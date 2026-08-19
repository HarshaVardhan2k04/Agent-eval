# Forge — Complete Frontend Plan

Frontend build plan for **Forge** (the promptforge-style voice-agent prompt optimizer that supersedes
the old Prompt Eval). This is a **plan only** — no component code here. It is written against the
authoritative `PROMPTFORGE_REPLACEMENT_PLAN.md` (REVISION 2 wins on every conflict) and mirrors the
repo's existing look **exactly**: ember-orange warm-dark, inline styles, hand-rolled SVG charts, the `T`
tokens + `card`/`label`/`btnPrimary` fragments from `theme.ts`, and the reusable primitives in
`components/analysis.tsx`.

## 0 — Design-system fidelity (non-negotiable, applies to every page)

- **No CSS framework, no new deps beyond what's already installed.** `react-diff-viewer-continued@4.2.2`,
  `zustand@5`, `react-router-dom@7` are present; **no markdown renderer is installed**, so all
  markdown (merged-preview, how-solved narratives) renders in a mono `T.well` `<pre>` block, never as
  rich markdown. Matches repo convention.
- **Two theme conventions coexist in the repo** and Forge follows the *newer* one (as the scoreboard +
  call-analysis pages do): import shared `card`, `label`, `btnPrimary`, `btnSecondary`, `backBtn` from
  `../theme` and chart primitives (`ScoreRing`, `MetricBar`, `SectionCard`, `FaithfulnessPanel`,
  `FlowStrip`, `TranscriptBubbles`, `score100Color`, `SECTION_LABELS`, `METRIC_LABELS`, `InfoDot`) from
  `../components/analysis`. Page-local `React.CSSProperties` consts (built from `T.*`) for anything
  bespoke, declared at the bottom of each file.
- **Scores:** Forge composites/sections/metrics are 0–100 → use `score100Color` + `ScoreRing`/`MetricBar`
  (NOT the 0–1 `scoreColor`). The old-eval `scoreColor` is only for legacy pages.
- **Status chips:** reuse the repo pattern — `inline-flex` pill, `color + '26'` (or a `tint(color,0.15)`)
  background, small dot that pulses (`pulse-dot`) when the state is live. Forge has more statuses than the
  current `statusMeta()` covers, so add a **`forgeStatusMeta()`** helper (see §3).
- **Segmented pill control** (mode toggles, dataset-branch toggle, matrix sub-view toggle): the STT
  `ModeSwitch` shape — `T.well` container radius 12, active tab `T.surface2`/`T.text`/weight 600,
  inactive `transparent`/`T.muted`.
- **Vertical/prompt picker:** the STT radio-row variant (`role="radio"`, active `T.accentSoft` +
  `1px solid var(--accent)`), with a disabled state + "creds not set" amber tag when a source is
  unconfigured — reused verbatim for the agent_db universal/vertical import pickers.
- **Charts are hand-rolled inline SVG** (`viewBox`, `<polyline>`/`<path>`/`<circle>`/`<rect>`), exactly
  like `EvalProgressPage`'s line chart and `EvalListPage`'s sparkline. No chart library.
- **Live updates:** the repo's `subscribeToEvents` SSE path exists but is **currently dead** (every page
  polls). Forge **wires the SSE path and drops polling** on the progress page (per R8 / plan §Frontend).

---

## 1 — Route table

All routes are children of `<AppShell>` in `App.tsx`, added alongside the existing groups. New page
components live in `frontend/src/pages/forge/`.

| Route | Component | Purpose |
|---|---|---|
| `/forge` | `ForgeListPage` | All runs, status chips, composite, mode, rename/delete, click-through |
| `/forge/new` | `ForgeSetupPage` | Standalone/Layered setup, layer import + merged preview, dataset branch, scoring config |
| `/forge/:id/progress` | `ForgeProgressPage` | Live tiered-eval view + running log (SSE) + escalations inbox |
| `/forge/:id/results` | `ForgeResultsPage` | LLM-complete result: composite ring, section cards, deepeval metrics, faithfulness, worst probes |
| `/forge/:id/matrix` | `ForgeMatrixPage` | Split view: (a) GLOBAL problem library (definitions) + (b) PER-RUN status grid |
| `/forge/:id/versions` | `ForgeVersionsPage` | Every variation (accepted + reverted), split diff, coach edits, rerun |
| `/forge/:id/review` | `ForgeHumanReviewPage` | Phase-2 mandatory handoff: original vs current, solved/left, edits+how, live chat, export, promote |
| `/forge/:id/escalations` | `ForgeEscalationsPage` | Full-page escalations inbox (same component the progress page embeds) |

Notes:
- `ForgeMatrixPage`'s GLOBAL library tab is run-independent data but is reached via a run (`:id`) so the
  per-run status grid sits beside it; a top-level `/forge/matrix` alias can also mount it with the run
  grid hidden. Keep the canonical route `/forge/:id/matrix`.
- `App.tsx` change: add a `{/* Forge */}` block of `<Route>`s. Keep all existing eval/analysis/stt/rag/
  flow routes untouched (Old Eval stays read-only).
- `AppShell.tsx`: Forge pages use the **centered 1180 column** (default), NOT the wide canvas; no change to
  `WIDE_ROUTES` needed. (The matrix grid scrolls horizontally inside its own `overflow-x:auto` card.)

---

## 2 — Sidebar navigation changes (`components/Sidebar.tsx`)

Edit the `GROUPS` array only. Add a **Forge** group at the **top** (it is now the primary feature), and
rename the existing `Prompt Eval` group heading to **`Old Eval`** (kept, read-only, not removed).

