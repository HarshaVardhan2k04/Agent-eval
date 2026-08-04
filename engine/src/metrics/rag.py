"""RAG evaluation metrics — native ports on our (AWS-hosted) Gemma judge.

Per the chosen design (accuracy over cost):
  - Faithfulness          -> DeepEval decomposition (claims -> per-claim verdict -> count)
  - Answer Relevancy      -> Opik single-shot (rubric + few-shot, one call)
  - Contextual Precision  -> DeepEval per-chunk verdict -> ranking-aware MAP@k
  - Contextual Recall     -> DeepEval decompose gold answer -> per-sentence attributable -> count
  - Contextual Relevancy  -> DeepEval decompose each chunk -> per-statement relevant -> count

Every judge call uses temperature 0 + a fixed seed (reproducible) and json_mode
(vLLM response_format=json_object -> always-valid JSON). Verdict trails are returned
so a human can audit any score.
"""
from __future__ import annotations

import json
import re

from src.config import DEFAULT_JUDGE_MAX_TOKENS
from src.llm.client import LLMClient

_SEED = 13          # fixed -> reproducible scores
_TEMP = 0.0

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _clamp01(v) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.0


def _norm_yn(v) -> str:
    s = str(v).strip().lower()
    if s.startswith("idk") or s in ("unsure", "unknown"):
        return "idk"
    return "no" if s.startswith("n") else "yes"


# 4-way faithfulness verdict + how much each hurts the score.
_FAITH_PENALTY = {"supported": 0.0, "not_in_kb": 0.0, "partial": 0.5, "contradicted": 1.0}


def _norm_faith(v) -> str:
    s = str(v).strip().lower()
    if s.startswith("contradict") or s == "no":
        return "contradicted"
    if s.startswith("partial"):
        return "partial"
    if s.startswith("support") or s in ("yes", "consistent", "faithful"):
        return "supported"
    # idk / unverifiable / not in context / not_in_kb / unknown
    return "not_in_kb"


class _Base:
    def __init__(self, client: LLMClient | None = None, threshold: float = 0.5):
        self.client = client or LLMClient()
        self.threshold = threshold

    async def _json(self, system: str, user: str, max_tokens: int = 1500):
        # Retry on a malformed/truncated response. Attempt 0 uses the fixed seed
        # (reproducible); retries vary the seed so a bad generation isn't just repeated.
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        last = None
        for attempt in range(3):
            try:
                # Attempt 0 is greedy + fixed seed (reproducible). At temp 0 the seed
                # can't change the output, so retries bump temperature for a fresh draw.
                msg = await self.client.chat(
                    msgs, temperature=(_TEMP if attempt == 0 else 0.5),
                    max_tokens=max_tokens, enable_thinking=False,
                    seed=_SEED + attempt, json_mode=True,
                )
                content = (msg.content or "").strip().replace("```json", "").replace("```", "").strip()
                m = re.search(r"\{.*\}", content, re.DOTALL)
                if not m:
                    raise ValueError("no JSON object in response")
                blob = m.group(0)
                try:
                    return json.loads(blob)
                except json.JSONDecodeError:
                    # Small models emit malformed JSON that json_object mode doesn't
                    # catch (missing quotes/commas, e.g. `"contradictions:[]`). Repair it
                    # rather than fail the whole metric.
                    from json_repair import repair_json
                    return repair_json(blob, return_objects=True)
            except Exception as e:
                last = e
        raise last


