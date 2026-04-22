from __future__ import annotations
import time
import traceback
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from backend.models.schemas import AgentResult, AgentType
from backend.services.cache_service import CacheService
from backend.services.llm_service import LLMService
from backend.utils.logger import get_logger, metrics


class BaseAgent(ABC):
    agent_type: AgentType

    def __init__(self, cache: CacheService, llm: Optional[LLMService] = None):
        self._cache = cache
        self._llm = llm
        self._log = get_logger(f"agent.{self.agent_type.value}")

    async def execute(
        self, payload: Dict[str, Any], correlation_id: str = None
    ) -> AgentResult:
        correlation_id = correlation_id or str(uuid.uuid4())
        start = time.perf_counter()
        try:
            result = await self.run(payload, correlation_id)
            ms = (time.perf_counter() - start) * 1000
            await self._cache.set_agent_state(
                correlation_id, self.agent_type.value, result
            )
            metrics.agent_runs.labels(
                agent=self.agent_type.value, status="success"
            ).inc()
            metrics.agent_duration.labels(agent=self.agent_type.value).observe(
                ms / 1000
            )
            self._log.info("done", ms=round(ms, 1))
            return AgentResult(
                agent=self.agent_type,
                success=True,
                data=result,
                duration_ms=round(ms, 1),
            )
        except Exception as exc:
            ms = (time.perf_counter() - start) * 1000
            self._log.error("failed", error=str(exc), tb=traceback.format_exc())
            metrics.agent_runs.labels(
                agent=self.agent_type.value, status="failed"
            ).inc()
            return AgentResult(
                agent=self.agent_type,
                success=False,
                error=f"{type(exc).__name__}: {exc}",
                duration_ms=round(ms, 1),
            )

    @abstractmethod
    async def run(
        self, payload: Dict[str, Any], correlation_id: str
    ) -> Dict[str, Any]: ...
