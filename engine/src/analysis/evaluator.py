"""CallEvaluator — score one call with the Gemma judge (thinking ON)."""
from __future__ import annotations

import asyncio

from src.config import DEFAULT_JUDGE_MAX_TOKENS, DEFAULT_JUDGE_TEMPERATURE
from src.llm.client import LLMClient
from src.metrics.rag import Faithfulness, AnswerRelevancy, SelfConsistency
from src.analysis.prompts import CALL_ANALYSIS_SYSTEM, CALL_ANALYSIS_USER
from src.analysis import parsing

SECTION_KEYS = [
    "greeting_intro", "empathy", "information_push_goal",
    "conversation_management_flow", "call_closing", "tool_calling",
]
# Judged by the LLM in the main pass.
METRIC_KEYS = [
    "customer_retention_frustration", "repetition",
    "instruction_flow_following", "tool_calling", "human_likeness",
]
# Computed separately (not judged) by dedicated metric calls.
COMPUTED_METRIC_KEYS = ["faithfulness", "answer_relevancy", "self_consistency"]
MIN_USER_WORDS = 5
JUDGE_SEED = 13  # fixed first-attempt seed -> reproducible section/metric scores


def _clamp(v) -> int:
    try:
        return max(0, min(100, int(round(float(v)))))
    except (TypeError, ValueError):
        return 0


def _guidelines_block(items: list[str]) -> str:
    if not items:
        return "(none provided)"
    return "\n".join(f"- {str(g)[:400]}" for g in items[:12])


def _flow_block(stages: list[dict]) -> str:
    if not stages:
        return "(no explicit flow provided — judge conversation management generally)"
    return "\n".join(f"{i+1}. {s['stage']} — {str(s['guidance'])[:300]}" for i, s in enumerate(stages))


def _tools_block(available: list[str], fired: list[str]) -> str:
    av = ", ".join(available) if available else "(unknown)"
    fr = ", ".join(fired) if fired else "(none fired / not logged)"
    return f"Available: {av}\nActually fired: {fr}"


