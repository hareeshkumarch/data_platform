from __future__ import annotations

import json
import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE}/api/v1"

EXPECTED_GROQ_MODELS = {
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
}


def test_ingress_health():
    r = requests.get(f"{BASE}/api/health", timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"


def test_models_includes_groq_and_catalogue():
    r = requests.get(f"{API}/models", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "groq" in data["providers"], data["providers"]
    groq_ids = {m["id"] for m in data["models"].get("groq", [])}
    missing = EXPECTED_GROQ_MODELS - groq_ids
    assert not missing, f"missing groq models: {missing}; got {groq_ids}"


def test_settings_providers_exposes_groq_key_flags():
    r = requests.get(f"{API}/settings/providers", timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert "groq" in body["providers"]

    assert body.get("key_configured") is True
    assert "key_masked" in body

    assert "groq_key_masked" in body
    assert "groq_key_configured" in body
    assert body["groq_key_configured"] is False
    assert body["groq_key_masked"] in ("", None)


def test_metrics_llm_key_source_provider():
    r = requests.get(f"{API}/metrics/llm", timeout=30)
    assert r.status_code == 200
    body = r.json()

    assert body.get("key_source") in (
        "openai",
        "anthropic",
        "gemini",
        "groq",
        "none",
    ), body
    assert body["key_source"] in ("openai", "anthropic", "gemini", "groq", "none")


def test_settings_accepts_groq_provider_whitelist():
    r = requests.post(
        f"{API}/settings",
        json={"provider": "groq", "model": "llama-3.3-70b-versatile"},
        timeout=30,
    )
    assert r.status_code in (200, 201), (
        f"groq whitelist rejected: {r.status_code} {r.text}"
    )
    pr = requests.get(f"{API}/settings/providers", timeout=30).json()
    assert pr["default_provider"] == "groq"
    assert pr["default_model"] == "llama-3.3-70b-versatile"

    r2 = requests.post(
        f"{API}/settings",
        json={"provider": "openai", "model": "gpt-5.2"},
        timeout=30,
    )
    assert r2.status_code in (200, 201)


def test_chat_groq_without_key_returns_clear_error():
    r = requests.post(
        f"{API}/chat",
        json={
            "prompt": "hello",
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
        },
        timeout=60,
    )

    assert r.status_code in (400, 500, 502, 503), (
        f"unexpected status: {r.status_code} {r.text}"
    )
    text = r.text.lower()
    assert "groq_api_key" in text or "groq api key" in text or "groq" in text, (
        f"error text not helpful: {r.text}"
    )


@pytest.fixture(scope="module")
def dataset_id() -> str:
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
    assert task_id
    deadline = time.time() + 60
    while time.time() < deadline:
        tb = requests.get(f"{API}/task/{task_id}", timeout=15).json()
        if tb.get("success") is True or tb.get("status") in (
            "success",
            "SUCCESS",
            "completed",
            "done",
        ):
            break
        if tb.get("status") in ("failed", "error", "FAILURE"):
            pytest.fail(f"seed failed: {tb}")
        time.sleep(1.0)

    if body.get("dataset_id"):
        return body["dataset_id"]
    items = requests.get(f"{API}/datasets", timeout=30).json()
    if isinstance(items, dict):
        items = items.get("datasets") or items.get("items") or []
    sales = [
        d
        for d in items
        if (d.get("name") or "").lower().startswith("sales performance")
    ]
    ds = sales[0] if sales else items[-1]
    return ds.get("id") or ds.get("dataset_id") or ds.get("table_name")


def test_process_data_and_eda(dataset_id):
    r = requests.post(f"{API}/process-data/{dataset_id}", json={}, timeout=60)

    assert r.status_code in (200, 201, 202), r.text
    body = r.json()
    task_id = body.get("task_id") or body.get("id")
    if task_id:
        deadline = time.time() + 60
        while time.time() < deadline:
            tb = requests.get(f"{API}/task/{task_id}", timeout=15).json()
            if tb.get("success") is True or tb.get("status") in (
                "success",
                "SUCCESS",
                "completed",
                "done",
            ):
                break
            if tb.get("status") in ("failed", "error", "FAILURE"):
                pytest.fail(f"process-data failed: {tb}")
            time.sleep(1.0)

    er = requests.get(f"{API}/eda/{dataset_id}", timeout=30)
    assert er.status_code == 200, er.text
    ebody = er.json()
    assert isinstance(ebody, dict) and len(ebody) > 0


def test_generate_and_fetch_insights(dataset_id):
    r = requests.post(
        f"{API}/generate-insights/{dataset_id}",
        json={"focus_columns": None, "llm_provider": "openai", "llm_model": "gpt-5.2"},
        timeout=60,
    )
    assert r.status_code in (200, 201, 202), r.text
    task_id = r.json().get("task_id") or r.json().get("id")
    assert task_id
    deadline = time.time() + 120
    while time.time() < deadline:
        tb = requests.get(f"{API}/task/{task_id}", timeout=15).json()
        if tb.get("success") is True or tb.get("status") in (
            "success",
            "SUCCESS",
            "completed",
            "done",
        ):
            break
        if tb.get("status") in ("failed", "error", "FAILURE"):
            pytest.fail(f"insight task failed: {tb}")
        time.sleep(2.0)

    ir = requests.get(f"{API}/insights/{dataset_id}", timeout=30)
    assert ir.status_code == 200, ir.text
    ibody = ir.json()
    insights = (
        ibody
        if isinstance(ibody, list)
        else ibody.get("insights") or ibody.get("items") or []
    )
    assert len(insights) >= 1, f"no insights returned: {ibody}"


def test_chart_generate_shape(dataset_id):
    r = requests.post(
        f"{API}/chart/generate",
        json={"dataset_id": dataset_id, "chart_type": "bar"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    chart_type = (
        body.get("chart_type")
        or body.get("type")
        or (body.get("config") or {}).get("chart_type")
    )
    data = (
        body.get("data") or (body.get("config") or {}).get("data") or body.get("rows")
    )
    assert chart_type, f"chart missing chart_type: {body}"
    assert data is not None, f"chart missing data: {body}"


def test_dashboard_generate_and_fetch(dataset_id):
    r = requests.post(f"{API}/dashboard/{dataset_id}", json={}, timeout=120)
    assert r.status_code in (200, 201, 202), r.text
    body = r.json()
    task_id = body.get("task_id") or body.get("id")
    if task_id and not body.get("charts"):
        deadline = time.time() + 120
        while time.time() < deadline:
            tb = requests.get(f"{API}/task/{task_id}", timeout=15).json()
            if tb.get("success") is True or tb.get("status") in (
                "success",
                "SUCCESS",
                "completed",
                "done",
            ):
                break
            if tb.get("status") in ("failed", "error", "FAILURE"):
                pytest.fail(f"dashboard task failed: {tb}")
            time.sleep(2.0)

    gr = requests.get(f"{API}/dashboard/{dataset_id}", timeout=30)
    assert gr.status_code == 200, gr.text
    gbody = gr.json()
    charts = gbody.get("charts") or []
    kpis = gbody.get("kpis") or []
    assert isinstance(charts, list), f"charts not list: {gbody}"
    assert isinstance(kpis, list), f"kpis not list: {gbody}"

    assert len(charts) + len(kpis) > 0, f"dashboard empty: {gbody}"


def test_query_natural_language(dataset_id):
    r = requests.post(
        f"{API}/query/{dataset_id}",
        json={"question": "How many rows are in this dataset?"},
        timeout=120,
    )
    assert r.status_code in (200, 201, 202), r.text
    body = r.json()
    task_id = body.get("task_id") or body.get("id")
    if task_id and not (body.get("rows") or body.get("result")):
        deadline = time.time() + 120
        final = None
        while time.time() < deadline:
            tb = requests.get(f"{API}/task/{task_id}", timeout=15).json()
            status = tb.get("status") or ("success" if tb.get("success") else None)
            if tb.get("success") is True or status in (
                "success",
                "SUCCESS",
                "completed",
                "done",
            ):
                final = tb
                break
            if status in ("failed", "error", "FAILURE"):
                pytest.fail(f"query task failed: {tb}")
            time.sleep(2.0)
        assert final is not None, "query task did not complete"
        body = final.get("result") or final

    has_payload = any(
        k in body for k in ("rows", "data", "sql", "plan", "result", "answer")
    )
    assert has_payload, f"query returned no payload: {body}"


def test_analytics_kpis_and_profile(dataset_id):
    for analysis in ("kpis", "profile"):
        r = requests.post(
            f"{API}/analytics/{dataset_id}",
            json={"analysis_type": analysis, "config": {}},
            timeout=60,
        )
        assert r.status_code == 200, f"{analysis}: {r.text}"
        body = r.json()
        assert body, f"{analysis} returned empty: {body}"


def test_ws_pipeline_flow():
    try:
        from websockets.sync.client import connect
    except Exception:
        pytest.skip("websockets lib not available in this env")

    ws_url = (
        BASE.replace("https://", "wss://").replace("http://", "ws://")
        + "/api/v1/ws/pipeline"
    )
    stages = []
    complete = None
    with connect(ws_url, open_timeout=15) as ws:
        ws.send(
            json.dumps(
                {
                    "prompt": "Summarise the sales trends in the demo data",
                    "provider": "openai",
                    "model": "gpt-5.2",
                }
            )
        )
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                msg = ws.recv(timeout=15)
            except Exception:
                break
            try:
                frame = json.loads(msg)
            except Exception:
                continue
            t = frame.get("type") or frame.get("event") or frame.get("stage")
            if (
                frame.get("type") == "complete"
                or frame.get("done")
                or frame.get("final")
            ):
                complete = frame
                break
            if t:
                stages.append(t)
    assert stages, "no pipeline stage frames received"
    assert complete is not None, "did not receive a final complete frame"
    reply = (
        complete.get("reply")
        or complete.get("message")
        or (complete.get("result") or {}).get("reply")
        or complete.get("content")
    )
    assert reply, f"complete frame missing reply: {complete}"
