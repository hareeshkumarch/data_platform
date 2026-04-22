"""Lumen FastAPI entrypoint.

Also exposes an asyncio WebSocket for realtime pipeline progress and wires
in the SQL executor and persistent dataset store on top of PostgreSQL.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.middleware.rate_limit import rate_limit_middleware
from backend.api.routes.advanced import advanced_router
from backend.api.routes.conversations import conversations_router
from backend.api.routes.endpoints import router
from backend.api.routes.warehouse import warehouse_router
from backend.api.routes.websocket import register_websockets
from backend.config import settings
from backend.services.sql_service import SQLWarehouse
from backend.utils.logger import (
    configure_logging,
    get_logger,
    metrics,
    start_metrics_server,
)

configure_logging()
logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting Lumen",
        version=settings.APP_VERSION,
        provider=settings.DEFAULT_LLM_PROVIDER,
    )
    start_metrics_server()
    try:
        SQLWarehouse.get().bootstrap()
    except (
        Exception
    ) as exc:  # pragma: no cover - degrade gracefully when PG unavailable
        logger.warning("PostgreSQL bootstrap skipped", error=str(exc))
    yield
    logger.info("Shutdown")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Lumen — multi-agent data intelligence platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(rate_limit_middleware)


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    try:
        metrics.http_requests.labels(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code,
        ).inc()
        metrics.http_duration.labels(endpoint=request.url.path).observe(ms / 1000)
    except Exception:  # pragma: no cover - metric collection must never break requests
        pass
    response.headers["X-Response-Time-Ms"] = str(round(ms, 2))
    return response


@app.exception_handler(Exception)
async def global_error(request: Request, exc: Exception):
    logger.error("Unhandled error", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(router, prefix=settings.API_PREFIX)
app.include_router(warehouse_router, prefix=settings.API_PREFIX)
app.include_router(conversations_router, prefix=settings.API_PREFIX)
app.include_router(advanced_router, prefix=settings.API_PREFIX)
register_websockets(app)


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "docs": "/docs"}


@app.get("/api/health")
async def ingress_health():
    """Health endpoint served under the /api prefix for the ingress."""
    return {"status": "ok", "service": settings.APP_NAME}
