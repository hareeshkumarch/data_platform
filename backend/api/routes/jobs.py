from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.job_manager import BackgroundJobManager, JobStatus

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    kind: str
    error: Optional[str] = None
    elapsed_seconds: Optional[float] = None
    has_result: bool = False
    result: Optional[Any] = None


@jobs_router.get("/{job_id}")
async def get_job_status(
    job_id: str, include_result: bool = False
) -> JobStatusResponse:
    mgr = BackgroundJobManager.get()
    rec = mgr.get_job(job_id)
    if rec is None:
        raise HTTPException(404, f"Job '{job_id}' not found or has expired.")

    resp = JobStatusResponse(**rec.to_dict())
    if include_result and rec.status == JobStatus.COMPLETED and rec.result is not None:
        resp.result = rec.result
    return resp


@jobs_router.get("")
async def list_jobs(limit: int = 20) -> Dict[str, Any]:
    mgr = BackgroundJobManager.get()
    return {"jobs": mgr.list_jobs(limit=limit)}
