# agent-eval — Project Overview

A closed-loop **evaluation and self-improvement harness for voice AI agents**.

You give it (1) a system prompt for a voice agent and (2) a set of test scenarios. It runs the
agent through every scenario against an LLM, has a second "judge" LLM score each conversation on
five dimensions plus deterministic voice-quality checks, then has a third "resolver" LLM **rewrite
the system prompt to fix the failures** — and repeats, iteration after iteration, until the average
score crosses a quality threshold or it runs out of iterations. Live progress streams to a web UI;
every prompt version, transcript, and score is persisted for inspection afterward.

The concrete agent under test is **"Aanya," a warm, honest insurance pre-sales advisor for "Beta
Insurance"** in the Indian market — multilingual (English / Hindi / Telugu code-switching),
voice-only, non-closing. The whole system is purpose-built around the hard parts of a voice sales
agent: brevity, no markdown/digits (output is spoken via TTS), language mirroring, empathy, and not
being pushy.

---

## Table of contents

1. [High-level architecture](#high-level-architecture)
2. [Repository layout](#repository-layout)
3. [The core evaluation loop](#the-core-evaluation-loop)
4. [Engine (Python / FastAPI)](#engine--python--fastapi)
5. [Backend (TypeScript / Express)](#backend--typescript--express)
6. [Frontend (React / Vite)](#frontend--react--vite)
7. [The domain — Aanya & the test data](#the-domain--aanya--the-test-data)
8. [Scoring model](#scoring-model)
9. [Event flow & API reference](#event-flow--api-reference)
10. [Database schema](#database-schema)
11. [Configuration & ports](#configuration--ports)
12. [Running it locally](#running-it-locally)
13. [Notes, gotchas & observations](#notes-gotchas--observations)

---

## High-level architecture

Three services plus a Postgres database. The data flow is a clean relay.

```
┌──────────────┐   POST /api/evals    ┌─────────────────┐  POST /api/eval/start  ┌──────────────────┐
│  frontend    │ ───────────────────▶ │   backend       │ ─────────────────────▶ │   engine         │
│ React/Vite   │   SSE /events        │  Node/Express   │   callback_url         │  Python/FastAPI  │
│  :5173       │ ◀─────────────────── │  TS  :3001      │ ◀───────────────────── │   :8002          │
└──────────────┘   live progress      └────────┬────────┘  POST eval-events      └────────┬─────────┘
                                                │          (engine → backend)              │
                                          ┌─────▼─────┐                          ┌─────────▼──────────┐
                                          │ Postgres  │                          │  LLM (OpenAI-compat │
                                          │  :6666    │                          │  vLLM/Gemma) + RAG  │
                                          └───────────┘                          └────────────────────┘
```

- **engine/** (Python, FastAPI, :8002) — the brain. Runs conversations, judges them, rewrites
  prompts. Holds in-flight evals in memory and streams events.
- **backend/** (TypeScript, Express, :3001) — the orchestrator + system of record. Owns the Postgres
  schema, dispatches evals to the engine, receives the engine's event callbacks, persists everything,
  and re-broadcasts to the browser over SSE.
- **frontend/** (React 19 + Vite + Zustand, :5173) — the UI: set up an eval, watch live progress,
  browse results, diff prompt versions, view a dedicated voice-quality report.
- **test_data/** — the Aanya system prompt and two scenario suites.

End-to-end path:
**frontend → backend (DB write + dispatch) → engine (runs eval, POSTs events back) →
backend (`/api/internal/eval-events` persists + broadcasts) → frontend (SSE updates)**.

> The engine *also* exposes its own SSE stream (`/api/eval/{id}/stream`), but in the wired-up path
> the browser subscribes to the **backend's** SSE, which is fed by the engine's HTTP callbacks.

---

## Repository layout

```
agent-eval/
├── engine/                          # Python FastAPI evaluation engine
│   ├── requirements.txt             # fastapi, uvicorn, openai, httpx, pydantic
│   └── src/
│       ├── main.py                  # FastAPI app, CORS, /health, mounts router
│       ├── config.py                # LLM endpoint, defaults (temps, concurrency, thresholds)
│       ├── api/
│       │   ├── routes.py            # /api/eval/{start,status,results,stop,stream}
│       │   └── schemas.py           # Pydantic: EvalConfig, RAGConfig, EvalStartRequest
│       ├── core/
│       │   ├── eval_runner.py       # EventBus + EvalRunner: the iterate→judge→resolve loop
│       │   ├── conversation.py      # single_turn / multi_turn / simulated conversation modes
│       │   ├── judge.py             # LLM judge over 5 dimensions + outcome judge
│       │   ├── resolver.py          # rewrites the system prompt from failure analysis
│       │   └── voice_analyzer.py    # regex voice-quality checks (TTS-friendliness)
│       ├── llm/
│       │   ├── client.py            # AsyncOpenAI wrapper, global concurrency semaphore
│       │   └── prompts.py           # judge / resolver / user-persona / outcome prompts
│       ├── scoring/
│       │   ├── calculator.py        # dimension weights, penalties, composite score
│       │   └── criteria.py          # dimension + penalty metadata (reference)
│       ├── tools/
│       │   ├── definitions.py       # 9 voice-tool JSON schemas
│       │   └── simulator.py         # mock tool execution (+ real date calc, RAG search)
│       ├── rag/client.py            # optional knowledge-base search client
│       └── context/builder.py       # dynamic context injection (date/time, lead info)
│
├── backend/                         # TypeScript Express orchestrator + DB
│   ├── package.json                 # express, pg, nanoid, diff, cors, dotenv (tsx/tsc)
│   ├── .env                         # DATABASE_URL, ENGINE_URL, SELF_URL, PORT
│   └── src/
│       ├── index.ts                 # app bootstrap, migrate(), route mounting
│       ├── config.ts                # port, engineUrl, databaseUrl, selfUrl
│       ├── db/
│       │   ├── connection.ts        # pg Pool
│       │   └── schema.ts            # CREATE TABLE migrations + indexes
│       ├── routes/
│       │   ├── evals.ts             # create/list/get/results/stop/delete/rerun
│       │   ├── prompts.ts           # prompt versions + diffs
│       │   └── progress.ts          # SSE to browser + /internal/eval-events callback sink
│       ├── services/
│       │   ├── evalOrchestrator.ts  # dispatchEval / stopEval → engine HTTP calls
│       │   └── promptStore.ts       # store prompt versions, compute unified diffs
│       └── types/index.ts           # shared TS interfaces
│
├── frontend/                        # React 19 + Vite + Zustand
│   ├── package.json                 # react-router, zustand, recharts, monaco, diff-viewer
│   ├── vite.config.ts               # :5173, proxies /api → :3001
│   └── src/
│       ├── App.tsx                  # router + nav (6 routes)
│       ├── main.tsx                 # React root
│       ├── api/client.ts            # fetch wrapper + SSE subscription
│       ├── stores/evalStore.ts      # Zustand store, SSE lifecycle, live progress
│       ├── pages/
│       │   ├── EvalListPage.tsx     # all evals
│       │   ├── EvalSetupPage.tsx    # Monaco editors for prompt + scenarios, config panel
│       │   ├── EvalProgressPage.tsx # live progress (auto-redirects to results when done)
│       │   ├── ResultsDashboard.tsx # scenario table, expandable transcripts + per-dim scores
│       │   ├── PromptHistoryPage.tsx# version list + side-by-side diff + re-run
│       │   └── VoiceReportPage.tsx  # voice-issue charts + detailed issue table
│       └── components/
│           ├── ConfigPanel.tsx      # iterations, threshold, tools, dynamic context, RAG
│           ├── ProgressTracker.tsx  # iteration/scenario progress + score line chart
│           ├── ScoreCard.tsx        # colored percentage card
│           └── TranscriptViewer.tsx # chat-bubble transcript
│
└── test_data/
    ├── aanya_system_prompt.json     # the Aanya agent definition (~55 behavioral rules)
    ├── aanya_beta_scenarios.json    # 23-scenario beta set
    └── aanya_full_eval.json         # ~70-scenario full eval suite
```

---

## The core evaluation loop

Implemented in `engine/src/core/eval_runner.py` → `EvalRunner.run()`.

```
seed prompt_versions with v0 (original prompt)
filter scenarios by included/excluded
for iteration in 1..max_iterations:
    if stopped: break
    emit iteration_start
    full_prompt = current_prompt (+ dynamic context if enabled)
    scenario_results = run ALL scenarios concurrently   # Semaphore(concurrent_scenarios)
    judged = [judge.evaluate(r) for r in scenario_results]
        emit scenario_complete per scenario
    iteration_score = mean(composite_scores)
    emit iteration_complete (carries full judged results)
    if iteration_score >= quality_threshold:
        emit threshold_met; break
    if iterations remain:
        improved_prompt, changes = resolver.improve(current_prompt, judged, iteration)
        current_prompt = improved_prompt
        append new prompt_version
        emit prompt_improved
emit eval_complete (final_score, prompt_versions, last results, status)
```

Key properties:

- **Scenarios run concurrently** within an iteration, bounded by `concurrent_scenarios`
  (`asyncio.Semaphore`), and globally bounded by the LLM client's concurrency semaphore.
- **Each iteration produces a new, improved prompt** unless the threshold is met or it's the last
  iteration. This is the self-improvement loop — the system literally tunes the prompt for you.
- **Stop is cooperative** — `runner.stop()` sets a flag checked between iterations/scenarios.
- Engine eval state lives in memory (`active_evals`, `eval_results` dicts in `api/routes.py`); the
  durable record is in Postgres via the backend's event callbacks.

### Scenario type detection (`_detect_type`)

| Key present      | Type         | Behavior                                                              |
|------------------|--------------|----------------------------------------------------------------------|
| `type` explicit  | as specified | honored first                                                        |
| `question`       | single_turn  | one user message → one agent reply (tools supported)                 |
| `turns`          | multi_turn   | scripted customer lines; agent replies each turn (tools supported)   |
| else             | simulated    | a 2nd LLM role-plays the customer from `user_persona`, back-and-forth |

### Conversation modes (`engine/src/core/conversation.py`)

- **single_turn** — system prompt + (optional RAG injection) + the user `question`; one agent
  response; tool-call loop handled if the model calls tools.
- **multi_turn** — iterates scripted `turns[].customer`; agent replies each turn; records expected
  behavior / expected tools / max length per turn.
- **simulated** — the realistic one. A **second LLM plays the customer** (`USER_PERSONA_WRAPPER`,
  temp 0.7), the agent answers (temp 0.3), alternating up to `max_turns`. The user-LLM ends the call
  by emitting `[END]`. Supports inbound (agent greets, user reacts) and outbound (user reacts to a
  greeting). `_strip_thinking()` scrubs `<think>…</think>` and stray tags from agent output.

---

## Engine — Python / FastAPI

### `main.py` / `config.py`
- FastAPI app, permissive CORS, `/health`, mounts the `/api` router.
- Defaults: LLM base URL `http://16.112.145.206:8000/v1`, model `/models/gemma4-awq`, API key
  `EMPTY` (self-hosted vLLM-style endpoint). Temperatures: agent 0.3, judge 0.1, resolver 0.3,
  user 0.7. Max tokens: 300 default, **16000 for the resolver**. Concurrency: 4 scenarios, 8 LLM calls.

### `llm/client.py`
- `AsyncOpenAI` wrapper. A **class-level global semaphore** caps total LLM concurrency at 8 across
  all roles (agent/user/judge/resolver) — shared so a big eval can't overwhelm the endpoint.
- `chat()` for normal/tool calls; `chat_json()` robustly extracts JSON from messy output (strips
  ```` ```json ```` fences, regex-matches the first `{…}` block), raising `ValueError` on failure.

### `core/judge.py` + `llm/prompts.py`
- An LLM scores five dimensions as JSON: **factual_accuracy, voice_friendliness, human_likeness,
  tool_correctness, response_quality**, plus a structured `issues[]` list (dimension, description,
  severity, turn) and a one-line `summary`.
- `tool_correctness` is **recomputed deterministically** (F1 of expected vs actual tools) when a
  multi_turn scenario declares `expected_tools`.
- For simulated scenarios with an `expected_outcome`, a separate **outcome judge**
  (`OUTCOME_JUDGE_PROMPT`) decides if the outcome was reached and blends it 50/50 into
  response_quality. Outcome vocabulary: `callback_scheduled`, `callback_offered`, `warm_exit`,
  `audit_offered`, `second_opinion_offered`, `interest_shown`, `empathy_mode`, `challenge_used`,
  `warm_open`.
- On JSON-parse failure the judge falls back to neutral 0.5 scores.

### `core/voice_analyzer.py` — deterministic voice-quality checks
Not everything is left to the LLM judge. Regex detection because output is spoken via TTS:

| Issue          | What it catches                                                       |
|----------------|-----------------------------------------------------------------------|
| thinking_leaks | `<think>`, `<thought>`, `<response>`, `<\|channel\|>`, "Thinking Process:", stray XML-ish tags |
| markdown       | `**bold**`, `*italic*`, bullet/numbered lists, code fences, headers, links |
| digit_issues   | any run of ≥2 digits (numbers must be spoken as words)                |
| emoji_issues   | emoji unicode ranges                                                  |
| length_issues  | response longer than the turn's `max_response_length` (default 300)   |

Each becomes a **score penalty** (see [Scoring model](#scoring-model)).

### `core/resolver.py` — the self-improvement engine
Builds a detailed **failure analysis** and asks an LLM to produce an improved prompt:
- Aggregates judge `issues` by dimension; totals voice violations (thinking leaks, markdown, digits,
  length); lists failing scenarios (composite < 0.85); and **dumps the actual transcripts of the 10
  worst failures** so the model can see exactly where the agent got stuck.
- `RESOLVER_PROMPT_TEMPLATE` is voice-agent-specific guidance: add "never use markdown", "spell out
  numbers", add escape hatches for deflection/empathy loops, etc.
- Tracks `_previous_changes` and instructs the model **not to revert** earlier fixes.
- Returns `{improved_prompt, changes_summary}`; on parse failure, keeps the current prompt.

### `tools/` — simulated voice tools
Nine tools defined in `definitions.py`: `end_call`, `voicemail_detected`, `warm_transfer_call`,
`switch_agent`, `search_knowledge_base`, `send_whatsapp_template`, `date_calculator`,
`handle_call_screening`, `irrelevant_interruption`.
`simulator.py` returns canned mock responses, except:
- `date_calculator` actually computes calendar dates in `Asia/Kolkata` from expressions like
  "next Monday".
- `search_knowledge_base` calls the real RAG client when configured.

### `rag/client.py` & `context/builder.py`
- **RAG** — optional knowledge-base search (`POST {server}/search` with collection, search_type,
  top_k, alpha, rerank). Injected as a system message before the agent answers, and used by the
  `search_knowledge_base` tool. Fails open (returns `[]` on error).
- **ContextBuilder** — when `dynamic_context_enabled`, prepends current IST date/time plus lead
  info (name, status, extracted data, follow-up reason, summary, call notes, WhatsApp notes) to the
  system prompt — simulating a real CRM-driven call.

---

## Backend — TypeScript / Express

- **`index.ts`** — runs `migrate()` then listens; mounts routers under `/api/evals` and `/api`.
- **`routes/evals.ts`** — `POST /` create (nanoid id, inserts eval row + v0 prompt, dispatches to
  engine), `GET /` list, `GET /:id`, `GET /:id/results` (optionally per-iteration), `POST /:id/stop`,
  `DELETE /:id`, **`POST /:id/rerun`** (fork a new eval starting from any historical prompt version).
- **`routes/progress.ts`** — two responsibilities:
  - `GET /:id/events` — **SSE to the browser** (keeps a `Map<evalId, Set<Response>>`).
  - `POST /internal/eval-events` — **the sink for the engine's callbacks**. Persists `eval_events`
    rows; on `iteration_complete` updates the eval + inserts `scenario_results`; on
    `prompt_improved`/`eval_complete` stores prompt versions; then **broadcasts to subscribed
    browsers**.
- **`services/evalOrchestrator.ts`** — `dispatchEval` POSTs to the engine's `/api/eval/start` with a
  `callback_url` pointing back at `${SELF_URL}/api/internal/eval-events`; `stopEval` hits the engine's
  stop endpoint.
- **`services/promptStore.ts`** — stores prompt versions and computes **unified diffs** between
  consecutive versions (the `diff` npm package) for the UI's diff viewer. Upserts on
  `(eval_id, version)` conflict.

---

## Frontend — React / Vite

Single-page app, six routes (`App.tsx`), dark theme, inline styles.

| Route                     | Page                  | Purpose                                                              |
|---------------------------|-----------------------|----------------------------------------------------------------------|
| `/`                       | EvalListPage          | list all evals with status + final score, links to progress/results |
| `/new`                    | EvalSetupPage         | Monaco editors for prompt + scenarios JSON, file upload, ConfigPanel |
| `/eval/:id/progress`      | EvalProgressPage      | live SSE progress; auto-redirects to results when complete           |
| `/eval/:id/results`       | ResultsDashboard      | scenario table, expandable rows (judge reasoning, per-dim scores, transcript) |
| `/eval/:id/prompts`       | PromptHistoryPage     | version list + side-by-side diff viewer + "re-run from this version" |
| `/eval/:id/voice`         | VoiceReportPage       | bar charts of voice issues per scenario + detailed issue table       |

- **State** — one Zustand store (`evalStore.ts`) holding eval list, current eval, scenario results,
  prompt versions, live progress, and the SSE `EventSource`. `connectToProgress` translates
  `iteration_start` / `scenario_complete` / `iteration_complete` / `eval_complete` events into UI
  state and refetches everything when the eval completes.
- **API client** (`api/client.ts`) — thin fetch wrapper + `subscribeToEvents` (EventSource).
- **Config panel** exposes: max iterations, quality threshold (slider), tools toggle, dynamic
  context toggle, and RAG (server URL + collection).
- Charts via Recharts; prompt editing via Monaco; diffs via `react-diff-viewer-continued`.
- Vite dev server (:5173) proxies `/api` → `:3001`.

---

## The domain — Aanya & the test data

The agent under test is **Aanya, an honest insurance pre-sales advisor for "Beta Insurance"**
(brand: *Insurance with Honesty*), targeting the Indian market.

### `aanya_system_prompt.json`
A sophisticated voice-agent definition with ~55 behavioral guidelines plus output rules,
conversation flows (inbound/outbound/follow-up, staged), and objection-handling playbooks. Highlights:

- **Advisor, not a closer** — educates, audits, comforts, qualifies, opens a connection; a human
  does the actual quote/close. Never gives firm numbers or guarantees a claim.
- **Brevity is the prime rule** — one short sentence the norm, two max; "the real failure mode is
  talking too much."
- **Voice-first** — spoken-only output, no markdown/digits/emoji; numbers softened and spelled out.
- **Language mirroring with zero inertia** — English/Hindi/Telugu; switch the instant the customer
  does. "Tenglish/Hinglish" = mostly English words with native glue; insurance nouns + numbers always
  in English; correct script per language; long lists of **banned bookish Hindi/Telugu words** and
  **banned bot words** ("got it", "certainly", "absolutely", …).
- **Empathy never fear**; never name-and-shame insurers; bless existing relationships (the "free
  second opinion" wedge); never push past a no; never deny being AI but never volunteer it.
- **RAG-grounded** — all facts come from retrieved knowledge base; otherwise "I don't know" + defer.

### Scenario suites
- **`aanya_beta_scenarios.json`** — 23 scenarios (single/multi/simulated) covering pricing, add-ons,
  providers, disclosure, audit, sensitive-data refusal, tax, "I don't know", no-cover education, the
  relationship objection, employer-cover diagnosis, and simulated personas (busy, curious, smug
  challenger, vulnerable widow, not-interested, Hindi/Telugu switch, privacy-angry, already-insured).
- **`aanya_full_eval.json`** — ~70 scenarios, a much broader stress test: closings/warmth, pricing
  under pressure, product knowledge, guardrails, full Hindi/Telugu conversations + closings +
  objections, language-switch with zero inertia, garbled-STT/wrong-script handling, brevity/word-count,
  no-echo, bridge-don't-interrupt, silence, energy-matching (brisk/chatty), mentor-vs-friend,
  natural-fillers, fused empathy, WhatsApp-contradiction, digit-check, markdown-check.

Each scenario carries `pass_criteria` / `fail_criteria` and (for simulated) an `expected_outcome`,
which feed the judge and outcome judge.

---

## Scoring model

`engine/src/scoring/calculator.py`.

**Dimension weights** (judge scores, each 0.0–1.0):

| Dimension          | Weight |
|--------------------|--------|
| factual_accuracy   | 0.25   |
| voice_friendliness | 0.20   |
| human_likeness     | 0.15   |
| tool_correctness   | 0.15   |
| response_quality   | 0.25   |

**Voice penalties** (subtracted from the weighted base, each capped):

| Issue          | Per occurrence | Cap  |
|----------------|----------------|------|
| thinking_leak  | 0.15           | 0.50 |
| markdown       | 0.05           | 0.30 |
| digit          | 0.03           | 0.20 |
| length         | 0.05           | 0.20 |
| emoji          | 0.05           | 0.15 |

```
base      = Σ (judge_score[dim] × weight[dim])
penalties = Σ min(count × per_occurrence, cap)
composite = round(max(0.0, base − penalties), 4)
iteration_score = mean(composite over scenarios)
```

**Tool score** (`compute_tool_score`): no tools expected & none called → 1.0; none expected but some
called → 0.5; otherwise F1 of the expected vs actual tool-name sets.

UI thresholds: composite ≥ 0.7 counts as **PASS**; color bands green ≥ 0.8, amber ≥ 0.6, red below.

---

## Event flow & API reference

### Engine events (emitted by `EventBus`, POSTed to the backend callback)
`iteration_start` · `scenario_complete` · `iteration_complete` (carries judged results) ·
`prompt_improved` · `threshold_met` · `eval_complete`.

### Engine HTTP API (`:8002`, prefix `/api`)
| Method | Path                      | Purpose                               |
|--------|---------------------------|---------------------------------------|
| POST   | `/api/eval/start`         | start an eval (async background task)  |
| GET    | `/api/eval/{id}/status`   | running / completed / failed           |
| GET    | `/api/eval/{id}/results`  | final result object                    |
| POST   | `/api/eval/{id}/stop`     | cooperative stop                       |
| GET    | `/api/eval/{id}/stream`   | engine-native SSE (standalone/debug)   |
| GET    | `/health`                 | health check                           |

### Backend HTTP API (`:3001`)
| Method | Path                                   | Purpose                                  |
|--------|----------------------------------------|------------------------------------------|
| POST   | `/api/evals`                           | create + dispatch an eval                |
| GET    | `/api/evals`                           | list evals                               |
| GET    | `/api/evals/:id`                       | eval detail                              |
| GET    | `/api/evals/:id/results?iteration=`    | scenario results                         |
| POST   | `/api/evals/:id/stop`                  | stop                                     |
| DELETE | `/api/evals/:id`                       | delete (cascade)                         |
| POST   | `/api/evals/:id/rerun`                 | fork from a prompt version               |
| GET    | `/api/evals/:id/prompts`               | prompt versions                          |
| GET    | `/api/evals/:id/prompts/:version/diff` | diff vs previous version                 |
| GET    | `/api/evals/:id/events`                | **SSE to browser**                       |
| POST   | `/api/internal/eval-events`            | **engine → backend callback sink**       |
| GET    | `/health`                              | health check                             |

---

## Database schema

Four tables (`backend/src/db/schema.ts`), all keyed to `evals` with `ON DELETE CASCADE`.

- **evals** — `id` (text PK), `status`, `original_prompt`, `scenarios_json`, `config_json`,
  `final_score`, `iterations_run`, `max_iterations`, `quality_threshold`, timestamps, `error_message`.
- **prompt_versions** — `(eval_id, version)` unique; `prompt_text`, `score`, `changes_summary`,
  `diff_from_previous`.
- **scenario_results** — per iteration/scenario: `response_text`, `transcript_json`,
  `tool_calls_json`, `scores_json`, `voice_analysis_json`, `judge_reasoning`, `composite_score`.
- **eval_events** — raw `event_type` + `event_data` audit log.

Indexes on `prompt_versions(eval_id)`, `scenario_results(eval_id, iteration)`, `eval_events(eval_id)`.

---

## Configuration & ports

| Service  | Port  | Key env / config                                                            |
|----------|-------|-----------------------------------------------------------------------------|
| frontend | 5173  | `VITE_API_URL` (default `http://localhost:3001`); proxies `/api` → :3001     |
| backend  | 3001  | `DATABASE_URL`, `ENGINE_URL` (`http://localhost:8002`), `SELF_URL`, `PORT`   |
| engine   | 8002* | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `CALLBACK_BASE_URL`              |
| postgres | 6666  | DB `agent_eval` (backend `.env`: `postgres:admin@localhost:6666`)            |

\* The engine's listen port is set by however uvicorn is launched; the backend expects it at `:8002`.

LLM defaults (engine `config.py`): self-hosted OpenAI-compatible endpoint
`http://16.112.145.206:8000/v1`, model `/models/gemma4-awq`. Per-role temperatures and token limits
as listed in [Engine](#engine--python--fastapi).

---

## Running it locally

> Inferred from `package.json` scripts and configs — adjust to your environment.

```bash
# 1. Postgres (DB: agent_eval) on :6666, matching backend/.env

# 2. Engine (Python, FastAPI)  →  :8002
cd engine
pip install -r requirements.txt
uvicorn src.main:app --port 8002 --reload
#   point it at your LLM endpoint via LLM_BASE_URL / LLM_MODEL / LLM_API_KEY

# 3. Backend (Node/Express)  →  :3001  (runs DB migrations on boot)
cd backend
npm install
npm run dev            # tsx watch src/index.ts

# 4. Frontend (Vite)  →  :5173
cd frontend
npm install
npm run dev
```

Then open the UI, paste a system prompt + scenarios JSON (or upload one from `test_data/`),
configure iterations/threshold, and start an eval.

---

## Notes, gotchas & observations

- **Secret in repo** — `backend/.env` contains a DB password (`postgres:admin`). Consider rotating /
  gitignoring it.
- **Two SSE paths** — the engine exposes its own `/api/eval/{id}/stream`, but the production path uses
  the **backend's** SSE fed by engine HTTP callbacks. The engine stream is effectively standalone/debug.
- **In-memory engine state** — `active_evals` / `eval_results` live in process memory; an engine
  restart mid-eval loses in-flight state (the backend DB keeps whatever events were already persisted).
- **Port wiring is spread across files** — engine port (uvicorn launch), `backend/.env` `ENGINE_URL`,
  and engine `CALLBACK_BASE_URL` must agree. Defaults are consistent (engine :8002, backend :3001).
- **Robust-but-loose JSON parsing** — judge/resolver rely on `chat_json()` regex extraction; on
  failure the judge falls back to neutral 0.5s and the resolver keeps the current prompt, so a flaky
  LLM degrades gracefully rather than crashing the eval.
- **Deterministic + LLM scoring combined** — voice quality is caught by regex penalties (cheap,
  reliable) while subjective quality is judged by an LLM; tool correctness is recomputed
  deterministically. This hybrid is the design's core strength for voice agents.
- **The frontend README is the stock Vite template** — not project documentation (this file is).
- **Assets** — `frontend/src/assets/hero.png` plus stock Vite/React SVGs; no logic.
```