```
Forge
  ├ Runs            → /forge            (IconHistory or new IconForge, end:true)
  ├ New Run         → /forge/new        (IconPlus)
  └ Problem Matrix  → /forge/matrix     (new IconMatrix)   // opens global library, run grid hidden
Call Analysis        (unchanged)
Test STT             (unchanged)
RAG Testing          (unchanged)
Flow Builder         (unchanged)
Old Eval             (was "Prompt Eval"; same two items /, /new stay pointing at legacy pages)
  ├ History         → /
  └ New Eval        → /new
Settings             (unchanged)
```

- New icons to add in `components/icons.tsx` following the existing `export const IconX = ({ s, style }: P) => (<svg .../>)`
  style: **`IconForge`** (anvil/spark — the "forge" metaphor) and **`IconMatrix`** (grid of cells). If we
  want zero new icons for v1, reuse `IconJudge` for Forge Runs and `IconBoard` for Problem Matrix.
- The active-item accent bar, collapsed behavior, and `KEY_COLLAPSED` logic are unchanged.
- Because Forge becomes the landing feature, optionally change the logo click target from `/` to `/forge`
  (leave `/` working for Old Eval). Low priority; keep `/` default if we don't want to touch AppShell.

---

## 3 — `theme.ts` additions (small, additive only)

Add a Forge status helper next to `statusMeta()` (do not modify `statusMeta`, legacy pages depend on it):

```ts
// Forge run + version + verdict → { color, label }
export function forgeStatusMeta(status: string): { color: string; label: string } {
  switch (status) {
    case 'collecting':          return { color: T.blue,   label: 'Collecting' }
    case 'optimizing':          return { color: T.blue,   label: 'Optimizing' }
    case 'awaiting_human':      return { color: T.purple, label: 'Awaiting human' }
    case 'llm_complete':        return { color: T.amber,  label: 'LLM-complete' }
    case 'human_review':        return { color: T.purple, label: 'Human review' }
    case 'finalized':           return { color: T.green,  label: 'Finalized' }
    case 'converged_below_gate':return { color: T.amber2, label: 'Converged < gate' }
    case 'stopped':             return { color: T.faint,  label: 'Stopped' }
    case 'failed':              return { color: T.red,    label: 'Failed' }
    default: return { color: T.faint, label: status }
  }
}
```

Also add tiny verdict tokens used by the matrix + progress deltas (can be a page-local map instead, but
centralizing keeps colors consistent):

```ts
export const verdictMeta = {
  Y: { color: T.green, glyph: 'Y', label: 'Solved' },
  N: { color: T.red,   glyph: 'N', label: 'Failing' },
  '~': { color: T.amber, glyph: '~', label: 'Partial' },
} as const
```

Everything else (`T`, `card`, `label`, `btnPrimary`, `btnSecondary`, `backBtn`, `score100Color`) is reused
as-is. No token values change.

---

## 4 — `forgeStore.ts` (Zustand) — the store shape

`frontend/src/stores/forgeStore.ts`, modeled on `evalStore.ts` (same `create<...>((set, get) => ({...}))`
shape, same "fetch* writes into slice" pattern), but with the SSE connection actually used for progress.

### Types (mirrors `forge_*` DB tables)

```ts
type ForgeMode = 'standalone' | 'layered'
type ForgeStatus = 'collecting'|'optimizing'|'awaiting_human'|'llm_complete'|'human_review'
                  |'finalized'|'stopped'|'failed'|'converged_below_gate'
type Verdict = 'Y'|'N'|'~'
type LayerType = 'universal'|'vertical'|'campaign'|'addon'
type VersionStatus = 'baseline'|'accepted'|'reverted'

interface ForgeRunSummary {
  id: string; name: string | null; mode: ForgeMode; status: ForgeStatus
  dataset_kind: 'real'|'authored'
  final_composite: number | null           // 0..100
  solved_pct: number | null                // % of applicable problems at Y (snapshot denominator)
  denominator_snapshot: number | null      // applicable-problem count pinned at start
  iterations_run: number
  created_at: string; completed_at: string | null
}

interface ForgeVersion {
  version: number; status: VersionStatus
  targeted_problem: string | null; layer_for_fix: LayerType | null
  composite: number | null                 // only present on accepted versions (tiered eval)
  section_scores: Record<string, number> | null
  metrics: Record<string, number> | null   // deepeval, accepted+final only
  edits: Array<{ op: string; layer?: LayerType; path?: string; text?: string }>
  diagnosis: string | null; how_solved: string | null
  merged_markdown: string | null           // layered: merged; standalone: the blob
  config_json: unknown                      // blob OR per-layer campaign edit
  verify_json: unknown | null              // adversarial verify result
  diff_from_previous: string | null
  created_at: string
}

interface GlobalProblem {                    // forge_problems (definitions)
  problem_id: string; behaviour: string; btc_problem: string
  layer_for_fix: LayerType; category: string
  filter_territory: boolean                  // HUMAN-SET ONLY (UI: coach cannot edit)
  winning_lever: string | null; how_solved: string | null
  applicability: { verticals: string[]; modes: string[]; languages: string[]; directions: string[] }
  has_detector: boolean; updated_at: string
}

interface RunProblemStatus {                 // forge_run_problem_status (per-run × version)
  problem_id: string; version: number; verdict: Verdict; in_denominator: boolean
}

interface Escalation {
  id: string; iteration: number; problem_id: string
  question: string; options: string[]; coach_rationale: string
  answer: string | null; status: 'open'|'answered'
}

interface LayerRow {                         // agent_db import candidate OR run-pinned layer
  prompt_id: string; prompt_type: LayerType; friendly_name: string
  source: 'agent_db'|'local'|'pasted'; configured?: boolean
  prompt?: unknown; override_keys?: string[]
}

interface HumanReview {
  reviewer_notes: string; resolved_toggles: Record<string, boolean>
  edited_prompt: string | null; chat_log: Array<{ role: 'human'|'agent'; text: string }>
  export_json: unknown | null; finalized_at: string | null
}

interface LiveForge {                        // fed by SSE on the progress page
  version: number; targeted_problem: string | null; layer_for_fix: LayerType | null
  tier: 'candidate'|'accepted'|'milestone'   // tiered-eval indicator
  bestOfN: number[]                          // per-sample composites for the current candidate
  matrixDeltas: Array<{ problem_id: string; from: Verdict|null; to: Verdict }>
  solvedPct: number; denominator: number
  log: Array<Record<string, unknown>>        // append-only event rows for the terminal log
  coachThinking: boolean
}
```

