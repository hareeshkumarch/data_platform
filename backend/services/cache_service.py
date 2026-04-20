from __future__ import annotations
import json
from typing import Any, Optional

import redis.asyncio as aioredis

from backend.config import settings
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)


class CacheService:
    def __init__(self):
        self._pool = aioredis.ConnectionPool.from_url(
            settings.REDIS_URL, max_connections=50, decode_responses=True
        )
        self._r = aioredis.Redis(connection_pool=self._pool)

    async def get(self, key: str) -> Optional[str]:
        try:
            val = await self._r.get(key)
            ns = key.split(":")[0]
            (metrics.cache_hits if val else metrics.cache_misses).labels(type=ns).inc()
            return val
        except Exception as e:
            logger.error("cache.get failed", key=key, error=str(e))
            return None

    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        try:
            ttl = ttl or settings.REDIS_TTL_DEFAULT
            data = value if isinstance(value, str) else json.dumps(value, default=str)
            await self._r.setex(key, ttl, data)
            return True
        except Exception as e:
            logger.error("cache.set failed", key=key, error=str(e))
            return False

    async def delete(self, key: str) -> bool:
        try:
            await self._r.delete(key)
            return True
        except Exception as e:
            logger.error("cache.delete failed", key=key, error=str(e))
            return False

    async def get_json(self, key: str) -> Optional[Any]:
        raw = await self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return raw

    async def set_json(self, key: str, value: Any, ttl: int = None) -> bool:
        return await self.set(key, json.dumps(value, default=str), ttl)

    async def get_schema(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"schema:{dataset_id}")

    async def set_schema(self, dataset_id: str, schema: Any) -> bool:
        return await self.set_json(f"schema:{dataset_id}", schema, ttl=86400)

    async def get_sample(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"sample:{dataset_id}")

    async def set_sample(self, dataset_id: str, rows: Any) -> bool:
        return await self.set_json(f"sample:{dataset_id}", rows, ttl=86400)

    async def get_eda(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"eda:{dataset_id}")

    async def set_eda(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(f"eda:{dataset_id}", data, ttl=86400)

    async def get_insights(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"insights:{dataset_id}")

    async def set_insights(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(f"insights:{dataset_id}", data, ttl=86400)

    async def get_charts(self, dataset_id: str) -> Optional[Any]:
        return await self.get_json(f"charts:{dataset_id}")

    async def set_charts(self, dataset_id: str, data: Any) -> bool:
        return await self.set_json(f"charts:{dataset_id}", data, ttl=settings.REDIS_TTL_CHART)

    async def get_query(self, key: str) -> Optional[Any]:
        return await self.get_json(f"query:{key}")

    async def set_query(self, key: str, data: Any) -> bool:
        return await self.set_json(f"query:{key}", data, ttl=settings.REDIS_TTL_QUERY)

    async def set_agent_state(self, corr_id: str, agent: str, data: Any) -> bool:
        return await self.set_json(f"state:{corr_id}:{agent}", data, ttl=3600)

    async def get_agent_state(self, corr_id: str, agent: str) -> Optional[Any]:
        return await self.get_json(f"state:{corr_id}:{agent}")

    async def set_task_progress(self, task_id: str, progress: float, status: str) -> bool:
        return await self.set_json(f"task:{task_id}", {"progress": progress, "status": status}, ttl=7200)

    async def get_task_progress(self, task_id: str) -> Optional[Any]:
        return await self.get_json(f"task:{task_id}")

    async def check_rate_limit(self, key: str, limit: int, window: int = 60) -> bool:
        try:
            pipe = self._r.pipeline()
            pipe.incr(f"rl:{key}")
            pipe.expire(f"rl:{key}", window)
            results = await pipe.execute()
            return results[0] <= limit
        except Exception:
            return True

    async def invalidate_dataset(self, dataset_id: str):
        patterns = [f"schema:{dataset_id}", f"sample:{dataset_id}", f"eda:{dataset_id}",
                    f"insights:{dataset_id}", f"charts:{dataset_id}"]
        for p in patterns:
            await self.delete(p)
        for pattern in [f"query:{dataset_id}:*", f"state:*:{dataset_id}"]:
            keys = await self._r.keys(pattern)
            if keys:
                await self._r.delete(*keys)

    async def ping(self) -> bool:
        try:
            return await self._r.ping()
        except Exception:
            return False

    async def close(self):
        await self._r.aclose()
