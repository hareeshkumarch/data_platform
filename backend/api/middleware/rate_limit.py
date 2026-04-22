"""Lightweight per-IP rate limiter for LLM-heavy endpoints.

Uses the in-memory cache's sliding-window counter. Rate limits are intentionally
generous — the goal is to keep a single abusive client from exhausting the
LLM service quota, not to throttle legitimate use.
"""

from __future__ import annotations

import re
from typing import Callable

from fastapi import Request
from starlette.responses import JSONResponse

from backend.services.cache_service import CacheService


_LIMITS: dict[re.Pattern, tuple[int, int, str]] = {
    re.compile(r"^/api/v1/chat(-stream)?/?$"): (60, 60, "chat"),
    re.compile(r"^/api/v1/query/[^/]+/?$"): (30, 60, "query"),
    re.compile(r"^/api/v1/generate-insights/[^/]+/?$"): (10, 60, "insights"),
    re.compile(r"^/api/v1/dashboard/[^/]+/?$"): (10, 60, "dashboard"),
    re.compile(r"^/api/v1/report/[^/]+/?$"): (5, 60, "report"),
}


def _match(path: str) -> tuple[int, int, str] | None:
    for pattern, cfg in _LIMITS.items():
        if pattern.match(path):
            return cfg
    return None


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "anon"


_cache = CacheService()


async def rate_limit_middleware(request: Request, call_next: Callable):
    """ASGI middleware that rate-limits LLM-heavy routes."""
    cfg = _match(request.url.path)
    if cfg:
        limit, window, bucket = cfg
        key = f"{bucket}:{_client_ip(request)}"
        allowed = await _cache.check_rate_limit(key, limit, window)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded for {bucket} ({limit}/min). Please retry shortly."
                },
                headers={"Retry-After": str(window)},
            )
    return await call_next(request)
