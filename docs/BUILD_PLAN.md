# Agent Eval — Full Build Plan (Call Analysis · Test STT · Flow Builder · Settings)

Built to match the design 1:1 (minus the meaningless buttons Claude over-added) and your house backend style (sales + automation lab). Optimal Postgres: **few tables, JSONB-heavy**.

## 1. Architecture (keep the existing split, extend it)
```
Frontend (Vite + React, React Flow v11)  ──HTTP──▶  Node backend (Express + Sequelize + Joi, house style)
                                                        │  owns DB (Postgres, JSONB) + orchestration + BullMQ
                                                        ▼
                                              Python engine (FastAPI)  — all LLM / STT / flow-gen compute
                                              (reuses LLMClient, Judge, Soniox; judge model swappable)
```
- **Node backend = your house style** (Express + Sequelize 6 + Joi, snake_case, `timestamps:false` + explicit `created_at/updated_at`, UUID PKs, JSONB `DEFAULT '[]'::jsonb`, GIN indexes, CHECK-as-STRING enums, sequelize-cli migrations `YYYYMMDD######-verb-subject.js`, layering `route → authenticate → validateRequest(joi) → controller → model`).
- **Python engine** does the model work (Call-Analysis scoring, Soniox+WER/CER, Gemma flow-gen) and posts results back for the Node backend to store — same Node↔engine pattern already in place, and same as your sales `dispatcher → queue → service` pipeline.

### Decision to confirm
The current Node backend is **TypeScript + raw `pg`**. To match your sales/automation style you asked for, I'll **rebuild it as Express + Sequelize 6 + Joi (plain JS)** and wrap the 4 existing eval tables in Sequelize models + a baseline migration (no data loss — same tables). This makes the whole backend one consistent house-style codebase.

## 2. Database — optimal schema (snake_case, UUID PKs, JSONB)
Existing (keep tables, add Sequelize models + baseline migration): `evals`, `prompt_versions`, `scenario_results`, `eval_events`.

New tables (mirroring your `call_outcomes` style — CHECK enums, JSONB defaults, GIN, lifecycle status):

**Call Analysis**
- `call_batches` — `id UUID PK`, `name`, `direction TEXT CHECK(inbound|outbound|followup|mixed)`, `status TEXT CHECK(pending|running|completed|failed) DEFAULT 'pending'`, `agent_config JSONB`, `tools JSONB DEFAULT '[]'`, `summary JSONB DEFAULT '{}'`, `flow_id UUID REFERENCES flows(id)`, `created_at`, `updated_at`. idx: status, created_at.
- `call_analyses` — `id UUID PK`, `batch_id UUID REFERENCES call_batches ON DELETE CASCADE`, `call_ref`, `direction`, `overall_score REAL`, `verdict TEXT CHECK(perfect|pass|good|poor|fail)`, `transcript JSONB DEFAULT '[]'`, `sections JSONB DEFAULT '[]'` (6 sections: name/score/verdict/quotes/reasoning), `metrics JSONB DEFAULT '{}'` (5 metrics), `tool_eval JSONB DEFAULT '{}'`, `flow_adherence JSONB DEFAULT '{}'`, `improvements JSONB DEFAULT '[]'`, `analyzed_at TIMESTAMPTZ`, `created_at`. idx: batch_id, verdict, GIN(improvements).

**Test STT**
- `stt_batches` — `id UUID PK`, `mode TEXT CHECK(single|batch)`, `status`, `summary JSONB DEFAULT '{}'`, `created_at`.
- `stt_results` — `id UUID PK`, `batch_id UUID REFERENCES stt_batches ON DELETE CASCADE`, `file`, `language TEXT CHECK(en|hi|te)`, `model`, `reference TEXT`, `hypothesis TEXT`, `wer REAL`, `cer REAL`, `match_pct REAL`, `verdict TEXT CHECK(perfect|good|poor|error)`, `diff JSONB DEFAULT '[]'`, `error TEXT`, `created_at`. idx: batch_id, verdict.

