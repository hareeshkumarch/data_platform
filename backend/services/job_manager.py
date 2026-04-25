from __future__ import annotations

import asyncio
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from enum import Enum
from typing import Any, Callable, Dict, Optional

from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobRecord:
    __slots__ = (
        "job_id",
        "status",
        "progress",
        "result",
        "error",
        "created_at",
        "started_at",
        "completed_at",
        "kind",
    )

    def __init__(self, job_id: str, kind: str = "analytics") -> None:
        self.job_id = job_id
        self.kind = kind
        self.status: JobStatus = JobStatus.PENDING
        self.progress: float = 0.0
        self.result: Any = None
        self.error: Optional[str] = None
        self.created_at: float = time.time()
        self.started_at: Optional[float] = None
        self.completed_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        elapsed: Optional[float] = None
        if self.started_at:
            end = self.completed_at or time.time()
            elapsed = round(end - self.started_at, 2)
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "progress": round(self.progress, 2),
            "kind": self.kind,
            "error": self.error,
            "elapsed_seconds": elapsed,
            "has_result": self.result is not None,
        }


class BackgroundJobManager:
    _instance: Optional["BackgroundJobManager"] = None

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(
            max_workers=settings.ANALYTICS_THREAD_POOL_SIZE,
            thread_name_prefix="job",
        )
        self._jobs: Dict[str, JobRecord] = {}
        self._max_age = 1800

    @classmethod
    def get(cls) -> "BackgroundJobManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _prune_old(self) -> None:
        cutoff = time.time() - self._max_age
        stale = [
            jid
            for jid, rec in self._jobs.items()
            if rec.completed_at and rec.completed_at < cutoff
        ]
        for jid in stale:
            self._jobs.pop(jid, None)

    def submit(
        self,
        fn: Callable[..., Any],
        *args: Any,
        kind: str = "analytics",
        **kwargs: Any,
    ) -> str:
        self._prune_old()
        job_id = str(uuid.uuid4())
        rec = JobRecord(job_id, kind=kind)
        self._jobs[job_id] = rec

        def _wrapper() -> None:
            rec.status = JobStatus.RUNNING
            rec.started_at = time.time()
            rec.progress = 0.1
            try:
                result = fn(*args, **kwargs)
                rec.result = result
                rec.status = JobStatus.COMPLETED
                rec.progress = 1.0
                logger.info("Job completed", job_id=job_id, kind=kind)
            except Exception as exc:
                rec.status = JobStatus.FAILED
                rec.error = str(exc)
                logger.error(
                    "Job failed",
                    job_id=job_id,
                    kind=kind,
                    error=str(exc),
                    traceback=traceback.format_exc(),
                )
            finally:
                rec.completed_at = time.time()

        self._pool.submit(_wrapper)
        logger.info("Job submitted", job_id=job_id, kind=kind)
        return job_id

    async def submit_async(
        self,
        coro_fn: Callable[..., Any],
        *args: Any,
        kind: str = "analytics",
        **kwargs: Any,
    ) -> str:
        self._prune_old()
        job_id = str(uuid.uuid4())
        rec = JobRecord(job_id, kind=kind)
        self._jobs[job_id] = rec

        async def _wrapper() -> None:
            rec.status = JobStatus.RUNNING
            rec.started_at = time.time()
            rec.progress = 0.1
            try:
                result = await coro_fn(*args, **kwargs)
                rec.result = result
                rec.status = JobStatus.COMPLETED
                rec.progress = 1.0
                logger.info("Async job completed", job_id=job_id, kind=kind)
            except Exception as exc:
                rec.status = JobStatus.FAILED
                rec.error = str(exc)
                logger.error(
                    "Async job failed",
                    job_id=job_id,
                    kind=kind,
                    error=str(exc),
                )
            finally:
                rec.completed_at = time.time()

        asyncio.ensure_future(_wrapper())
        logger.info("Async job submitted", job_id=job_id, kind=kind)
        return job_id

    def get_job(self, job_id: str) -> Optional[JobRecord]:
        return self._jobs.get(job_id)

    def list_jobs(self, limit: int = 20) -> list[Dict[str, Any]]:
        jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        return [j.to_dict() for j in jobs[:limit]]
