"""In-process async task runner that mimics the Celery surface used by the API.

The FastAPI endpoints call ``task_xxx.apply_async(kwargs={"payload": {...}})``
and later query status via ``celery_app.AsyncResult(task_id)``. We keep that
contract but run every task as a ``asyncio.Task`` inside the main event loop
so there is no external broker or worker to run.
"""

from __future__ import annotations

import asyncio
import base64
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

from backend.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class _TaskRecord:
    """Mutable state for one async task execution."""

    id: str
    name: str
    state: str = "PENDING"
    result: Any = None
    error: Optional[str] = None
    progress: float = 0.0
    stage: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


class _TaskRegistry:
    """Thread-safe registry shared across the process."""

    def __init__(self) -> None:
        self._records: Dict[str, _TaskRecord] = {}
        self._lock = threading.RLock()
        self._max_records = 1000

    def create(self, name: str) -> _TaskRecord:
        rec = _TaskRecord(id=str(uuid.uuid4()), name=name)
        with self._lock:
            self._records[rec.id] = rec
            # Bound the registry so long-running deployments don't leak.
            if len(self._records) > self._max_records:
                oldest_id = min(
                    self._records, key=lambda k: self._records[k].started_at
                )
                self._records.pop(oldest_id, None)
        return rec

    def get(self, task_id: str) -> Optional[_TaskRecord]:
        with self._lock:
            return self._records.get(task_id)


_REGISTRY = _TaskRegistry()

# Keep strong references to in-flight asyncio tasks — otherwise the Python
# garbage collector may cancel them mid-run (PEP 492 / asyncio docs).
_INFLIGHT: set["asyncio.Task[Any]"] = set()


class _AsyncTaskHandle:
    """Handle returned from ``apply_async`` — provides ``.id``."""

    def __init__(self, task_id: str) -> None:
        self.id = task_id


class _AsyncResult:
    """Mimic ``celery.AsyncResult`` for status polling."""

    def __init__(self, task_id: str) -> None:
        self._rec = _REGISTRY.get(task_id)
        self.id = task_id

    @property
    def state(self) -> str:
        return self._rec.state if self._rec else "PENDING"

    @property
    def result(self) -> Any:
        return self._rec.result if self._rec else None

    @property
    def info(self) -> Any:
        if not self._rec:
            return None
        if self._rec.state == "FAILURE":
            return self._rec.error
        if self._rec.state == "PROGRESS":
            return {"progress": self._rec.progress, "stage": self._rec.stage}
        return self._rec.result


class _AsyncTask:
    """Wraps an async coroutine function into a ``apply_async``-able object."""

    def __init__(self, name: str, func: Callable[..., Awaitable[Any]]) -> None:
        self.name = name
        self._func = func

    def apply_async(
        self, kwargs: Optional[Dict[str, Any]] = None, queue: Optional[str] = None
    ) -> _AsyncTaskHandle:
        kwargs = kwargs or {}
        rec = _REGISTRY.create(self.name)

        async def _runner() -> None:
            rec.state = "STARTED"
            try:
                result = await self._func(rec, **kwargs)
                # Set progress *before* state so a poll that lands between the
                # two writes never sees "SUCCESS" at <100%.
                rec.progress = 100.0
                rec.result = result
                rec.finished_at = time.time()
                rec.state = "SUCCESS"
            except Exception as exc:
                rec.error = f"{type(exc).__name__}: {exc}"
                rec.finished_at = time.time()
                rec.state = "FAILURE"
                logger.error(
                    "task failed",
                    task=self.name,
                    id=rec.id,
                    error=rec.error,
                    tb=traceback.format_exc(),
                )

        # Schedule on the running loop (or create one if called from a sync context).
        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(_runner())
            _INFLIGHT.add(task)
            task.add_done_callback(_INFLIGHT.discard)
        except RuntimeError:
            # fallback — used only in tests invoked synchronously
            asyncio.run(_runner())
        return _AsyncTaskHandle(rec.id)


def _set_progress(rec: _TaskRecord, progress: float, stage: str = "") -> None:
    rec.state = "PROGRESS"
    rec.progress = progress
    rec.stage = stage


# --------------------------------------------------------------------------
# Shared helpers and task implementations
# --------------------------------------------------------------------------


def _services():
    from backend.services.cache_service import CacheService
    from backend.services.llm_service import LLMService
    from backend.services.storage_service import StorageService
    from backend.services.vector_service import VectorService

    cache = CacheService()
    llm = LLMService(cache)
    vector = VectorService()
    storage = StorageService()
    return cache, llm, vector, storage


