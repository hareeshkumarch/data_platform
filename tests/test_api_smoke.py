"""Smoke tests for the Lumen FastAPI backend."""

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

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_models_endpoint() -> None:
    response = client.get("/api/v1/models")
    assert response.status_code == 200
    data = response.json()
    assert "providers" in data and isinstance(data["providers"], list)
    assert "openai" in data["providers"]


def test_providers_endpoint() -> None:
    response = client.get("/api/v1/settings/providers")
    assert response.status_code == 200
    data = response.json()
    assert "default_provider" in data
    assert "models" in data


def test_chart_types() -> None:
    response = client.get("/api/v1/chart-types")
    assert response.status_code == 200
    types = response.json()["chart_types"]
    assert any(t["id"] == "bar" for t in types)
