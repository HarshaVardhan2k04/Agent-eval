import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from src.api.schemas import EvalStartRequest, EvalStopRequest
from src.core.eval_runner import EvalRunner

router = APIRouter(prefix="/api")

active_evals: dict[str, EvalRunner] = {}
eval_results: dict[str, dict] = {}


@router.post("/eval/start")
async def start_eval(request: EvalStartRequest):
    if request.eval_id in active_evals:
        raise HTTPException(400, "Eval already running")

    config = request.config.model_dump()
    runner = EvalRunner(request.eval_id, config, request.callback_url)
    active_evals[request.eval_id] = runner

    async def run_and_store():
        try:
            result = await runner.run(request.system_prompt, request.scenarios)
            eval_results[request.eval_id] = result
        except Exception as e:
            eval_results[request.eval_id] = {
                "eval_id": request.eval_id,
                "status": "failed",
                "error": str(e),
            }
        finally:
            active_evals.pop(request.eval_id, None)

    asyncio.create_task(run_and_store())

    return {"eval_id": request.eval_id, "status": "started"}


@router.get("/eval/{eval_id}/status")
async def get_status(eval_id: str):
    if eval_id in active_evals:
        return {"eval_id": eval_id, "status": "running"}
    if eval_id in eval_results:
        return {"eval_id": eval_id, "status": eval_results[eval_id].get("status", "completed")}
    raise HTTPException(404, "Eval not found")


@router.get("/eval/{eval_id}/results")
async def get_results(eval_id: str):
    if eval_id in eval_results:
        return eval_results[eval_id]
    if eval_id in active_evals:
        return {"eval_id": eval_id, "status": "running", "message": "Eval still in progress"}
    raise HTTPException(404, "Eval not found")


@router.post("/eval/{eval_id}/stop")
async def stop_eval(eval_id: str):
    runner = active_evals.get(eval_id)
    if not runner:
        raise HTTPException(404, "Eval not running")
    runner.stop()
    return {"eval_id": eval_id, "status": "stopping"}


@router.get("/eval/{eval_id}/stream")
async def stream_events(eval_id: str):
    runner = active_evals.get(eval_id)
    if not runner:
        raise HTTPException(404, "Eval not running")

    queue = runner.event_bus.subscribe()

    async def event_generator():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                import json
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("event_type") == "eval_complete":
                    break
        except asyncio.TimeoutError:
            yield "data: {\"event_type\": \"timeout\"}\n\n"
        finally:
            runner.event_bus.unsubscribe(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
