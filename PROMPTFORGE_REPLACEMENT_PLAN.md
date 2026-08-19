# Prompt Eval → "PromptForge": Complete Replacement

## Context

The user (harshavardhan) runs a manual `/promptforge` workflow (in `agent-server-dev/prompt_lab/`) that
produces **better final voice-agent prompts** than the product's built-in prompt-eval optimizer — and
final prompt quality is what they care about. They want to **replace** the in-product optimizer with a
full-stack, in-app version of promptforge: DB-backed, UI-driven, optimizing **both** standalone and
layered (universal+vertical+campaign) prompts, scoring with the existing **deepeval metrics**, keeping a
**persistent self-updating problem-matrix**, and ending in a **mandatory human-review handoff** (because
Gemma-as-judge tops out ~85–90/100 and a human developer must finish the prompt). The old Prompt Eval
feature is set aside as "Old Eval" now; a removal doc comes later.

This plan is grounded in three real systems already on disk:
- the **product** being modified: `/home/celume/Documents/projects/agent-eval` (React + Node + Python).
- the **production multi-level prompt system**: `.../engage_dev_environment/agent-server-dev`
  (`promptMerger.js`, `prompts` table, `metadataBuilder`) — the source of truth for how layers merge and
  reach the voice agent.
- the **real promptforge workspace**: `agent-server-dev/prompt_lab/` (`regression.py`, `stress_sim.py`,
  `canon_probes.json`, `problem_matrix.csv`, `history_tracking.txt`) — the methodology to reproduce.

---

## CURRENT SYSTEM (what we're replacing) — condensed audit

- **DB (Postgres `agent_eval` @:6666):** `evals`, `prompt_versions`, `scenario_results`, `eval_events`
  (migration `20260726120000-baseline-eval-tables.js`).
- **Engine (`engine/src/core/`):** `EvalRunner.run()` champion/challenger loop; `Resolver.improve` coach
  (2-pass patch→rewrite); `Judge.evaluate` 5-dim weighted judge; `ConversationEngine`
  (single/multi/simulated self-play); `VoiceAnalyzer`; `calculator`. State in **in-process dicts**.
- **Backend:** `createEval`→`engineClient.dispatchEval`→engine→callbacks to `/api/internal/eval-events`→
  `progressController.ingestEvent` writes DB per event.
