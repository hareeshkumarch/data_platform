from __future__ import annotations

import json
import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api/v1"


def test_health():
    r = requests.get(f"{API}/health", timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


def test_providers():
    r = requests.get(f"{API}/settings/providers", timeout=30)
    assert r.status_code == 200
    data = r.json()
    for p in ("openai", "anthropic", "gemini"):
        assert p in data["providers"], f"missing provider {p}"
    assert data["key_configured"] is True
    assert data["default_provider"] == "openai"


def test_chat_openai_real_reply():
    payload = {
        "prompt": "Say exactly hello world",
        "provider": "openai",
        "model": "gpt-5.2",
    }
    r = requests.post(f"{API}/chat", json=payload, timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()

    text = (
        body.get("reply")
        or body.get("response")
        or body.get("content")
        or body.get("message")
        or ""
    )
    assert isinstance(text, str) and len(text) > 0, f"empty LLM reply: {body}"


def test_chat_stream_sse():
    params = {
        "prompt": "Say hello in 3 words.",
        "provider": "openai",
        "model": "gpt-5.2",
    }
    got_token = False
    got_done = False
    with requests.get(
        f"{API}/chat-stream", params=params, stream=True, timeout=120
    ) as r:
        assert r.status_code == 200, r.text
        deadline = time.time() + 90
        for raw in r.iter_lines(decode_unicode=True):
            if time.time() > deadline:
                break
            if not raw:
                continue
            if raw.startswith("data:"):
                chunk = raw[5:].strip()
                if chunk == "[DONE]":
                    got_done = True
                    break
                try:
                    parsed = json.loads(chunk)
                    if "token" in parsed or "content" in parsed or "delta" in parsed:
                        got_token = True
                except Exception:
                    got_token = True
    assert got_token, "no streamed tokens received"
    assert got_done, "SSE did not emit [DONE] marker"


@pytest.fixture(scope="module")
def seeded_dataset_id() -> str:
    r = requests.post(f"{API}/datasets/seed-demo", timeout=60)
    assert r.status_code in (200, 201, 202), r.text
    body = r.json()

    if (
        body.get("status") == "success"
        and body.get("task_id") is None
        and body.get("dataset_id")
    ):
        return body["dataset_id"]
    task_id = body.get("task_id") or body.get("id")
    assert task_id, f"no task id in seed response: {body}"

    deadline = time.time() + 60
    status = None
    while time.time() < deadline:
        tr = requests.get(f"{API}/task/{task_id}", timeout=15)
        assert tr.status_code == 200, tr.text
        tb = tr.json()
        status = tb.get("status") or ("success" if tb.get("success") else None)
        if tb.get("success") is True or status in (
            "success",
            "SUCCESS",
            "completed",
            "done",
        ):
            break
        if status in ("failed", "error", "FAILURE"):
            pytest.fail(f"seed task failed: {tb}")
        time.sleep(1.0)

    lr = requests.get(f"{API}/datasets", timeout=30)
    assert lr.status_code == 200, lr.text
    items = lr.json()
    if isinstance(items, dict):
        items = items.get("datasets") or items.get("items") or []
    assert len(items) >= 1, f"no datasets listed: {items}"

    with_cols = [d for d in items if d.get("columns")]
    ds = with_cols[-1] if with_cols else items[-1]
    return ds.get("id") or ds.get("dataset_id") or ds.get("table_name")


def test_seed_and_list(seeded_dataset_id):
    assert seeded_dataset_id
    r = requests.get(f"{API}/datasets", timeout=30)
    assert r.status_code == 200
    items = r.json()
    if isinstance(items, dict):
        items = items.get("datasets") or items.get("items") or []
    assert any(
        (d.get("row_count") == 260 and d.get("col_count") == 8) for d in items
    ), f"expected row_count=260 col_count=8 in at least one dataset: {items}"


def test_dataset_preview(seeded_dataset_id):
    r = requests.get(f"{API}/datasets/{seeded_dataset_id}/preview", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body.get("rows") or body.get("data") or body
    assert rows and len(rows) > 0, f"empty preview: {body}"


def test_warehouse_tables():
    r = requests.get(f"{API}/warehouse/tables", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    tables = body if isinstance(body, list) else body.get("tables") or []
    table_names = [
        t if isinstance(t, str) else (t.get("name") or t.get("table_name"))
        for t in tables
    ]
    assert any((n or "").lower() == "sales_performance" for n in table_names), (
        f"sales_performance missing: {table_names}"
    )


def test_warehouse_query():
    r = requests.post(
        f"{API}/warehouse/query",
        json={"sql": "SELECT * FROM sales_performance LIMIT 5"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body.get("rows") or body.get("data") or []
    assert len(rows) > 0, f"no rows from SQL: {body}"


def test_analytics_profile(seeded_dataset_id):
    r = requests.post(
        f"{API}/analytics/{seeded_dataset_id}",
        json={"analysis_type": "profile", "config": {}},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body, f"empty analytics: {body}"


def test_chart_generate(seeded_dataset_id):
    r = requests.post(
        f"{API}/chart/generate",
        json={"dataset_id": seeded_dataset_id, "chart_type": "bar"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body, f"empty chart config: {body}"


def test_settings_persist_and_read_back():
    r = requests.post(
        f"{API}/settings",
        json={"provider": "anthropic", "model": "claude-sonnet-4-5-20250929"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    pr = requests.get(f"{API}/settings/providers", timeout=30).json()
    assert pr.get("default_provider") == "anthropic", pr
    assert pr.get("default_model") == "claude-sonnet-4-5-20250929", pr

    r2 = requests.post(
        f"{API}/settings",
        json={"provider": "openai", "model": "gpt-5.2"},
        timeout=30,
    )
    assert r2.status_code in (200, 201)
    pr2 = requests.get(f"{API}/settings/providers", timeout=30).json()
    assert pr2.get("default_provider") == "openai"


def test_system_stats():
    r = requests.get(f"{API}/system/stats", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict) and len(body) > 0


def test_llm_metrics():
    r = requests.get(f"{API}/metrics/llm", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)


def test_generate_insights(seeded_dataset_id):
    r = requests.post(
        f"{API}/generate-insights/{seeded_dataset_id}",
        json={"focus_columns": None, "llm_provider": "openai", "llm_model": "gpt-5.2"},
        timeout=60,
    )
    assert r.status_code in (200, 201, 202), r.text
    body = r.json()
    task_id = body.get("task_id") or body.get("id")
    assert task_id, f"no task id: {body}"
    deadline = time.time() + 90
    while time.time() < deadline:
        tr = requests.get(f"{API}/task/{task_id}", timeout=15).json()
        if tr.get("success") is True or tr.get("status") in (
            "success",
            "SUCCESS",
            "completed",
            "done",
        ):
            return
        if tr.get("status") in ("failed", "error", "FAILURE"):
            pytest.fail(f"insight task failed: {tr}")
        time.sleep(1.5)
    pytest.fail("insight task did not complete in time")
