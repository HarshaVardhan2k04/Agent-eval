# Agent Eval — Full App Design Spec (functional + visual)

> Extend the **Agent Eval** page you already built (the clickable Evaluations/History screen, warm ember-orange theme) into the complete app. This spec describes **what every page does functionally** and **how it should look/behave**, so you can design each screen with real understanding. Design **every page and every state (empty / loading / running / complete / error), high-fidelity and clickable, desktop + mobile, dark-first.**

---

## 0. Product in one paragraph
Agent Eval is a workbench for teams building **voice AI agents** (e.g. an insurance phone agent that talks in English/Hindi/Telugu). It does five things: (1) **Prompt Eval** — automatically test an agent's system-prompt against scenarios and rewrite it until it scores better; (2) **Call Analysis** — take *real* call transcripts and grade how the agent handled each call; (3) **Test STT** — check how accurate the speech-to-text is; (4) **Flow Builder** — draw the conversation flow the agent is supposed to follow; (5) **Settings** — pick the agent's tools and the scoring model. Voice throughout: warm, plain-language, encouraging; translate jargon ("flow adherence" → "did it follow the intended conversation path").

## 1. Visual foundation — reuse what you built
Reuse the exact tokens/components from the existing Agent Eval page. Reference values (use your real ones): warm near-black surfaces (~`#1a1410`); **ember-orange accent** (~`#ee6c4d`) for logo/primary buttons/active states; **bright-green** scores + sparklines (~`#4ade80`); status badges — blue Running/Analyzing, grey Stopped, green Completed/Pass, amber Converged/Warning, red Failed/Critical; warm off-white text, muted warm-grey secondary; **monospace** for IDs, scores, iterations, logs, transcripts; rounded cards with a **colored left-accent border per status** + soft glow; friendly headings + a one-line tagline under each. Same type scale, spacing, pills/badges/chips/sparklines everywhere.

## 2. App shell — LEFT SIDEBAR (your "3b Vertical rail")
**Function:** persistent navigation across the five modules; shows live job status.
- Slim warm sidebar, collapsible to icons-only (remember the state). Logo at top. Sections with small caps labels; items with icon + label; active item = ember accent bar + subtle highlight. Theme toggle + account avatar pinned at the bottom.
- **Live job chip:** if an eval or analysis is running, a small chip appears in the sidebar (spinner + name + %) that links to its live page. Multiple running jobs → a small stack/count.
- Groups & items:
  - **PROMPT EVAL** — History · New Eval
  - **CALL ANALYSIS** — Analyze Calls · Scoreboard
  - **TEST STT**
  - **FLOW BUILDER**
  - **SETTINGS** — Tools · Judge model
- Main area = page header (title + one-line tagline + contextual actions + back where relevant) then content. Mobile: sidebar collapses to a hamburger drawer.

---

## 3. PROMPT EVAL

### 3.1 History (exists — re-home in the shell)
**Purpose:** see every eval you've run and its outcome; jump into one or start a new one.
**Functionality:** lists eval runs newest-first; clicking a **running** one opens its live Progress page, a **finished** one opens Results. Filter pills (All / Running / Completed / Stopped / Converged) filter the list; search filters by name or ID.
**Elements:** header "Evaluations" + tagline + **"+ New Eval"** (ember button); filter pills; search box; a card per eval showing **name** (big), monospace **ID** chip, created date, iteration progress (`3 / 10 iterations`), a **score sparkline**, the **final score %** (green), and a **status badge**. Colored left-accent border per status. Hover = subtle lift/glow.
**States:** empty ("No evaluations yet — run your first one"); loading skeleton cards; a running card animates (pulsing accent + live %).

### 3.2 New Eval
**Purpose:** configure and launch an eval.
**Functionality:** the user names the run, pastes the agent's **system prompt** and a **scenarios** file, tunes settings, and hits Start — which kicks off a background eval and routes to the live Progress page. Start is disabled until both a prompt and valid scenarios exist.
**Elements:** a **Name** field; two large **code editors** side-by-side — *System Prompt* (plaintext) and *Scenarios JSON* (with an **Upload File** button). Each editor header shows live **character count · ~token estimate**; the scenarios one also shows **"N scenarios loaded"**. A **Configuration** panel: **Max Iterations**, **Quality Threshold** slider, toggles **Tools / Dynamic Context / RAG** (RAG reveals server-URL + collection). **Readiness ticks** (`○ prompt` `○ scenarios` → green ✓). A big **Start Evaluation** button (disabled until ready). Gentle inline validation.
**States:** empty; ready; starting.

