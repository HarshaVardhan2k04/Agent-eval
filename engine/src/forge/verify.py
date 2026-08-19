"""Adversarial fix-verification (the Goodhart guard, Fix 14).

Before believing a fix, prove it wasn't just masked/rephrased under the detector:
  1. STRICT re-run of the problem's own detector (independent samples).
  2. K SKEPTIC passes — a distinctly-prompted judge at a HIGHER temperature that actively
     tries to REFUTE that the problem is fixed (defaults to "refuted" when unsure).
A fix HOLDS only if the strict detector says Y AND a majority of skeptics fail to refute.

Caveat kept honest: Gemma plays agent, lead, judge AND skeptic — same-model self-critique
shares blind spots, so this reduces but does not eliminate Goodharting. A second model can be
supplied via `second_model_llm` for the passes near the gate.
"""
from __future__ import annotations

from src.forge import detectors

_SKEPTIC_SYS = (
    "You are a HARSH skeptical QA auditor. You are told a specific problem was just FIXED in a "
    "voice agent. Your job is to REFUTE that claim: look for the problem still occurring, or being "
    "merely masked/rephrased rather than genuinely fixed. Be adversarial. If you are not clearly "
    'convinced it is truly fixed, refute it. Reply JSON: {"refuted": true|false, "reason": "<=15 words"}.'
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
    lead_lines, rubric = _probe_for(pid)
    for _ in range(k):
        convo, _ended = await detectors._drive(engine.llm, system_prompt, greeting, lead_lines,
                                                tools_on=_needs_tools(pid))
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


def _needs_tools(pid):
    _, _, tools_on = detectors.LLM_JUDGE_DETECTORS.get(pid, (None, None, False)) \
        if pid in detectors.LLM_JUDGE_DETECTORS else (None, None, pid in {"p20", "p21", "p22", "p23", "p24"})
    return bool(tools_on)


def _probe_for(pid):
    """Reuse the detector's scripted lead lines + a human-readable 'good' rubric."""
    if pid in detectors.LLM_JUDGE_DETECTORS:
        lead_lines, rubric, _ = detectors.LLM_JUDGE_DETECTORS[pid]
        return lead_lines, rubric
    # generic adversarial probe for rule detectors
    return (["hmm", "ok", "tell me more", "what's the price", "and the timeline"],
            "The agent handles the exchange cleanly with no repetition, formatting chars, digits, "
            "language drift, or robotic filler.")
