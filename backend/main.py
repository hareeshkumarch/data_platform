import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routes.endpoints import router
from backend.config import settings
from backend.utils.logger import configure_logging, get_logger, metrics, start_metrics_server

configure_logging()
logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting", version=settings.APP_VERSION)
    start_metrics_server()
    yield
    logger.info("Shutdown")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Agentic AI Data Intelligence Platform — Gemini + Groq",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=settings.ALLOWED_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    metrics.http_requests.labels(method=request.method, endpoint=request.url.path, status=response.status_code).inc()
    metrics.http_duration.labels(endpoint=request.url.path).observe(ms / 1000)
    response.headers["X-Response-Time-Ms"] = str(round(ms, 2))
    return response


@app.exception_handler(Exception)
async def global_error(request: Request, exc: Exception):
    logger.error("Unhandled error", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(router, prefix=settings.API_PREFIX)


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "docs": "/docs"}
