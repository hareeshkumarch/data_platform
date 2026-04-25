from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_root = Path(__file__).resolve().parent.parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("GROQ_API_KEY", "test-key")


@pytest.fixture
def storage():
    svc = MagicMock()
    svc.list_datasets.return_value = [
        {
            "id": "test-ds-1",
            "dataset_id": "test-ds-1",
            "filename": "test.csv",
            "size_bytes": 1024,
            "checksum_sha256": "abc123",
            "created_at": 1700000000,
            "last_accessed_at": 1700000000,
        }
    ]
    svc.get_storage_stats.return_value = {
        "total_datasets": 1,
        "total_bytes": 1024,
        "total_mb": 0.001,
    }
    svc.list_stale_datasets.return_value = []
    svc.verify_checksum.return_value = {
        "valid": True,
        "stored_checksum": "abc123",
        "current_checksum": "abc123",
        "dataset_id": "test-ds-1",
    }
    svc.validate_upload.return_value = {
        "valid": True,
        "errors": [],
        "warnings": [],
        "stats": {"rows": 100, "cols": 5},
    }
    return svc


@pytest.fixture
def cache():
    svc = AsyncMock()
    svc.get_schema = AsyncMock(return_value=None)
    svc.set_schema = AsyncMock()
    svc.get_json = AsyncMock(return_value=None)
    svc.set_json = AsyncMock()
    svc.delete = AsyncMock()
    return svc
