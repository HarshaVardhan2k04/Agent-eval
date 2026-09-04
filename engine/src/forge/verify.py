"""Adversarial fix-verification (the Goodhart guard, Fix 14).

Before believing a fix, prove it wasn't just masked/rephrased under the detector:
  1. STRICT re-run of the problem's own detector (independent samples).
  2. K SKEPTIC passes on HELD-OUT phrasings — the situation is paraphrased so the fix is
     tested on words it was never written against, then a distinctly-prompted judge at a
     HIGHER temperature actively tries to REFUTE it (defaults to "refuted" when unsure).
A fix HOLDS only if the strict detector says Y AND a majority of skeptics fail to refute.

Why the held-out step exists: every other gate drives the SAME scripted lead lines, so a
rule written around those words ("if the caller says 'not interested' ...") turns the row
green while the behaviour is unchanged for any other phrasing. Paraphrasing is the cheap
generalisation test; coach.probe_leak is the deterministic one that runs before the edit
is ever applied.

Caveat kept honest: Gemma plays agent, lead, judge AND skeptic — same-model self-critique
shares blind spots, so this reduces but does not eliminate Goodharting. A second model can be
supplied via `second_model_llm` for the passes near the gate.
"""
from __future__ import annotations

from src.forge import detectors

_SKEPTIC_SYS = (
    "You are a HARSH skeptical QA auditor. You are told a specific problem was just FIXED in a "
    "voice agent. Your job is to REFUTE that claim USING THIS TRANSCRIPT: point at a turn where "
    "the problem still occurs, or where it is merely masked/rephrased rather than genuinely "
    "fixed.\n"
    "REFUTE ONLY ON EVIDENCE YOU CAN QUOTE. You may NOT refute because the sample is small, "
    "because one conversation does not prove a general fix, because you would like to see more "
    "cases, or because you are uncertain — those are not observations about this transcript and "
    "the sampling is handled elsewhere. If this transcript shows the agent behaving correctly, "
    'answer refuted=false.\n'
    'Reply JSON: {"refuted": true|false, "reason": "<=15 words, quote the offending turn"}.'
)


async def verify_fix(engine, system_prompt, problem, *, greeting="", k=3, strict_votes=3,
                     second_model_llm=None):
    """Return {holds, strict_verdict, refutations, k, detail}."""
    pid = problem.get("id")
    # 1) strict independent detector re-run
    strict = await detectors.run_detector(engine, system_prompt, pid, greeting=greeting, votes=strict_votes)
    strict_verdict = strict.get("verdict")

    # 2) skeptic passes on fresh adversarial rollouts
    #    Reuse the detector's own scripted drive to produce a transcript, then have the skeptic judge it.
    refutations = 0
    reasons = []
    rubric = _rubric_for(pid)
    for i in range(k):
        # HELD-OUT phrasing. Screening and deep-confirm both replay the scripted variants
        # (10 of 31 problems have exactly one), so re-running them here would re-test what
        # the fix was written against. A paraphrase keeps the SITUATION and changes the
        # WORDS, which is what separates "solved the behaviour" from "matched the script".
        held = await detectors.heldout_scenario(engine.llm, pid, seed=1000 + i)
        if held is None:     # no scripted scenario for this pid — generic adversarial probe
            lines, tools_on = _GENERIC_LINES, False
        else:
            lines, tools_on = held
        sim = getattr(engine, "tool_simulator", None)
        if sim is not None and tools_on:
            sim.reset_conversation()      # fresh per-call tool state, like production
        convo, _ended, _meta = await detectors._drive(
            engine.llm, system_prompt, greeting, lines, tools_on=tools_on, tool_sim=sim)
        transcript = "\n".join(
            (f"Agent: {c}" if r == "A" else (f"User: {c}" if r == "L" else f"Agent(ended): {c}"))
            for r, c in convo
        )
        judge_llm = second_model_llm or engine.llm
        prompt = (f"CLAIMED-FIXED PROBLEM: {problem.get('behaviour', pid)}\n"
                  f"WHAT GOOD LOOKS LIKE: {rubric}\n\nTRANSCRIPT:\n{transcript}")
        try:
            data = await judge_llm.chat_json(
                [{"role": "system", "content": _SKEPTIC_SYS}, {"role": "user", "content": prompt}],
                temperature=0.7, max_tokens=300, enable_thinking=False,
            )
            if bool(data.get("refuted")):
                refutations += 1
                reasons.append(str(data.get("reason", ""))[:60])
        except Exception:
            refutations += 1  # default-to-refuted on failure (conservative)
            reasons.append("skeptic_error")

    holds = (strict_verdict == "Y") and (refutations <= k // 2)
    return {
        "holds": holds,
        "strict_verdict": strict_verdict,
        "strict_detail": strict.get("evidence"),
        "refutations": refutations,
        "k": k,
        "reasons": reasons,
    }


_GENERIC_LINES = ["hmm", "ok", "tell me more", "what's the price", "and the timeline"]
_GENERIC_RUBRIC = ("The agent handles the exchange cleanly with no repetition, formatting chars, "
                   "digits, language drift, or robotic filler.")


def _rubric_for(pid):
    """What 'good' looks like, for the skeptic's prompt. Which lines to drive and whether
    tools are attached is drive_scenario's business, not this module's."""
    if pid in detectors.LLM_JUDGE_DETECTORS:
        return detectors.LLM_JUDGE_DETECTORS[pid][1]
    return _GENERIC_RUBRIC
