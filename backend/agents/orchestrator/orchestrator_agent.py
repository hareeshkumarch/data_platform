from __future__ import annotations
import asyncio
import time
import uuid
from typing import Any, Dict, List, Optional

from backend.agents.base_agent import BaseAgent
from backend.agents.agents import (
    IngestionAgent,
    UnderstandingAgent,
    FeatureAgent,
    InsightAgent,
    VisualizationAgent,
    QueryAgent,
    ReportAgent,
    EvaluatorAgent,
)
from backend.config import settings
from backend.models.schemas import AgentResult, AgentType
from backend.services.cache_service import CacheService
from backend.services.llm_service import LLMService
from backend.services.storage_service import StorageService
from backend.services.vector_service import VectorService
from backend.utils.logger import get_logger

logger = get_logger(__name__)


STATIC_PLANS: Dict[str, List[Dict]] = {
    "upload": [
        {
            "step_id": 1,
            "agent": "ingestion",
            "parallel_group": None,
            "depends_on": [],
            "config": {},
        },
        {
            "step_id": 2,
            "agent": "understanding",
            "parallel_group": None,
            "depends_on": [1],
            "config": {"run_anomaly": True},
        },
    ],
    "process": [
        {
            "step_id": 1,
            "agent": "understanding",
            "parallel_group": None,
            "depends_on": [],
            "config": {"run_anomaly": True},
        },
        {
            "step_id": 2,
            "agent": "feature",
            "parallel_group": None,
            "depends_on": [1],
            "config": {},
        },
    ],
    "insights": [
        {
            "step_id": 1,
            "agent": "insight",
            "parallel_group": None,
            "depends_on": [],
            "config": {},
        },
    ],
    "query": [
        {
            "step_id": 1,
            "agent": "query",
            "parallel_group": None,
            "depends_on": [],
            "config": {},
        },
    ],
    "dashboard": [
        {
            "step_id": 1,
            "agent": "visualization",
            "parallel_group": None,
            "depends_on": [],
            "config": {},
        },
    ],
    "report": [
        {
            "step_id": 1,
            "agent": "insight",
            "parallel_group": 1,
            "depends_on": [],
            "config": {},
        },
        {
            "step_id": 2,
            "agent": "visualization",
            "parallel_group": 1,
            "depends_on": [],
            "config": {},
        },
        {
            "step_id": 3,
            "agent": "report",
            "parallel_group": None,
            "depends_on": [1, 2],
            "config": {},
        },
    ],
    "full": [
        {
            "step_id": 1,
            "agent": "ingestion",
            "parallel_group": None,
            "depends_on": [],
            "config": {},
        },
        {
            "step_id": 2,
            "agent": "understanding",
            "parallel_group": None,
            "depends_on": [1],
            "config": {"run_anomaly": True},
        },
        {
            "step_id": 3,
            "agent": "feature",
            "parallel_group": None,
            "depends_on": [2],
            "config": {},
        },
        {
            "step_id": 4,
            "agent": "insight",
            "parallel_group": 1,
            "depends_on": [2],
            "config": {},
        },
        {
            "step_id": 5,
            "agent": "visualization",
            "parallel_group": 1,
            "depends_on": [2],
            "config": {},
        },
        {
            "step_id": 6,
            "agent": "report",
            "parallel_group": None,
            "depends_on": [4, 5],
            "config": {},
        },
        {
            "step_id": 7,
            "agent": "evaluator",
            "parallel_group": None,
            "depends_on": [6],
            "config": {},
        },
    ],
}


