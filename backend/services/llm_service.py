from __future__ import annotations
import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from backend.config import settings
from backend.models.schemas import LLMMode, LLMProvider, LLMRequest, LLMResponse
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)

MODEL_REGISTRY = {
    LLMProvider.GEMINI: {
        LLMMode.FAST:      settings.GEMINI_FAST,
        LLMMode.ADVANCED:  settings.GEMINI_ADVANCED,
        LLMMode.REASONING: settings.GEMINI_REASONING,
    },
    LLMProvider.GROQ: {
        LLMMode.FAST:      settings.GROQ_FAST,
        LLMMode.ADVANCED:  settings.GROQ_ADVANCED,
        LLMMode.REASONING: settings.GROQ_ADVANCED,
    },
}

ALL_MODELS = {
    LLMProvider.GEMINI: [
        {"id": "gemini-2.0-flash",              "label": "Gemini 2.0 Flash",          "mode": "fast"},
        {"id": "gemini-2.0-flash-thinking-exp", "label": "Gemini 2.0 Flash Thinking", "mode": "reasoning"},
        {"id": "gemini-1.5-pro",                "label": "Gemini 1.5 Pro",            "mode": "advanced"},
        {"id": "gemini-1.5-flash",              "label": "Gemini 1.5 Flash",          "mode": "fast"},
        {"id": "gemini-1.5-flash-8b",           "label": "Gemini 1.5 Flash 8B",       "mode": "fast"},
    ],
    LLMProvider.GROQ: [
        {"id": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B",       "mode": "advanced"},
        {"id": "llama-3.1-8b-instant",    "label": "Llama 3.1 8B Instant","mode": "fast"},
        {"id": "mixtral-8x7b-32768",      "label": "Mixtral 8x7B",        "mode": "balanced"},
        {"id": "gemma2-9b-it",            "label": "Gemma2 9B",           "mode": "fast"},
    ],
}

FAST_ORDER = [LLMProvider.GROQ, LLMProvider.GEMINI]
ADVANCED_ORDER = [LLMProvider.GEMINI, LLMProvider.GROQ]
REASONING_ORDER = [LLMProvider.GEMINI, LLMProvider.GROQ]


class LLMService:
    def __init__(self, cache=None):
        self._cache = cache
        self._sem = asyncio.Semaphore(settings.LLM_PARALLEL_CALLS)
        self._clients: Dict[LLMProvider, Any] = {}
        self._init_clients()

    def _init_clients(self):
        if settings.GEMINI_API_KEY:
            try:
                import google.generativeai as genai
                genai.configure(api_key=settings.GEMINI_API_KEY)
                self._clients[LLMProvider.GEMINI] = genai
                logger.info("Gemini ready")
            except ImportError:
                logger.warning("google-generativeai not installed")

        if settings.GROQ_API_KEY:
            try:
                from groq import AsyncGroq
                self._clients[LLMProvider.GROQ] = AsyncGroq(api_key=settings.GROQ_API_KEY)
                logger.info("Groq ready")
            except ImportError:
                logger.warning("groq not installed")

    async def complete(self, request: LLMRequest) -> LLMResponse:
        key = self._cache_key(request) if request.use_cache else None
        if key and self._cache:
            raw = await self._cache.get(key)
            if raw:
                metrics.llm_cache_hits.inc()
                data = json.loads(raw)
                data["provider"] = LLMProvider(data["provider"])
                return LLMResponse(**{**data, "cached": True})

        provider = self._route(request)
        response = await self._call_with_retry(request, provider)

        if key and self._cache:
            await self._cache.set(key, json.dumps({
                "content": response.content, "provider": response.provider.value,
                "model": response.model, "tokens_used": response.tokens_used,
                "latency_ms": response.latency_ms,
            }), ttl=request.cache_ttl)

        return response

    async def stream_complete(self, request: LLMRequest):
        provider = self._route(request)
        model = self._get_model(request, provider)
        
        if provider == LLMProvider.GEMINI:
            async for token in self._stream_gemini(request, model):
                yield token
        else:
            async for token in self._stream_groq(request, model):
                yield token

    async def parallel_complete(self, requests: List[LLMRequest]) -> List[LLMResponse]:
        return await asyncio.gather(*[self.complete(r) for r in requests])

    def get_models(self) -> Dict[str, List[Dict]]:
        return {p.value: ALL_MODELS[p] for p in self._clients}

    def get_providers(self) -> List[str]:
        return [p.value for p in self._clients]

    def _route(self, req: LLMRequest) -> LLMProvider:
        if req.provider and req.provider in self._clients:
            return req.provider
        order = {
            LLMMode.FAST: FAST_ORDER,
            LLMMode.ADVANCED: ADVANCED_ORDER,
            LLMMode.REASONING: REASONING_ORDER,
        }.get(req.mode, FAST_ORDER)
        for p in order:
            if p in self._clients:
                return p
        raise RuntimeError("No LLM provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.")

    def _get_model(self, req: LLMRequest, provider: LLMProvider) -> str:
        if req.model_override:
            return req.model_override
        return MODEL_REGISTRY[provider].get(req.mode, MODEL_REGISTRY[provider][LLMMode.FAST])

    async def _call_with_retry(self, req: LLMRequest, provider: LLMProvider) -> LLMResponse:
        chain = [provider] + [p for p in self._clients if p != provider]
        last_exc: Optional[Exception] = None
        for p in chain:
            for attempt in range(1, settings.CELERY_MAX_RETRIES + 1):
                try:
                    async with self._sem:
                        return await self._dispatch(req, p)
                except Exception as e:
                    last_exc = e
                    wait = min(settings.CELERY_RETRY_BACKOFF * (2 ** (attempt - 1)), 30)
                    logger.warning("LLM failed", provider=p.value, attempt=attempt, error=str(e))
                    await asyncio.sleep(wait)
        raise RuntimeError(f"All providers failed. Last: {last_exc}")

    async def _dispatch(self, req: LLMRequest, provider: LLMProvider) -> LLMResponse:
        start = time.perf_counter()
        model = self._get_model(req, provider)
        try:
            resp = (await self._call_gemini(req, model) if provider == LLMProvider.GEMINI
                    else await self._call_groq(req, model))
            resp.latency_ms = (time.perf_counter() - start) * 1000
            metrics.llm_calls.labels(provider=provider.value, model=model, status="success").inc()
            metrics.llm_tokens.labels(provider=provider.value, model=model).inc(resp.tokens_used)
            metrics.llm_latency.labels(provider=provider.value).observe(resp.latency_ms / 1000)
            return resp
        except Exception as e:
            metrics.llm_calls.labels(provider=provider.value, model=model, status="error").inc()
            raise e

    async def _call_gemini(self, req: LLMRequest, model: str) -> LLMResponse:
        genai = self._clients[LLMProvider.GEMINI]
        is_thinking = "thinking" in model
        try:
            gmodel = genai.GenerativeModel(model, system_instruction=req.system_prompt or None)
        except Exception as e:
            logger.warning("system_instruction not supported in constructor, prepending to prompt", error=str(e))
            gmodel = genai.GenerativeModel(model)
            req.prompt = f"System: {req.system_prompt}\n\nUser: {req.prompt}" if req.system_prompt else req.prompt

        cfg = genai.GenerationConfig(
            temperature=None if is_thinking else req.temperature,
            max_output_tokens=req.max_tokens,
        )
        logger.info("Calling Gemini", model=model, prompt_len=len(req.prompt))
        resp = await asyncio.to_thread(gmodel.generate_content, req.prompt, generation_config=cfg)
        text = ""
        try:
            text = resp.text or ""
        except Exception:
            for part in resp.parts:
                text += getattr(part, "text", "")
        tokens = getattr(getattr(resp, "usage_metadata", None), "total_token_count", 0)
        return LLMResponse(content=text, provider=LLMProvider.GEMINI, model=model, tokens_used=tokens)

    async def _call_groq(self, req: LLMRequest, model: str) -> LLMResponse:
        client = self._clients[LLMProvider.GROQ]
        messages = []
        if req.system_prompt:
            messages.append({"role": "system", "content": req.system_prompt})
        messages.append({"role": "user", "content": req.prompt})
        resp = await client.chat.completions.create(
            model=model, messages=messages,
            temperature=req.temperature, max_tokens=req.max_tokens,
        )
        return LLMResponse(
            content=resp.choices[0].message.content or "",
            provider=LLMProvider.GROQ, model=model,
            tokens_used=resp.usage.total_tokens if resp.usage else 0,
        )

    async def _stream_gemini(self, req: LLMRequest, model: str):
        genai = self._clients[LLMProvider.GEMINI]
        gmodel = genai.GenerativeModel(model, system_instruction=req.system_prompt or None)
        cfg = genai.GenerationConfig(temperature=req.temperature, max_output_tokens=req.max_tokens)
        
        # Gemini Python SDK's generate_content is blocking, use to_thread for the iterator if needed, 
        # but the iterator itself yields parts.
        resp = await asyncio.to_thread(gmodel.generate_content, req.prompt, generation_config=cfg, stream=True)
        for part in resp:
            yield part.text

    async def _stream_groq(self, req: LLMRequest, model: str):
        client = self._clients[LLMProvider.GROQ]
        messages = []
        if req.system_prompt:
            messages.append({"role": "system", "content": req.system_prompt})
        messages.append({"role": "user", "content": req.prompt})
        
        stream = await client.chat.completions.create(
            model=model, messages=messages,
            temperature=req.temperature, max_tokens=req.max_tokens,
            stream=True
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    @staticmethod
    def _cache_key(req: LLMRequest) -> str:
        raw = f"{req.provider}{req.mode}{req.model_override}{req.temperature}{req.system_prompt}{req.prompt}"
        return "llm:" + hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def extract_json(text: str) -> Dict[str, Any]:
        import re
        # Find all JSON-like blocks or the first {
        text = text.strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
        if fence:
            text = fence.group(1)
        
        start = text.find("{")
        if start == -1:
            start = text.find("[")
        
        if start == -1:
            raise ValueError(f"No JSON object found in response: {text[:200]}")
            
        text = text[start:]
        
        # Try to find the last closing brace and ignore everything after
        end = text.rfind("}")
        if end == -1:
            end = text.rfind("]")
            
        if end != -1:
            text = text[:end+1]
            
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            # Last ditch effort: try to strip common artifacts
            text = re.sub(r"//.*$", "", text, flags=re.MULTILINE) # strip comments
            return json.loads(text)
