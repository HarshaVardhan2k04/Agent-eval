# Changelog — regression-gated coaching loop + agent tool/KB hardening

_Date: 2026-06-22_

This documents the work done in this session. Two things landed: (1) the agent (Aanya) system prompt
was hardened for tool-calling and out-of-KB handling, and (2) the eval loop was rebuilt from
"accept every rewrite" into a **regression-gated champion/challenger loop** with rollback and an
anti-stall mechanism.

See also: `PROJECT_OVERVIEW.md` (whole-system map) and `COACH_LOOP.md` (the loop design + anti-stall
roadmap).

---

## 1. Agent prompt hardening — `test_data/aanya_system_prompt.json`

The prompt had ~55 behavioral rules but **zero tool-calling guidance** and only a weak out-of-KB
path. Two rules were added to `agent_details.behavioral_guidelines` (now 54 entries), in Aanya's own
terse voice:

- **`TOOL USE, NEVER SPOKEN`** — a per-tool trigger policy for all 9 tools (`search_knowledge_base`,
  `date_calculator`, `send_whatsapp_template`, `end_call`, `voicemail_detected`,
  `handle_call_screening`, `warm_transfer_call`, `switch_agent`, `irrelevant_interruption`). Key
  principle baked in: **"default to calling nothing, an unneeded tool call is itself a failure"** —
  which directly protects the `tool_correctness` score (it penalizes 0.5 for unnecessary calls).
- **`OUT OF KNOWLEDGE, SEARCH THEN DEFER`** — when a fact isn't in front of her, call
  `search_knowledge_base` first and answer only from what returns; if nothing useful comes back,
  defer with the "I don't know" line instead of inventing.

JSON validated. ⚠️ Open item: confirm your JSON→string flattening actually serializes
`behavioral_guidelines`, or these (and the existing rules) won't reach the agent.

---

## 2. The eval loop — from blind-accept to regression-gated champion/challenger

### The defect fixed
The old loop did `current_prompt = improved_prompt` **unconditionally** every iteration, so a worse
rewrite became the new baseline and the coach drifted from there (the 0.9611 → 0.9111 problem). The
coach also never learned whether its last change helped or hurt.

### New behavior
- **Champion = best prompt so far**, only ever moves forward; the eval always returns the champion.
- Each attempt the coach proposes a **challenger**, which is re-run over the full suite and diffed
  per-scenario vs the champion (**fixed** vs **regressed**).
- **Regression-strict gate:** promote only if the mean rises AND no previously-passing case
  regresses; otherwise **revert**.
- **Must-pass guardrails:** breaking a passing critical case (section `guardrails` / critical tags /
  `"critical": true`) forces a revert regardless of the mean.
- **Noise margin** so scoring jitter doesn't cause false reverts.
- **Anti-stall:** surgical mode after a revert (L1) + early `converged` stop after repeated reverts
  (L2). The champion-forward design means a stall can never make the prompt worse.

---

## 3. Files changed

| File | Change |
|------|--------|
| `test_data/aanya_system_prompt.json` | Added `TOOL USE` + `OUT OF KNOWLEDGE` rules to `behavioral_guidelines`. |
| `engine/src/api/schemas.py` | `EvalConfig`: added `scenario_pass_threshold` (0.7), `regression_margin` (0.05), `plateau_patience` (3), `critical_sections`, `critical_tags`. |
| `engine/src/llm/prompts.py` | Rewrote `RESOLVER_PROMPT_TEMPLATE` (regression-aware, asks for diagnosis + fix strategy); added `RESOLVER_FOCUSED_MODE` / `RESOLVER_SURGICAL_MODE`. |
| `engine/src/core/resolver.py` | New `improve(...)` signature `→ (prompt, changes, diagnosis, fix_strategy)`; takes `revert_context` + `surgical`; added `record_accepted()` and `_build_revert_feedback()`. |
| `engine/src/core/eval_runner.py` | Rebuilt `run()` as the champion/challenger loop; added `_is_critical`, `_diff_results`, `_run_and_judge`, `_scenario_name`; baseline eval; accept/revert gate; new events. |
| `COACH_LOOP.md` | New — loop design, STLC mapping, anti-stall escalation ladder (L0–L6). |
| `docs/CHANGELOG.md` | This file. |

Reference docs also present from earlier this session: `PROJECT_OVERVIEW.md`.

---

## 4. New config knobs (`EvalConfig`)

| Key | Default | Meaning |
|-----|---------|---------|
| `scenario_pass_threshold` | `0.7` | composite ≥ this = a scenario "passes" |
| `regression_margin` | `0.05` | min drop (below pass line) to count as a real regression |
| `plateau_patience` | `3` | consecutive reverts before stopping early (`converged`) |
| `critical_sections` | `["guardrails"]` | sections treated as must-pass |
| `critical_tags` | sensitive_data, claims, quote, tax, pricing, … | tags treated as must-pass |

A scenario can also be flagged directly with `"critical": true`.

---

## 5. New events emitted

- **`prompt_improved`** — challenger accepted (now carries `fixed` cases + `score`).
- **`prompt_reverted`** — challenger rejected; carries `reason`
  (`regression` / `critical_regression` / `no_improvement`), the `regressed` cases, and the coach's
  `diagnosis`.
- **`converged`** — loop stalled (`plateau_patience` reverts); carries the `stubborn_cases` list and
  a human-readable reason. Returns the best prompt found.

Existing events unchanged: `iteration_start`, `scenario_complete`, `iteration_complete`
(now also carries `champion_score` / `challenger_score` / `accepted`), `threshold_met`,
`eval_complete` (now also carries `best_prompt` + `attempt_history`).

> Backend compatibility: `progress.ts` only acts on `iteration_complete` / `prompt_improved` /
> `eval_complete` and stores extra fields harmlessly; new event types are logged + broadcast. No
> backend change was required, though the UI doesn't yet *render* reverts/converged.

---

## 6. Verification done
- `python3 -m py_compile` passes for all four changed engine modules.
- `aanya_system_prompt.json` parses as valid JSON; the two new rules confirmed present.
- Gate logic spot-checked: `accept = mean_improved and not regressed and not critical_regressions`.

Not yet run end-to-end against a live LLM endpoint (no eval executed).

---

## 7. Next steps (planned, not built)
From `COACH_LOOP.md`, in recommended order:
1. **L3 best-of-N** — generate N challengers per attempt, accept the best that passes (breaks most stalls).
2. **L5 controlled relaxation** — one net-positive move when strict gate stalls (must-pass stays hard).
3. **L4 regression-repair** — keep a fix + carve-out for the case it broke.
4. **L6 conflict detection** — flag mutually contradictory scenario pairs for human review.
5. De-noise the gate by running each scenario N times and comparing means (pairs naturally with L3).
6. (Optional) Frontend: render `prompt_reverted` / `converged` in the progress + prompt-history UI.