class OrchestratorAgent(BaseAgent):
    agent_type = AgentType.ORCHESTRATOR

    def __init__(
        self,
        cache: CacheService,
        llm: LLMService,
        vector: VectorService,
        storage: StorageService,
    ):
        super().__init__(cache, llm)
        self._agents: Dict[str, BaseAgent] = {
            "ingestion": IngestionAgent(cache, storage),
            "understanding": UnderstandingAgent(cache),
            "feature": FeatureAgent(cache),
            "insight": InsightAgent(cache, llm),
            "visualization": VisualizationAgent(cache, llm),
            "query": QueryAgent(cache, llm, vector),
            "report": ReportAgent(cache, llm),
            "evaluator": EvaluatorAgent(cache, llm),
        }

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        start = time.perf_counter()
        mode = payload.get("mode", "full")
        dataset_id = payload.get("dataset_id", str(uuid.uuid4()))

        await self._cache.set_task_progress(correlation_id, 0, "planning")

        results: Dict[str, AgentResult] = {}
        completed: set = set()

        if mode == "dynamic":
            from backend.prompts.templates import ORCHESTRATOR_PROMPT, ORCHESTRATOR_SYSTEM
            from backend.models.schemas import LLMRequest, LLMMode
            from backend.services.llm_service import LLMService
            import json
            
            schema = await self._cache.get_schema(dataset_id)
            # Evaluate current dataset state to skip unnecessary steps
            quality_score = schema.get("quality_score", 100) if schema else 100
            col_count = len(schema.get("columns", [])) if schema else 0

            prompt = ORCHESTRATOR_PROMPT.format(
                user_request=payload.get("question", "Full data analysis"),
                dataset_state=json.dumps(schema) if schema else "Schema not yet loaded"
            )
            req = LLMRequest(
                prompt=prompt,
                system_prompt=ORCHESTRATOR_SYSTEM,
                mode=LLMMode.FAST,
                temperature=0.1
            )
            resp = await self._llm.complete(req)
            try:
                plan_json, _ = LLMService.extract_json_with_preamble(resp.content)
                steps = plan_json.get("steps", STATIC_PLANS["full"])

                # Conditional Skipping: if data is clean and small, skip feature engineering
                if quality_score > 90 and col_count < 10:
                    steps = [s for s in steps if s["agent"] != "feature"]

            except Exception as e:
                logger.error(f"Dynamic planning failed, falling back to full: {e}")
                steps = STATIC_PLANS["full"]
        else:
            steps = STATIC_PLANS.get(mode, STATIC_PLANS["full"])

        total = len(steps)

        groups: Dict[Optional[int], List[Dict]] = {}
        for s in steps:
            g = s.get("parallel_group")
            groups.setdefault(g, []).append(s)

        seq = groups.pop(None, [])
        batches: List[List[Dict]] = [[s] for s in seq] + [
            g for g in sorted(groups.values(), key=lambda x: x[0]["step_id"])
        ]

        done = 0
        for batch in batches:
            runnable = [
                s for s in batch if all(d in completed for d in s.get("depends_on", []))
            ]
            if not runnable:
                continue

            if len(runnable) == 1:
                # Inject dependencies for evaluator
                s = runnable[0]
                if s["agent"] == "evaluator" and "report" in results:
                    s["config"]["report"] = results["report"].data

                r = await self._run_step(s, payload, correlation_id)
                results[s["agent"]] = r
                if r.success:
                    completed.add(s["step_id"])
                done += 1
            else:
                batch_results = await asyncio.gather(
                    *[self._run_step(s, payload, correlation_id) for s in runnable],
                    return_exceptions=True,
                )
                for s, r in zip(runnable, batch_results):
                    res = (
                        r
                        if isinstance(r, AgentResult)
                        else AgentResult(
                            agent=AgentType(s["agent"]), success=False, error=str(r)
                        )
                    )
                    results[s["agent"]] = res
                    if res.success:
                        completed.add(s["step_id"])
                    done += 1

            await self._cache.set_task_progress(
                correlation_id, done / total * 90, "running"
            )
            
        # Recursive Refinement Loop (max 1 refinement pass to prevent token burn)
        evaluator_data = results.get("evaluator", AgentResult(agent=AgentType.EVALUATOR, success=False)).data or {}
        if evaluator_data.get("satisfied") is False:
            refinement = evaluator_data.get("refinement_instruction", "")
            if refinement and refinement.lower() != "ready for delivery":
                logger.info(f"Refinement triggered by Evaluator: {refinement}")
                # Create a refined payload
                refined_payload = payload.copy()
                refined_payload["refinement_instruction"] = refinement
                # Re-run Report Agent
                r = await self._run_step({"step_id": 99, "agent": "report", "config": {}}, refined_payload, correlation_id)
                results["report"] = r
                
                # Re-evaluate
                eval_step = {"step_id": 100, "agent": "evaluator", "config": {"report": r.data}}
                e_res = await self._run_step(eval_step, refined_payload, correlation_id)
                results["evaluator"] = e_res

        ms = (time.perf_counter() - start) * 1000
        await self._cache.set_task_progress(correlation_id, 100, "success")

        compiled = {k: r.data for k, r in results.items() if r.success}
        errors = {f"{k}_error": r.error for k, r in results.items() if not r.success}

        return {
            **compiled,
            **errors,
            "correlation_id": correlation_id,
            "dataset_id": dataset_id,
            "duration_ms": round(ms, 1),
            "agents_run": len(results),
            "agents_failed": [k for k, r in results.items() if not r.success],
        }

    async def _run_step(
        self, step: Dict, global_payload: Dict, correlation_id: str
    ) -> AgentResult:
        name = step["agent"]
        agent = self._agents.get(name)
        if not agent:
            return AgentResult(
                agent=AgentType(name), success=False, error=f"Unknown agent: {name}"
            )

        step_payload = {
            **global_payload.get("agent_payloads", {}).get(name, {}),
            **step.get("config", {}),
            "dataset_id": global_payload.get("dataset_id"),
            "llm_provider": global_payload.get("provider"),
            "model_override": global_payload.get("model"),
        }

        # Advanced DAG explicit retry strategy config
        max_retries = step.get("config", {}).get("max_retries", settings.CELERY_MAX_RETRIES)
        fallback_agent_name = step.get("config", {}).get("fallback_agent")

        for attempt in range(1, max_retries + 1):
            result = await agent.execute(step_payload, correlation_id)
            if result.success:
                return result
            if attempt < max_retries:
                wait = min(settings.CELERY_RETRY_BACKOFF * (2 ** (attempt - 1)), 30)
                logger.warning("Step retry", agent=name, attempt=attempt, wait=wait, error=result.error)
                await asyncio.sleep(wait)

        # Fallback mechanism if main agent fails
        if not result.success and fallback_agent_name:
            logger.warning(f"Agent {name} failed after {max_retries} attempts. Triggering fallback: {fallback_agent_name}")
            fallback_agent = self._agents.get(fallback_agent_name)
            if fallback_agent:
                return await fallback_agent.execute(step_payload, correlation_id)

        return result
