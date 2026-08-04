"""Call Analysis endpoint: score one call (backend orchestrates batches)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.analysis.evaluator import CallEvaluator

router = APIRouter(prefix="/api/analysis")

_evaluator = CallEvaluator()


class ScoreCallRequest(BaseModel):
    call_id: str | None = None
    transcript: str
    call_direction: str = "outbound"
    editable_config: dict | str | None = None
    available_tools: list[str] | None = None
    tool_events: list[dict] | None = None


@router.post("/score")
async def score_call(req: ScoreCallRequest):
    try:
        result = await _evaluator.evaluate(req.model_dump())
    except Exception as e:
        raise HTTPException(502, f"Scoring failed: {e}")
    result["call_id"] = req.call_id
    return result
