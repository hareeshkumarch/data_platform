from __future__ import annotations

import os

import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE}/api/v1"


def test_health_v1_reports_cache_field_connected():
    r = requests.get(f"{API}/health", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "ok"

    assert "cache" in body, f"expected 'cache' key, got keys={list(body.keys())}"
    assert body["cache"] == "connected", body
    assert "version" in body, f"expected 'version' key, got {body}"


def test_seed_demo_idempotent_same_id_and_no_task_id():
    r1 = requests.post(f"{API}/datasets/seed-demo", timeout=60)
    assert r1.status_code in (200, 201, 202), r1.text
    body1 = r1.json()
    ds1 = body1.get("dataset_id") or body1.get("id")
    assert ds1, f"no dataset_id in first response: {body1}"

    r2 = requests.post(f"{API}/datasets/seed-demo", timeout=60)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2.get("status") == "success", body2

    assert "task_id" in body2, f"task_id field missing: {body2}"
    assert body2["task_id"] is None, f"expected task_id=null, got {body2['task_id']}"

    ds2 = body2.get("dataset_id") or body2.get("id")
    assert ds2 == ds1, f"dataset_id changed between calls: {ds1!r} vs {ds2!r}"


def test_datasets_list_has_single_sales_performance_entry():
    for _ in range(3):
        requests.post(f"{API}/datasets/seed-demo", timeout=60)
    r = requests.get(f"{API}/datasets", timeout=30)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("datasets") or items.get("items") or []

    matches = [
        d
        for d in items
        if (d.get("name") or "").strip().lower() == "sales performance (sample)"
    ]
    assert len(matches) == 1, (
        f"expected exactly ONE 'Sales Performance (Sample)' entry, got "
        f"{len(matches)}: names={[d.get('name') for d in items]}"
    )
