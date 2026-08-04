"""Flow Builder endpoint: generate a node graph from pasted flow text (Gemma)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.flow.generator import FlowGenerator
from src.flow.editor import FlowEditor

router = APIRouter(prefix="/api/flow")

_generator = FlowGenerator()
_editor = FlowEditor()


class GenerateRequest(BaseModel):
    text: str
    notes: str = ""
    direction: str = "inbound"


class EditRequest(BaseModel):
    graph: dict
    instruction: str


@router.post("/generate")
async def generate(req: GenerateRequest):
    if not req.text.strip():
        raise HTTPException(400, "text is required")
    try:
        graph = await _generator.generate(req.text, req.notes, req.direction)
    except Exception as e:
        raise HTTPException(502, f"Flow generation failed: {e}")
    return graph


@router.post("/edit")
async def edit(req: EditRequest):
    if not req.instruction.strip():
        raise HTTPException(400, "instruction is required")
    try:
        result = await _editor.edit(req.graph or {"nodes": [], "edges": []}, req.instruction)
    except Exception as e:
        raise HTTPException(502, f"Flow edit failed: {e}")
    return result
