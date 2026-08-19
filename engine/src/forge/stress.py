"""Stress-sim runner (the MILESTONE tier) — ports prompt_lab/stress_sim.py.

Runs many self-play rollouts of the prompt-under-test across a persona x mood grid
(target ~300-500 sims; authored personas expand via the mood grid toward the floor).
Emits aggregate stress metrics AND surfaces candidate problems INDEPENDENTLY of the coach
(so the coach can't suppress discovery — Fix 4). Each stress signal maps to a global
problem_id; the runner feeds these into the per-run problem status + new-problem discovery.
"""
from __future__ import annotations

import asyncio
import re

from src.config import DEFAULT_MAX_LLM_CONCURRENCY

# Mood modifiers layered onto each persona to widen coverage (~ the "6 moods" grid).
MOODS = {
    "neutral": "",
    "rushed": " You are in a hurry and speak in short clipped sentences.",
    "skeptical": " You are doubtful and push back on claims.",
    "annoyed": " You are mildly irritated at being contacted.",
    "warm": " You are friendly and chatty.",
    "distracted": " You keep half-changing the subject.",
}

FORMATTING = re.compile(r"[—–]|\*|\[|\]|`|#|•")
DIGIT = re.compile(r"\d")
BOT_WORDS = re.compile(r"\b(i understand|got it|certainly|of course|absolutely|as an ai|"
                       r"i'?m happy to|great question)\b", re.I)

# Problems this runner can verdict via at-scale signals (keep in sync with the
# `signals` dict below). The ForgeRunner unions these into its gate denominator so
# stress-only problems still count toward the 95% gate.
SIGNAL_PIDS = {"p9", "p30", "p15", "p39", "p17"}


def build_grid(personas, target=360):
    """persona x mood, repeated toward `target` (capped at target). Returns [(persona, mood_key)]."""
    personas = personas or []
    if not personas:
        return []
    grid = [(p, m) for p in personas for m in MOODS]
    if not grid:
        return []
    out = []
    i = 0
    while len(out) < target:
        out.append(grid[i % len(grid)])
        i += 1
        if i > target * 2:  # safety
            break
    return out[:target]


def _persona_text(persona, mood_key):
    base = persona.get("persona") or persona.get("user_persona") or ""
    return base + MOODS.get(mood_key, "")


async def run_stress(engine, system_prompt, greeting, personas, *,
                     direction="outbound", target=360, concurrency=None, on_progress=None, on_sim=None):
    """Run the grid concurrently; return {metrics, signals, n_sims, transcripts_sample}.
    on_progress(done, total): optional async callback fired as each sim completes."""
    grid = build_grid(personas, target)
    if not grid:
        return {"metrics": {}, "signals": {}, "n_sims": 0, "transcripts_sample": [],
                "note": "no personas provided — stress skipped"}

    sem = asyncio.Semaphore(concurrency or DEFAULT_MAX_LLM_CONCURRENCY)

    async def one(persona, mood_key, idx):
        async with sem:
            scenario = {
                "name": f"{persona.get('id', 'p')}-{mood_key}-{idx}",
                "greeting": greeting or "",
                "call_direction": direction,
                "user_persona": _persona_text(persona, mood_key),
                "max_turns": int(persona.get("max_turns", 10)),
            }
            try:
                res = await engine.run_simulated(system_prompt, scenario)
                return res
            except Exception as e:
                return {"transcript": [], "error": str(e)[:80]}

    done = 0

    async def one_tracked(p, m, i):
        nonlocal done
        res = await one(p, m, i)
        done += 1
        if on_sim:
            try:
                await on_sim(i, f"{p.get('id', 'p')}-{m}", res)
            except Exception:
                pass
        # heartbeat every few sims (not every one — the grid can be 300+)
        if on_progress and (done % 4 == 0 or done == len(grid)):
            try:
                await on_progress(done, len(grid))
            except Exception:
                pass
        return res

    tasks = [one_tracked(p, m, i) for i, (p, m) in enumerate(grid)]
    results = await asyncio.gather(*tasks)

    # ---- aggregate metrics over all agent turns ----
    agent_turns = []
    repeat_loops = 0
    for res in results:
        turns = [t["content"] for t in res.get("transcript", []) if t.get("role") == "agent"]
        agent_turns.extend(turns)
        # duplicate agent turns within a call = a repeat/deadlock loop proxy
        if turns and len(turns) != len(set(turns)):
            repeat_loops += 1

    n_turns = max(1, len(agent_turns))
    def rate(pred):
        return round(sum(1 for t in agent_turns if pred(t)) / n_turns * 100, 1)

    words = [len(t.split()) for t in agent_turns] or [0]
    avg_words = round(sum(words) / len(words), 1)
    over_2_sentences = rate(lambda t: len(re.findall(r"[.!?]", t)) > 2)

    metrics = {
        "n_sims": len(grid),
        "n_agent_turns": len(agent_turns),
        "avg_agent_words": avg_words,
        "pct_formatting": rate(lambda t: bool(FORMATTING.search(t))),
        "pct_digits": rate(lambda t: bool(DIGIT.search(t))),
        "pct_bot_words": rate(lambda t: bool(BOT_WORDS.search(t))),
        "pct_over_2_sentences": over_2_sentences,
        "pct_repeat_loops": round(repeat_loops / max(1, len(results)) * 100, 1),
    }

    # ---- map stress metrics to problem SIGNALS (present/clean), independent of the coach ----
    # A signal 'N' means the problem is present at scale; 'Y' means clean. Thresholds are
    # deliberately lenient (stress is about scale, not a single probe).
    signals = {
        "p9": "N" if metrics["pct_bot_words"] > 5 else "Y",       # robotic bot-words
        "p30": "N" if metrics["pct_formatting"] > 3 else "Y",      # formatting chars
        "p15": "N" if metrics["pct_digits"] > 3 else "Y",         # digits spoken
        "p39": "N" if (avg_words > 45 or over_2_sentences > 40) else "Y",  # over-long/yapping
        "p17": "N" if metrics["pct_repeat_loops"] > 8 else "Y",   # deadlock/repeat loop
    }

    sample = []
    for res in results[:5]:
        sample.append([f"{t['role']}: {t['content']}" for t in res.get("transcript", [])])

    return {"metrics": metrics, "signals": signals, "n_sims": len(grid), "transcripts_sample": sample}
