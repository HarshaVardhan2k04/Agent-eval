"""Reusable metric endpoints (hallucination, …) on the Gemma judge."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.metrics.hallucination import HallucinationMetric
from src.metrics import rag

router = APIRouter(prefix="/api/metrics")

_hallucination = HallucinationMetric()


class HallucinationRequest(BaseModel):
    actual_output: str
    contexts: list[str]
    threshold: float = 0.5
    include_reason: bool = True


@router.post("/hallucination")
async def hallucination(req: HallucinationRequest):
    metric = HallucinationMetric(threshold=req.threshold)
    try:
        return await metric.measure(req.actual_output, req.contexts, include_reason=req.include_reason)
    except Exception as e:
        raise HTTPException(502, f"Hallucination metric failed: {e}")


# ------------------------------------------------------------------ RAG metrics
class FaithfulnessRequest(BaseModel):
    output: str
    context: list[str]
    threshold: float = 0.5


class AnswerRelevancyRequest(BaseModel):
    input: str
    output: str
    threshold: float = 0.5


class ContextPrecisionRequest(BaseModel):
    input: str
    expected_output: str
    retrieval_context: list[str]
    threshold: float = 0.5


class ContextRecallRequest(BaseModel):
    expected_output: str
    retrieval_context: list[str]
    threshold: float = 0.5


class ContextRelevancyRequest(BaseModel):
    input: str
    retrieval_context: list[str]
    threshold: float = 0.5


async def _run(metric, coro_name, *args):
    try:
        return await getattr(metric, "measure")(*args)
    except Exception as e:
        raise HTTPException(502, f"Metric failed: {e}")


@router.post("/faithfulness")
async def faithfulness(req: FaithfulnessRequest):
    return await _run(rag.Faithfulness(threshold=req.threshold), "measure", req.output, req.context)


@router.post("/answer-relevancy")
async def answer_relevancy(req: AnswerRelevancyRequest):
    return await _run(rag.AnswerRelevancy(threshold=req.threshold), "measure", req.input, req.output)


@router.post("/contextual-precision")
async def contextual_precision(req: ContextPrecisionRequest):
    return await _run(rag.ContextualPrecision(threshold=req.threshold), "measure",
                      req.input, req.expected_output, req.retrieval_context)


@router.post("/contextual-recall")
async def contextual_recall(req: ContextRecallRequest):
    return await _run(rag.ContextualRecall(threshold=req.threshold), "measure",
                      req.expected_output, req.retrieval_context)


@router.post("/contextual-relevancy")
async def contextual_relevancy(req: ContextRelevancyRequest):
    return await _run(rag.ContextualRelevancy(threshold=req.threshold), "measure",
                      req.input, req.retrieval_context)


# ------------------------------------------------------------------- RAG suite
class RagSuiteRequest(BaseModel):
    input: str
    output: str | None = None           # the RAG system's answer (enables faithfulness + answer relevancy)
    expected_output: str | None = None  # gold answer (enables contextual precision + recall)
    retrieval_context: list[str]        # retrieved chunks
    threshold: float = 0.5


@router.post("/rag-suite")
async def rag_suite(req: RagSuiteRequest):
    """Run every RAG metric that the provided inputs allow, in parallel."""
    import asyncio
    ctx = req.retrieval_context or []
    tasks: dict = {
        "contextual_relevancy": rag.ContextualRelevancy(threshold=req.threshold).measure(req.input, ctx),
    }
    if req.output:
        tasks["faithfulness"] = rag.Faithfulness(threshold=req.threshold).measure(req.output, ctx)
        tasks["answer_relevancy"] = rag.AnswerRelevancy(threshold=req.threshold).measure(req.input, req.output)
    if req.expected_output:
        tasks["contextual_precision"] = rag.ContextualPrecision(threshold=req.threshold).measure(
            req.input, req.expected_output, ctx)
        tasks["contextual_recall"] = rag.ContextualRecall(threshold=req.threshold).measure(
            req.expected_output, ctx)

    keys = list(tasks.keys())
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    out = {}
    for k, r in zip(keys, results):
        out[k] = r if not isinstance(r, Exception) else {"score": None, "score_100": None, "error": str(r)[:200]}
    return out
