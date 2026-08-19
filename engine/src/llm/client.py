import asyncio
import json
import re

from openai import AsyncOpenAI

from src.config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    DEFAULT_MAX_LLM_CONCURRENCY,
)


# --- Gemma 4 thought-channel leak stripping (full-text, non-streaming) ---------
# Mirrors the production livekit gemma5090 plugin's _ThoughtFilter. Even with
# thinking disabled, vLLM bug #38855 can leak channel markers into content, so we
# scrub them defensively. With thinking enabled (judge/coach) the reasoning parser
# usually routes reasoning to reasoning_content, but inline leaks are stripped too.
_THOUGHT_BLOCK_RE = re.compile(
    r"<\|?channel\|?>\s*thought.*?(?:<\|?channel\|?>\s*response(?:\s*<\|?message\|?>)?|<response>?|</thought>)",
    re.DOTALL | re.IGNORECASE,
)
_THINK_BLOCK_RE = re.compile(r"<\s*think\s*>.*?</\s*think\s*>", re.DOTALL | re.IGNORECASE)
_BARE_THOUGHT_RE = re.compile(r"\A\s*thought\b.*?(?:\n|^)response\s*\n", re.DOTALL | re.IGNORECASE)
_STRAY_MARKERS_RE = re.compile(
    r"<\|?(?:channel|message|start|end)\|?>|</?\s*(?:think|thought|response)\s*>",
    re.IGNORECASE,
)
    

def strip_thinking_leaks(text):
    if not text:
        return text
    text = _THOUGHT_BLOCK_RE.sub("", text)
    text = _THINK_BLOCK_RE.sub("", text)
    text = _BARE_THOUGHT_RE.sub("", text)
    text = _STRAY_MARKERS_RE.sub("", text)
    return text.strip()


class LLMClient:
    _global_semaphore = None

    def __init__(self, base_url=None, model=None, api_key=None, max_concurrency=None, params=None):
        self.base_url = base_url or LLM_BASE_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY
        # Per-model request overrides (arena "Params" column): max_tokens/temperature
        # replace the call's values; anything else (reasoning, top_p, ...) is merged
        # into the request body — how OpenRouter takes reasoning/thinking controls.
        self.params = dict(params or {})
        self._client = AsyncOpenAI(base_url=self.base_url, api_key=self.api_key)

        if LLMClient._global_semaphore is None:
            LLMClient._global_semaphore = asyncio.Semaphore(
                max_concurrency or DEFAULT_MAX_LLM_CONCURRENCY
            )

    def _is_vllm(self):
        # Our self-hosted vLLM endpoints: the configured Gemma host, anything local,
        # or a filesystem-path model id ("/models/gemma4-awq"). Third-party
        # OpenAI-compatible providers (OpenRouter etc.) must NOT get vLLM knobs —
        # some backends reject unknown extra_body params with a 400.
        base = (self.base_url or "").lower()
        return (base == LLM_BASE_URL.lower() or "localhost" in base or "127.0.0.1" in base
                or (self.model or "").startswith("/"))

    def _extra_body(self, enable_thinking):
        # Match the production gemma5090 plugin: toggle thinking per call and keep
        # special tokens so vLLM's reasoning parser can strip channel markers.
        if not self._is_vllm():
            return None
        return {
            "chat_template_kwargs": {"enable_thinking": bool(enable_thinking)},
            "skip_special_tokens": False,
        }

    async def chat(self, messages, tools=None, temperature=0.3, max_tokens=300,
                   enable_thinking=False, seed=None, json_mode=False):
        async with self._global_semaphore:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "extra_body": self._extra_body(enable_thinking),
            }
            if self.params:
                if self.params.get("max_tokens") is not None:
                    kwargs["max_tokens"] = int(self.params["max_tokens"])
                if self.params.get("temperature") is not None:
                    kwargs["temperature"] = float(self.params["temperature"])
                extra = {k: v for k, v in self.params.items()
                         if k not in ("max_tokens", "temperature") and v is not None}
                if extra:
                    kwargs["extra_body"] = {**(kwargs.get("extra_body") or {}), **extra}
            if tools:
                kwargs["tools"] = tools
            if seed is not None:  # reproducible judge outputs (vLLM supports it)
                kwargs["seed"] = seed
            if json_mode:  # force valid JSON at the model layer (vLLM json_object)
                kwargs["response_format"] = {"type": "json_object"}
            import time as _time
            _t0 = _time.monotonic()
            response = await self._client.chat.completions.create(**kwargs)
            _ms = round((_time.monotonic() - _t0) * 1000.0, 1)
            msg = response.choices[0].message
            if msg.content:
                msg.content = strip_thinking_leaks(msg.content)
            # Per-completion observability (mirrors the voice stack's per-engine metrics:
            # duration_ms / tokens / tok_per_s). Stamped on the message for callers.
            try:
                usage = getattr(response, "usage", None)
                ctok = getattr(usage, "completion_tokens", None) if usage else None
                object.__setattr__(msg, "latency_ms", _ms)
                object.__setattr__(msg, "completion_tokens", ctok)
                object.__setattr__(msg, "tokens_per_second",
                                   round(ctok / (_ms / 1000.0), 1) if ctok and _ms > 0 else None)
            except Exception:
                pass
            return msg

    async def chat_json(self, messages, temperature=0.1, max_tokens=500,
                        enable_thinking=False, seed=None, json_mode=True):
        # json_mode defaults ON — judge/metric calls should always get valid JSON.
        raw = await self.chat(
            messages, temperature=temperature, max_tokens=max_tokens,
            enable_thinking=enable_thinking, seed=seed, json_mode=json_mode,
        )
        content = (raw.content or "").strip()
        content = content.replace("```json", "").replace("```", "").strip()
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            raise ValueError(f"Failed to parse JSON from LLM response: {content[:200]}")
        blob = match.group(0)
        try:
            return json.loads(blob)
        except json.JSONDecodeError:
            # Small models (Gemma) intermittently emit a missing comma / trailing
            # bracket, especially on long judge outputs. Repair rather than fail the
            # whole call — same fallback the metrics use.
            from json_repair import repair_json
            repaired = repair_json(blob, return_objects=True)
            if isinstance(repaired, (dict, list)) and repaired:
                return repaired
            raise
