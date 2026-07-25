# The Coaching Loop — regression-gated prompt optimization

## Why this exists
The original loop accepted every rewrite unconditionally (`current_prompt = improved_prompt`), so a
worse prompt became the new baseline and the coach "developed from there" — exactly the
0.9611 → 0.9111 → drift problem. There was no acceptance gate, no rollback, and the coach never
learned whether its last change helped or hurt.

This document describes the **champion / challenger** loop that replaces it, and the **anti-stall
plan** for when changes keep getting reverted.

---

## What is implemented now

### Champion / challenger with rollback
- **Champion** = the best prompt found so far (with its per-scenario scores). It only ever moves
  forward — the eval always returns the champion, never a worse prompt you happened to end on.
- Each attempt the **coach** (`resolver.improve`) proposes a **challenger** from the champion, its
  failing cases, and the previous attempt's outcome.
- The challenger is re-run over the **full** suite (integration test) and diffed per scenario vs the
  champion (`_diff_results`): **fixed** (was failing → now passing) and **regressed**
  (was passing → now broken).
- **Acceptance gate (regression-strict):** promote challenger → champion **only if** the mean rises
  **AND** zero previously-passing cases regress. Otherwise **revert** to the champion.
- **Must-pass guardrails:** scenarios in a critical section/tag set (default: section `guardrails`;
  tags `sensitive_data`, `claims`, `quote`, `tax`, `pricing`, `number_handling`, or per-scenario
  `"critical": true`) are hard must-pass — breaking one forces a revert even if the mean rose.
- **Noise margin:** a previously-passing case only counts as regressed if it crosses below the pass
  threshold *and* drops by more than `regression_margin` (default 0.05), so scoring jitter doesn't
  trigger false reverts.

### Coach contract (what the resolver receives and returns)
- **Receives:** champion prompt · its failing cases (+ transcripts) · whether the last change was
  accepted or reverted · the score before/after · and, on a revert, the exact regressed cases
  (with before/after and a `[CRITICAL must-pass]` flag).
- **Returns:** `improved_prompt` · `changes_summary` · `regression_diagnosis` (why the last change
  broke things) · `fix_strategy` (how this change fixes the failures without breaking passing cases).

### STLC mapping
| STLC stage | In the loop |
|---|---|
| Unit test | each scenario is a unit |
| Re-test | re-run previously-failed cases → confirm fixed |
| Regression test | re-run previously-passed cases → ensure none broke |
| Integration test | full suite run every attempt |
| Acceptance + rollback | promote on pass, revert on fail (champion mechanism) |

### Config knobs (`EvalConfig`)
`scenario_pass_threshold` (0.7) · `regression_margin` (0.05) · `plateau_patience` (3) ·
`critical_sections` · `critical_tags`.

### Events
`prompt_improved` (accepted) · `prompt_reverted` (reason + regressed cases + diagnosis) ·
`converged` (stalled, stopping with stubborn-case list) — in addition to the existing
`iteration_start` / `scenario_complete` / `iteration_complete` / `threshold_met` / `eval_complete`.

---

## The anti-stall plan: what to do when it keeps reverting

A strict gate can reject many challengers; without a plan, the champion never advances and the budget
is wasted. The strategy is an **escalation ladder** — each failed attempt loosens the *approach*
(not the safety gate) before, as a last resort, stopping honestly. The must-pass guardrail is the one
thing that never loosens.

| Rung | Trigger | Action | Status |
|------|---------|--------|--------|
| **L0** | normal | Coach makes a focused change from the champion's failures. | **done** |
| **L1** | 1+ consecutive reverts | **Surgical mode** — coach is told exactly what broke and why, and must make the *smallest* change targeting only the worst failing case, preserving regressed cases' behavior. Smaller diff → less regression. | **done** |
| **L2** | `plateau_patience` consecutive reverts | **Stop early (converged)** — return the best prompt and report the stubborn cases instead of burning budget. | **done** |
| **L3** | 2+ reverts (before stopping) | **Best-of-N sampling** — generate N challengers in parallel (varied temperature/framing), evaluate all, accept the best one that passes the gate. Breaks "one unlucky proposal" stalls. | *next* |
| **L4** | a change fixes new cases but regresses others | **Targeted regression-repair** — instead of discarding, ask the coach to *keep* the fix and add a scoped carve-out so the regressed cases still work (turn a revert into a constrained retry). | *next* |
| **L5** | N reverts, no challenger passes regression-strict | **Controlled gate relaxation (one move)** — temporarily accept a challenger that fixes more than it breaks, **provided no critical/must-pass case regresses** (guardrail stays hard). Logged loudly. Escapes a local optimum without sacrificing compliance. | *next* |
| **L6** | same case-pair keeps trading (A fixed ↔ B broken) across attempts | **Conflict detection** — flag the scenario pair as mutually contradictory for human review rather than thrashing forever. | *next* |

### The key safety net
Because the **champion only ever moves forward and is what gets returned**, "it keeps reverting" can
never make the prompt *worse* — at worst the loop stops at the best prompt it found and tells you
why. A stall is a clean, honest stop, not drift.

### Why stopping early is correct (not a failure)
Repeated reverts almost always mean one of three things, and the `converged` event surfaces which:
1. **Capability ceiling** — the base model can't satisfy the case no matter the prompt wording
   (e.g. authentic Telugu). No prompt edit fixes a model limit; stop and report.
2. **Conflicting scenarios** — two cases have mutually exclusive requirements; fixing one always
   breaks the other (L6). Needs a human to reconcile the scenarios, not more coaching.
3. **Diminishing returns** — the remaining failures are marginal; the champion is already good.

In all three, the right move is to hand the human the best prompt + a precise diagnosis, which is far
more useful than an ever-growing, thrashing prompt.

### Recommended build order for the "next" rungs
1. **L3 best-of-N** — highest leverage, breaks most stalls, isolated change in the attempt step.
2. **L5 controlled relaxation** — the real "don't get stuck" valve; cheap, needs the must-pass gate
   that already exists.
3. **L4 regression-repair** — improves sample efficiency once L3/L5 are in.
4. **L6 conflict detection** — needs cross-attempt history tracking; do last.

> Note: with stochastic single-sample scoring, regression/fix detection is itself noisy. The
> `regression_margin` mitigates it now; running each scenario N times and comparing means would make
> the gate robust, and is the natural companion to L3.
