"""In-memory cache service with TTL and typed accessors.

Drop-in replacement for the Redis-backed version used by the rest of the backend.
All methods are ``async`` so the existing call sites keep working without
modification. Values are scoped per-process which is sufficient for the
single-worker deployment used here.
"""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from typing import Any, Optional

from backend.config import settings
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)


class _TTLStore:
    """Thread-safe in-memory store with per-key TTL and pattern delete."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, Any]] = {}
        self._counters: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))
        self._lock = threading.RLock()

    def get(self, key: str) -> Any:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires and expires < time.time():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        expires = time.time() + ttl if ttl else 0.0
        with self._lock:
            self._data[key] = (expires, value)

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        with self._lock:
            for k in [k for k in self._data if k.startswith(prefix)]:
                self._data.pop(k, None)

    def flush_all(self) -> None:
        """Wipe every key — equivalent to Redis FLUSHDB."""
        with self._lock:
            self._data.clear()
            self._counters.clear()

    def incr_window(self, key: str, window: int) -> int:
        with self._lock:
            count, expiry = self._counters[key]
            now = time.time()
            if expiry < now:
                count, expiry = 0, now + window
            count += 1
            self._counters[key] = (count, expiry)
            return count


_STORE = _TTLStore()


class CacheService:
    """Namespace-aware cache wrapper that matches the Redis client surface."""

    async def get(self, key: str) -> Optional[str]:
        val = _STORE.get(key)
        ns = key.split(":", 1)[0]
        (metrics.cache_hits if val is not None else metrics.cache_misses).labels(
            type=ns
        ).inc()
        if val is None:
            return None
        return val if isinstance(val, str) else json.dumps(val, default=str)

    async def set(self, key: str, value: Any, ttl: int | None = None) -> bool:
        _STORE.set(
            key,
            value if not isinstance(value, str) else value,
            ttl or settings.CACHE_TTL_DEFAULT,
        )
        return True

    async def delete(self, key: str) -> bool:
        _STORE.delete(key)
        return True

    async def get_json(self, key: str) -> Optional[Any]:
        raw = _STORE.get(key)
        if raw is None:
            return None
        if isinstance(raw, (dict, list)):
            return raw
        try:
            return json.loads(raw)
        except Exception:
            return raw

    async def set_json(self, key: str, value: Any, ttl: int | None = None) -> bool:
        _STORE.set(key, value, ttl or settings.CACHE_TTL_DEFAULT)
        return True

    # Typed accessors kept identical to the Redis service so call-sites need no change.
    async def get_schema(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"schema:{dataset_id}")

    async def set_schema(self, dataset_id: str, schema: Any) -> bool:
        return await self.set_json(
            f"schema:{dataset_id}", schema, ttl=settings.CACHE_TTL_LLM
        )

    async def get_sample(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"sample:{dataset_id}")

    async def set_sample(self, dataset_id: str, rows: Any) -> bool:
        return await self.set_json(
            f"sample:{dataset_id}", rows, ttl=settings.CACHE_TTL_LLM
        )

    async def get_eda(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"eda:{dataset_id}")

    async def set_eda(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(
            f"eda:{dataset_id}", data, ttl=settings.CACHE_TTL_LLM
        )

    async def get_insights(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"insights:{dataset_id}")

    async def set_insights(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(
            f"insights:{dataset_id}", data, ttl=settings.CACHE_TTL_LLM
        )

    async def get_charts(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"charts:{dataset_id}")

    async def set_charts(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(
            f"charts:{dataset_id}", data, ttl=settings.CACHE_TTL_CHART
        )

    async def cache_chart_config(self, key: str, config: Any) -> bool:
        return await self.set_json(
            f"chart_cfg:{key}", config, ttl=settings.CACHE_TTL_CHART
        )

    async def get_query(self, key: str) -> Optional[Any]:
        return await self.get_json(f"query:{key}")

    async def set_query(self, key: str, data: Any) -> bool:
        return await self.set_json(f"query:{key}", data, ttl=settings.CACHE_TTL_QUERY)

    async def set_agent_state(self, corr_id: str, agent: str, data: Any) -> bool:
        return await self.set_json(f"state:{corr_id}:{agent}", data, ttl=3600)

    async def get_agent_state(self, corr_id: str, agent: str) -> Optional[Any]:
        return await self.get_json(f"state:{corr_id}:{agent}")

    async def set_task_progress(
        self, task_id: str, progress: float, status: str
    ) -> bool:
        return await self.set_json(
            f"task:{task_id}", {"progress": progress, "status": status}, ttl=7200
        )

    async def get_task_progress(self, task_id: str) -> Optional[Any]:
        return await self.get_json(f"task:{task_id}")

    async def check_rate_limit(self, key: str, limit: int, window: int = 60) -> bool:
        count = _STORE.incr_window(f"rl:{key}", window)
        return count <= limit

    async def invalidate_dataset(self, dataset_id: str) -> None:
        for prefix in (
            f"schema:{dataset_id}",
            f"sample:{dataset_id}",
            f"eda:{dataset_id}",
            f"insights:{dataset_id}",
            f"charts:{dataset_id}",
            f"chart_cfg:{dataset_id}",
        ):
            _STORE.delete(prefix)
        _STORE.delete_prefix(f"query:{dataset_id}")
        _STORE.delete_prefix(f"state:{dataset_id}")

    async def ping(self) -> bool:  # noqa: D401
        """Always available — in-memory cache has no connection."""
        return True

    async def flush_all(self) -> None:
        """Wipe everything from the in-memory store."""
        _STORE.flush_all()

    async def close(self) -> None:  # pragma: no cover
        return None
