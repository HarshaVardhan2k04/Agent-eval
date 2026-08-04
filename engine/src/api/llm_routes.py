"""Test-an-LLM: send a prompt to a model endpoint and see the response + latency.

Lets the user preview / sanity-check the model that acts as judge & coach. Today
that's the self-hosted Gemma; the endpoint is overridable so a different model can
be swapped in later without code changes.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src import config
from src.llm.client import LLMClient

router = APIRouter(prefix="/api/llm")


class LLMTestRequest(BaseModel):
    base_url: str | None = None
    model: str | None = None
    system: str | None = None
    prompt: str
    enable_thinking: bool = False
    temperature: float = 0.3
    max_tokens: int = 512


@router.get("/info")
async def info():
    # Never leak the API key; just what the app is pointed at.
    return {"base_url": config.LLM_BASE_URL, "model": config.LLM_MODEL}


@router.post("/test")
async def test(req: LLMTestRequest):
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    client = LLMClient(base_url=req.base_url or None, model=req.model or None)
    messages = []
    if req.system:
        messages.append({"role": "system", "content": req.system})
    messages.append({"role": "user", "content": req.prompt})

    t0 = time.perf_counter()
    try:
        msg = await client.chat(
            messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            enable_thinking=req.enable_thinking,
        )
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")
    latency_ms = int((time.perf_counter() - t0) * 1000)

    return {
        "response": msg.content or "",
        "latency_ms": latency_ms,
        "model": client.model,
        "thinking": req.enable_thinking,
    }