### Store slices + actions

```ts
interface ForgeStore {
  runs: ForgeRunSummary[]
  currentRun: (ForgeRunSummary & { scoring_json?: unknown; original_prompt_snapshot?: string }) | null
  versions: ForgeVersion[]
  globalProblems: GlobalProblem[]
  runStatus: RunProblemStatus[]              // per-run status grid rows
  escalations: Escalation[]
  humanReview: HumanReview | null
  live: LiveForge | null
  eventSource: EventSource | null

  // reads
  fetchRuns(): Promise<void>
  fetchRun(id: string): Promise<void>
  fetchVersions(id: string): Promise<void>
  fetchGlobalProblems(): Promise<void>
  fetchRunStatus(id: string): Promise<void>
  fetchEscalations(id: string): Promise<void>
  fetchHumanReview(id: string): Promise<void>

  // writes
  createRun(payload): Promise<string>        // returns run_id
  stopRun(id: string): Promise<void>
  renameRun(id: string, name: string): Promise<void>
  deleteRun(id: string): Promise<void>
  rerunFromVersion(id: string, version: number): Promise<void>
  patchProblem(problem_id: string, patch: Partial<GlobalProblem>): Promise<void>
  answerEscalation(id: string, escId: string, answer: string): Promise<void>
  rebaselineDenominator(id: string): Promise<void>  // human re-baseline (Fix 4)
  // human review
  saveReview(id: string, patch: Partial<HumanReview>): Promise<void>
  sendChat(id: string, message: string): Promise<{ reply: string }>
  evaluateOnly(id: string): Promise<void>    // dataset re-run, no coaching
  finalizeRun(id: string): Promise<void>
  promoteToLocal(id: string): Promise<void>  // export + local lib, NO prod write

  // live (SSE — the wired path)
  connectToProgress(id: string): void        // opens api.subscribeToForge, folds events into `live`
  disconnectProgress(): void
}
```

`connectToProgress` folds each SSE event into `live` (like `evalStore.connectToProgress` folds into
`liveProgress`, but richer): `candidate_start` → set targeted_problem/layer/tier; `sample_scored` →
push into `bestOfN`; `matrix_delta` → push delta; `version_accepted` → clear bestOfN, refetch versions +
runStatus; `escalation_opened` → refetch escalations + set `awaiting_human` chip; `run_complete` →
disconnect + `fetchRun` + `fetchVersions`. Every event also appends to `live.log` for the terminal.

---

## 5 — `usePersisted` draft keys (ForgeSetupPage)

Per the task, Setup uses `usePersisted` (sessionStorage-backed, `ae:` prefix) so drafts survive nav — the
STT model, not the plain-`useState` EvalSetupPage. Un-serializable data (none expected here; personas and
call-IDs are text) stays in state. Keys:

```
forge:mode                 'standalone' | 'layered'
forge:name                 run name
forge:standaloneBlob       the editable_config blob text (standalone)
forge:layerUniversalId     pinned agent_db universal prompt_id
forge:layerVerticalId      pinned agent_db vertical prompt_id
forge:campaignText         pasted/authored campaign layer (JSON or markdown)
forge:addonIds             string[] of optional addon prompt_ids
forge:leadStatus           selected conversational_flow stage (for preview slice)
forge:direction            inbound|outbound|followup (greeting pick + preview)
forge:datasetKind          'real' | 'authored'
forge:realVertical         vertical key for real-transcript import
forge:realCallIds          textarea text of call IDs
forge:personasText         pasted authored personas JSON
forge:scoreBestOfN         number (default 3)
forge:scoreThreshold       composite gate margin
forge:criticalSets         selected critical problem sets / tags
```