### 3.3 Progress (live)
**Purpose:** watch an eval run in real time.
**Functionality:** runs a baseline, then repeatedly proposes a prompt change (the "coach"), re-tests all scenarios, and **keeps the change only if the score improves and nothing regresses** ("champion never gets worse"). Streams every event; auto-navigates to Results when done.
**Elements:** header + **Stop**; a **progress summary** (Iteration X/N, Scenario Y/Z, large current-score, a **score-over-iterations line chart** growing live); a **terminal-style Live Log** (monospace, timestamped, color-coded): `▶ Iteration baseline started`, `· ScenarioName → 96% [42/112]`, `■ Iteration complete — champion 96%`, `↑ ACCEPTED v3 — + "new rule…"` (green), `↩ REVERTED v4 — broke: X, Y` (amber), `🎯 threshold met`, `✅ complete`. Auto-scroll; "N events · streaming…".
**Micro-behavior:** keep it alive during slow phases — a subtle "coach is rewriting the prompt…" line so it never looks frozen.

### 3.4 Results
**Purpose:** review final performance scenario-by-scenario.
**Elements:** header + links to **Prompt History** / **Voice Report**; **summary score cards** (Final, Iterations, Pass Rate); a **scenario table** (name · type · score % · PASS/FAIL · iteration) with **expandable rows** (judge reasoning + per-dimension score cards + chat-bubble transcript). Sort/filter (e.g. only failures).

