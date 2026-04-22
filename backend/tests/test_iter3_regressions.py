"""Iteration 3 regression tests.

Validates the two small changes applied after iteration 2:
  1. POST /api/v1/datasets/seed-demo is idempotent:
       - 2nd call returns same dataset_id
       - 2nd call returns status='success' and task_id=null (reuse path)
       - GET /api/v1/datasets shows exactly ONE entry with
         name='Sales Performance (Sample)' regardless of repeats
  2. /api/v1/health now reports a 'cache' field (not 'redis') with value
     'connected'.
"""

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
    # New field per iteration 3
    assert "cache" in body, f"expected 'cache' key, got keys={list(body.keys())}"
    assert body["cache"] == "connected", body
    assert "version" in body, f"expected 'version' key, got {body}"


def test_seed_demo_idempotent_same_id_and_no_task_id():
    # First call — may or may not be a reuse depending on previous state
    r1 = requests.post(f"{API}/datasets/seed-demo", timeout=60)
    assert r1.status_code in (200, 201, 202), r1.text
    body1 = r1.json()
    ds1 = body1.get("dataset_id") or body1.get("id")
    assert ds1, f"no dataset_id in first response: {body1}"

    # Second call — MUST be idempotent reuse path
    r2 = requests.post(f"{API}/datasets/seed-demo", timeout=60)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2.get("status") == "success", body2
    # Reuse-path contract: task_id field present but null
    assert "task_id" in body2, f"task_id field missing: {body2}"
    assert body2["task_id"] is None, f"expected task_id=null, got {body2['task_id']}"

    ds2 = body2.get("dataset_id") or body2.get("id")
    assert ds2 == ds1, f"dataset_id changed between calls: {ds1!r} vs {ds2!r}"


def test_datasets_list_has_single_sales_performance_entry():
    # Hammer seed-demo a few times to ensure no duplicates are created
    for _ in range(3):
        requests.post(f"{API}/datasets/seed-demo", timeout=60)
    r = requests.get(f"{API}/datasets", timeout=30)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("datasets") or items.get("items") or []
    # Match by the 'name' field the backend stores
    matches = [
        d
        for d in items
        if (d.get("name") or "").strip().lower() == "sales performance (sample)"
    ]
    assert len(matches) == 1, (
        f"expected exactly ONE 'Sales Performance (Sample)' entry, got "
        f"{len(matches)}: names={[d.get('name') for d in items]}"
    )
