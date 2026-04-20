"""Tests for the newly-added conversations + rate limit endpoints."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("EMERGENT_LLM_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://postgres:postgres@localhost:5432/lumen")

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

client = TestClient(app)


def test_conversations_crud() -> None:
    payload = {
        "id": "conv-unit-1",
        "title": "Unit test conversation",
        "mode": "chat",
        "messages": [
            {"id": "m1", "role": "user", "content": "Hello", "mode": "chat"},
            {"id": "m2", "role": "assistant", "content": "Hi there", "mode": "chat"},
        ],
    }
    response = client.post("/api/v1/conversations", json=payload)
    assert response.status_code == 200
    assert response.json()["id"] == "conv-unit-1"

    response = client.get("/api/v1/conversations/conv-unit-1")
    assert response.status_code == 200
    data = response.json()
    assert len(data["messages"]) == 2
    assert data["title"] == "Unit test conversation"

    response = client.delete("/api/v1/conversations/conv-unit-1")
    assert response.status_code == 200
    assert response.json()["deleted"] is True


def test_conversations_list_empty() -> None:
    response = client.get("/api/v1/conversations")
    assert response.status_code == 200
    assert isinstance(response.json().get("conversations"), list)


def test_llm_metrics_includes_key_source() -> None:
    response = client.get("/api/v1/metrics/llm")
    assert response.status_code == 200
    data = response.json()
    assert "key_source" in data
    assert data["key_source"] in {"emergent", "openai", "anthropic", "gemini", "none"}
    assert "active_provider" in data
    assert "active_model" in data


def test_rate_limit_returns_429_when_exceeded() -> None:
    # The ``report`` bucket limits to 5/min — trigger it with concentrated traffic.
    statuses = [
        client.post("/api/v1/report/does-not-exist", json={}).status_code
        for _ in range(8)
    ]
    assert 429 in statuses
