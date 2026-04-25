from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from backend.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class _ProviderState:
    failures: int = 0
    successes: int = 0
    last_failure: float = 0.0
    opened_at: Optional[float] = None


class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 3,
        window_seconds: float = 60.0,
        cooldown_seconds: float = 30.0,
    ):
        self.failure_threshold = failure_threshold
        self.window_seconds = window_seconds
        self.cooldown_seconds = cooldown_seconds
        self._states: Dict[str, _ProviderState] = {}
        self._lock = asyncio.Lock()

    def _state(self, provider: str) -> _ProviderState:
        return self._states.setdefault(provider, _ProviderState())

    def is_open(self, provider: str) -> bool:
        s = self._state(provider)
        if s.opened_at is None:
            return False
        elapsed = time.time() - s.opened_at
        if elapsed > self.cooldown_seconds:
            s.opened_at = None
            s.failures = 0
            return False
        return True

    async def record_success(self, provider: str) -> None:
        async with self._lock:
            s = self._state(provider)
            s.successes += 1
            s.failures = max(0, s.failures - 1)
            if s.opened_at is not None:
                s.opened_at = None
                logger.info("Circuit breaker CLOSED for provider", provider=provider)

    async def record_failure(self, provider: str) -> None:
        async with self._lock:
            s = self._state(provider)
            now = time.time()
            if now - s.last_failure > self.window_seconds:
                s.failures = 0
            s.failures += 1
            s.last_failure = now
            if s.failures >= self.failure_threshold and s.opened_at is None:
                s.opened_at = now
                logger.warning(
                    "Circuit breaker OPEN for provider",
                    provider=provider,
                    failures=s.failures,
                )

    def pick_fallback(
        self, preferred: str, available: List[str], keys: Dict[str, str]
    ) -> str:
        for p in available:
            if p == preferred:
                continue
            if not self.is_open(p) and keys.get(p):
                return p
        return preferred

    def status(self) -> Dict[str, Dict]:
        return {
            p: {
                "failures": s.failures,
                "successes": s.successes,
                "open": s.opened_at is not None,
                "opened_at": s.opened_at,
            }
            for p, s in self._states.items()
        }
