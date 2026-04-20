from __future__ import annotations
import asyncio
import time
import uuid
from typing import Any, Dict, List, Optional

from backend.agents.base_agent import BaseAgent
from backend.agents.agents import (
    IngestionAgent, UnderstandingAgent, FeatureAgent,
    InsightAgent, VisualizationAgent, QueryAgent, ReportAgent,
)
from backend.config import settings
from backend.models.schemas import AgentResult, AgentType, LLMMode, LLMRequest
from backend.prompts.templates import ORCHESTRATOR_SYSTEM, ORCHESTRATOR_PROMPT
from backend.services.cache_service import CacheService
from backend.services.llm_service import LLMService
from backend.services.storage_service import StorageService
from backend.services.vector_service import VectorService
from backend.utils.logger import get_logger

logger = get_logger(__name__)


STATIC_PLANS: Dict[str, List[Dict]] = {
    "upload": [
        {"step_id": 1, "agent": "ingestion", "parallel_group": None, "depends_on": [], "config": {}},
        {"step_id": 2, "agent": "understanding", "parallel_group": None, "depends_on": [1], "config": {"run_anomaly": True}},
    ],
    "process": [
        {"step_id": 1, "agent": "understanding", "parallel_group": None, "depends_on": [], "config": {"run_anomaly": True}},
        {"step_id": 2, "agent": "feature", "parallel_group": None, "depends_on": [1], "config": {}},
    ],
    "insights": [
        {"step_id": 1, "agent": "insight", "parallel_group": None, "depends_on": [], "config": {}},
    ],
    "query": [
        {"step_id": 1, "agent": "query", "parallel_group": None, "depends_on": [], "config": {}},
    ],
    "dashboard": [
        {"step_id": 1, "agent": "visualization", "parallel_group": None, "depends_on": [], "config": {}},
    ],
    "report": [
        {"step_id": 1, "agent": "insight", "parallel_group": 1, "depends_on": [], "config": {}},
        {"step_id": 2, "agent": "visualization", "parallel_group": 1, "depends_on": [], "config": {}},
        {"step_id": 3, "agent": "report", "parallel_group": None, "depends_on": [1, 2], "config": {}},
    ],
    "full": [
        {"step_id": 1, "agent": "ingestion", "parallel_group": None, "depends_on": [], "config": {}},
        {"step_id": 2, "agent": "understanding", "parallel_group": None, "depends_on": [1], "config": {"run_anomaly": True}},
        {"step_id": 3, "agent": "feature", "parallel_group": None, "depends_on": [2], "config": {}},
        {"step_id": 4, "agent": "insight", "parallel_group": 1, "depends_on": [2], "config": {}},
        {"step_id": 5, "agent": "visualization", "parallel_group": 1, "depends_on": [2], "config": {}},
        {"step_id": 6, "agent": "report", "parallel_group": None, "depends_on": [4, 5], "config": {}},
    ],
}


class OrchestratorAgent(BaseAgent):
    agent_type = AgentType.ORCHESTRATOR

    def __init__(self, cache: CacheService, llm: LLMService, vector: VectorService, storage: StorageService):
        super().__init__(cache, llm)
        self._agents: Dict[str, BaseAgent] = {
            "ingestion":     IngestionAgent(cache, storage),
            "understanding": UnderstandingAgent(cache),
            "feature":       FeatureAgent(cache),
            "insight":       InsightAgent(cache, llm),
            "visualization": VisualizationAgent(cache, llm),
            "query":         QueryAgent(cache, llm, vector),
            "report":        ReportAgent(cache, llm),
        }

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        start = time.perf_counter()
        mode = payload.get("mode", "full")
        dataset_id = payload.get("dataset_id", str(uuid.uuid4()))

        await self._cache.set_task_progress(correlation_id, 0, "planning")

        steps = STATIC_PLANS.get(mode, STATIC_PLANS["full"])
        results: Dict[str, AgentResult] = {}
        completed: set = set()
        total = len(steps)

        groups: Dict[Optional[int], List[Dict]] = {}
        for s in steps:
            g = s.get("parallel_group")
            groups.setdefault(g, []).append(s)

        seq = groups.pop(None, [])
        batches: List[List[Dict]] = [[s] for s in seq] + [g for g in sorted(groups.values(), key=lambda x: x[0]["step_id"])]

        done = 0
        for batch in batches:
            runnable = [s for s in batch if all(d in completed for d in s.get("depends_on", []))]
            if not runnable:
                continue

            if len(runnable) == 1:
                r = await self._run_step(runnable[0], payload, correlation_id)
                results[runnable[0]["agent"]] = r
                completed.add(runnable[0]["step_id"])
                done += 1
            else:
                batch_results = await asyncio.gather(
                    *[self._run_step(s, payload, correlation_id) for s in runnable],
                    return_exceptions=True,
                )
                for s, r in zip(runnable, batch_results):
                    results[s["agent"]] = r if isinstance(r, AgentResult) else AgentResult(
                        agent=AgentType(s["agent"]), success=False, error=str(r))
                    completed.add(s["step_id"])
                    done += 1

            await self._cache.set_task_progress(correlation_id, done / total * 90, "running")

        ms = (time.perf_counter() - start) * 1000
        await self._cache.set_task_progress(correlation_id, 100, "success")

        compiled = {k: r.data for k, r in results.items() if r.success}
        errors = {f"{k}_error": r.error for k, r in results.items() if not r.success}

        return {
            **compiled, **errors,
            "correlation_id": correlation_id,
            "dataset_id": dataset_id,
            "duration_ms": round(ms, 1),
            "agents_run": len(results),
            "agents_failed": [k for k, r in results.items() if not r.success],
        }

    async def _run_step(self, step: Dict, global_payload: Dict, correlation_id: str) -> AgentResult:
        name = step["agent"]
        agent = self._agents.get(name)
        if not agent:
            return AgentResult(agent=AgentType(name), success=False, error=f"Unknown agent: {name}")

        step_payload = {
            **global_payload.get("agent_payloads", {}).get(name, {}),
            **step.get("config", {}),
            "dataset_id": global_payload.get("dataset_id"),
        }

        for attempt in range(1, settings.CELERY_MAX_RETRIES + 1):
            result = await agent.execute(step_payload, correlation_id)
            if result.success:
                return result
            if attempt < settings.CELERY_MAX_RETRIES:
                wait = min(settings.CELERY_RETRY_BACKOFF * (2 ** (attempt - 1)), 30)
                logger.warning("Step retry", agent=name, attempt=attempt, wait=wait)
                await asyncio.sleep(wait)

        return result
