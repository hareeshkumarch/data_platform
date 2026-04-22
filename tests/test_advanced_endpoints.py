"""Tests for the advanced-analytics + cleaning + demo catalogue endpoints.

The task runner is asyncio-based; inside ``TestClient`` the background task
is scheduled against the request-scoped loop which is torn down before it
runs. For CI we avoid the async seed path entirely and exercise the
handlers by materializing a dataset on disk directly.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg2://postgres:postgres@localhost:5432/lumen"
)

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.demo_datasets import generate_demo  # noqa: E402
from backend.services.storage_service import StorageService  # noqa: E402

client = TestClient(app)


def _materialize(kind: str) -> str:
    """Write a demo CSV to disk and register it — returns the dataset id."""
    filename, content = generate_demo(kind)
    storage = StorageService()
    import asyncio

    ref = asyncio.get_event_loop().run_until_complete(
        storage.store_file(content, filename)
    )
    return ref["dataset_id"]


def test_demo_catalogue_lists_all_kinds() -> None:
    response = client.get("/api/v1/datasets/demo-catalogue")
    assert response.status_code == 200
    kinds = {d["kind"] for d in response.json()["datasets"]}
    assert {
        "sales",
        "ecommerce",
        "marketing",
        "finance",
        "hr",
        "customers",
        "iot",
    }.issubset(kinds)


def test_dataset_stats_returns_quality_score() -> None:
    dataset_id = _materialize("sales")
    stats = client.get(f"/api/v1/datasets/{dataset_id}/stats").json()
    assert stats["row_count"] > 0
    assert stats["col_count"] > 0
    assert 0 <= stats["quality_score"] <= 100


def test_correlations_matrix_is_square() -> None:
    dataset_id = _materialize("finance")
    corr = client.get(f"/api/v1/analytics/{dataset_id}/correlations").json()
    cols = corr["columns"]
    matrix = corr["matrix"]
    assert len(matrix) == len(cols)
    for row in matrix:
        assert len(row) == len(cols)


def test_cleaning_suggestions_and_preview() -> None:
    dataset_id = _materialize("marketing")
    sugg = client.get(f"/api/v1/cleaning/suggestions/{dataset_id}").json()
    assert isinstance(sugg["suggestions"], list)

    preview = client.post(
        f"/api/v1/cleaning/{dataset_id}/preview",
        json={
            "operations": [{"op": "drop_duplicates"}, {"op": "trim_strings"}],
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["report"]["rows_before"] > 0
    assert "steps" in body["report"]


def test_outliers_and_trends_endpoints() -> None:
    dataset_id = _materialize("marketing")
    outliers = client.get(f"/api/v1/analytics/{dataset_id}/outliers").json()
    assert "outliers" in outliers
    trends = client.get(f"/api/v1/analytics/{dataset_id}/trends").json()
    assert "trends" in trends
