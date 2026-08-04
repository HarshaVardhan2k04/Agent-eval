"""Hallucination metric — native port of DeepEval's technique onto our Gemma judge.

Technique (context-contradiction, not open-world fact-check):
  1. For EACH context string, ask the judge whether the output AGREES with it
     -> per-context {verdict: yes|no, reason}. Face-value, forgive omissions,
     only 'no' on a real contradiction.
  2. score = count('no') / total_contexts   (LOWER is better; 0 = no hallucination)
  3. pass = score <= threshold (default 0.5)
  4. optional one-line reason summarizing alignments vs contradictions.

No DeepEval dependency — just the algorithm, run on src.llm.client.LLMClient with
thinking OFF (reliable JSON) and defensive parsing.
"""
from __future__ import annotations

from src.config import DEFAULT_JUDGE_TEMPERATURE
from src.llm.client import LLMClient

_VERDICTS_SYSTEM = (
    "You are a strict factual-consistency checker. Reply with ONLY a JSON object. "
    "Do not use any prior knowledge — take each context at face value."
)

# Filled with contexts_count, contexts_block, actual_output
_VERDICTS_USER = """For EACH context below, decide whether the ACTUAL OUTPUT agrees with that context.
Return one verdict per context. 'verdict' is STRICTLY "yes" or "no". 'reason' explains it; on "no",
give the correction.

Rules:
- Take each context at face value; do NOT use outside knowledge.
- Answer "no" ONLY if the output CONTRADICTS the context. FORGIVE missing detail (omission is not a contradiction).
- Return EXACTLY {contexts_count} verdicts, in order.

Example contexts: ["Einstein won the Nobel Prize for the photoelectric effect.", "Einstein won the Nobel Prize in 1968."]
Example output: "Einstein won the Nobel Prize in 1969 for the photoelectric effect."
Example JSON:
{{"verdicts":[{{"verdict":"yes","reason":"Agrees — the prize was for the photoelectric effect."}},
{{"verdict":"no","reason":"Contradiction: context says 1968, output says 1969."}}]}}

Contexts:
{contexts_block}

Actual output:
{actual_output}

JSON:"""

_REASON_USER = """The hallucination score is {score} (0-1, lower is better).
Alignments: {alignments}
Contradictions: {contradictions}
Give a concise one-sentence reason. Return ONLY JSON: {{"reason":"The score is {score} because ..."}}"""


def _norm_verdict(v) -> str:
    return "no" if str(v).strip().lower().startswith("n") else "yes"


class HallucinationMetric:
    def __init__(self, client: LLMClient | None = None, threshold: float = 0.5):
        self.client = client or LLMClient()
        self.threshold = threshold

    async def measure(self, actual_output: str, contexts: list[str], include_reason: bool = True) -> dict:
        contexts = [c for c in (contexts or []) if str(c).strip()]
        if not contexts:
            return {"score": None, "passed": None, "threshold": self.threshold,
                    "verdicts": [], "reason": "No context provided to check against."}

        verdicts = await self._verdicts(actual_output or "", contexts)
        n = len(verdicts)
        halluc = sum(1 for v in verdicts if v["verdict"] == "no")
        score = round(halluc / n, 4) if n else 0.0
        reason = None
        if include_reason:
            reason = await self._reason(verdicts, score)

        return {
            "score": score,               # fraction of contexts contradicted (lower = better)
            "passed": score <= self.threshold,
            "threshold": self.threshold,
            "contradicted": halluc,
            "total_contexts": n,
            "verdicts": verdicts,
            "reason": reason,
        }

    async def _chat_json_retry(self, messages: list[dict], max_tokens: int, tries: int = 2):
        """chat_json with one retry + a stricter JSON nudge — small local judges
        (Gemma via vLLM) occasionally emit unparseable JSON; a retry fixes most."""
        last_err = None
        for attempt in range(tries):
            msgs = messages
            if attempt > 0:  # nudge harder on the retry
                msgs = messages[:-1] + [{
                    "role": "user",
                    "content": messages[-1]["content"] + "\n\nReturn ONLY the raw JSON object — no prose, no code fences.",
                }]
            try:
                return await self.client.chat_json(
                    msgs, temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=max_tokens, enable_thinking=False
                )
            except Exception as e:
                last_err = e
        raise last_err

    async def _verdicts(self, actual_output: str, contexts: list[str]) -> list[dict]:
        block = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(contexts))
        prompt = _VERDICTS_USER.format(
            contexts_count=len(contexts), contexts_block=block, actual_output=actual_output
        )
        raw = await self._chat_json_retry(
            [{"role": "system", "content": _VERDICTS_SYSTEM}, {"role": "user", "content": prompt}],
            max_tokens=1500,
        )
        items = raw.get("verdicts") if isinstance(raw, dict) else None
        items = items if isinstance(items, list) else []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            out.append({"verdict": _norm_verdict(it.get("verdict")), "reason": str(it.get("reason", ""))[:300]})
        # If the judge returned the wrong count, keep what parsed (score computed over it).
        return out

    async def _reason(self, verdicts: list[dict], score: float) -> str:
        alignments = [v["reason"] for v in verdicts if v["verdict"] == "yes"]
        contradictions = [v["reason"] for v in verdicts if v["verdict"] == "no"]
        prompt = _REASON_USER.format(
            score=f"{score:.2f}", alignments=alignments or "(none)", contradictions=contradictions or "(none)"
        )
        try:
            raw = await self._chat_json_retry([{"role": "user", "content": prompt}], max_tokens=400)
            return str(raw.get("reason", ""))[:400] if isinstance(raw, dict) else ""
        except Exception:
            return f"Score {score:.2f}: {len(contradictions)} of {len(verdicts)} contexts contradicted."