# ---------------------------------------------------------------- Faithfulness
class Faithfulness(_Base):
    """Claim-level faithfulness (a.k.a. hallucination check).

    Decompose the OUTPUT into factual claims, then judge EACH claim against the
    knowledge base with a 4-way verdict (supported / partial / contradicted /
    not_in_kb). Score = 1 − (Σ penalty / #claims); lower penalty = fewer
    hallucinations. Face-value: judge only against the KB, never outside knowledge.
    Returns the full per-claim trail so a human can see exactly what went wrong.
    """

    _CLAIMS_SYS = "Extract factual claims from the text. Reply ONLY JSON."
    _VERDICTS_SYS = (
        "You are a strict factual-consistency checker (a hallucination detector). "
        "Judge each claim ONLY against the given knowledge base — never use outside knowledge. "
        "Reply ONLY JSON."
    )

    async def measure(self, output: str, context: list[str], include_reason: bool = True) -> dict:
        context = [c for c in (context or []) if str(c).strip()]
        if not context:
            return {"score": None, "score_100": None, "passed": None, "claims": [], "verdicts": [],
                    "contradicted": [], "partial": [], "not_in_kb": [], "reason": "No knowledge base to check against."}

        claims = await self._claims(output or "")
        if not claims:
            return {"score": None, "score_100": None, "passed": None, "claims": [], "verdicts": [],
                    "contradicted": [], "partial": [], "not_in_kb": [],
                    "reason": "The agent made no checkable factual claims."}

        verdicts = await self._verdicts(claims, context)
        n = len(verdicts)
        # Score only over claims the KB can actually adjudicate. not_in_kb claims are
        # excluded (we can't verify them) — so an agent that asserts only uncoverable
        # things scores "—", not a misleading 100.
        verifiable = sum(1 for v in verdicts if v["verdict"] != "not_in_kb")
        penalty = sum(_FAITH_PENALTY.get(v["verdict"], 0.0) for v in verdicts)
        score = max(0.0, 1.0 - penalty / verifiable) if verifiable else None

        contradicted = [v for v in verdicts if v["verdict"] == "contradicted"]
        partial = [v for v in verdicts if v["verdict"] == "partial"]
        not_in_kb = [v for v in verdicts if v["verdict"] == "not_in_kb"]
        reason = None
        if include_reason:
            if contradicted or partial:
                reason = (f"{len(contradicted)} contradicted, {len(partial)} partially-off of {n} claims: "
                          + "; ".join(v["reason"] for v in (contradicted + partial))[:400])
            elif verifiable == 0:
                reason = f"None of the agent's {n} claims are covered by the knowledge base — nothing to verify."
            else:
                reason = f"All {verifiable} checkable claims are consistent with the knowledge base."
        return {
            "score": round(score, 4) if score is not None else None,
            "score_100": round(score * 100, 1) if score is not None else None,
            "passed": (score >= self.threshold) if score is not None else None,
            "threshold": self.threshold,
            "claims": claims, "verdicts": verdicts,
            "contradicted": contradicted, "partial": partial, "not_in_kb": not_in_kb,
            "reason": reason,
        }

    async def _claims(self, output: str) -> list[str]:
        raw = await self._json(
            self._CLAIMS_SYS,
            f'Extract every FACTUAL, checkable claim the speaker asserts (prices, dates, hours, '
            f'policies, product/company facts) as a JSON list. Ignore greetings, opinions, questions, '
            f'and pleasantries.\nReturn {{"claims": ["claim 1", ...]}}.\n\nTEXT:\n{output}',
        )
        items = raw.get("claims") if isinstance(raw, dict) else None
        if not isinstance(items, list):
            return []
        seen, claims = set(), []  # dedupe so a repeated claim isn't double-counted
        for c in items:
            s = str(c).strip()[:300]
            k = s.lower()
            if s and k not in seen:
                seen.add(k)
                claims.append(s)
        return claims[:30]

    async def _verdicts(self, claims: list[str], context: list[str]) -> list[dict]:
        cblock = "\n".join(f"- {c}" for c in context)
        qblock = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(claims))
        raw = await self._json(
            self._VERDICTS_SYS,
            f'For EACH claim, judge it against the KNOWLEDGE BASE using ONLY the KB (no outside knowledge). '
            f'The verdict is exactly one of:\n'
            f'- "supported": the KB confirms the claim.\n'
            f'- "contradicted": the KB states otherwise (a hallucination).\n'
            f'- "partial": mostly right but a detail is wrong, misattributed, or oversimplified.\n'
            f'- "not_in_kb": the KB neither confirms nor denies it.\n'
            f'Watch for subtle failures: subject/attribute MISATTRIBUTION (right fact, wrong entity), '
            f'PARTIAL contradictions, and OVERSIMPLIFICATIONS that change meaning. '
            f'For "contradicted"/"partial", the reason MUST quote the conflicting KB fact and give the correction.\n'
            f'Return exactly {len(claims)} verdicts in order: '
            f'{{"verdicts":[{{"verdict":"supported|partial|contradicted|not_in_kb","reason":"..."}}]}}.\n\n'
            f'KNOWLEDGE BASE:\n{cblock}\n\nCLAIMS:\n{qblock}',
        )
        items = raw.get("verdicts") if isinstance(raw, dict) else None
        items = items if isinstance(items, list) else []
        # Iterate over CLAIMS (not the model's list) so verdicts stay 1:1 with claims
        # even if the model returns a malformed/short/extra list. A claim with no valid
        # verdict is left unverified (excluded from scoring), never dropped or duplicated.
        out = []
        for i, claim in enumerate(claims):
            it = items[i] if i < len(items) else None
            if isinstance(it, dict):
                out.append({"claim": claim, "verdict": _norm_faith(it.get("verdict")),
                            "reason": str(it.get("reason", ""))[:300]})
            else:
                out.append({"claim": claim, "verdict": "not_in_kb", "reason": "No verdict returned by the judge."})
        return out


