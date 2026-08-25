"""Best-of-N scorer for Forge.

For one probe: simulate N conversation rollouts of the prompt-under-test (reusing the
existing ConversationEngine self-play), grade each transcript with the reused
analysis.CallEvaluator (deepeval metrics + 6 section scores), and aggregate by MEDIAN of
per-run composites (per the acceptance ruling). The simulation is the dominant noise
source; medianing N rollouts gives a stable central estimate — "reproducible within
tolerance" (vLLM continuous batching is not byte-deterministic even with fixed seeds).

This is the DEEPEVAL TIER of the tiered-evaluation scheme (run on accepted/final versions,
plus v0 baseline). Cheap per-candidate screening uses forge/detectors.py instead.
"""
from __future__ import annotations

import statistics

from src.analysis.evaluator import SECTION_KEYS, METRIC_KEYS, COMPUTED_METRIC_KEYS


def transcript_to_lines(transcript) -> str:
    """[{role:'agent'|'user', content}] -> the label-prefixed string parsing.py expects."""
    out = []
    for t in transcript or []:
        role = "Agent" if t.get("role") == "agent" else "User"
        text = (t.get("content") or "").strip()
        if text:
            out.append(f"{role}: {text}")
    return "\n".join(out)


def _probe_type(probe: dict) -> str:
    if probe.get("type"):
        return probe["type"]
    if "question" in probe:
        return "single_turn"
    if "turns" in probe:
        return "multi_turn"
    return "simulated"


def _scenario_from_probe(probe: dict, prompt_bundle: dict, direction: str) -> dict:
    """Build a ConversationEngine scenario from a Forge probe."""
    sc = {
        "name": str(probe.get("id") or probe.get("name") or "probe"),
        "greeting": prompt_bundle.get("greeting") or "",
        "call_direction": direction,
        "user_persona": probe.get("persona") or probe.get("user_persona") or "",
        "max_turns": int(probe.get("max_turns", 12)),
        "expected_outcome": probe.get("expected_outcome"),
        "pass_criteria": probe.get("pass_criteria"),
        "fail_criteria": probe.get("fail_criteria"),
    }
    if "question" in probe:
        sc["question"] = probe["question"]
    if "turns" in probe:
        sc["turns"] = probe["turns"]
    return sc


# Tool names the agent must CALL, never say. Matched as whole words on the spoken text.
def _spoken_tool_leaks(transcript, available_tools):
    import re as _re
    names = [t for t in (available_tools or []) if t] or [
        "end_call", "voicemail_detected", "handle_call_screening", "date_calculator",
        "warm_transfer_call", "search_knowledge_base", "send_whatsapp_template",
        "switch_agent", "web_search", "get_location_details", "irrelevant_interruption",
    ]
    text = " ".join((t.get("content") or "") for t in (transcript or [])
                    if t.get("role") in ("agent", "agent_end"))
    return [n for n in names if _re.search(rf"\b{_re.escape(n)}\b", text)]


def _median(vals):
    vals = [v for v in vals if v is not None]
    return round(statistics.median(vals), 2) if vals else None


async def score_probe(
    engine, evaluator, prompt_bundle: dict, probe: dict, *,
    direction: str = "outbound", n: int = 3, available_tools=None,
) -> dict:
    """Simulate n rollouts of prompt_bundle against probe, grade each, return medians.

    prompt_bundle: { system_prompt, config, greeting? }
      - system_prompt: what drives the sim agent (markdown for layered, blob for standalone)
      - config:        merged STRUCTURED object (layered) or the editable_config (standalone),
                       fed to CallEvaluator so parsing.py can read flow/KB/guidelines.
      - greeting:      spoken by the system before turn 1 (layered).
    """
    system_prompt = prompt_bundle["system_prompt"]
    config = prompt_bundle.get("config") or {}
    greeting = prompt_bundle.get("greeting") or ""

    ptype = _probe_type(probe)
    scenario = _scenario_from_probe(probe, {"greeting": greeting}, direction)

    samples = []
    for _k in range(max(1, n)):
        # simulate one rollout
        if ptype == "single_turn":
            sim = await engine.run_single_turn(system_prompt, scenario)
        elif ptype == "multi_turn":
            sim = await engine.run_multi_turn(system_prompt, scenario)
        else:
            sim = await engine.run_simulated(system_prompt, scenario)

        transcript = sim.get("transcript", [])
        fired = [tc.get("name") for tc in sim.get("tool_calls", []) if tc.get("name")]
        call = {
            "editable_config": config,
            "transcript": transcript_to_lines(transcript),
            "call_direction": direction,
            "available_tools": available_tools or [],
            "tool_events": [{"name": t.get("name"), "args": t.get("args"), "result": t.get("result")}
                            for t in (sim.get("tool_calls") or []) if t.get("name")],
        }
        try:
            result = await evaluator.evaluate(call)
        except Exception as e:  # a single bad rollout must not kill the probe
            result = {"gated_reason": f"score_error: {str(e)[:120]}", "composite_score": None,
                      "sections": {}, "metrics": {}, "areas_of_improvement": []}
        # tool_calling is CODE-COMPUTED, never judged: valid calls / attempts, where an
        # attempt is a real tool_call OR a tool name SPOKEN as text (the classic
        # "...Have a good day. end_call" leak — the model thinks it hung up, the line
        # stays open). A judged score here used to report 100 while the agent was
        # literally typing the tool name instead of calling it.
        leaks = _spoken_tool_leaks(transcript, available_tools or [])
        if isinstance(result.get("metrics"), dict):
            attempts = len(fired) + len(leaks)
            if attempts == 0:
                result["metrics"]["tool_calling"] = None  # nothing attempted -> not judgeable
            else:
                result["metrics"]["tool_calling"] = round(100.0 * len(fired) / attempts, 1)
        if leaks:
            result.setdefault("areas_of_improvement", []).append(
                f"spoke the tool name instead of calling it: {', '.join(sorted(set(leaks)))}")
        samples.append({"transcript": transcript, "result": result,
                        "tool_calls": sim.get("tool_calls") or [], "leaks": leaks})

    scored = [s for s in samples if s["result"].get("composite_score") is not None]
    composites = [s["result"]["composite_score"] for s in scored]
    median_composite = _median(composites)

    # per-section medians
    section_scores = {}
    for k in SECTION_KEYS:
        vals = [s["result"].get("sections", {}).get(k, {}).get("score") for s in scored]
        section_scores[k] = _median(vals)

    # metric medians (LLM-judged + computed)
    metrics = {}
    for k in METRIC_KEYS + COMPUTED_METRIC_KEYS:
        vals = [s["result"].get("metrics", {}).get(k) for s in scored]
        metrics[k] = _median(vals)

    # representative sample = the one nearest the median composite (for storage/UI)
    rep = None
    if scored and median_composite is not None:
        rep = min(scored, key=lambda s: abs(s["result"]["composite_score"] - median_composite))
    elif samples:
        rep = samples[0]

    return {
        "composite": median_composite,
        "section_scores": section_scores,
        "metrics": metrics,
        "n_scored": len(scored),
        "n_total": len(samples),
        "per_run_composites": composites,
        "gated_reason": None if scored else (samples[0]["result"].get("gated_reason") if samples else "no_samples"),
        "areas_of_improvement": (rep["result"].get("areas_of_improvement") if rep else []),
        "representative_transcript": (rep["transcript"] if rep else []),
        "all_transcripts": [s["transcript"] for s in samples],
        "all_tool_calls": [s["tool_calls"] for s in samples],
        "spoken_tool_leaks": sorted({n for s in samples for n in s["leaks"]}),
    }
