from __future__ import annotations

import os
import re
from typing import Callable, Optional

from fastapi import Request
from starlette.responses import JSONResponse

from backend.services.cache_service import CacheService

_DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "chat": (60, 60),
    "query": (30, 60),
    "insights": (10, 60),
    "dashboard": (10, 60),
    "report": (5, 60),
    "forecast": (10, 60),
    "anomalies": (20, 60),
    "cleaning": (10, 60),
    "jobs": (60, 60),
}


def _load_limit(bucket: str) -> tuple[int, int]:
    env_key = f"RATE_LIMIT_{bucket.upper()}"
    raw = os.environ.get(env_key)
    if raw:
        try:
            parts = raw.split(",")
            return int(parts[0]), int(parts[1]) if len(parts) > 1 else 60
        except (ValueError, IndexError):
            pass
    return _DEFAULT_LIMITS.get(bucket, (60, 60))


_ROUTE_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^/api/v1/chat(-stream)?/?$"), "chat"),
    (re.compile(r"^/api/v1/query/[^/]+/?$"), "query"),
    (re.compile(r"^/api/v1/generate-insights/[^/]+/?$"), "insights"),
    (re.compile(r"^/api/v1/dashboard/[^/]+/?$"), "dashboard"),
    (re.compile(r"^/api/v1/report/[^/]+/?$"), "report"),
    (re.compile(r"^/api/v1/analytics/[^/]+/forecast$"), "forecast"),
    (re.compile(r"^/api/v1/analytics/[^/]+/anomalies$"), "anomalies"),
    (re.compile(r"^/api/v1/cleaning/(suggest|preview|apply)/[^/]+/?$"), "cleaning"),
    (re.compile(r"^/api/v1/jobs/?"), "jobs"),
]


def _match(path: str) -> Optional[str]:
    for pattern, bucket in _ROUTE_PATTERNS:
        if pattern.match(path):
            return bucket
    return None


def _client_identity(request: Request) -> str:
    auth = request.headers.get("authorization")
    if auth:
        import hashlib

        return f"user:{hashlib.sha256(auth.encode()).hexdigest()[:16]}"

    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if fwd:
        return f"ip:{fwd.split(',')[0].strip()}"
    return f"ip:{request.client.host if request.client else 'anon'}"


_cache = CacheService()


async def rate_limit_middleware(request: Request, call_next: Callable):
    bucket = _match(request.url.path)
    if bucket:
        limit, window = _load_limit(bucket)
        identity = _client_identity(request)
        key = f"{bucket}:{identity}"
        allowed = await _cache.check_rate_limit(key, limit, window)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded for {bucket} ({limit}/{window}s). Please retry shortly.",
                    "bucket": bucket,
                    "limit": limit,
                    "window_seconds": window,
                },
                headers={
                    "Retry-After": str(window),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Bucket": bucket,
                },
            )
    return await call_next(request)