- **Frontend:** 6 pages (List/Setup/Progress/Results/PromptHistory/Voice), Zustand `evalStore`.
- **Why it loses to promptforge:** single-sample **unseeded** judge (noisy gate); fixed synthetic
  scenarios (no real-failure coverage); `revert_history` discarded (no cross-run memory); no adversarial
  verification; standalone-only (can't do layered).

**Disposition:** keep old tables/pages as read-only "Old Eval" (non-destructive); new "Forge" supersedes.

---

## TARGET SYSTEM — the vision (authoritative requirements)

**R1. Per-candidate (per-iteration) pipeline** — for every prompt the optimizer produces:
1. Run **all problem-matrix behavioural tests** (best-of-3 majority, like `regression.py`) → Y/N/~ per
   problem_id → "problems solved %".
2. Run **300–500 stress simulations** over the chosen dataset (self-play, like `stress_sim.py`) → stress
   metrics + surfaces NEW problems.
3. **List remaining problems**; coach **keeps trying** (one concern at a time, layer-routed).
4. **THEN** run the **deepeval metrics** (`CallEvaluator` + Faithfulness/AnswerRelevancy/SelfConsistency)
   on the sim transcripts as the final quality confirmation.
5. **Completion gate = ≥95% of the problem list solved** (`Y`), with plateau/filter-territory honesty for
   the stubborn remainder → prompt is "LLM-complete".

**R2. ONE GLOBAL, self-updating problem-matrix.** Seeded from `prompt_lab/problem_matrix.csv` + the
promptforge catalog (`~/.claude/skills/promptforge/references/problem-catalog.csv`, ~35 problems w/
winning levers). A single shared matrix across all agents. Every run reads it (proven levers) and writes
back: new problems found, Y/N/~ status, the **`layer_for_fix`**, and **how it was solved** (the lever).
The user can **edit the matrix themselves** in the UI. It updates itself continuously as problems are
found/fixed — the persistent memory that makes optimization cheaper over time.

**R3. Never lose a prompt.** Persist EVERY variation (accepted AND reverted), immediately, with its
scores + edits + diagnosis. Frontend lists all variations (like agent-server-dev version history).

**R4. Two optimizable modes, user-selectable:**
- **Standalone** — one `editable_config` blob (guiding_prompt + agent_details). Coach edits the blob.
- **Layered** — universal (**import**) + vertical (**import**) + campaign (**paste/author**) + optional
  addon. Merged via the production `promptMerger` algorithm into the markdown the voice agent sees.
  **The coach is layer-aware** (see below): it routes each fix to the correct layer.

**R5. Layer-aware routing + human escalation (layered mode).** The judge/coach must KNOW each layer's
purpose and decide **which layer** a fix belongs to (the `layer_for_fix` column already encodes this):
- **universal** = LLM-speech/behaviour rules true for ANY voice agent, any domain, any client — e.g.
  never speak "?", bullets, or special characters; language mirroring; TTS hygiene. Reused by every agent.
- **vertical** = domain rules for real-estate / education / automobile / insurance — e.g. say "square
  feet" not "sqft"; how to explain insurance plans. Reused by every client in that domain.
- **campaign** = one specific client, tightly coupled, may be 100% client-specific (a school vs a college
  both in the education vertical each get their own campaign layer).
The coach classifies each fix's target layer with a rationale; **if not confident, it escalates to the
human advisor** (a required option), who answers, and the answer is recorded. Editing a shared
layer (universal/vertical) is flagged prominently since it affects many agents.

**R6. Two-phase with MANDATORY human gate.** Phase 1: Gemma-as-judge drives to LLM-complete (R1 gate /
plateau; realistically ~85–90/100). Phase 2: **human handoff** — the app shows the human EVERYTHING:
the original prompt the user gave, problems **solved vs left**, the **edits done and HOW each problem was
overcome**, and the current %; the human then continues **in a loop** with the latest delivered prompt —
re-running the datasets and/or acting as the live second party chatting with the agent — until finalized.
Human step is required for BOTH modes. Status model: `collecting → optimizing → llm_complete →
human_review → finalized`.

**R7. Dataset is a per-run branch.** At setup, ask "test with real transcripts or authored personas?":
- **Real** → next ask for **call IDs** → pull transcripts (and recordings) from the production verticals
  DB (reuse `backend/src/services/verticalSource.js`, read-only) → mine into probes/personas.
- **Authored** → user **pastes** the personas/simulations dataset to run.

**R8. Iterations UX.** Iteration 1 begins once the user has supplied every required detail. Each iteration
runs the full R1 pipeline; the live view shows current version, targeted problem + chosen layer, best-of-N
spread, matrix deltas, and the running log. Save notable versions; matrix + history auto-update.

---

## GROUNDING — the real merge + harnesses to reproduce

**Merge (`agent-server-dev/src/services/promptMerger.js`) — reproduce byte-faithfully:**
- Order universal→vertical→campaign→triggered-addons; scalars later-wins, **arrays concat (no dedupe)**,
  objects deep-merge, `_`-keys stripped. `override_keys` deletes a dot-path before a layer merges
  (replace-not-accumulate).
- `greeting_message` direction-picked (`{inbound,outbound,followup}`), **stripped**, spoken by system.
- `conversational_flow` sliced to ONE stage by case-insensitive `lead_status`, **stripped**, rendered as a
  trailing `# Conversational Flow` section. `renderMarkdown` key-agnostic. Final = markdown string.
- `prompts` table: `id` VARCHAR(6), `prompt_type` ENUM(universal|vertical|campaign|addon), `prompt` JSON
  (order-preserving), `override_keys` TEXT[], `friendly_name` VARCHAR(120). Agent selects via
  `prompt_ids` JSONB `{universal:id, vertical:id, campaign:id, addon:[ids]}`.
- **Strategy:** copy the actual `promptMerger.js` into the agent-eval **backend** (Node→Node, identical
  output). Backend produces `{markdown, greeting, flowStage, mergedObject}` per candidate and sends to the
  engine. The engine scores; it never re-implements the merge.

**Harnesses (`agent-server-dev/prompt_lab/`) — port into the engine:**
- `regression.py` — build merged markdown (or blob) → system prompt → **28 behavioural probes, best-of-3
  majority**, tool-aware (`end_call`). Each probe = a problem-matrix `test_id` detector.
- `stress_sim.py` — self-play, Gemma role-plays the lead across **~55 personas × 6 moods (~330 sims)**,
  categories pos/neg/etc. This is the 300–500-sim stage.
- `canon_probes.json` — ~100 code-switched (Telugu/Hindi/English) domain Q&A probes = a dataset.
- `problem_matrix.csv` columns: `test_id, behaviour, btc_problem, layer_for_fix, v1..vN` (Y/N/~) +
  `TALLY_PASS` + `STRESS_*` rows (%). `history_tracking.txt` = per-version narrative w/ `<-- CURRENT BEST`.

**Two representations bridge merge → scorer:** simulated agent's system prompt = rendered **markdown**
(what the voice agent sees) + system speaks greeting first + sliced flow; scorer's `editable_config` = the
**merged structured object** so the reused `parsing.py` extracts flow/KB/guidelines for `CallEvaluator`.
Standalone passes its config both as the sim prompt and the scorer config.

---

## ARCHITECTURE

### Engine (`engine/src/forge/`)
- `scorer.py` — `score_probe(prompt, probe, n)` wraps the reused `CallEvaluator.evaluate` **best-of-N**
  (default N=3, median composite + per-section median), seed varied per run (keep `JUDGE_SEED=13` base).
- `detectors.py` — the **problem-matrix detector library**: one detector per problem_id (ported from
  `regression.py` + promptforge `references/known-problems.md` test methods), best-of-3 → Y/N/~.
- `stress.py` — the 300–500-sim self-play runner (port `stress_sim.py`): persona×mood grid over the run's
  dataset; emits stress metrics + candidate new problems.
- `coach.py` — layer-aware coach (evolves `Resolver`): input = champion + failing detectors/probes +
  **global matrix** (proven levers) + revert history + **layer-purpose spec (R5)**. Output = challenger +
  `targeted_problem` + `layer_for_fix` + confidence + edits. Low confidence on a shared layer →
  `needs_human` escalation flag.
- `verify.py` — adversarial fix-verification: K skeptic judge passes prompted to REFUTE the fix; accept
  only if majority fail to refute (Goodhart guard).
- `runner.py` — `ForgeRunner.run()` orchestrates R1 per iteration; regression-strict gate (best-of-N
  means) + adversarial verify; updates matrix rows (Y/N/~ + lever); anti-stall/plateau; ≥95% gate →
  `llm_complete`. **DB-backed state** (not in-process).
- `routes.py` additions: `POST /api/forge/start`, `/forge/{id}/stop`, `/forge/{id}/stream`.
- **Reuse as-is:** `analysis/evaluator.py`, `metrics/rag.py`, `analysis/parsing.py`, `analysis/prompts.py`,
  `core/conversation.py`, `voice_analyzer.py`, `llm/client.py` (now PASS the seed), `tools/simulator.py`.

### DB (migration `backend/migrations/<ts>-forge-tables.js`)
- `forge_runs` — id, name, `mode`(standalone|layered), `status`(collecting|optimizing|llm_complete|
  human_review|finalized), `dataset_kind`(real|authored), `dataset_json`, `scoring_json`(best_of_n,
  thresholds, critical sets), original_prompt_snapshot, final_composite, timestamps.
- `forge_prompts` — the layered library (mirror of production `prompts`): id, prompt_type, prompt JSONB,
  override_keys, friendly_name. Universal/vertical rows are imported/reused; campaign/addon authored.
- `forge_run_layers` — run_id → prompt_ids map (which universal/vertical/campaign/addon a run uses).
- `forge_versions` — run_id, version, `config_json` (blob OR campaign-layer edit), `merged_markdown`,
  composite, `section_scores_json`, `metrics_json`, `edits_json`, `targeted_problem`, `layer_for_fix`,
  `status`(baseline|accepted|reverted), `verify_json`, `diagnosis`, `how_solved`, diff_from_previous.
- `forge_probes` — run_id/library, `source`(real|authored), vertical, `probe_json`, tags[], critical.
- `forge_problem_matrix` — the ONE GLOBAL matrix: problem_id, behaviour, btc_problem, `layer_for_fix`,
  category, filter_territory, `winning_lever`/how_solved, `status_by_version` JSONB, editable, updated_at.
- `forge_scenario_results` — version_id, probe_id, best-of-N transcripts + per-run composites, aggregate,
  section scores, detector verdicts, areas_of_improvement.
- `forge_events` — append-only progress/audit (poll cursor, mirrors `eval_events`).
- `forge_human_reviews` — run_id, reviewer notes, resolved-problem toggles, edited prompt, live-chat log,
  finalized_at. Backs Phase 2.

### Backend (`backend/src/routes/forge.js` + `forgeController.js` + services)
- Runs: create/list/get/stop/rerun; versions; matrix GET + **PATCH (user edits)**; probes CRUD;
  **importRealProbes** (reuse `verticalSource.js`, read-only, by call ID); layer library
  (list/import universal+vertical, create campaign/addon); **mergePreview** (copied `promptMerger.js`).
- Human review: submit notes / toggle resolved / save edited prompt / append live-chat / finalize.
- `forgeEngineClient.js` dispatch to engine; ingest callbacks → `forge_*` (transactional multi-row writes).
- Copy `agent-server-dev/src/services/promptMerger.js` → `backend/src/services/promptMerger.js` verbatim.

### Frontend (`frontend/src/pages/forge/`, Zustand `forgeStore.ts`)
- **ForgeSetupPage** — `mode` toggle Standalone|Layered. Layered: universal **import** picker, vertical
  **import** picker, campaign **paste** editor, optional addons; live **merged-preview** (markdown +
  greeting + selected stage). Dataset branch (R7): real→call-IDs (reuse Call-Analysis import UX) OR
  authored→paste. Scoring config (best-of-N, thresholds). `usePersisted` drafts.
- **ForgeProgressPage** — live iteration view: version, targeted problem + `layer_for_fix`, best-of-N
  spread, matrix deltas, log. Wire the existing (currently-dead) SSE path; drop polling.
- **ForgeResultsPage** — reuse `components/analysis.tsx` (ScoreRing, MetricBar, FaithfulnessPanel,
  FlowStrip, TranscriptBubbles) for composite + 6 sections + faithfulness trail + flow.
- **ForgeMatrixPage** — the global problem-matrix grid (problem × version, Y/N/~), `layer_for_fix`,
  winning-lever/how-solved, **user-editable** cells + add-problem; history narrative.
- **ForgeVersionsPage** — every variation (accepted+reverted), client-side diff
  (`react-diff-viewer-continued`), exact edits, rerun.
- **ForgeHumanReviewPage** (Phase 2) — original prompt vs current; solved vs unsolved problems; edits +
  how-each-was-overcome; current %; reviewer edit box + resolved toggles + a live-chat panel to talk to
  the agent; Finalize.

---

## REUSE INVENTORY (do NOT rebuild)
Engine: `analysis/evaluator.py`, `metrics/rag.py`, `analysis/parsing.py`, `analysis/prompts.py`,
`core/conversation.py`, `voice_analyzer.py`, `llm/client.py`, `tools/simulator.py`, `context/builder.py`.
Backend: `services/verticalSource.js`, copy `promptMerger.js` from agent-server-dev.
Frontend: `components/analysis.tsx`, `usePersisted.ts`, `stores/evalStore.ts` SSE pattern, `theme.ts`.
Seed data: `prompt_lab/problem_matrix.csv`, `canon_probes.json`, promptforge `problem-catalog.csv`.

## PHASED BUILD ORDER
1. **Seed the global matrix** from `problem_matrix.csv` + promptforge catalog; DB `forge_*` migration.
2. **Engine scorer + detectors + best-of-N** (`forge/scorer.py`, `detectors.py`) — reproduce
   `regression.py` best-of-3 in-product; validate reproducibility.
3. **Engine stress runner** (`forge/stress.py`) — the 300–500 sims.
4. **Engine ForgeRunner + layer-aware coach + adversarial verify**, DB-backed; ≥95% gate.
5. **Backend** routes/controllers + real-probe import + `promptMerger.js` copy + merge-preview.
6. **Frontend** Setup→Progress→Results→Matrix→Versions.
7. **Layered mode** end-to-end (import universal/vertical, paste campaign, merged-preview, layer routing).
8. **Phase 2 human-review** page + `forge_human_reviews` + live-chat loop.

## VERIFICATION
- Reproducibility: same prompt + seeds → identical composite (fixes the current non-reproducibility).
- Standalone E2E: weak blob → loop accepts ≥1 fix, matrix flips ≥1 problem to Y, composite > baseline,
  gate reaches ≥95% or converges honestly.
- Layered E2E: import a universal + a vertical, paste a campaign, merged-preview matches production
  `promptMerger` output; coach routes a formatting fix to universal, a "sqft→square feet" fix to vertical,
  a client-identity fix to campaign; a low-confidence shared-layer fix escalates to human.
- Adversarial verify: a rephrase-under-the-detector fix is REFUTED and reverted.
- Cross-run memory: a problem solved in run A appears pre-solved (lever known) when it recurs in run B.
- Human gate: `llm_complete` run presents original vs current, solved/unsolved, edits+how, %; human edit +
  finalize persists.
- Constraints: prod verticals READ-ONLY; Soniox/GCS creds stay in gitignored `.env`; never print secrets;
  no Claude co-author on commits; old eval tables untouched (non-destructive).

---

---

# REVISION 2 — design-review resolutions (SUPERSEDES the DB + runner sections above where they conflict)

A design review raised 14 issues; all are valid. This section is now authoritative. Product decisions
made: escalation = **park-and-continue**; promote = **export + local library only** (never auto-write
prod); layered import = **live READ-ONLY from `agent_db` prompts**.

## Fix 1 — split the matrix (definition vs status)
- `forge_problems` (GLOBAL, definitions only): `problem_id, behaviour, btc_problem, layer_for_fix,
  category, filter_territory(bool, HUMAN-SET ONLY), winning_lever, how_solved,
  applicability_json{verticals[],modes[],languages[],directions[]}, has_detector(bool), updated_at`.
- `forge_run_problem_status` (PER-RUN): `run_id, version_id, problem_id, verdict(Y|N|~), in_denominator(bool)`.
- Cross-run reuse = a **known problem + its proven lever**, never a status. Run B still tests it.
  The `problem×v1..vN` grid is a **per-run** view; the global page shows definitions + the lever library.

## Fix 2 — tiered evaluation (cost) + inference policy
| Trigger | Runs |
|---|---|
| **Per candidate** | targeted problem's detector + **regression on previously-solved problems** (best-of-3). ~3–6 probes. |
| **On acceptance** | full matrix (best-of-3). |
| **On accepted milestone / every K accepts** | 300–500 stress sims. |
| **On accept + at final** | deepeval metrics (`CallEvaluator`). |
- Candidate `forge_versions` rows store only cheap detector verdicts; **composite/section_scores/metrics
  are stored only on accepted versions** (resolves the deepeval "THEN vs per-version" contradiction).
- vLLM budget: reuse the global semaphore (`llm/client.py`, cap 8). Policy: **max 1 optimizing run per
  inference box**; additional runs queue. Store `denominator_snapshot_json` on the run.

## Fix 3 — shared-layer lifecycle (run-local-first + promote)
- Coach edits are **always run-local**. A universal/vertical fix creates a **run-local overlay** stored in
  `forge_versions` (per-layer `config_json` keyed by `layer_type` + source `prompt_id`) — NEVER mutates a
  shared row mid-run.
- `forge_run_layers`: `run_id, layer_type, source(agent_db|local|pasted), source_prompt_id,
  pinned_version, config_snapshot`. Runs **pin the exact imported layer versions at start** — a shared
  change never shifts an in-flight run. `forge_prompts` rows are immutable versions.
- **Promote** (human-gated, endgame): run-local overlay → new local `forge_prompts` version + **export
  files**. NO automatic prod write (per decision).

## Fix 4 — the ≥95% gate (denominator + anti-gaming)
- **Applicability scope** per problem (on `forge_problems`). Denominator = **applicable** problems only.
- **Snapshot the denominator at run start** (`in_denominator`). Newly discovered problems are tracked but
  do NOT move the current %; entering the denominator needs an explicit **human re-baseline**.
- **`~` never counts as solved** (Y only). **`filter_territory` is human-only** — the coach cannot
  self-tag (closes the gate loophole). Discovery is done by the detector/stress layer, not the coach.

## Fix 5 — production fidelity
- Sims run on the **substituted** prompt (lead name, project vars, IST datetime) via reused
  `ContextBuilder` + ported production substitution — not raw `<name>` placeholders.
- **Golden-file parity test in CI**: our merge output MUST equal production `promptMerger` on fixtures
  (permanent, catches drift of the copied file).

## Fix 6 — escalation (park-and-continue) + Phase-2 endpoints
- New run state `awaiting_human`; `forge_escalations` table: `run_id, iteration, problem_id, question,
  options, coach_rationale, answer, status(open|answered)`. UI escalations inbox.
- On escalation: **park that problem, keep optimizing others**; enter `awaiting_human` only if nothing
  else is actionable.
- New engine endpoints: `POST /api/forge/{id}/chat` (interactive session vs a candidate) and
  `POST /api/forge/{id}/evaluate` (eval-only, no coaching) — back Phase-2 live-chat + dataset re-run.

## Fix 7 — real-transcript mining + PII + voice
- `engine/src/forge/miner.py`: LLM prompt to extract lead utterances → dedupe → categorize into
  personas + probes, with validation.
- **PII scrub** (names/numbers → placeholders) BEFORE anything lands in `forge_probes` (`pii_scrubbed`
  flag) — they're replayed hundreds of times.
- **Drop recordings** from the real branch (transcripts only; prompt optimization is text). Wire
  `voice_analyzer` as **text detectors** on simulated agent turns (maps to universal #16/#31).

## Fix 8 — authored dataset expansion
- Target **~300–500 sims, expanded via the mood grid**: `sims = personas × moods × repeats`, floored/
  capped to the sim budget. Persona schema `{id, persona, category, moods?}`; own moods used if present,
  else the 6-mood grid. Validate on paste.

## Fix 9 — endgame/export
- After `finalized`: **export** merged markdown + per-layer JSONs (+ `prompt_ids`) for download, and
  **promote to the local library** only. `forge_human_reviews` gains `export_json`, promote action.

## Fixes 10–14 — rulings
- **10 Acceptance:** accept iff **targeted problem→Y** AND **no previously-solved regresses (Y→N/~)** AND
  **composite drop ≤ margin**. Matrix is primary; composite is a guard. A→Y & B→N ⇒ reject → surgical
  retry. best-of-3 three-valued: **Y needs ≥2 Y, N needs ≥2 N, else `~`**. Aggregate = **median of
  per-run composites**.
- **11 Status enum:** `collecting→optimizing→awaiting_human→llm_complete→human_review→finalized`, plus
  `stopped` (stop endpoint), `failed`, `converged_below_gate` (honest plateau <95%).
- **12 Seed:** `seed=f(base_seed, probe_id, sample_k)` (EXCLUDE run_id for cross-run comparability).
  State **"reproducible within tolerance"** — vLLM continuous batching isn't byte-deterministic; pin
  serving settings where possible.
- **13 Seeding:** dedupe/ID-map `problem_matrix.csv.btc_problem` ↔ promptforge catalog IDs. Catalog
  problems **without a detector are EXCLUDED from the auto-gate denominator** (tracked, not counted) until
  a detector exists. **v0/baseline runs the identical full pipeline before any coaching** (honest
  before/after).
- **14 Verify:** `verify.py` uses a **distinctly-prompted skeptic persona at a different temperature**;
  optional **second model near the gate**. State the shared-blind-spot limitation honestly (Gemma plays
  agent+lead+judge+skeptic).

## Import source (resolved)
Layered universal/vertical = **live READ-ONLY list/import from the production `agent_db` prompts table**
(no writes). Imported rows are **snapshot-pinned** into `forge_run_layers` at run start; campaign/addon
are pasted/authored locally.

## Revised phase order
Phase 1 now delivers the **split schema (Fix 1) + applicability + tiered-eval scaffolding** first, since
everything downstream inherits it. Then: 2 scorer+detectors (tier-aware), 3 stress runner, 4 runner +
layer-aware coach + escalation + verify, 5 backend (agent_db read import, promptMerger copy + golden test,
miner+PII), 6 frontend, 7 layered E2E, 8 Phase-2 human review + chat/evaluate endpoints + export.

---

# REVISION 3 — schema consolidation (BUILT; supersedes Revision 2's table list)

User feedback during the build: 11 tables violates the house style (few tables + JSONB, cf. Call
Analysis's 2) and multiplies DB hops. Consolidated to **4 tables** (migration
`20260814160000-forge-consolidate.js`):

- **`forge_runs`** — parent row. Sub-entities folded in as JSONB: `layers_json` (pinned layer
  snapshots: source agent_db|pasted, source_prompt_id, editable flag), `probes_json` (dataset
  personas, PII-scrubbed when mined), `escalations_json` (coach→human questions + answers),
  `review_json` (Phase-2 state), plus `solved_pct` (separate from `final_composite`),
  `denominator_snapshot_json` (persisted from the engine's `run_start` event = the EFFECTIVE gate
  denominator).
- **`forge_versions`** — every variation; per-version problem grid folded in as `statuses_json`
  (one JSONB write per version instead of ~20 row upserts).
- **`forge_problems`** — the GLOBAL catalog (unchanged; definition-only, per Fix 1).
- **`forge_events`** — append-only audit/poll log (unchanged).

Dropped: forge_run_problem_status, forge_prompts, forge_run_layers, forge_probes,
forge_scenario_results, forge_escalations, forge_human_reviews. The layer LIBRARY is now the real
`agent_db_dev.prompts` table read-only (same Postgres server as agent_eval — creds derived from
`DATABASE_URL`, database name via `AGENT_DB_NAME`, default `agent_db_dev`; forced
read-only per connection). Pasted layers live on the run row; promote = export payload (no DB write).

Also fixed from smoke-run findings: stress-only problems (p18 etc.) now count in the gate
denominator via stress signals and their verdicts carry forward across accept rebuilds; the coach
only targets problems with scripted detectors; solved_pct no longer clobbers final_composite.

**Build status: engine + DB + backend are BUILT and smoke-tested E2E** (standalone run: baseline →
coached attempt → regression-strict revert → converged; layered run: agent_db import + pinning
verified; merge byte-identical to production on the golden fixtures). Frontend remains planned-only
(`FRONTEND_FORGE_PLAN.md` + the API delta note inside it).