class CallEvaluator:
    def __init__(self, client: LLMClient | None = None):
        self.client = client or LLMClient()
        self.faithfulness = Faithfulness(client=self.client)
        self.answer_relevancy = AnswerRelevancy(client=self.client)
        self.self_consistency = SelfConsistency(client=self.client)

    async def evaluate(self, call: dict) -> dict:
        direction = call.get("call_direction") or call.get("direction") or "outbound"
        config = parsing.coerce_config(call.get("editable_config"))
        turns = parsing.parse_turns(call.get("transcript") or "")

        # Empty-call gate — don't score a call the customer barely spoke on.
        uw = parsing.user_word_count(turns)
        if uw < MIN_USER_WORDS:
            return self._gated(f"user_silent ({uw} words)")

        stages = parsing.flow_stages(config, direction)
        fired = [t.get("name") for t in (call.get("tool_events") or []) if t.get("name")]
        prompt = CALL_ANALYSIS_USER.format(
            direction=direction,
            guidelines_block=_guidelines_block(parsing.behavioral_guidelines(config)),
            flow_block=_flow_block(stages),
            tools_block=_tools_block(call.get("available_tools") or [], fired),
            transcript=parsing.transcript_as_lines(turns),
        )

        messages = [
            {"role": "system", "content": CALL_ANALYSIS_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        # Thinking-on judge: json_object mode conflicts with the thinking preamble and
        # intermittently yields malformed JSON, so parse the JSON out ourselves and
        # retry a couple of times before giving up on the whole call.
        raw, last_err = None, None
        for attempt in range(3):
            try:
                raw = await self.client.chat_json(
                    messages,
                    # Greedy (temp 0) + fixed seed -> reproducible scores. Sampling
                    # (temp>0) isn't deterministic under vLLM continuous batching even
                    # with a seed, so the judge decodes greedily like the metrics do.
                    temperature=0.0,
                    max_tokens=DEFAULT_JUDGE_MAX_TOKENS,
                    enable_thinking=True,
                    json_mode=False,
                    seed=JUDGE_SEED + attempt,  # attempt 0 reproducible; retries vary
                )
                break
            except Exception as e:
                last_err = e
        if raw is None:
            return self._gated(f"judge_parse_error: {str(last_err)[:120]}")

        result = self._normalize(raw, stages)
        # Computed metrics — independent, so run them concurrently (same call count,
        # lower wall-clock). Each writes its own metric key; no shared state race.
        await asyncio.gather(
            self._add_faithfulness(result, config, turns),
            self._add_answer_relevancy(result, turns),
            self._add_self_consistency(result, turns),
        )
        return result

    async def _add_answer_relevancy(self, result: dict, turns: list[dict]) -> None:
        """Did the agent's replies address what the customer actually asked? No KB needed."""
        result["metrics"]["answer_relevancy"] = None
        user_text = " ".join(t["text"] for t in turns if t["role"] == "User").strip()[:6000]
        agent_text = " ".join(t["text"] for t in turns if t["role"] == "Agent").strip()[:6000]
        if not user_text or not agent_text:
            return
        try:
            res = await self.answer_relevancy.measure(user_text, agent_text)
            result["metrics"]["answer_relevancy"] = res.get("score_100")
        except Exception:
            return

    async def _add_self_consistency(self, result: dict, turns: list[dict]) -> None:
        """Did the agent contradict itself within the call? No KB needed."""
        result["metrics"]["self_consistency"] = None
        agent_text = " ".join(t["text"] for t in turns if t["role"] == "Agent").strip()[:8000]
        if not agent_text:
            return
        try:
            res = await self.self_consistency.measure(agent_text)
        except Exception:
            return
        result["metrics"]["self_consistency"] = res.get("score_100")
        contradictions = res.get("contradictions") or []
        if contradictions:
            result["metrics"]["self_consistency_detail"] = {"contradictions": contradictions}
            for c in contradictions:
                result["areas_of_improvement"].append(
                    f"Self-contradiction — “{c['claim_a']}” vs “{c['claim_b']}”. {c.get('reason', '')}"[:400])
            result["areas_of_improvement"] = result["areas_of_improvement"][:8]

    async def _add_faithfulness(self, result: dict, config: dict, turns: list[dict]) -> None:
        """Set metrics.faithfulness (0-100, higher = fewer hallucinations), stash the
        per-claim trail, and surface each contradicted/partial claim into areas."""
        result["metrics"]["faithfulness"] = None
        # KB is read once as reference context (not iterated), so a generous cap — a
        # small cap would blind the check to facts beyond it.
        kb = parsing.knowledge_base_facts(config, limit=80)
        agent_text = " ".join(t["text"] for t in turns if t["role"] == "Agent").strip()[:8000]
        if not kb or not agent_text:
            return
        try:
            res = await self.faithfulness.measure(agent_text, kb, include_reason=True)
        except Exception:
            return
        result["metrics"]["faithfulness"] = res.get("score_100")
        # Full trail (claims + verdicts) so the UI can show exactly what went wrong.
        result["metrics"]["faithfulness_detail"] = {
            "claims_checked": len(res.get("verdicts") or []),
            "contradicted": res.get("contradicted") or [],
            "partial": res.get("partial") or [],
            "not_in_kb": res.get("not_in_kb") or [],
            "summary": res.get("reason"),
        }
        # Push the concrete hallucinations into areas of improvement.
        for v in (res.get("contradicted") or []):
            result["areas_of_improvement"].insert(
                0, f"Hallucination — agent claimed “{v['claim']}”. {v['reason']}"[:400]
            )
        for v in (res.get("partial") or []):
            result["areas_of_improvement"].append(
                f"Partly inaccurate — “{v['claim']}”. {v['reason']}"[:400]
            )
        result["areas_of_improvement"] = result["areas_of_improvement"][:8]

    def _normalize(self, raw: dict, stages: list[dict]) -> dict:
        # The judge is an LLM — treat every field as untrusted and coerce defensively.
        raw = raw if isinstance(raw, dict) else {}
        raw_sections = raw.get("sections") if isinstance(raw.get("sections"), dict) else {}
        raw_metrics = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}

        sections = {}
        for k in SECTION_KEYS:
            s = raw_sections.get(k)
            s = s if isinstance(s, dict) else {}
            ev = s.get("evidence")
            ev = ev if isinstance(ev, list) else []
            sections[k] = {
                "score": _clamp(s.get("score")),
                "verdict": str(s.get("verdict", ""))[:300],
                "evidence": [str(e)[:300] for e in ev][:3],
            }
        metrics = {k: _clamp(raw_metrics.get(k)) for k in METRIC_KEYS}

        flow = []
        raw_flow = raw.get("flow_adherence")
        for f in (raw_flow if isinstance(raw_flow, list) else []):
            if not isinstance(f, dict):
                continue
            status = f.get("status")
            if status not in ("hit", "partial", "missed"):
                status = "partial"
            flow.append({"stage": str(f.get("stage", ""))[:120], "status": status, "note": str(f.get("note", ""))[:200]})

        raw_areas = raw.get("areas_of_improvement")
        areas = [str(a)[:400] for a in (raw_areas if isinstance(raw_areas, list) else []) if str(a).strip()][:6]
        composite = round(sum(sections[k]["score"] for k in SECTION_KEYS) / len(SECTION_KEYS), 1)

        return {
            "sections": sections,
            "metrics": metrics,
            "flow_adherence": flow,
            "areas_of_improvement": areas,
            "composite_score": composite,
            "gated_reason": None,
        }

    def _gated(self, reason: str) -> dict:
        return {
            "sections": {k: {"score": None, "verdict": "", "evidence": []} for k in SECTION_KEYS},
            "metrics": {k: None for k in METRIC_KEYS + COMPUTED_METRIC_KEYS},
            "flow_adherence": [],
            "areas_of_improvement": [],
            "composite_score": None,
            "gated_reason": reason,
        }