async def _run_ingest(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 10, "Initializing services")
    cache, llm, vector, storage = _services()
    if payload.get("content_b64"):
        payload["content"] = base64.b64decode(payload["content_b64"])
        payload.pop("content_b64", None)
    _set_progress(rec, 35, "Running ingestion agent")
    from backend.agents.agents import IngestionAgent

    agent = IngestionAgent(cache, storage)
    result = await agent.execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    if result.success:
        _set_progress(rec, 80, "Indexing vectors")
        schema = result.data.get("schema", {})
        try:
            await vector.index_dataset(payload["dataset_id"], schema, {})
        except Exception as exc:
            logger.warning(
                "Vector index failed — proceeding without RAG", error=str(exc)
            )
        storage.save_dataset_record(schema)
    return {"success": result.success, "data": result.data, "error": result.error}


async def _run_process(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 10, "Initializing")
    cache, llm, vector, storage = _services()
    corr = payload.get("correlation_id", str(uuid.uuid4()))
    from backend.agents.agents import FeatureAgent, UnderstandingAgent

    _set_progress(rec, 35, "Running EDA analysis")
    eda_result = await UnderstandingAgent(cache).execute(payload, corr)
    _set_progress(rec, 75, "Running feature engineering")
    feat_result = await FeatureAgent(cache).execute(
        {"dataset_id": payload["dataset_id"]}, corr
    )
    return {
        "eda": {
            "success": eda_result.success,
            "data": eda_result.data,
            "error": eda_result.error,
        },
        "feature": {
            "success": feat_result.success,
            "data": feat_result.data,
            "error": feat_result.error,
        },
    }


async def _run_insights(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 20, "Gathering dataset context")
    cache, llm, _, _ = _services()
    _set_progress(rec, 55, "Generating insights with LLM")
    from backend.agents.agents import InsightAgent

    result = await InsightAgent(cache, llm).execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    return {"success": result.success, "data": result.data, "error": result.error}


async def _run_query(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 20, "Preparing query context")
    cache, llm, vector, _ = _services()
    _set_progress(rec, 55, "Executing query agent")
    from backend.agents.agents import QueryAgent

    result = await QueryAgent(cache, llm, vector).execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    return {"success": result.success, "data": result.data, "error": result.error}


async def _run_dashboard(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 20, "Composing dashboard plan")
    cache, llm, _, _ = _services()
    _set_progress(rec, 60, "Rendering charts")
    from backend.agents.agents import VisualizationAgent

    result = await VisualizationAgent(cache, llm).execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    return {"success": result.success, "data": result.data, "error": result.error}


async def _run_report(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    _set_progress(rec, 20, "Collating report sections")
    cache, llm, _, _ = _services()
    _set_progress(rec, 70, "Drafting narrative")
    from backend.agents.agents import ReportAgent

    result = await ReportAgent(cache, llm).execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    return {"success": result.success, "data": result.data, "error": result.error}


async def _run_pipeline(rec: _TaskRecord, payload: Dict[str, Any]) -> Dict[str, Any]:
    cache, llm, vector, storage = _services()

    # Stage helper — agents also push intermediate state into cache
    async def stage_cb(stages):
        rec.progress = min(99.0, stages.get("progress", rec.progress))
        rec.stage = stages.get("stage", rec.stage)
        rec.state = "PROGRESS"

    from backend.agents.orchestrator.orchestrator_agent import OrchestratorAgent

    orchestrator = OrchestratorAgent(cache, llm, vector, storage)
    orchestrator.progress_cb = stage_cb
    result = await orchestrator.execute(
        payload, payload.get("correlation_id", str(uuid.uuid4()))
    )
    return {"success": result.success, "data": result.data, "error": result.error}


# --------------------------------------------------------------------------
# Celery-compatible facade
# --------------------------------------------------------------------------


class _CeleryShim:
    @staticmethod
    def AsyncResult(task_id: str) -> _AsyncResult:  # noqa: N802
        return _AsyncResult(task_id)


celery_app = _CeleryShim()

task_ingest = _AsyncTask("ingest", _run_ingest)
task_process = _AsyncTask("process", _run_process)
task_insights = _AsyncTask("insights", _run_insights)
task_query = _AsyncTask("query", _run_query)
task_dashboard = _AsyncTask("dashboard", _run_dashboard)
task_report = _AsyncTask("report", _run_report)
task_pipeline = _AsyncTask("pipeline", _run_pipeline)


def get_task_record(task_id: str) -> Optional[_TaskRecord]:
    """Expose the registry for the /task endpoint to read progress info."""
    return _REGISTRY.get(task_id)


__all__ = [
    "celery_app",
    "task_ingest",
    "task_process",
    "task_insights",
    "task_query",
    "task_dashboard",
    "task_report",
    "task_pipeline",
    "get_task_record",
]