Clear them with `clearPersisted('forge:mode', ...)` after a successful `createRun` (mirrors
AnalyzeCallsPage's `clearDraft()`).

---

## 6 — `api.*` methods to add (`api/client.ts`)

All go under a new `// --- Forge ---` block, reusing the existing `request()` helper. Endpoints match the
backend routes in `PROMPTFORGE_REPLACEMENT_PLAN.md` (`backend/src/routes/forge.js`) + the engine
endpoints exposed through the backend.

### Runs
```
createForgeRun(body)                POST   /api/forge/runs
  body: { name?, mode, dataset_kind, dataset_json, scoring_json, layers?, standalone_config? }
listForgeRuns()                     GET    /api/forge/runs
getForgeRun(id)                     GET    /api/forge/runs/:id
stopForgeRun(id)                    POST   /api/forge/runs/:id/stop
renameForgeRun(id, name)            PATCH  /api/forge/runs/:id            { name }
deleteForgeRun(id)                  DELETE /api/forge/runs/:id
rebaselineForgeRun(id)              POST   /api/forge/runs/:id/rebaseline // human re-baseline denominator
```

### Versions
```
getForgeVersions(id)                GET    /api/forge/runs/:id/versions
getForgeVersionDiff(id, version)    GET    /api/forge/runs/:id/versions/:version/diff
rerunForgeVersion(id, version)      POST   /api/forge/runs/:id/rerun      { version }
```

### Problem matrix (split — Fix 1)
```
listForgeProblems()                 GET    /api/forge/problems            // GLOBAL definitions library
patchForgeProblem(problemId, patch) PATCH  /api/forge/problems/:problemId // user edits (filter_territory human-only)
createForgeProblem(body)            POST   /api/forge/problems            // add-problem
getForgeRunStatus(id)               GET    /api/forge/runs/:id/status     // per-run problem×version grid
```

### Layered mode: agent_db import + merge preview
```
listAgentDbLayers(type)             GET    /api/forge/agentdb/prompts?type=universal|vertical|addon
                                                                          // LIVE READ-ONLY list from prod agent_db
getAgentDbLayer(promptId)           GET    /api/forge/agentdb/prompts/:promptId  // full prompt JSON for preview
mergePreview(body)                  POST   /api/forge/merge-preview
  body: { universal_id?, vertical_id?, campaign, addon_ids?, lead_status, direction }
  → { markdown, greeting, flow_stage, merged_object }
```

### Dataset — real transcripts (mirror Call-Analysis import)
```
forgeVerticals()                    GET    /api/forge/verticals           // {key,label,dbConfigured,gcsConfigured}[]
importForgeProbes(id, body)         POST   /api/forge/runs/:id/probes/import  { vertical, call_ids } // PII-scrubbed
validatePersonas(body)              POST   /api/forge/personas/validate   { personas } → { ok, expanded_sim_count, errors[] }
```

### Escalations (Fix 6)
```
listForgeEscalations(id)            GET    /api/forge/runs/:id/escalations
answerForgeEscalation(id, escId, a) POST   /api/forge/runs/:id/escalations/:escId/answer  { answer }
```

### Human review (Phase 2 — Fix 6/9)
```
getForgeReview(id)                  GET    /api/forge/runs/:id/review
saveForgeReview(id, patch)          PATCH  /api/forge/runs/:id/review     // notes, resolved toggles, edited prompt
forgeChat(id, body)                 POST   /api/forge/runs/:id/chat       { message, history } → { reply }
forgeEvaluate(id)                   POST   /api/forge/runs/:id/evaluate   // eval-only, no coaching
finalizeForgeRun(id)                POST   /api/forge/runs/:id/finalize
exportForgeRun(id)                  GET    /api/forge/runs/:id/export     // merged md + per-layer JSONs (download)
promoteForgeRun(id)                 POST   /api/forge/runs/:id/promote    // local library only, NO prod write
```

### SSE (the wired live path)
```
subscribeToForge(id, onEvent)       EventSource /api/forge/runs/:id/stream
  // same shape as existing subscribeToEvents; returns the EventSource so the store can close it
```

---

## 7 — Component reuse map (`components/analysis.tsx` + theme)

| Forge page | Reused from `analysis.tsx` | Reused theme fragments |
|---|---|---|
| ForgeListPage | — (hand-rolled sparkline/pips like EvalListPage) | `card`, `forgeStatusMeta`, `score100Color` |
| ForgeSetupPage | `InfoDot` (on scoring-config fields) | `card`, `label`, `btnPrimary`, `btnSecondary` |
| ForgeProgressPage | `ScoreRing` (best-of-N median), `verdictMeta` deltas | `card`, `label`, `forgeStatusMeta` |
| ForgeResultsPage | `ScoreRing`, `SectionCard`, `MetricBar`, `FaithfulnessPanel`, `FlowStrip`, `TranscriptBubbles`, `SECTION_LABELS`, `METRIC_LABELS`, `InfoDot` | `card`, `label`, `backBtn` |
| ForgeMatrixPage | `InfoDot`, `verdictMeta` | `card`, `label` |
| ForgeVersionsPage | — (`ReactDiffViewer` default import) | `card`, `label`, `backBtn` |
| ForgeHumanReviewPage | `ScoreRing`, `TranscriptBubbles` (chat), `ReactDiffViewer` (orig vs current) | `card`, `label`, `btnPrimary`, `backBtn` |
| ForgeEscalationsPage / inbox | — | `card`, `label` |

New **shared Forge components** to create in `frontend/src/pages/forge/components/` (or a
`components/forge.tsx`), all built from `T.*`:
- **`RunStatusChip({ status })`** — the pill using `forgeStatusMeta`, pulsing dot on live states.
- **`LayerBadge({ layer })`** — small mono chip color-coded per layer (universal=`T.blue`,
  vertical=`T.purple`, campaign=`T.accent`, addon=`T.faint`); shared-layer badge shows a warning tint.
- **`VerdictCell({ verdict })`** — Y/N/~ cell using `verdictMeta` (matrix + deltas).
- **`SolvedGauge({ solvedPct, denominator })`** — reuse `ScoreRing` at value=`solvedPct` with a caption
  `n/denominator applicable · 95% gate` marker.
- **`EscalationCard({ escalation, onAnswer })`** — question + options + coach rationale + answer form.
- **`MergedPreviewPanel({ markdown, greeting, flowStage })`** — mono `T.well` `<pre>` with a greeting
  chip + selected-stage chip header.
- **`Log`/`LogLine`** — the terminal-style log lines (traffic-light dots, colored icon badges, coach
  spinner) ported from `EvalProgressPage`'s `formatEvent`, but fed by SSE instead of poll.

---

## 8 — Per-page wireframes (layout, state, api, states)

### 8.1 ForgeListPage (`/forge`)

**Header** — flex space-between (EvalListPage pattern): left `<h1>` "Forge runs" (fontSize 34) + muted
`<p>` "Optimize a voice-agent prompt end-to-end, then hand it to a human."; right gradient
`btnPrimary` "+ New run" → `nav('/forge/new')`.

**Controls row** — filter pills (`all` + each status group: Active / LLM-complete / In review / Finalized /
Stopped) styled active via `T.accentSoft`/`T.accentHi`, + a search `<input>` pill with magnifier SVG.
Client-side filter in a `useMemo` over `runs` by name/id + status.

**List** — vertical stack of clickable row cards (`className="ev-row"`, `T.surface2`, radius 16), one per
run:
- left status accent bar (`forgeStatusMeta(run.status).color`);
- run name + mono `id` chip (`T.chip`) + a **mode pill** (`LayerBadge`-style: "Standalone"/"Layered");
- created_at + `iterations_run` iters + `dataset_kind`;
- **solved-% pips or sparkline** — hand-rolled SVG like EvalListPage: a small `SolvedGauge`
  (ring of `solved_pct`) plus the composite % big number colored by `score100Color`;
- `RunStatusChip` (pulsing dot when `optimizing`/`collecting`/`awaiting_human`).
- **Rename + delete** inline, optimistic, exactly the ScoreboardPage UX: ✎ swaps name cell to an
  `<input>` (autofocus), Enter/blur `renameRun` optimistic then revert on failure; 🗑 → `confirmDel`
  two-step ✓/✕ → `deleteRun`. Action cells `stopPropagation`.

**Click-through** — `awaiting_human`/`llm_complete` → `/forge/:id/review` is *available*, but the default
row click routes: `optimizing`/`collecting` → `/forge/:id/progress`; else → `/forge/:id/results`.

**States** — `loading` → "Loading…"; `runs.length === 0` → dashed `T.well` empty card with gradient
IconForge + "Start your first run" CTA (`btnPrimary` → `/forge/new`); filtered-empty → smaller no-match
card. Store: `useForgeStore` → `runs`, `fetchRuns()` in `useEffect`. No polling.

### 8.2 ForgeSetupPage (`/forge/new`)

`backBtn` "← Back to runs" → `nav('/forge')`; `<h1>` "New run" (32) + subtitle. Two-column grid like
AnalyzeCallsPage: left = the form stack, right = a **sticky "Ready to launch?" checklist panel**.

**Block 1 — Mode toggle** — segmented pill **Standalone | Layered** (`forge:mode`).

**Block 2a — Standalone** (mode=standalone): one `card` "Prompt (editable_config blob)" with a mono
`wellArea` `<textarea>` (`forge:standaloneBlob`), char + `estimateTokens` footer, and a ready `statusChip`.

**Block 2b — Layered** (mode=layered): four stacked cards + a live preview.
- **Universal (import)** card — `role="radio"` list from `listAgentDbLayers('universal')`; each row =
  `friendly_name` + mono `prompt_id`, disabled + "creds not set" tag if unconfigured. Selecting pins
  `forge:layerUniversalId`. A muted note: "Universal is one-per-LLM and shared — imported read-only,
  snapshot-pinned at launch."
- **Vertical (import)** card — same picker from `listAgentDbLayers('vertical')` → `forge:layerVerticalId`.
- **Campaign (paste/author)** card — mono `wellArea` `<textarea>` (`forge:campaignText`), JSON-or-markdown,
  with inline validity text (green "valid campaign layer" / red "invalid JSON").
- **Add-ons (optional)** card — multi-select pill chips from `listAgentDbLayers('addon')` →
  `forge:addonIds`.
- **Preview controls** row — `direction` segmented (inbound/outbound/followup → greeting pick) +
  `lead_status` select (→ which `conversational_flow` stage is sliced).
- **Merged-preview panel** (`MergedPreviewPanel`) — debounced call to `mergePreview(...)` whenever any
  layer/lead_status/direction changes; renders `{markdown}` in a mono `T.well` `<pre>`, with an
  **extracted greeting** chip and the **selected stage** chip above it. Loading → subtle "merging…"
  shimmer; error → amber inline "merge failed (check campaign JSON)".

**Block 3 — Dataset branch (R7)** — segmented **Real transcripts | Authored personas** (`forge:datasetKind`).
- **Real** → vertical radio picker from `forgeVerticals()` (`dbConfigured` gating, "creds not set") +
  a "Call IDs" mono `<textarea rows=5>` (`forge:realCallIds`) with the shared `parseCallIds`
  JSON-array-or-`/[\s,]+/` logic and a live "N call ID(s) parsed" green counter — the exact
  Call-Analysis/STT import UX. A muted line: "Transcripts only; recordings dropped; PII scrubbed before
  probes are stored."
- **Authored** → mono `<textarea>` (`forge:personasText`) for personas `{id, persona, category, moods?}`,
  with an on-blur/`validatePersonas` call showing "**~N sims** after mood-grid expansion (target
  300–500)" (green if within the sim floor, amber if below) + a per-error list. Explain the mood grid:
  "sims = personas × moods × repeats; own moods if present else the 6-mood grid."