**Flow Builder** (mirrors automation-lab `flows`)
- `flows` — `id UUID PK`, `name`, `namespace`, `version INT DEFAULT 1`, `is_active BOOL DEFAULT true`, `source_text TEXT`, `definition JSONB DEFAULT '{}'` (`{nodes[], execEdges[], lanes}`), `status`, `created_at`, `updated_at`. UNIQUE(namespace,name,version).

**Settings**
- `app_settings` — singleton (`id INT PK DEFAULT 1`), `tools_enabled JSONB DEFAULT '[]'`, `appearance JSONB DEFAULT '{}'`, `updated_at`.
- `llm_endpoints` — `id UUID PK`, `name`, `base_url`, `model`, `kind TEXT CHECK(agent|judge|coach)`, `status TEXT CHECK(untested|connected|failed) DEFAULT 'untested'`, `last_checked_at`, `created_at`. (Backs the "Test an LLM" page.)

→ 7 new tables. No per-metric/per-section tables; all variable/nested data in JSONB, queried by the few real columns.

## 3. Backend (house style, per module)
Files: `src/config/{database,queue}.js`, `src/models/{index,<Model>}.js`, `src/controllers/<res>Controller.js`, `src/routes/<res>.js`, `src/middleware/validation.js` (Joi `validateRequest` + `schemas`), `src/services/*` (dispatch to Python engine), BullMQ processors for async scoring.
Routes: `/api/evals` (existing) · `/api/call-batches` (+`/:id/analyze`, `/:id/analyses`) · `/api/stt` (+`/run`, `/results`) · `/api/flows` (+`/generate`) · `/api/settings` · `/api/llm-endpoints` (+`/:id/test`).

## 4. Python engine additions (reuse LLMClient/Judge)
- `POST /api/analyze-call` — score one transcript → 6 sections (+quotes+reasoning), 5 metrics, tool-eval (call-level from tool logs), flow-adherence (vs the flow's stages), improvements. **Judge stubbed** until a model is connected (returns a "pending" shape).
- `POST /api/stt-compare` — run Soniox (streaming WS, 16k mono, diarized) on audio → hypothesis; compute WER + CER (jiwer) + word-diff vs the human reference; verdict per language.
- `POST /api/flow-generate` — Gemma turns pasted JSON/MD/text → `definition` graph (`nodes[] + execEdges[]`, kinds stage/branch/tool-call/end, branches via named exec-pins); validate shape.

## 5. Frontend (Vite React — imitate the design)
- **Shell + theme:** port the design tokens (`--bg0 #14110e`, ember accent, pass/warn/fail/run/violet), General-Sans + JetBrains Mono; build the **left sidebar** + a router for the real routes (`home/history/new/progress/results/report/voice/analyze/batches/scoreboard/stt/flow/settings/llm/judge/system`). Drop the meaningless buttons.
- **Per page:** port each page's markup from `Agent Eval App.dc.html` (I read it directly), wire to the Node API. Reuse existing Monaco/Recharts/diff-viewer where the design keeps them.
- **Flow Builder:** React Flow v11 + reuse automation-lab `frontend/src/editor/serialize.js` (`defToGraph` auto-layout, `graphToDef`) for canvas ⇄ JSON.

## 6. Phasing (build order)
- **P0** — Backend house-style scaffold (Sequelize config, models/index, baseline migration for the 4 eval tables) + frontend shell/sidebar/theme/router.
- **P1** — Re-skin Prompt-Eval pages (already functional via the engine) to the design.
- **P2** — Test STT: tables + routes + Python `stt-compare` + STT page (single + batch, diff, WER/CER). **Fully working now** (no judge needed).
- **P3** — Call Analysis: tables + routes + BullMQ + Python `analyze-call` (judge stubbed) + Analyze→Batches→Scoreboard→Report pages.
- **P4** — Flow Builder: `flows` + routes + Python `flow-generate` (Gemma) + React Flow page.
- **P5** — Settings + Test-an-LLM: `llm_endpoints`/`app_settings` + connect/test → flip the judge on → Call-Analysis scoring goes live.
