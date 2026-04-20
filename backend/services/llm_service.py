"""LLM service backed by the Emergent universal key.

Supports OpenAI, Anthropic and Gemini providers. ``complete`` returns a
full response; ``stream_complete`` yields incremental chunks. We fan-out the
single completion into word-sized chunks to keep the frontend streaming
smoothly even when the underlying SDK does not expose a native stream.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Optional

import litellm
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.utils import get_app_identifier, get_integration_proxy_url

from backend.config import settings
from backend.models.schemas import LLMMode, LLMProvider, LLMRequest, LLMResponse
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)


# Model catalogue surfaced to the Settings page
ALL_MODELS: Dict[str, List[Dict[str, Any]]] = {
    "openai": [
        {"id": "gpt-5.2", "label": "GPT-5.2", "mode": "advanced"},
        {"id": "gpt-5.1", "label": "GPT-5.1", "mode": "advanced"},
        {"id": "gpt-5-mini", "label": "GPT-5 Mini", "mode": "fast"},
        {"id": "gpt-4.1", "label": "GPT-4.1", "mode": "advanced"},
        {"id": "gpt-4o", "label": "GPT-4o", "mode": "balanced"},
        {"id": "o3-mini", "label": "o3-mini", "mode": "reasoning"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-5-20250929", "label": "Claude Sonnet 4.5", "mode": "advanced"},
        {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5", "mode": "fast"},
        {"id": "claude-opus-4-5-20251101", "label": "Claude Opus 4.5", "mode": "reasoning"},
    ],
    "gemini": [
        {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "mode": "advanced"},
        {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "mode": "fast"},
    ],
}


DEFAULT_MODEL_BY_PROVIDER: Dict[str, str] = {
    "openai": "gpt-5.2",
    "anthropic": "claude-sonnet-4-5-20250929",
    "gemini": "gemini-2.5-flash",
}


@dataclass
class LLMStats:
    """Simple in-process counters used by the Settings page."""

    calls: int = 0
    tokens: int = 0
    errors: int = 0
    latency_sum_ms: float = 0.0

    def observe(self, tokens: int, latency_ms: float, error: bool = False) -> None:
        self.calls += 1
        self.tokens += tokens
        self.latency_sum_ms += latency_ms
        if error:
            self.errors += 1


class LLMService:
    """Thin wrapper around emergentintegrations supporting multiple providers."""

    def __init__(self, cache=None) -> None:
        self._cache = cache
        self._sem = asyncio.Semaphore(settings.LLM_PARALLEL_CALLS)
        self._stats = LLMStats()
        # Prefer Emergent universal key; fall back to direct-provider keys
        self._api_key = settings.EMERGENT_LLM_KEY
        self._direct_keys = {
            "openai": settings.OPENAI_API_KEY,
            "anthropic": settings.ANTHROPIC_API_KEY,
            "gemini": settings.GEMINI_API_KEY,
        }
        self._using_emergent = bool(self._api_key)
        if not self._api_key and not any(self._direct_keys.values()):
            logger.warning("No LLM keys configured — set EMERGENT_LLM_KEY or provider-specific keys.")

    # ---- public API --------------------------------------------------------

    async def complete(self, request: LLMRequest) -> LLMResponse:
        """Return a full completion, using cache when available."""
        key = self._cache_key(request) if request.use_cache else None
        if key and self._cache:
            raw = await self._cache.get_json(key)
            if raw:
                metrics.llm_cache_hits.inc()
                return LLMResponse(**{**raw, "cached": True})

        provider, model = self._resolve(request)
        start = time.perf_counter()
        try:
            async with self._sem:
                content = await self._call(request, provider, model)
            latency_ms = (time.perf_counter() - start) * 1000
            tokens = _estimate_tokens(request.prompt) + _estimate_tokens(content)
            self._stats.observe(tokens, latency_ms)
            metrics.llm_calls.labels(provider=provider, model=model, status="success").inc()
            metrics.llm_tokens.labels(provider=provider, model=model).inc(tokens)
            metrics.llm_latency.labels(provider=provider).observe(latency_ms / 1000)
        except Exception as exc:
            latency_ms = (time.perf_counter() - start) * 1000
            self._stats.observe(0, latency_ms, error=True)
            metrics.llm_calls.labels(provider=provider, model=model, status="error").inc()
            logger.error("LLM call failed", provider=provider, model=model, error=str(exc))
            raise

        response = LLMResponse(
            content=content,
            provider=LLMProvider(provider) if provider in LLMProvider._value2member_map_ else LLMProvider.GEMINI,
            model=model,
            tokens_used=tokens,
            cached=False,
            latency_ms=latency_ms,
        )

        if key and self._cache:
            await self._cache.set_json(
                key,
                {
                    "content": response.content,
                    "provider": response.provider.value if hasattr(response.provider, "value") else str(response.provider),
                    "model": response.model,
                    "tokens_used": response.tokens_used,
                    "latency_ms": response.latency_ms,
                },
                ttl=request.cache_ttl,
            )
        return response

    async def stream_complete(self, request: LLMRequest) -> AsyncIterator[str]:
        """Stream tokens directly from the LLM provider as they arrive.

        Uses ``litellm.acompletion(stream=True)`` against either the Emergent
        proxy or a direct-provider key. Falls back to word-chunking if the
        stream errors.
        """
        provider, model = self._resolve(request)
        direct_key = self._direct_keys.get(provider)
        if not self._api_key and not direct_key:
            raise RuntimeError("No LLM key configured for provider: " + provider)

        params: Dict[str, Any] = {
            "messages": [
                {"role": "system", "content": request.system_prompt or "You are Lumen, a helpful data intelligence assistant."},
                {"role": "user", "content": request.prompt},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": True,
        }

        if self._api_key:
            app_identifier = get_app_identifier()
            headers = {"X-App-ID": app_identifier} if app_identifier else {}
            params.update({
                "model": model if provider != "gemini" else f"gemini/{model}",
                "api_key": self._api_key,
                "api_base": get_integration_proxy_url() + "/llm",
                "custom_llm_provider": "openai",
                "extra_headers": headers,
            })
        else:
            params.update({
                "model": model if provider == "openai" else f"{provider}/{model}",
                "api_key": direct_key,
            })

        start = time.perf_counter()
        full_text = ""
        try:
            stream = await litellm.acompletion(**params)
            async for chunk in stream:
                try:
                    delta = chunk.choices[0].delta
                    piece = (delta.content if hasattr(delta, "content") else None) or ""
                except Exception:
                    piece = ""
                if piece:
                    full_text += piece
                    yield piece
            latency_ms = (time.perf_counter() - start) * 1000
            tokens = _estimate_tokens(request.prompt) + _estimate_tokens(full_text)
            self._stats.observe(tokens, latency_ms)
            metrics.llm_calls.labels(provider=provider, model=model, status="success").inc()
            metrics.llm_tokens.labels(provider=provider, model=model).inc(tokens)
            metrics.llm_latency.labels(provider=provider).observe(latency_ms / 1000)
        except Exception as exc:
            logger.warning("litellm stream failed — falling back to chunked completion", error=str(exc))
            response = await self.complete(request)
            text = response.content[len(full_text):] or response.content
            for token in re.findall(r"\S+\s*|\s+", text):
                yield token
                await asyncio.sleep(0.012)

    async def parallel_complete(self, requests: List[LLMRequest]) -> List[LLMResponse]:
        return await asyncio.gather(*[self.complete(r) for r in requests])

    def get_models(self) -> Dict[str, List[Dict[str, Any]]]:
        return ALL_MODELS

    def get_providers(self) -> List[str]:
        return list(ALL_MODELS.keys())

    def get_stats(self) -> Dict[str, Any]:
        avg = self._stats.latency_sum_ms / self._stats.calls if self._stats.calls else 0.0
        success_rate = ((self._stats.calls - self._stats.errors) / self._stats.calls * 100) if self._stats.calls else 100.0
        return {
            "llm_calls": self._stats.calls,
            "llm_tokens": self._stats.tokens,
            "llm_errors": self._stats.errors,
            "avg_latency_ms": round(avg, 1),
            "success_rate": round(success_rate, 1),
        }

    # ---- internals ---------------------------------------------------------

    def _resolve(self, request: LLMRequest) -> tuple[str, str]:
        provider = request.provider.value if hasattr(request.provider, "value") else (request.provider or None)
        if not provider or provider not in ALL_MODELS:
            provider = settings.DEFAULT_LLM_PROVIDER
        model = request.model_override or DEFAULT_MODEL_BY_PROVIDER.get(provider, settings.DEFAULT_LLM_MODEL)
        return provider, model

    async def _call(self, request: LLMRequest, provider: str, model: str) -> str:
        direct_key = self._direct_keys.get(provider)
        if self._api_key:
            chat = LlmChat(
                api_key=self._api_key,
                session_id=f"lumen-{uuid.uuid4().hex[:12]}",
                system_message=request.system_prompt or "You are Lumen, a helpful data intelligence assistant.",
            ).with_model(provider, model)
            message = UserMessage(text=request.prompt)
            return await chat.send_message(message) or ""
        if direct_key:
            # Fallback: call provider directly via litellm with its own API key
            params: Dict[str, Any] = {
                "model": f"{provider}/{model}" if provider != "openai" else model,
                "messages": [
                    {"role": "system", "content": request.system_prompt or "You are Lumen, a helpful data intelligence assistant."},
                    {"role": "user", "content": request.prompt},
                ],
                "api_key": direct_key,
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
            }
            resp = await litellm.acompletion(**params)
            return resp.choices[0].message.content or ""
        raise RuntimeError("No LLM key configured (EMERGENT_LLM_KEY or provider API key).")

    @staticmethod
    def _cache_key(req: LLMRequest) -> str:
        raw = f"{req.provider}|{req.mode}|{req.model_override}|{req.temperature}|{req.system_prompt}|{req.prompt}"
        return "llm:" + hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def extract_json(text: str) -> Any:
        """Robust JSON extraction from a possibly fenced LLM response."""
        text = (text or "").strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
        if fence:
            text = fence.group(1)
        start = min((i for i in (text.find("{"), text.find("[")) if i != -1), default=-1)
        if start < 0:
            raise ValueError("No JSON object found in response.")
        text = text[start:]
        end = max(text.rfind("}"), text.rfind("]"))
        if end != -1:
            text = text[: end + 1]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            cleaned = re.sub(r"//.*$", "", text, flags=re.MULTILINE)
            cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
            return json.loads(cleaned)


def _estimate_tokens(text: str) -> int:
    """Rough token estimate — 4 characters per token is the standard heuristic."""
    return max(1, len(text) // 4)