**Block 4 — Scoring config** — a `card`: `best-of-N` number input (`forge:scoreBestOfN`, default 3, with
`InfoDot`), composite-drop margin slider (`forge:scoreThreshold`), and critical-set multi-select pills
(`forge:criticalSets`) tagging which problems are must-solve. `InfoDot` copy explains best-of-N majority,
median composite, and that `~` never counts as solved.

**Right sticky panel** — readiness checklist (`✓`/`○`): mode chosen; (layered) universal+vertical+campaign
present & merge preview OK; dataset supplied (real IDs>0 or personas valid); scoring set. `btnPrimary`
full-width **"Launch run →"** enabled only when all green. On submit → `createForgeRun(payload)` (assemble
from persisted keys), `clearPersisted(...)`, `nav('/forge/:id/progress')`.

**States** — merge preview + persona validation each carry their own loading/error inline; the launch
button is the single gate.

### 8.3 ForgeProgressPage (`/forge/:id/progress`)

**Header** — `<h1>` = run name + inline `RunStatusChip` (pulsing when live) + subtitle
`statusLine` ("Iteration k · optimizing · N/denominator solved"). Right action: red **Stop** button
(`stopRun(id)`) while live; a gradient "View results →" when `llm_complete`/`finalized`; a purple
"Human review →" when `awaiting_human`/`llm_complete`.