# ------------------------------------------------------------- Self-consistency
class SelfConsistency(_Base):
    """Does the agent contradict ITSELF within the same call? Needs NO knowledge base —
    the call is its own ground truth. One call: extract the agent's factual claims and
    flag any pairs that can't both be true. score = share of claims not in a conflict.
    """

    _SYS = "You detect internal contradictions in a single speaker's own statements. Reply ONLY JSON."

    async def measure(self, output: str) -> dict:
        raw = await self._json(
            self._SYS,
            'From the AGENT statements below, (1) list the distinct FACTUAL claims the agent asserts '
            '(prices, dates, hours, policies, facts — ignore greetings/opinions), and (2) find any PAIRS '
            'that CONTRADICT each other (cannot both be true in the same call). Judge meaning, not wording.\n'
            'Return {"claims":["..."],"contradictions":[{"claim_a":"...","claim_b":"...","reason":"..."}]}.\n\n'
            f'AGENT STATEMENTS:\n{output}',
        )
        claims = [str(c)[:200] for c in (raw.get("claims") or [])
                  if str(c).strip()] if isinstance(raw, dict) else []
        contradictions = []
        for c in (raw.get("contradictions") or [] if isinstance(raw, dict) else []):
            if isinstance(c, dict) and str(c.get("claim_a", "")).strip() and str(c.get("claim_b", "")).strip():
                contradictions.append({"claim_a": str(c["claim_a"])[:200], "claim_b": str(c["claim_b"])[:200],
                                       "reason": str(c.get("reason", ""))[:300]})
        total = len(claims)
        if total < 2:  # can't self-contradict with fewer than two claims
            return {"score": None, "score_100": None, "passed": None, "claims": claims,
                    "contradictions": [], "reason": "Not enough factual claims to check for self-contradiction."}
        # Each contradiction ties up 2 claims; share of claims free of conflict.
        score = max(0.0, (total - 2 * len(contradictions)) / total)
        return {"score": round(score, 4), "score_100": round(score * 100, 1),
                "passed": score >= self.threshold, "threshold": self.threshold,
                "claims": claims, "contradictions": contradictions,
                "reason": (f"{len(contradictions)} self-contradiction(s): "
                           + "; ".join(c["reason"] for c in contradictions))[:400]
                          if contradictions else "No self-contradictions found."}


# ------------------------------------------------------------- Answer Relevancy
class AnswerRelevancy(_Base):
    """Opik-style single-shot: rate how well the output answers the input."""

    _SYS = (
        "You are an expert judge scoring how RELEVANT an answer is to the question. "
        "Reply ONLY JSON. A relevant answer directly addresses the question without "
        "rambling, padding, or going off-topic. Score 0.0 (irrelevant) to 1.0 (fully on-point).\n"
        'Examples: Q "What are your hours?" A "We are open 9-6 weekdays." -> 1.0. '
        'A "We have great service and many happy customers." -> 0.2 (dodges the question).'
    )

    async def measure(self, input: str, output: str) -> dict:
        raw = await self._json(
            self._SYS,
            f'Return {{"answer_relevance_score": <0-1>, "reason": "..."}}.\n\n'
            f'QUESTION:\n{input}\n\nANSWER:\n{output}',
            max_tokens=400,
        )
        score = _clamp01(raw.get("answer_relevance_score")) if isinstance(raw, dict) else 0.0
        return {"score": round(score, 4), "score_100": round(score * 100, 1),
                "passed": score >= self.threshold, "threshold": self.threshold,
                "reason": str(raw.get("reason", ""))[:400] if isinstance(raw, dict) else ""}


# --------------------------------------------------------- Contextual Precision
class ContextualPrecision(_Base):
    """DeepEval-style: per-chunk relevance (ranked) -> weighted MAP@k."""

    _SYS = "You judge whether each retrieved chunk is relevant. Reply ONLY JSON."

    async def measure(self, input: str, expected_output: str, retrieval_context: list[str]) -> dict:
        chunks = [c for c in (retrieval_context or []) if str(c).strip()]
        if not chunks:
            return {"score": None, "passed": None, "verdicts": [], "reason": "No retrieval context."}
        verdicts = await self._verdicts(input, expected_output, chunks)
        node = [1 if v["verdict"] == "yes" else 0 for v in verdicts]
        sum_wp, rel = 0.0, 0
        for k, is_rel in enumerate(node, start=1):
            if is_rel:
                rel += 1
                sum_wp += rel / k          # precision@k
        score = (sum_wp / rel) if rel else 0.0
        return {"score": round(score, 4), "score_100": round(score * 100, 1),
                "passed": score >= self.threshold, "threshold": self.threshold,
                "verdicts": verdicts,
                "reason": f"{rel} of {len(node)} retrieved chunks were relevant; ranking-weighted precision {score:.2f}."}

    async def _verdicts(self, input: str, expected: str, chunks: list[str]) -> list[dict]:
        cblock = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(chunks))
        raw = await self._json(
            self._SYS,
            f'For EACH retrieved chunk (in order), is it relevant to answering the INPUT '
            f'(the expected answer shows what a good answer contains)? verdict "yes"/"no".\n'
            f'Return exactly {len(chunks)} verdicts: {{"verdicts":[{{"verdict":"yes|no","reason":"..."}}]}}.\n\n'
            f'INPUT:\n{input}\n\nEXPECTED ANSWER:\n{expected}\n\nRETRIEVED CHUNKS:\n{cblock}',
        )
        items = raw.get("verdicts") if isinstance(raw, dict) else None
        out = []
        for it in (items if isinstance(items, list) else []):
            if isinstance(it, dict):
                out.append({"verdict": _norm_yn(it.get("verdict")), "reason": str(it.get("reason", ""))[:200]})
        return out


