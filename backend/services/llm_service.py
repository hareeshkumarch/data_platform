"""LLM service backed by direct provider credentials.

Supports OpenAI, Anthropic and Gemini providers. ``complete`` returns a
full response; ``stream_complete`` yields incremental chunks. We fan-out the
single completion into word-sized chunks to keep the frontend streaming
smoothly even when the underlying SDK does not expose a native stream.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List

import litellm

from backend.config import settings
from backend.models.schemas import LLMProvider, LLMRequest, LLMResponse
from backend.services.circuit_breaker import CircuitBreaker
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)

_CIRCUIT_BREAKER = CircuitBreaker(
    failure_threshold=3,
    window_seconds=60.0,
    cooldown_seconds=30.0,
)


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
        {
            "id": "claude-sonnet-4-5-20250929",
            "label": "Claude Sonnet 4.5",
            "mode": "advanced",
        },
        {
            "id": "claude-haiku-4-5-20251001",
            "label": "Claude Haiku 4.5",
            "mode": "fast",
        },
        {
            "id": "claude-opus-4-5-20251101",
            "label": "Claude Opus 4.5",
            "mode": "reasoning",
        },
    ],
    "gemini": [
        {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "mode": "advanced"},
        {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "mode": "fast"},
    ],
    "groq": [
        {
            "id": "llama-3.3-70b-versatile",
            "label": "Llama 3.3 70B Versatile",
            "mode": "advanced",
        },
        {"id": "llama-3.1-8b-instant", "label": "Llama 3.1 8B Instant", "mode": "fast"},
        {"id": "llama3-70b-8192", "label": "Llama 3 70B", "mode": "balanced"},
        {"id": "mixtral-8x7b-32768", "label": "Mixtral 8x7B", "mode": "balanced"},
        {"id": "gemma2-9b-it", "label": "Gemma 2 9B", "mode": "fast"},
    ],
}


DEFAULT_MODEL_BY_PROVIDER: Dict[str, str] = {
    "openai": "gpt-5.2",
    "anthropic": "claude-sonnet-4-5-20250929",
    "gemini": "gemini-2.5-flash",
    "groq": "llama-3.3-70b-versatile",
}


@dataclass
class LLMStats:
    """Simple in-process counters used by the Settings page."""

    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    errors: int = 0
    latency_sum_ms: float = 0.0

    def observe(
        self, tokens_in: int, tokens_out: int, latency_ms: float, error: bool = False
    ) -> None:
        self.calls += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        self.latency_sum_ms += latency_ms
        if error:
            self.errors += 1


_GLOBAL_LLM_STATS = LLMStats()


# Cap the response body we run through the slow JSON-salvage parser so a
# misbehaving or adversarial provider can't pin a CPU with O(n²) scans.
_MAX_JSON_CANDIDATE_BYTES = 64 * 1024


def _coerce_provider(provider: Any) -> LLMProvider:
    """Map a provider string to an LLMProvider enum without silently falling
    through to GEMINI (which previously polluted metrics with wrong labels)."""
    if isinstance(provider, LLMProvider):
        return provider
    if isinstance(provider, str):
        key = provider.lower()
        if key in LLMProvider._value2member_map_:
            return LLMProvider(key)
        for member in LLMProvider:
            if member.value == key or member.name.lower() == key:
                return member
    logger.warning("Unknown LLM provider value", provider=str(provider))
    # Fall back to the configured default rather than a hard-coded vendor.
    default = settings.DEFAULT_LLM_PROVIDER.lower()
    if default in LLMProvider._value2member_map_:
        return LLMProvider(default)
    return next(iter(LLMProvider))


class LLMService:
    """Thin wrapper around litellm supporting multiple providers."""

    def __init__(self, cache=None) -> None:
        self._cache = cache
        self._sem = asyncio.Semaphore(settings.LLM_PARALLEL_CALLS)
        self._stats = _GLOBAL_LLM_STATS
        self._direct_keys = {
            "openai": settings.OPENAI_API_KEY,
            "anthropic": settings.ANTHROPIC_API_KEY,
            "gemini": settings.GEMINI_API_KEY,
            "groq": settings.GROQ_API_KEY,
        }
        if not any(self._direct_keys.values()):
            logger.warning(
                "No LLM keys configured — set at least one provider API key."
            )

    # ---- public API --------------------------------------------------------

    async def complete(self, request: LLMRequest) -> LLMResponse:
        """Return a full completion, using cache when available.

        Integrates circuit-breaker resilience: if the preferred provider is
        tripped, auto-fallback to the next healthy configured provider.
        """
        key = self._cache_key(request) if request.use_cache else None
        if key and self._cache:
            raw = await self._cache.get_json(key)
            if raw:
                metrics.llm_cache_hits.inc()
                return LLMResponse(
                    content=raw["content"],
                    provider=_coerce_provider(raw["provider"]),
                    model=raw["model"],
                    tokens_in=raw.get("tokens_in", 0),
                    tokens_out=raw.get("tokens_out", 0),
                    cached=True,
                    latency_ms=raw.get("latency_ms", 0.0),
                )

        preferred_provider, preferred_model = self._resolve(request)
        providers = list(self._direct_keys.keys())
        provider = preferred_provider
        model = preferred_model
        last_exc: Optional[Exception] = None

        for attempt in range(len(providers)):
            if _CIRCUIT_BREAKER.is_open(provider):
                fallback = _CIRCUIT_BREAKER.pick_fallback(
                    provider, providers, self._direct_keys
                )
                if fallback == provider:
                    # All breakers open; try anyway (degraded)
                    pass
                else:
                    logger.warning(
                        "Circuit breaker OPEN — falling back",
                        from_provider=provider,
                        to_provider=fallback,
                    )
                    provider = fallback
                    model = self._default_model_for(provider)

            start = time.perf_counter()
            tokens_in, tokens_out = 0, 0
            try:
                async with self._sem:
                    resp = await self._call(request, provider, model)
                    content = resp.choices[0].message.content or ""
                    if hasattr(resp, "usage") and resp.usage:
                        tokens_in = getattr(resp.usage, "prompt_tokens", 0)
                        tokens_out = getattr(resp.usage, "completion_tokens", 0)
                latency_ms = (time.perf_counter() - start) * 1000
                self._stats.observe(tokens_in, tokens_out, latency_ms)
                metrics.llm_calls.labels(
                    provider=provider, model=model, status="success"
                ).inc()
                metrics.llm_tokens.labels(provider=provider, model=model).inc(
                    tokens_in + tokens_out
                )
                metrics.llm_latency.labels(provider=provider).observe(
                    latency_ms / 1000
                )
                await _CIRCUIT_BREAKER.record_success(provider)
                break  # success — exit retry loop
            except Exception as exc:
                latency_ms = (time.perf_counter() - start) * 1000
                self._stats.observe(0, 0, latency_ms, error=True)
                metrics.llm_calls.labels(
                    provider=provider, model=model, status="error"
                ).inc()
                logger.error(
                    "LLM call failed",
                    provider=provider,
                    model=model,
                    error=str(exc),
                )
                await _CIRCUIT_BREAKER.record_failure(provider)
                last_exc = exc
                # Try next provider on next iteration
                provider = _CIRCUIT_BREAKER.pick_fallback(
                    provider, providers, self._direct_keys
                )
                model = self._default_model_for(provider)
        else:
            # All providers exhausted
            raise last_exc or RuntimeError("All LLM providers failed.")

        response = LLMResponse(
            content=content,
            provider=_coerce_provider(provider),
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cached=False,
            latency_ms=latency_ms,
        )

        if key and self._cache:
            await self._cache.set_json(
                key,
                {
                    "content": response.content,
                    "provider": response.provider.value
                    if hasattr(response.provider, "value")
                    else str(response.provider),
                    "model": response.model,
                    "tokens_in": response.tokens_in,
                    "tokens_out": response.tokens_out,
                    "latency_ms": response.latency_ms,
                },
                ttl=request.cache_ttl,
            )
        return response

    async def stream_complete(self, request: LLMRequest) -> AsyncIterator[str]:
        """Stream tokens directly from the LLM provider as they arrive.

        Uses ``litellm.acompletion(stream=True, stream_options={"include_usage": True})``.
        """
        provider, model = self._resolve(request)
        direct_key = self._direct_keys.get(provider)
        if not direct_key:
            raise RuntimeError("No LLM key configured for provider: " + provider)

        params: Dict[str, Any] = {
            "messages": [
                {
                    "role": "system",
                    "content": request.system_prompt
                    or "You are Lumen, a helpful data intelligence assistant.",
                },
                {"role": "user", "content": request.prompt},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        params.update(
            {
                "model": model if provider == "openai" else f"{provider}/{model}",
                "api_key": direct_key,
            }
        )

        start = time.perf_counter()
        full_text = ""
        tokens_in, tokens_out = 0, 0
        
        # Exponential backoff for stream initialization
        max_retries = 3
        base_delay = 1.5
        stream = None
        
        for attempt in range(max_retries):
            try:
                stream = await litellm.acompletion(**params)
                break
            except Exception as e:
                err_str = str(e).lower()
                is_transient = any(code in err_str for code in ["429", "500", "502", "503", "504", "rate limit", "timeout"])
                
                if is_transient and attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"LLM Stream Transient Error (Attempt {attempt + 1}/{max_retries}) Provider: {provider}. Retrying in {delay}s... Error: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise

        try:
            async for chunk in stream:
                try:
                    if hasattr(chunk, "usage") and chunk.usage:
                        tokens_in = getattr(chunk.usage, "prompt_tokens", tokens_in)
                        tokens_out = getattr(
                            chunk.usage, "completion_tokens", tokens_out
                        )
                    if hasattr(chunk, "choices") and chunk.choices:
                        delta = chunk.choices[0].delta
                        piece = (
                            delta.content if hasattr(delta, "content") else None
                        ) or ""
                        if piece:
                            full_text += piece
                            yield piece
                except Exception:
                    pass
            latency_ms = (time.perf_counter() - start) * 1000
            self._stats.observe(tokens_in, tokens_out, latency_ms)
            metrics.llm_calls.labels(
                provider=provider, model=model, status="success"
            ).inc()
            metrics.llm_tokens.labels(provider=provider, model=model).inc(
                tokens_in + tokens_out
            )
            metrics.llm_latency.labels(provider=provider).observe(latency_ms / 1000)
        except Exception as exc:
            logger.warning(
                "litellm stream failed — falling back to chunked completion",
                error=str(exc),
            )
            response = await self.complete(request)
            text = response.content[len(full_text) :] or response.content
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
        avg = (
            self._stats.latency_sum_ms / self._stats.calls if self._stats.calls else 0.0
        )
        success_rate = (
            ((self._stats.calls - self._stats.errors) / self._stats.calls * 100)
            if self._stats.calls
            else 100.0
        )
        return {
            "llm_calls": self._stats.calls,
            "llm_tokens": self._stats.tokens_in + self._stats.tokens_out,
            "llm_tokens_in": self._stats.tokens_in,
            "llm_tokens_out": self._stats.tokens_out,
            "llm_errors": self._stats.errors,
            "avg_latency_ms": round(avg, 1),
            "success_rate": round(success_rate, 1),
        }

    def get_circuit_status(self) -> Dict[str, Any]:
        return _CIRCUIT_BREAKER.status()

    @staticmethod
    def _default_model_for(provider: str) -> str:
        return DEFAULT_MODEL_BY_PROVIDER.get(provider, settings.DEFAULT_LLM_MODEL)

    # ---- internals ---------------------------------------------------------

    def _resolve(self, request: LLMRequest) -> tuple[str, str]:
        provider = (
            request.provider.value
            if hasattr(request.provider, "value")
            else (request.provider or None)
        )
        if not provider or provider not in ALL_MODELS:
            provider = settings.DEFAULT_LLM_PROVIDER
        model = request.model_override or DEFAULT_MODEL_BY_PROVIDER.get(
            provider, settings.DEFAULT_LLM_MODEL
        )
        return provider, model

    async def _call(self, request: LLMRequest, provider: str, model: str) -> Any:
        direct_key = self._direct_keys.get(provider)
        if not direct_key:
            if provider == "groq":
                raise RuntimeError(
                    "Groq requires GROQ_API_KEY in backend/.env — get one at https://console.groq.com/keys."
                )
            raise RuntimeError(
                f"No LLM key configured for provider '{provider}'. Set {provider.upper()}_API_KEY in backend/.env."
            )
        params: Dict[str, Any] = {
            "model": f"{provider}/{model}" if provider != "openai" else model,
            "messages": [
                {
                    "role": "system",
                    "content": request.system_prompt
                    or "You are Lumen, a helpful data intelligence assistant.",
                },
                {"role": "user", "content": request.prompt},
            ],
            "api_key": direct_key,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        
        # Exponential backoff for resilience against rate limits (429) and server errors (50x)
        max_retries = 3
        base_delay = 1.5
        
        for attempt in range(max_retries):
            try:
                return await litellm.acompletion(**params)
            except Exception as e:
                err_str = str(e).lower()
                is_transient = any(code in err_str for code in ["429", "500", "502", "503", "504", "rate limit", "timeout"])
                
                if is_transient and attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"LLM Transient Error (Attempt {attempt + 1}/{max_retries}) Provider: {provider}. Retrying in {delay}s... Error: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise

    @staticmethod
    def _cache_key(req: LLMRequest) -> str:
        raw = f"{req.provider}|{req.mode}|{req.model_override}|{req.temperature}|{req.system_prompt}|{req.prompt}"
        return "llm:" + hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def extract_json(text: str) -> Any:
        """Robust JSON extraction from a possibly fenced or mixed LLM response."""
        text = (text or "").strip()
        # Cap input to prevent O(n²) scan on adversarially large responses.
        if len(text) > _MAX_JSON_CANDIDATE_BYTES:
            text = text[:_MAX_JSON_CANDIDATE_BYTES]

        # 1. Try to find a JSON-specific code block first
        json_fence = re.search(r"```(?:json)\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
        if json_fence:
            try:
                return json.loads(json_fence.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 2. Try any code block, but check if it's actually JSON
        any_fence = re.finditer(r"```(?:\w+)?\s*([\s\S]+?)\s*```", text)
        for match in any_fence:
            content = match.group(1).strip()
            if content.startswith(("{", "[")):
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    continue

        # 3. Aggressive scan: find ALL "{" or "[" and try to parse from each one
        # We search from the largest possible candidate blocks first
        candidates = []
        for i, char in enumerate(text):
            if char in ("{", "["):
                end_char = "}" if char == "{" else "]"
                last_end = text.rfind(end_char, i)
                if last_end != -1:
                    candidates.append((i, last_end))

        # Sort candidates: we prefer ones that are closer to the end (often where the final JSON is)
        # or ones that are larger.
        candidates.sort(key=lambda x: x[0], reverse=True)

        for start, end in candidates:
            candidate = text[start : end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                # Try cleaning it
                cleaned = re.sub(r"//.*$", "", candidate, flags=re.MULTILINE)
                cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError:
                    continue

        raise ValueError(
            "No valid JSON object could be extracted from the LLM response."
        )

    @staticmethod
    def extract_json_with_preamble(text: str) -> tuple[Any, str]:
        """Returns (parsed_data, preamble_text) from a response."""
        text = (text or "").strip()
        if len(text) > _MAX_JSON_CANDIDATE_BYTES:
            text = text[:_MAX_JSON_CANDIDATE_BYTES]

        # 1. Try strict JSON block first
        json_fence = re.search(r"```(?:json)\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
        if json_fence:
            try:
                data = json.loads(json_fence.group(1).strip())
                preamble = text[: json_fence.start()].strip()
                return data, preamble
            except json.JSONDecodeError:
                pass

        # 2. Try generic blocks that start with { or [
        any_fence = re.finditer(r"```(?:\w+)?\s*([\s\S]+?)\s*```", text)
        for match in any_fence:
            content = match.group(1).strip()
            if content.startswith(("{", "[")):
                try:
                    data = json.loads(content)
                    preamble = text[: match.start()].strip()
                    return data, preamble
                except json.JSONDecodeError:
                    pass

        # 3. Fallback: Aggressive scan for highest-weighted dictionary candidate
        candidates = []
        for i, char in enumerate(text):
            if char in ("{", "["):
                end_char = "}" if char == "{" else "]"
                last_end = text.rfind(end_char, i)
                if last_end != -1:
                    candidates.append((i, last_end))

        # Sort candidates by length to prefer the largest encompassing JSON bounds
        candidates.sort(key=lambda x: x[1] - x[0], reverse=True)

        for start, end in candidates:
            candidate = text[start : end + 1]
            try:
                data = json.loads(candidate)
                preamble = text[:start].strip()
                preamble = re.sub(r"```[a-z]*", "", preamble).strip()
                return data, preamble
            except Exception:
                continue

        # Last resort fallback if everything failed
        try:
            return LLMService.extract_json(text), ""
        except ValueError:
            return {}, text