**Layout** — two-column grid `320px 1fr` (`prog-grid`), plus a **full-width escalations strip on top**
when there are open escalations.

- **Escalations strip** (only if `escalations.some(open)`): a purple-tinted `card` "The coach parked N
  questions — park-and-continue" listing `EscalationCard`s (question + options + rationale + answer form
  → `answerEscalation`). If status is `awaiting_human` (nothing else actionable) the strip is emphasized
  and the log shows "paused, waiting on you."
- **LEFT stack:**
  - **Current version** card — `v{live.version}`, targeted problem text, `LayerBadge` for `layer_for_fix`,
    and a `tier` indicator chip (candidate=`T.faint` / accepted=`T.green` / milestone=`T.accentHi`).
  - **Best-of-N spread** card — `ScoreRing` at the **median** of `live.bestOfN`, plus a tiny hand-rolled
    dot-strip SVG showing each sample's composite (colored by `score100Color`) so the spread is visible.
  - **Solved gauge** card — `SolvedGauge(solvedPct, denominator)` with the 95%-gate marker.
  - **Matrix deltas** card — list of `live.matrixDeltas` rows: `problem_id`, `VerdictCell from → to`
    (e.g. `N → Y` green, `Y → ~` red regression). Link "Open matrix →" → `/forge/:id/matrix`.
- **RIGHT — terminal log** card (`T.well`, faux traffic-light dots + "streaming" indicator): SSE-fed
  `LogLine`s (icon+color per event: candidate_start, sample_scored, version_accepted/reverted,
  escalation_opened, milestone_stress, deepeval_done, run_complete), coach-thinking spinner, auto-scroll
  via `logEndRef`. Empty → "Waiting for the engine…".

**Live wiring** — `useEffect`: `connectToProgress(id)` on mount, `disconnectProgress()` on unmount; on
`run_complete` event navigate to `/forge/:id/results` after a 1500ms beat (EvalProgressPage pattern) —
but via **SSE**, not polling. Also `fetchRun`, `fetchEscalations` once on mount for initial paint.

### 8.4 ForgeResultsPage (`/forge/:id/results`)

The "LLM-complete" quality report — the CallReportPage layout, at run level. `backBtn` "← Back to runs"
→ `/forge`. Header: `ScoreRing value={final_composite} size={64}` + `<h1>` run name + "mode · dataset ·
overall N/100" + `RunStatusChip`. Right: header links "Matrix →" `/forge/:id/matrix`, "Versions →"
`/forge/:id/versions`, and a prominent purple "Continue to human review →" `/forge/:id/review` (since LLM
tops ~85–90 and a human must finish).

Body top-to-bottom (all reused from `analysis.tsx`):
1. **Sections** — `label` "How the agent did"; 2-col `dims-grid` of `<SectionCard name data={section}>`
   over `SECTION_LABELS` from the accepted final version's `section_scores`/verdict/evidence.
2. **Metrics (deepeval)** — `label` "Metrics"; `auto-fit minmax(200px,1fr)` grid of `<MetricBar>` over
   `METRIC_LABELS` from `metrics` (retention, repetition, instruction-flow, human-likeness,
   answer_relevancy, self_consistency).
3. **Faithfulness** — `<FaithfulnessPanel detail score>` when `metrics.faithfulness_detail` present.
4. **Flow** — `<FlowStrip flow>` from the final version's flow adherence.
5. **Worst probes** — `label` "Weakest probes"; clickable rows (worst by composite, `slice(0,6)`) each a
   `card` with a small `ScoreRing` + probe id/persona + one-line note; expand to `<TranscriptBubbles>` of
   that sim's transcript.

Single fetch (`fetchRun` + `fetchVersions`, pick the accepted final), no polling. Loading → "Loading…".

### 8.5 ForgeMatrixPage (`/forge/:id/matrix`)

Segmented pill at top: **Global library | This run** (the split from Fix 1). `backBtn` → `/forge/:id/results`
(or `/forge` when reached via the top-level alias with no run).

**(a) Global library tab** — the definition table inside an `overflow-x:auto` `card`. CSS-grid columns:
`problem_id · behaviour · layer_for_fix (LayerBadge) · category · winning_lever/how_solved ·
applicability · has_detector · filter_territory`. **User-editable** cells (inline-edit like ScoreboardPage
rename): clicking a cell → input/textarea, save → `patchForgeProblem`. **`filter_territory` is a
human-only toggle** (rendered as a switch the coach can't set — a muted note explains this closes the
gate loophole). An "+ Add problem" button opens a row → `createForgeProblem`. `InfoDot`s on the column
headers explain each field. Rows without `has_detector` show a faint "no detector — excluded from
auto-gate" tag.