### 3.5 Prompt History
**Purpose:** see how the prompt evolved; re-run from any version.
**Elements:** a **version rail** (v0…vN with score, accepted/reverted marker, one-line change summary); a **side-by-side diff**; a **Changes** box; a **Patch panel** (coach's edits: `APPEND` green, `REPLACE old→new` amber, `⟳ full rewrite` blue); **Re-run from this version**.

### 3.6 Voice Report
**Purpose:** surface spoken-output problems (voice agent → TTS).
**Elements:** stat cards (Thinking-leaks, Markdown, Digits, Length, Emoji); a **per-scenario bar chart**; a **detailed issue table** (scenario · type · turn · matched text). A friendly **"all clear"** state.

---

## 4. CALL ANALYSIS (new)

### 4.1 Analyze Calls (intake)
**Purpose:** feed in a batch of **real** call transcripts and grade the agent's handling.
**Functionality:** upload transcripts, attach the agent config (prompt + intended flow), tick the agent's tools, hit **Analyze**. Each call is scored by an LLM judge (*stub with a "scoring paused — judge not connected" state for now*). Progress streams.
**Elements:** an **upload/drop zone** for transcripts (JSON keyed by `call_id`) or paste; a loaded-count; an **attach `editable_config`** control (paste/upload the prompt + `conversation_flow` stages, or pick a saved Flow); a **Tools checklist** (grouped, from the fixed 17-tool set); a **direction** selector (inbound/outbound/follow-up); a big **Analyze** button; a streaming progress view.
**States:** empty; loaded; **"scoring paused — connect a judge model"**; analyzing; done → Scoreboard / per-call reports.

### 4.2 Per-call Report (the heart)
**Purpose:** show, for one call, how well the agent did and exactly where to improve.
**Elements:**
- **Transcript** as chat bubbles — **Agent / User / Supervisor** roles (Supervisor on transfers), distinct.
- **Six section score cards**, each: a 0–100 **score ring**, a **one-line verdict**, and **evidence quotes** from the transcript:
  1. **Greeting & introduction** — warm open + self-identify?
  2. **Empathy** — handled the customer's emotion well?
  3. **Information-push & goal progression** — moved toward the goal *smoothly* (not pushy, not passive)?
  4. **Conversation management / flow adherence** — followed the intended path (judged vs the Flow/stages)?
  5. **Call closing** — ended properly (confirm next steps, warm close)?
  6. **Tool-calling** — right tools (scored at **call level** — which fired — since transcripts lack per-turn args).
- An **Areas of improvement** panel — a friendly, prioritized bullet list of concrete fixes.
- A **flow-adherence strip** — the expected stages for this direction as a track, each marked **hit / partial / missed**.

### 4.3 Scoreboard (aggregate dashboard)
**Purpose:** the "metrics board" across a whole batch — is the agent good, where does it fail most?
**Elements:** top **metric tiles** (0–100 + trend): **Customer retention / frustration · Repetition · Instruction & flow following · Tool-calling · Human-likeness**; **section-average bars**; a **distribution / heat view** across calls; a **worst-calls list** (→ per-call report); **top recurring improvement themes**; filters (score band, direction, tool, date). Reads like a real analytics dashboard.

---

## 5. TEST STT (new)
**Purpose:** measure Soniox STT accuracy on real call audio (STT errors corrupt everything downstream — worst for Hindi/Telugu code-switching).
**Functionality:** upload audio + paste the **correct (human) transcript**; the app runs Soniox and compares its output to that reference → error metrics + good/bad verdict. Batch mode = many files.
**Elements (single):** **audio upload** (mp3/wav) + small player; a **reference transcript** box; a **language** selector (English/Hindi/Telugu); a **Run** button. Results: a **side-by-side** Soniox-vs-reference with **diff highlighting**, metric tiles — **WER**, **CER** (emphasized for HI/TE), **match %** — and a **good/bad verdict** badge (per-language threshold).
**Elements (batch):** a files table (WER · CER · verdict each) + an **aggregate summary**. A satisfying **"100% match — perfect STT"** state and a clear "poor STT" state.
**States:** empty; ready; running; result; error.

---

## 6. FLOW BUILDER (new) — design this in depth
**Purpose:** define the **conversation flow the agent should follow** — visually — so Call Analysis can score "flow adherence" against it. The user pastes their existing flow (JSON / Markdown / text) and a **separate Gemma model generates the visual node-and-connection diagram**, which they then **edit**.

### 6.1 Three-part layout
1. **Left input panel** — a text box to paste a flow as **JSON / Markdown / plain text** (or upload a file), a notes field, and a big **"Generate flow"** button; example helper text + a "load example" link; a small history of previously generated flows.
2. **Center canvas** — the node-and-connection graph (pan, zoom, fit-to-screen, minimap). The star of the page.
3. **Right inspector** — context panel for the selected node/edge (empty-state prompt when nothing selected).

### 6.2 Generation flow (Gemma)
- Paste → **Generate flow** → a **separate Gemma instance** parses it and returns a structured graph. Show a clear **"Gemma is building your flow…"** animated state on the canvas (skeleton nodes / shimmer).
- On completion, nodes animate into place via **auto-layout**; a toast "Flow generated — edit anything." **Regenerate** and **Edit manually** available.

### 6.3 Node types (distinct visual treatments)
- **Start** — the call entry (per direction).
- **Stage** — a conversation phase (Greeting, Discovery, Educate, Handle objection, Close): title + short description.
- **Branch / Decision** — a condition with multiple outgoing paths (e.g. "Already has cover?" → Yes / No): diamond or card with labeled output handles.
- **Tool-call** — where the agent should call a tool (e.g. `search_knowledge_base`, `end_call`): tool name + icon; picks from the 17-tool set.
- **End** — call ends / handoff (Warm close, Transfer to human).
Nodes have connection **handles**; edges are arrows with optional **condition labels**. Color/iconography per type.

### 6.4 Editing (a real editor, not a static diagram)
- **Select** a node → **right inspector** with editable fields: title, description, type (dropdown), type-specific fields (Branch → conditions/labels; Tool-call → which tool).
- **Move** by dragging; **connect** by dragging handle→handle; **delete** node/edge (keyboard + context menu).
- **Add node** from a **palette** or a "+" on canvas.
- **Direction lanes / tabs** — **inbound / outbound / follow-up**, each its own path.
- **Auto-layout**, **fit-to-screen**, **zoom**, **undo/redo**.
- **Validation hints** — flag disconnected nodes, missing End, unlabeled branch paths.
- **Save** (name + attach to an agent/config; becomes the flow-adherence reference) and **Export** to JSON.
**States:** empty (prompting a paste); generating; editing; saved; error (Gemma couldn't parse → raw text + retry).

---

## 7. SETTINGS (new)
### 7.1 Tools
**Purpose:** tell the system which tools the agent has, so tool-calling is scored against the right set.
**Elements:** the **17-tool checklist**, grouped with short descriptions + checkboxes:
- **Call-handling:** `end_call`, `voicemail_detected`, `handle_call_screening`, `irrelevant_interruption`, `switch_tts_provider`, `date_calculator`, `send_whatsapp_template`
- **Knowledge / lookup:** `search_knowledge_base`, `web_search`, `get_location_details`
- **Escalation:** `transfer_call`, `warm_transfer_call`, `transfer_to_supervisor`, `switch_agent`
(Three supervisor-internal transfer tools exist but off by default.) A "select all core" shortcut.

### 7.2 Judge model
**Purpose:** choose the model that scores calls/evals.
**Elements:** endpoint + model fields, a test-connection button, and a clear **"not connected — scoring paused"** state. Agent/user run on the production model; judge/coach can be a different model.

---

## 8. Cross-cutting
- Design **empty / loading / running / complete / error** for **every** page as real screens.
- **Accessibility:** WCAG AA both themes; status **never color-alone** (icon + label); visible focus; honor `prefers-reduced-motion`; readable monospace; ARIA live region on any streaming log.
- **Motion:** subtle, purposeful — status pulses, score count-up, streaming logs, a small celebratory beat on improvement, calm on a revert, node auto-layout animation in Flow Builder.

## 9. Deliverable
One cohesive, **high-fidelity, clickable** prototype of the entire app in the existing ember-orange theme: the left sidebar + every page above, **desktop + mobile**, all states — consistent with the Agent Eval page you already built. Include a short design-system reference (tokens, components, status colors, node styles).
