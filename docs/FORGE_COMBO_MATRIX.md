# Forge: direction x lead_status coverage + merge parity

Decisions confirmed by the user (2026-08-25). Do not change without asking.

## Coverage
- A run tests every direction x lead_status cell that can actually occur on a real call.
  The grid follows the voice-agent TEAM'S rule (not an inference from the prompt):
    inbound  -> ALL stages   (anyone can call in at any point in their journey)
    outbound -> `fresh` ONLY (a cold dial is by definition a lead nobody has spoken to)
    followup -> every stage EXCEPT `fresh` (a follow-up implies a previous call)
- Stage list is DYNAMIC: the non-`_` keys of the merged `conversational_flow`.
  No hardcoded status enum.
- All dataset personas are replayed in EVERY combo (personas x combos conversations).
- HARD CAP 200 conversations per run: personas are reduced to fit, and the drop is
  logged (never silently truncated).
- Tool-capability checks run ONCE per run (prompt-level, not stage-level).
- The LLM Arena stays SINGLE-COMBO.

## Scoring
- Per-combo scorecard (problems / metrics / tools) PLUS a pooled overall.
- Completion gate: EVERY combo must independently pass. One weak combo blocks
  `llm_complete`.

## Lead information block
- The existing `**LEAD INFORMATION:**` block is ENRICHED; no new blocks are added and
  the prefix-cache block order is unchanged.
- Fields synthesized per combo: Customer Name (from the persona), Call Direction,
  Lead Status, and for followup combos a `Reason for follow-up`.

A prompt with NEITHER a greeting_message NOR a conversational_flow (the normal shape of a
standalone blob) has no grid to sweep: it runs ONCE, as configured, and never hits the gate.

## Invalid combos -> HUMAN GATE
A combo is invalid when the prompt cannot serve it (no greeting for that direction, or
no flow stage for that status).
- The WHOLE RUN HALTS at that point.
- The pause screen shows the diagnosis and offers: write the missing content /
  fall back to outbound / skip the combo. An editor is inline and prefilled.
- A "remember for this campaign" checkbox stores the answer so the gap does not halt a
  future run.
- The answer is used to write the prompt properly for real (not faked) AND is fed to the
  coach as a problem it must fix, so the optimized prompt ends up containing the missing
  greeting/stage.

## Merge parity with production (agent-server-dev)
The merge algorithm is already a faithful port. These divergences are being FIXED:
1. `<name>` substitution in the greeting (production: telephonyDispatchService.js:66-72).
2. JS-compatible scalar rendering: true/false/null/3/joined-arrays, not Python repr.
3. `override_keys` dropped on the resume path (forgeController.js).
4. JS integer-like key hoisting in render/merge, and N prompt rows per layer type.

KNOWN, ACCEPTED divergence (user chose "leave as-is"):
- Our final prompt has 3 blocks; production's has 10 (datetime, lead details, call notes,
  whatsapp summary, agent switching, full transfer wording are absent) and our block order
  is reversed for vLLM prefix caching. Consequence: date reasoning, call-notes conditioning
  and production-strength warm-transfer instructions are NOT exercised by Forge.

## Coach guidance box
- A side-panel free-text box, scoped PER RUN and live-editable while the run is going.
- The coach reads it from the next iteration onward and must honour it.
- Stored on the run; not global, not carried into a new run automatically.

## Coach intelligence
- The coach system prompt must state the FULL context: who it is, what system it is part
  of, what the run is trying to achieve, why a fix is being asked for, which layer it may
  write to and why, and how its output is used downstream. All the W's and the H.
- Coach sampling: temperature 0.4, thinking ON (high). It is a reasoning role, not the
  agent-under-test.

## Fixed during E2E/UAT (do not regress)
- `conversation.py` treated only the literal "outbound" as agent-speaks-first, so FOLLOW-UP
  calls were simulated as inbound and the follow-up greeting was never spoken. Now
  `agent_speaks_first = call_direction != "inbound"`.
- Standalone runs would have halted at the human gate on every run (a blob has no
  greeting_message, so every combo read as an unservable gap). Guarded in build_matrix.
- Frontend used T.bg2/T.line/T.good/T.bad/T.warn, which do not exist in theme.ts — they
  resolved to undefined (white textarea on a dark page). Real tokens: surface2/border2/
  green/red/amber. There is a repo check for this in the session notes.
- The progress log auto-scrolled with scrollIntoView(), moving the whole document and
  yanking the page away from anyone typing in the guidance box. Now scrolls its own container.
- listSims did not project the `combo` column, so the archive showed combo=null even though
  the DB had it.