**(b) This-run status tab** — the per-run `problem × version` grid (`getForgeRunStatus`). Rows = problems
(only those `in_denominator` bolded; discovered-but-not-counted shown faint below a divider), columns =
versions `v0..vN`. Each cell = `VerdictCell` (Y green / N red / ~ amber). A sticky left column shows
`problem_id` + `LayerBadge`. Header shows the **95%-gate denominator** ("N applicable · snapshot at
launch") and a "**Re-baseline**" button (`rebaselineForgeRun`) with a confirm, since newly discovered
problems don't move the % until an explicit human re-baseline. A right rail shows the **how-solved
narrative** for the selected problem (mono `T.well`), pulled from the version where it flipped to Y.

Horizontal scroll lives inside the card (`overflow-x:auto`), page body never scrolls sideways.

### 8.6 ForgeVersionsPage (`/forge/:id/versions`)

`backBtn` "← Back to results" → `/forge/:id/results`; `<h1>` "Every variation" + muted "Accepted and
reverted — nothing is ever lost." Grid `288px 1fr` (PromptHistoryPage pattern).

- **LEFT list** — all `versions` sorted, each a `role="button"` card; `v{n}` chip, mono version,
  composite (`score100Color`, `—` for candidate-only rows), a `markFor` badge: **Baseline** (v0),
  **↑ accepted** (green) or **↩ reverted** (amber), plus `targeted_problem` + `LayerBadge(layer_for_fix)`.
- **RIGHT detail** (when selected, else "Select a version") — header: Version n + composite + a
  **"↻ Re-run from this version"** button (`rerunForgeVersion` then `nav('/forge/:id/progress')`).
  Then: **Diagnosis** box; **What changed** (`diff_from_previous` summary); the **split diff** via
  `import ReactDiffViewer from 'react-diff-viewer-continued'` with `splitView`, `useDarkTheme`,
  `oldValue={prev.merged_markdown||prev.config}`, `newValue={selected...}`, left/right titles
  `v{prev} (previous)` / `v{selected} (this)`; **the coach's exact edits** — `edits[]` as op-badge rows
  (append/prepend green, replace amber, rewrite blue — the PromptHistoryPage `opColor`/`opBg` map), each
  tagged with its target `LayerBadge`; **how_solved** narrative; and the **adversarial verify** result
  (`verify_json`) as a small pass/refuted chip. v0/baseline shows a raw `<pre>` instead of a diff.

### 8.7 ForgeHumanReviewPage (`/forge/:id/review`) — Phase 2, mandatory

`backBtn` → `/forge/:id/results`. `<h1>` "Human review" + `RunStatusChip` (human_review/finalized) +
muted "The LLM got it to ~{final_composite}. You finish it." Two-column `1fr 360px`: left = the review
canvas, right = a sticky action rail.

**LEFT canvas, top-to-bottom:**
1. **Original vs current** — `ReactDiffViewer` split, `oldValue={run.original_prompt_snapshot}`,
   `newValue={latest merged_markdown/blob}`, dark theme, titles "Original (as given)" / "Current (LLM-
   complete)".
2. **Problems solved vs left** — two columns of chips: solved (`Y`, green, from run status snapshot) and
   left (`N`/`~` or `filter_territory`, amber/red). Each left-problem chip has a **resolved toggle**
   (writes `resolved_toggles` via `saveReview`).
3. **Edits done + HOW each was overcome** — a list, one row per accepted version: `targeted_problem`,
   `LayerBadge`, and the `how_solved` narrative (the lever) — so the human sees exactly how each was
   fixed. Reused from `versions` (accepted only).
4. **Current %** — `SolvedGauge` + `ScoreRing(final_composite)` side by side, with the honest caption
   (plateau / converged_below_gate if applicable).
5. **Reviewer edit box** — a mono `wellArea` `<textarea>` seeded with the current prompt
   (`edited_prompt`), autosaved via `saveReview`.
6. **Live chat panel** — `TranscriptBubbles`-styled thread of `chat_log` (human right, agent left) + an
   input row → `forgeChat(id, {message, history})` appends the agent reply. "Chat with the candidate
   agent to probe it live."

**RIGHT action rail (sticky):**
- **Re-run datasets** button → `forgeEvaluate(id)` (eval-only, no coaching) → refresh scores.
- **Export** button → `exportForgeRun(id)` (download merged markdown + per-layer JSONs + `prompt_ids`).
- **Promote to local library** button → `promoteForgeRun(id)` — with a clear note **"local only — never
  writes production."** Shared-layer promotes show a prominent warning (affects many agents).
- **Finalize run** `btnPrimary` → `finalizeRun(id)` (sets `finalized`, stamps `finalized_at`); confirm
  dialog first.

Loading → "Loading…"; if run isn't `awaiting_human`/`llm_complete`/`human_review`/`finalized` yet, show a
gentle "This run hasn't reached human handoff — it's still {status}." with a link back to progress.

### 8.8 ForgeEscalationsPage / inbox (`/forge/:id/escalations`)

Same `EscalationCard` list the progress page embeds, as a standalone page for when the run is parked.
`backBtn` → progress. Header `<h1>` "Escalations" + count. Each open escalation: `problem_id`,
`LayerBadge` for the layer in question, the coach's **question**, the **options** (radio), the
**rationale**, and an answer form → `answerForgeEscalation`. Answered ones collapse into a muted "resolved"
list showing the recorded answer. Empty → "No open escalations." Shared-layer escalations get the warning
tint (editing universal/vertical affects many agents).

