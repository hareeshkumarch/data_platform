from __future__ import annotations

import pytest


class TestStandardResponseContract:
    def test_standard_response_shape(self):
        from backend.models.schemas import StandardResponse

        resp = StandardResponse(
            success=True,
            data={"key": "value"},
            message="OK",
        )
        d = resp.model_dump()
        assert d["success"] is True
        assert d["data"] == {"key": "value"}
        assert d["message"] == "OK"
        assert "errors" in d

    def test_standard_error_response_shape(self):
        from backend.models.schemas import StandardErrorResponse

        resp = StandardErrorResponse(
            success=False,
            error="Validation failed",
            detail="periods must be between 1 and 120",
            code="VALIDATION_ERROR",
        )
        d = resp.model_dump()
        assert d["success"] is False
        assert d["error"] == "Validation failed"
        assert "detail" in d
        assert "code" in d


class TestUploadValidation:
    def test_validates_valid_csv(self, tmp_path):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        content = b"name,age,city\nAlice,30,NYC\nBob,25,LA\n"
        result = svc.validate_upload(content, "test.csv")
        assert result["valid"] is True
        assert len(result["errors"]) == 0
        assert result["stats"]["rows"] == 2
        assert result["stats"]["cols"] == 3

    def test_rejects_unsupported_extension(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        result = svc.validate_upload(b"data", "test.docx")
        assert result["valid"] is False
        assert any("Unsupported" in e for e in result["errors"])

    def test_rejects_oversized_file(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()

        result = svc.validate_upload(
            b"x" * (1024 * 1024 + 1), "test.csv", max_size_mb=1
        )
        assert result["valid"] is False
        assert any("exceeds" in e for e in result["errors"])

    def test_rejects_unparseable_csv(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()

        result = svc.validate_upload(b"\x00\x01\x02\x03", "test.json")
        assert result["valid"] is False


class TestChecksumVerification:
    def test_missing_dataset_returns_not_found(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        result = svc.verify_checksum("nonexistent-id")
        assert result["valid"] is False
        assert "not found" in result.get("error", "").lower()


class TestConfigurationContract:
    def test_cache_backend_config(self):
        from backend.config import settings

        assert hasattr(settings, "CACHE_BACKEND")
        assert settings.CACHE_BACKEND in ("memory", "redis")

    def test_redis_url_config(self):
        from backend.config import settings

        assert hasattr(settings, "REDIS_URL")

    def test_code_exec_bounds(self):
        from backend.config import settings

        assert settings.CODE_EXEC_TIMEOUT_SEC > 0
        assert settings.CODE_EXEC_MAX_ROWS > 0

    def test_query_retry_config(self):
        from backend.config import settings

        assert settings.QUERY_MAX_RETRIES >= 1
        assert 0 <= settings.QUERY_RETRY_TEMP_ESCALATION <= 1.0

    def test_session_memory_config(self):
        from backend.config import settings

        assert settings.SESSION_MEMORY_MAX_TURNS >= 1
        assert settings.SESSION_MEMORY_TTL > 0


class TestStorageLifecycle:
    def test_storage_stats_shape(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        stats = svc.get_storage_stats()
        assert "total_datasets" in stats
        assert "total_bytes" in stats
        assert "total_mb" in stats
        assert isinstance(stats["total_datasets"], int)

    def test_list_stale_returns_list(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        stale = svc.list_stale_datasets(max_age_days=0)
        assert isinstance(stale, list)

    def test_purge_stale_returns_summary(self):
        from backend.services.storage_service import StorageService

        svc = StorageService()
        result = svc.purge_stale_datasets(max_age_days=99999)
        assert "purged_count" in result
        assert isinstance(result["purged_count"], int)
