"""Forge (PromptForge optimizer) HTTP surface.

- POST /api/forge/start          fire-and-forget optimization run (ForgeRunner)
- GET  /api/forge/{id}/status
- POST /api/forge/{id}/stop
- GET  /api/forge/{id}/stream    SSE of run events
- POST /api/forge/merge-preview  reproduce the production layered merge (markdown+greeting+stage)
- POST /api/forge/{id}/chat      interactive live-chat vs a candidate prompt (Phase-2 human loop)
- POST /api/forge/evaluate       eval-only (baseline pipeline, NO coaching)
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from src.config import DEFAULT_AGENT_TEMPERATURE
from src.llm.client import LLMClient
from src.forge.runner import ForgeRunner
from src.forge import merge as fmerge

router = APIRouter(prefix="/api/forge")

active_runs: dict[str, ForgeRunner] = {}
run_results: dict[str, dict] = {}

# Single global LLM client for the stateless helpers (merge-preview needs none; chat needs one).
_llm = LLMClient()


@router.post("/start")
async def start_run(req: dict):
    run_id = req.get("run_id")
    if not run_id:
        raise HTTPException(400, "run_id required")
    if run_id in active_runs:
        raise HTTPException(400, "Run already active")
    config = req.get("config") or {}
    spec = req.get("spec") or {}
    runner = ForgeRunner(run_id, config, req.get("callback_url"))
    active_runs[run_id] = runner

    async def run_and_store():
        try:
            run_results[run_id] = await runner.run(spec)
        except Exception as e:
            run_results[run_id] = {"status": "failed", "error": str(e)}
            # the backend must hear about it — otherwise the run shows 'optimizing' forever
            try:
                await runner.bus.emit("run_complete", {"run_id": run_id, "status": "failed",
                                                       "error": str(e)[:300], "final_version": 0})
            except Exception:
                pass
        finally:
            active_runs.pop(run_id, None)

    asyncio.create_task(run_and_store())
    return {"run_id": run_id, "status": "started"}


@router.post("/evaluate")
async def evaluate_only(req: dict):
    """Run the baseline pipeline (matrix + stress + deepeval) with NO coaching — for the
    human loop re-running datasets against an edited prompt."""
    run_id = req.get("run_id")
    if not run_id:
        raise HTTPException(400, "run_id required")
    config = req.get("config") or {}
    spec = dict(req.get("spec") or {})
    spec.setdefault("scoring", {})
    spec["scoring"] = {**spec["scoring"], "max_iterations": 0}  # baseline only
    runner = ForgeRunner(run_id, config, req.get("callback_url"))
    active_runs[run_id] = runner

    async def run_and_store():
        try:
            run_results[run_id] = await runner.run(spec)
        except Exception as e:
            run_results[run_id] = {"status": "failed", "error": str(e)}
            # the backend must hear about it — otherwise the run shows 'optimizing' forever
            try:
                await runner.bus.emit("run_complete", {"run_id": run_id, "status": "failed",
                                                       "error": str(e)[:300], "final_version": 0})
            except Exception:
                pass
        finally:
            active_runs.pop(run_id, None)

    asyncio.create_task(run_and_store())
    return {"run_id": run_id, "status": "evaluating"}


@router.get("/{run_id}/status")
async def status(run_id: str):
    if run_id in active_runs:
        return {"run_id": run_id, "status": "running"}
    if run_id in run_results:
        return {"run_id": run_id, **run_results[run_id]}
    raise HTTPException(404, "Run not found")


@router.post("/{run_id}/stop")
async def stop(run_id: str):
    runner = active_runs.get(run_id)
    if not runner:
        raise HTTPException(404, "Run not active")
    runner.stop()
    return {"run_id": run_id, "status": "stopping"}


@router.get("/{run_id}/stream")
async def stream(run_id: str):
    runner = active_runs.get(run_id)
    if not runner:
        raise HTTPException(404, "Run not active")
    q = runner.bus.subscribe()

    async def gen():
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=300)
                except asyncio.TimeoutError:
                    yield 'data: {"event_type": "timeout"}\n\n'
                    continue
                yield f"data: {json.dumps(ev)}\n\n"
                if ev.get("event_type") == "run_complete":
                    break
        finally:
            runner.bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/merge-preview")
async def merge_preview(req: dict):
    """Reproduce the production layered merge. Body: {layers:{universal,vertical,campaign,addon},
    direction, lead_status}. layers values are {prompt, override_keys}."""
    layers = req.get("layers") or {}
    rows = []
    for lt in ("universal", "vertical", "campaign"):
        L = layers.get(lt)
        if L and L.get("prompt"):
            rows.append({"prompt_type": lt, "prompt": L["prompt"], "override_keys": L.get("override_keys") or []})
    addons = []
    addon = layers.get("addon")
    if isinstance(addon, dict) and addon.get("prompt"):
        a = addon["prompt"]
        addons = [a[k] for k in a if not k.startswith("_")]
    elif isinstance(addon, list):
        addons = addon
    res = fmerge.assemble_for_forge(rows, addons,
                                    call_direction=req.get("direction", "outbound"),
                                    lead_status=req.get("lead_status", "fresh"))
    return {"markdown": res["markdown"], "greeting": res["greeting"],
            "flow_stage": res["flow_stage"], "flow_error": res["flow_error"]}


@router.post("/{run_id}/chat")
async def chat(req: dict):
    """One agent turn for the human live-chat loop. Body: {system_prompt, greeting?, history:
    [{role:'agent'|'user', content}], message}. Returns the agent's reply."""
    system_prompt = req.get("system_prompt") or ""
    history = req.get("history") or []
    message = req.get("message") or ""
    msgs = [{"role": "system", "content": system_prompt}]
    greeting = req.get("greeting")
    if greeting and not history:
        msgs.append({"role": "assistant", "content": greeting})
    for h in history:
        msgs.append({"role": "assistant" if h.get("role") == "agent" else "user",
                     "content": h.get("content", "")})
    msgs.append({"role": "user", "content": message})
    m = await _llm.chat(msgs, temperature=DEFAULT_AGENT_TEMPERATURE, max_tokens=200)
    return {"reply": (m.content or "").strip()}