---

## 9 — Cross-page empty / loading / error conventions

- **Loading:** early-return plain "Loading…" text (ScoreboardDetailPage/CallBatchPage pattern), or a
  subtle shimmer for the merge preview only.
- **Empty:** dashed `T.well` card with a gradient SVG icon + heading + CTA (`btnPrimary`) — EvalListPage /
  ScoreboardPage pattern.
- **Error:** inline amber `card` with `borderLeft: 3px solid T.amber` (SttPage engine-offline pattern);
  fatal fetch error on detail pages → early-return "…not found." card + back button
  (ScoreboardDetailPage). SSE drop on progress → show a muted "reconnecting…" and re-open the
  EventSource once.
- **Engine offline:** if any Forge create/stream call rejects with a connection error, surface the same
  amber banner SttPage uses ("the optimizer engine is offline").

---

## 10 — Build order (frontend)

1. **Plumbing:** `forgeStore.ts` + `api.*` Forge block + `forgeStatusMeta`/`verdictMeta` in `theme.ts` +
   new icons; add routes to `App.tsx`; add the **Forge** sidebar group + rename **Old Eval**.
2. **ForgeListPage** — proves store reads, status chips, rename/delete, routing.
3. **ForgeSetupPage (standalone first)** — mode toggle, standalone blob, dataset branch (authored +
   real import), scoring config, `usePersisted` drafts, `createForgeRun` → progress.
4. **ForgeProgressPage** — wire the **SSE** path (`subscribeToForge` + `connectToProgress`), terminal log,
   best-of-N, solved gauge, matrix deltas, tier indicator; embed the escalations strip.
5. **ForgeResultsPage** — reuse `analysis.tsx` primitives end-to-end.
6. **ForgeMatrixPage** — global library (editable) + per-run status grid split.
7. **ForgeVersionsPage** — diff viewer + coach edits + rerun.
8. **Layered mode in Setup** — agent_db import pickers + campaign editor + `MergedPreviewPanel`
   (`mergePreview`), `LayerBadge` everywhere layers surface.
9. **ForgeEscalationsPage** — standalone inbox (component already built in step 4).
10. **ForgeHumanReviewPage (Phase 2)** — original-vs-current diff, solved/left, edits+how, live chat
    (`forgeChat`), evaluate/export/promote/finalize.

This order lets standalone-mode E2E (steps 1–5,7) light up before the heavier layered + Phase-2 work,
matching the plan's phased backend delivery.

---

## 11 — Notes / open questions for the backend contract

- SSE event names in §4/§8.3 (`candidate_start`, `sample_scored`, `version_accepted`, `matrix_delta`,
  `escalation_opened`, `milestone_stress`, `deepeval_done`, `run_complete`) are the frontend's assumed
  contract — confirm against the engine's `forge/routes.py` emitter so `connectToProgress` folds them
  correctly.
- `mergePreview` must return `{markdown, greeting, flow_stage, merged_object}` synchronously for the live
  preview; if it's expensive, debounce ~400ms (already assumed) and cache by the layer-id + lead_status
  + direction tuple.
- `getForgeRunStatus` should return both the pinned denominator (`in_denominator`) and discovered-but-
  uncounted problems so the matrix can render them below the divider without a second call.
- Confirm `filter_territory` is rejected by `patchForgeProblem` when set by anything but a human action
  (UI enforces human-only, backend must too — closes the gate loophole from Fix 4).
</content>
</invoke>

---

# API DELTA — post schema-consolidation (authoritative over the method list above)

The backend was built with the consolidated 4-table schema (forge_runs / forge_versions /
forge_problems / forge_events). Adjust the api.* methods to the REAL endpoints:

- Layer library: `GET /api/forge/layers?type=universal|vertical|campaign|addon` →
  `{configured, db_name, rows:[{id, prompt_type, friendly_name}]}` (read-only from agent_db_dev,
  same Postgres). Full row: `GET /api/forge/layers/:id`. There is NO local library and NO
  POST /layers — a campaign is pasted inline in the createRun body
  (`layers.campaign = {source:'pasted', prompt, override_keys?}`; imports use
  `{source:'agent_db', id}`).
- Escalations: stored on the run row (`escalations_json`). Answer via
  `POST /api/forge/runs/:id/escalations/:escId/answer {answer}`. No standalone escalations table/page
  needed — read them from `GET /runs/:id` (`escalations` key).
- Human review: `GET/POST /api/forge/runs/:id/review` reads/writes `review_json`
  (`{reviewer_notes, resolved, edited_prompt, chat_log, finalized_at}`); pass `finalize:true` to
  finalize. Export: `POST /api/forge/runs/:id/export` → `{merged_markdown, greeting, config,
  solved_pct, composite}` (no promote-to-library — export only).
- Matrix page: global definitions from `GET /api/forge/problems` (+ PATCH/POST); the per-run grid
  from `GET /api/forge/runs/:id/matrix` → `[{version, status, statuses_json:{pid:{verdict,evidence}}}]`.
- Run detail `GET /runs/:id` returns `{...run, versions[], escalations[], review{}, layers[]}`;
  probes are `probes_json` on the run. `solved_pct` and `final_composite` are separate run columns.
- Live progress: poll `GET /runs/:id/log?after=<id>` (forge_events cursor) or engine SSE
  `GET :8002/api/forge/:id/stream`.
