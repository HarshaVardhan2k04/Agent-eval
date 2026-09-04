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


class _ToolCall:
    """Same shape as the SDK's ChatCompletionMessageToolCall (.id/.function.name/.arguments)."""
    __slots__ = ("id", "type", "function")

    def __init__(self, call_id, name, arguments):
        self.id = call_id
        self.type = "function"
        self.function = _ToolFn(name, arguments)


class _ToolFn:
    __slots__ = ("name", "arguments")

    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments or "{}"


class _StreamedMessage:
    """The assembled assistant message, attribute-compatible with the non-streamed one."""
    __slots__ = ("content", "tool_calls", "finish_reason", "role",
                 "latency_ms", "ttft_ms", "completion_tokens", "tokens_per_second")

    def __init__(self, content=None, tool_calls=None, finish_reason=None):
        self.role = "assistant"
        self.content = content
        self.tool_calls = tool_calls or []
        self.finish_reason = finish_reason
        self.latency_ms = self.ttft_ms = self.completion_tokens = self.tokens_per_second = None


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
        # Fail fast, never freeze a run: a single stuck completion used to block for
        # up to ~30 min (SDK default 600s x retries). 2 min read cap + 1 retry.
        import httpx as _httpx
        self._client = AsyncOpenAI(base_url=self.base_url, api_key=self.api_key,
                                   timeout=_httpx.Timeout(connect=5.0, read=120.0, write=15.0, pool=15.0),
                                   max_retries=1)

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
            # production's gemma5090 plugin sends this on EVERY request (llm.py:201/355),
            # tools present or not — a turn may legitimately fire several tools at once.
            kwargs["parallel_tool_calls"] = True
            if tools:
                kwargs["tools"] = tools
            if seed is not None:  # reproducible judge outputs (vLLM supports it)
                kwargs["seed"] = seed
            if json_mode:  # force valid JSON at the model layer (vLLM json_object)
                kwargs["response_format"] = {"type": "json_object"}
            # STREAM, like production. vLLM's gemma4 tool-call parser takes a different
            # code path when streaming, and that path is where the raw <|tool_call|> leak
            # actually originates — a non-streaming eval can never reproduce it. Streaming
            # also gives a real TTFT, the number the voice stack cares about.
            kwargs["stream"] = True
            kwargs["stream_options"] = {"include_usage": True}
            import time as _time
            _t0 = _time.monotonic()
            stream = await self._client.chat.completions.create(**kwargs)
            content_parts, tool_slots, usage = [], {}, None
            ttft = None
            finish_reason = None
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    usage = chunk.usage
                if not getattr(chunk, "choices", None):
                    continue
                choice = chunk.choices[0]
                delta = getattr(choice, "delta", None)
                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                if delta is None:
                    continue
                if delta.content:
                    if ttft is None:
                        ttft = round((_time.monotonic() - _t0) * 1000.0, 1)
                    content_parts.append(delta.content)
                # Accumulate tool calls exactly like LiveKit: a name delta OPENS a call
                # (keyed by index, since parallel calls interleave), argument deltas are
                # string-concatenated onto it.
                for tc in (delta.tool_calls or []):
                    slot = tool_slots.setdefault(tc.index, {"id": None, "name": "", "args": ""})
                    if getattr(tc, "id", None):
                        slot["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if fn is not None:
                        if fn.name:
                            slot["name"] = fn.name
                            if ttft is None:
                                ttft = round((_time.monotonic() - _t0) * 1000.0, 1)
                        if fn.arguments:
                            slot["args"] += fn.arguments
            _ms = round((_time.monotonic() - _t0) * 1000.0, 1)

            msg = _StreamedMessage(
                content=strip_thinking_leaks("".join(content_parts)) or None,
                tool_calls=[_ToolCall(v["id"] or f"call_{k}", v["name"], v["args"])
                            for k, v in sorted(tool_slots.items()) if v["name"]],
                finish_reason=finish_reason,
            )
            ctok = getattr(usage, "completion_tokens", None) if usage else None
            msg.latency_ms = _ms
            msg.ttft_ms = ttft
            msg.completion_tokens = ctok
            msg.tokens_per_second = round(ctok / (_ms / 1000.0), 1) if ctok and _ms > 0 else None
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
        if not match and enable_thinking:
            # Ran out of budget mid-object: thinking ate the tokens the answer needed.
            # Retry once with thinking OFF so the whole budget goes to the JSON. Silent
            # truncation used to surface as a parse error that callers scored as a
            # behavioural verdict — see the polarity note in forge/detectors.py.
            raw = await self.chat(
                messages, temperature=temperature, max_tokens=max_tokens,
                enable_thinking=False, seed=seed, json_mode=json_mode,
            )
            content = (raw.content or "").strip().replace("```json", "").replace("```", "").strip()
            match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            fr = getattr(raw, "finish_reason", None)
            raise ValueError(
                f"Failed to parse JSON from LLM response (finish_reason={fr}, "
                f"max_tokens={max_tokens}): {content[:200]}")
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