# ------------------------------------------------------------ Contextual Recall
class ContextualRecall(_Base):
    """DeepEval-style: split gold answer into sentences, each attributable to context?"""

    _SYS = "You check whether each sentence of a reference answer is supported by the retrieval context. Reply ONLY JSON."

    async def measure(self, expected_output: str, retrieval_context: list[str]) -> dict:
        chunks = [c for c in (retrieval_context or []) if str(c).strip()]
        sentences = [s.strip() for s in _SENT_SPLIT.split(expected_output or "") if s.strip()]
        if not chunks or not sentences:
            return {"score": None, "passed": None, "verdicts": [], "reason": "Need gold answer + retrieval context."}
        verdicts = await self._verdicts(sentences, chunks)
        n = len(verdicts)
        justified = sum(1 for v in verdicts if v["verdict"] == "yes")
        score = justified / n if n else 0.0
        return {"score": round(score, 4), "score_100": round(score * 100, 1),
                "passed": score >= self.threshold, "threshold": self.threshold,
                "verdicts": verdicts,
                "reason": f"{justified} of {n} reference sentences are supported by the retrieved context."}

    async def _verdicts(self, sentences: list[str], chunks: list[str]) -> list[dict]:
        cblock = "\n".join(f"- {c}" for c in chunks)
        sblock = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(sentences))
        raw = await self._json(
            self._SYS,
            f'For EACH sentence of the reference answer, can it be attributed to / supported by the CONTEXT? '
            f'verdict "yes"/"no".\nReturn exactly {len(sentences)} verdicts: '
            f'{{"verdicts":[{{"verdict":"yes|no","reason":"..."}}]}}.\n\n'
            f'CONTEXT:\n{cblock}\n\nREFERENCE SENTENCES:\n{sblock}',
        )
        items = raw.get("verdicts") if isinstance(raw, dict) else None
        out = []
        for it in (items if isinstance(items, list) else []):
            if isinstance(it, dict):
                out.append({"verdict": _norm_yn(it.get("verdict")), "reason": str(it.get("reason", ""))[:200]})
        return out


# --------------------------------------------------------- Contextual Relevancy
class ContextualRelevancy(_Base):
    """DeepEval-style: break each chunk into statements, each relevant to the input?"""

    _SYS = "You judge whether statements in the retrieved context are relevant to the question. Reply ONLY JSON."

    async def measure(self, input: str, retrieval_context: list[str]) -> dict:
        chunks = [c for c in (retrieval_context or []) if str(c).strip()]
        if not chunks:
            return {"score": None, "passed": None, "verdicts": [], "reason": "No retrieval context."}
        raw = await self._json(
            self._SYS,
            f'For EACH chunk, break it into statements and mark each relevant to the QUESTION ("yes"/"no").\n'
            f'Return {{"chunks":[{{"statements":[{{"statement":"...","verdict":"yes|no"}}]}}]}}.\n\n'
            f'QUESTION:\n{input}\n\nCHUNKS:\n' + "\n".join(f"{i + 1}. {c}" for i, c in enumerate(chunks)),
            max_tokens=2000,
        )
        total, relevant, irrelevant = 0, 0, []
        for ch in (raw.get("chunks") or [] if isinstance(raw, dict) else []):
            for st in (ch.get("statements") or [] if isinstance(ch, dict) else []):
                if not isinstance(st, dict):
                    continue
                total += 1
                if _norm_yn(st.get("verdict")) == "yes":
                    relevant += 1
                else:
                    irrelevant.append(str(st.get("statement", ""))[:120])
        score = relevant / total if total else 0.0
        return {"score": round(score, 4), "score_100": round(score * 100, 1),
                "passed": score >= self.threshold, "threshold": self.threshold,
                "total_statements": total, "relevant_statements": relevant,
                "reason": (f"{relevant} of {total} statements in the context are relevant."
                           + (f" Noise: {'; '.join(irrelevant[:3])}" if irrelevant else ""))}
# also lets say i clicked analyse and changed tab to stt testing then the thing just disappear like aborted and shows me the same page before i selected anything