import errno
import logging
import sys
import time
from functools import wraps

import structlog
from prometheus_client import Counter, Histogram, start_http_server

from backend.config import settings


def configure_logging():
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if settings.DEBUG else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
    )


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)


class Metrics:
    http_requests = Counter("http_requests_total", "HTTP requests", ["method", "endpoint", "status"])
    http_duration = Histogram("http_duration_seconds", "HTTP latency", ["endpoint"])
    agent_runs = Counter("agent_runs_total", "Agent executions", ["agent", "status"])
    agent_duration = Histogram("agent_duration_seconds", "Agent latency", ["agent"])
    llm_calls = Counter("llm_calls_total", "LLM calls", ["provider", "model", "status"])
    llm_tokens = Counter("llm_tokens_total", "LLM tokens", ["provider", "model"])
    llm_cache_hits = Counter("llm_cache_hits_total", "LLM cache hits")
    llm_latency = Histogram("llm_latency_seconds", "LLM latency", ["provider"])
    cache_hits = Counter("cache_hits_total", "Cache hits", ["type"])
    cache_misses = Counter("cache_misses_total", "Cache misses", ["type"])
    tasks_total = Counter("celery_tasks_total", "Celery tasks", ["name", "status"])
    rows_processed = Counter("rows_processed_total", "Rows processed")
    datasets_ingested = Counter("datasets_ingested_total", "Datasets ingested")


metrics = Metrics()


def start_metrics_server():
    if settings.ENABLE_PROMETHEUS:
        try:
            start_http_server(settings.PROMETHEUS_PORT)
            structlog.get_logger("metrics").info("Metrics server started", port=settings.PROMETHEUS_PORT)
        except OSError as e:
            if e.errno == errno.EADDRINUSE:
                structlog.get_logger("metrics").warning(
                    "Metrics server already running, skipping startup",
                    port=settings.PROMETHEUS_PORT
                )
            else:
                raise
