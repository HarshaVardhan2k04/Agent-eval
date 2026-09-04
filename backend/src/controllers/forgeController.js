// Forge (PromptForge optimizer) controller — consolidated house-style schema:
// forge_runs (parent + JSONB sub-entities) · forge_versions · forge_problems · forge_events.
// The backend owns persistence; the Python engine owns compute and streams events back
// to POST /api/internal/forge-events.
const { nanoid } = require('nanoid');
const { Op, literal } = require('sequelize');
const { ForgeRun, ForgeProblem, ForgeVersion, ForgeEvent, ForgeDataset, ForgeArena, ForgeSim, ForgeLlm,
  ForgeSavedPrompt } = require('../models');
const agentDb = require('../services/agentDbClient');
const forgeEngine = require('../services/forgeEngineClient');
const verticalSource = require('../services/verticalSource');

// Problem ids are VARCHAR ('p7'), so a plain ORDER BY id gives p1, p10, p11 ... p2 —
// which is what every dropdown and list built on this endpoint then showed. Order by
// the numeric part so the catalogue always reads p1, p2, p3 ... p43.
const PROBLEM_ORDER = [[literal("NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::int"), 'ASC'], ['id', 'ASC']];

const DEFAULT_SCORING = {
  best_of_n: 1, votes: 3, confirm_votes: 5, gate_pct: 95, stress_target: 120, milestone_every: 2,
  // Each iteration fixes at most ONE problem cluster, so the iteration budget is the
  // hard ceiling on how much of the matrix a run can close. At 5, a 35-problem gate
  // could never get near "most problems solved" no matter how good the coach was.
  // max_attempts_per_problem retires a problem that keeps failing so the budget is
  // spent breadth-first instead of on one stubborn fix (see test 234).
  max_iterations: 24, plateau_patience: 3, max_attempts_per_problem: 2,
  verify_k: 3, composite_margin: 3.0,
};

// A problem applies to a run unless its applicability narrows it out.
function applies(problem, { vertical, mode, direction, language }) {
  const a = problem.applicability_json || {};
  const ok = (list, v) => !Array.isArray(list) || list.length === 0 || (v && list.includes(v));
  return ok(a.verticals, vertical) && ok(a.modes, mode) && ok(a.directions, direction) && ok(a.languages, language);
}

// Resolve a layer spec { source: 'agent_db'|'pasted', id?, prompt?, override_keys? } into a
// pinned snapshot. agent_db rows are read-only; pasted arrives inline.
async function resolveLayer(layerType, spec) {
  if (!spec) return null;
  if (spec.source === 'agent_db' && spec.id) {
    const row = await agentDb.getById(spec.id);
    if (!row) throw new Error(`agent_db ${layerType} '${spec.id}' not found`);
    return { prompt: row.prompt, override_keys: row.override_keys || [], source: 'agent_db', source_prompt_id: row.id };
  }
  return { prompt: spec.prompt || {}, override_keys: spec.override_keys || [], source: 'pasted', source_prompt_id: null };
}

// ---- dataset library ------------------------------------------------------

async function listDatasets(_req, res) {
  const rows = await ForgeDataset.findAll({
    attributes: ['id', 'name', 'kind', 'n', 'source', 'created_at'],
    order: [['created_at', 'DESC']],
  });
  res.json(rows);
}

async function getDataset(req, res) {
  const row = await ForgeDataset.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}

async function createDataset(req, res) {
  const b = req.body || {};
  const personas = Array.isArray(b.personas) ? b.personas : [];
  if (!personas.length) return res.status(400).json({ error: 'personas required' });
  const row = await ForgeDataset.create({
    id: nanoid(10), name: b.name || `dataset ${new Date().toISOString().slice(0, 10)}`,
    kind: b.kind || 'authored', personas_json: personas, n: personas.length, source: b.source || null,
  });
  res.json(row);
}

async function deleteDataset(req, res) {
  await ForgeDataset.destroy({ where: { id: req.params.id } });
  res.json({ deleted: true });
}

// ---- saved LLM library -----------------------------------------------------
// Endpoints the user tests with, saved once, picked forever, editable.

async function listLlms(_req, res) {
  res.json(await ForgeLlm.findAll({ order: [['created_at', 'DESC']] }));
}

async function createLlm(req, res) {
  const b = req.body || {};
  if (!b.name || !b.base_url || !b.model) return res.status(400).json({ error: 'name, base_url, model required' });
  const row = await ForgeLlm.create({
    id: nanoid(10), name: String(b.name).trim(), base_url: String(b.base_url).trim(),
    model: String(b.model).trim(), api_key: b.api_key || null, params_json: b.params || null,
  });
  res.json(row);
}

async function updateLlm(req, res) {
  const row = await ForgeLlm.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const patch = { updated_at: new Date() };
  for (const k of ['name', 'base_url', 'model']) if (b[k] != null && String(b[k]).trim()) patch[k] = String(b[k]).trim();
  if (b.api_key != null && String(b.api_key).trim()) patch.api_key = String(b.api_key).trim();
  if ('params' in b) patch.params_json = b.params || null;
  await row.update(patch);
  res.json(row);
}

async function deleteLlm(req, res) {
  await ForgeLlm.destroy({ where: { id: req.params.id } });
  res.json({ deleted: true });
}

// ---- saved prompt library --------------------------------------------------
// Prompts worth keeping, linked to the problems they solve. Linking stores an
// EXCERPT as a reference on the problem: handing the coach a whole 58k-char prompt
// is useless to it, the four lines that fix p7 are not.

async function listSavedPrompts(_req, res) {
  res.json(await ForgeSavedPrompt.findAll({
    attributes: ['id', 'name', 'kind', 'vertical', 'notes', 'problem_ids', 'created_at', 'updated_at'],
    order: [['created_at', 'DESC']],
  }));
}

async function getSavedPrompt(req, res) {
  const row = await ForgeSavedPrompt.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}

async function createSavedPrompt(req, res) {
  const b = req.body || {};
  if (!b.name || (!b.body_text && !b.body_json)) {
    return res.status(400).json({ error: 'name and body_text (or body_json) required' });
  }
  res.json(await ForgeSavedPrompt.create({
    id: nanoid(10), name: String(b.name).trim(), kind: b.kind || 'blob',
    body_text: b.body_text || null, body_json: b.body_json || null,
    vertical: b.vertical || null, notes: b.notes || null,
    problem_ids: Array.isArray(b.problem_ids) ? b.problem_ids : [],
  }));
}

async function updateSavedPrompt(req, res) {
  const row = await ForgeSavedPrompt.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const patch = { updated_at: new Date() };
  for (const k of ['name', 'kind', 'body_text', 'vertical', 'notes']) if (k in b) patch[k] = b[k];
  if ('body_json' in b) patch.body_json = b.body_json;
  if (Array.isArray(b.problem_ids)) patch.problem_ids = b.problem_ids;
  await row.update(patch);
  res.json(row);
}

async function deleteSavedPrompt(req, res) {
  await ForgeSavedPrompt.destroy({ where: { id: req.params.id } });
  res.json({ deleted: true });
}

// Link a saved prompt to a problem, carrying the excerpt that actually does the work.
// The excerpt lands on the PROBLEM as a reference, which is what the coach reads.
async function linkSavedPrompt(req, res) {
  const { id, problemId } = req.params;
  const b = req.body || {};
  const sp = await ForgeSavedPrompt.findByPk(id);
  if (!sp) return res.status(404).json({ error: 'saved prompt not found' });
  const prob = await ForgeProblem.findByPk(problemId);
  if (!prob) return res.status(404).json({ error: 'problem not found' });

  const excerpt = String(b.excerpt || sp.body_text || '').trim();
  if (!excerpt) return res.status(400).json({ error: 'excerpt required (highlight the passage that fixes this problem)' });

  const refs = Array.isArray(prob.references_json) ? [...prob.references_json] : [];
  refs.push({
    id: nanoid(6),
    kind: b.kind || 'good_example',           // good_example | bad_example | layer_snapshot | note
    title: b.title || `from ${sp.name}`,
    body: excerpt.slice(0, 4000),
    source: sp.name, saved_prompt_id: sp.id,
    added_at: new Date().toISOString(),
  });
  await prob.update({ references_json: refs, updated_at: new Date() });

  const linked = Array.isArray(sp.problem_ids) ? sp.problem_ids : [];
  if (!linked.includes(problemId)) {
    await sp.update({ problem_ids: [...linked, problemId], updated_at: new Date() });
  }
  res.json({ linked: true, problem_id: problemId, references: refs.length });
}

async function unlinkSavedPrompt(req, res) {
  const { id, problemId } = req.params;
  const prob = await ForgeProblem.findByPk(problemId);
  if (prob) {
    const refs = (prob.references_json || []).filter((r) => r.saved_prompt_id !== id);
    await prob.update({ references_json: refs, updated_at: new Date() });
  }
  const sp = await ForgeSavedPrompt.findByPk(id);
  if (sp) {
    await sp.update({ problem_ids: (sp.problem_ids || []).filter((p) => p !== problemId), updated_at: new Date() });
  }
  res.json({ unlinked: true });
}

// ---- LLM Arena ------------------------------------------------------------
// N hosted LLMs, each with its OWN prompt, one dataset, full battery, fixed judge.
// Contestants run SEQUENTIALLY (one inference box) — the run_complete ingest
// dispatches the next queued member; when all land, the winner is computed.

async function applicableProblems({ vertical, mode, direction, language }) {
  const all = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  return all.map((p) => p.toJSON())
    .filter((p) => applies(p, { vertical, mode, direction, language }))
    .map((p) => ({
      id: p.id, behaviour: p.behaviour, layer_for_fix: p.layer_for_fix,
      has_detector: p.has_detector, filter_territory: p.filter_territory,
      winning_lever: p.winning_lever,
      // worked examples the coach imitates — the lever says WHAT to do, these show HOW
      references: Array.isArray(p.references_json) ? p.references_json : [],
    }));
}

async function dispatchArenaContestant(arena, contestant) {
  const run = await ForgeRun.findByPk(contestant.run_id);
  if (!run) throw new Error(`arena run ${contestant.run_id} missing`);
  const problems = await applicableProblems({ vertical: run.vertical, mode: 'standalone', direction: run.direction });
  const spec = {
    mode: 'standalone', direction: run.direction || 'outbound', lead_status: run.lead_status || 'fresh',
    champion: { blob: (run.original_prompt_snapshot || {}).blob || '' },
    problems, scoring: run.scoring_json,
    probes: run.probes_json || [],
  };
  const judge = (arena.scoring_json || {}).judge || {};
  await forgeEngine.dispatchForge(run.id, spec, {
    llm_base_url: contestant.base_url, llm_model: contestant.model,
    llm_api_key: contestant.api_key || undefined,
    llm_params: contestant.params || undefined,
    ...(run.tools_json && Array.isArray(run.tools_json.enabled)
        ? { enabled_tools: run.tools_json.enabled, tools_enabled: run.tools_json.enabled.length > 0 }
        : {}),
    judge_base_url: judge.base_url || undefined, judge_model: judge.model || undefined,
    judge_api_key: judge.api_key || undefined,
  });
  await run.update({ status: 'optimizing', updated_at: new Date() });
}

// Pre-flight check before the prompt step: send "hi" to the contestant's endpoint
// and report whether it answers. Never persists or logs the key.
async function testArenaLlm(req, res) {
  const { base_url, api_key, model, params } = req.body || {};
  if (!base_url || !model) return res.status(400).json({ ok: false, error: 'base_url and model required' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const t0 = Date.now();
  try {
    const r = await fetch(`${String(base_url).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(api_key ? { authorization: `Bearer ${api_key}` } : {}),
      },
      // 300, not 20: reasoning models (Gemini Flash etc.) burn 100+ hidden thinking
      // tokens before the first visible character — a tiny cap reads as "empty reply".
      // params = the contestant's request overrides (thinking level, max_tokens, ...)
      // so the test exercises the EXACT request shape the arena will send.
      body: JSON.stringify({ model, max_tokens: 300, ...(params || {}), messages: [{ role: 'user', content: 'hi' }] }),
    });
    const ms = Date.now() - t0;
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = (body && (body.error?.message || body.message)) || `HTTP ${r.status}`;
      return res.json({ ok: false, error: String(msg).slice(0, 200), ms });
    }
    const reply = body?.choices?.[0]?.message?.content || '';
    if (!reply.trim()) return res.json({ ok: false, error: 'endpoint answered but returned empty text', ms });
    res.json({ ok: true, reply: reply.trim().slice(0, 120), ms });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout after 20s' : (e.cause?.code || e.message);
    res.json({ ok: false, error: String(msg).slice(0, 200), ms: Date.now() - t0 });
  } finally {
    clearTimeout(timer);
  }
}

// Edit ONE contestant's connection config (url/key/model/params) in place.
// An empty api_key in the patch means "keep the stored key".
async function updateArenaContestant(req, res) {
  const arena = await ForgeArena.findByPk(req.params.id);
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  const b = req.body || {};
  // clone before mutate — Sequelize skips same-reference JSONB updates
  const contestants = JSON.parse(JSON.stringify(arena.contestants_json || []));
  const c = contestants.find((x) => x.run_id === req.params.runId);
  if (!c) return res.status(404).json({ error: 'contestant not found' });
  if (b.base_url != null && String(b.base_url).trim()) c.base_url = String(b.base_url).trim();
  if (b.model != null && String(b.model).trim()) c.model = String(b.model).trim();
  if (b.label != null && String(b.label).trim()) c.label = String(b.label).trim();
  if (b.api_key != null && String(b.api_key).trim()) c.api_key = String(b.api_key).trim();
  if ('params' in b) c.params = b.params || null; // explicit null clears overrides
  await arena.update({ contestants_json: contestants });
  const { api_key, ...safe } = c;
  res.json({ ok: true, contestant: { ...safe, has_key: !!api_key } });
}

// Re-evaluate the WHOLE arena with a different judge: conversations stay, only
// the judging + metrics re-run. Zero calls to the contestant models.
async function reevaluateArena(req, res) {
  const arena = await ForgeArena.findByPk(req.params.id);
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  const judge = (req.body || {}).judge || null; // {base_url, model, api_key} or null = default
  const runs = await ForgeRun.findAll({ where: { arena_id: arena.id } });
  if (runs.some((r) => ['optimizing', 'collecting'].includes(r.status))) {
    return res.status(400).json({ error: 'a contestant is still running' });
  }
  const problems = await applicableProblems({ mode: 'standalone', direction: runs[0]?.direction });
  const scoring = JSON.parse(JSON.stringify(arena.scoring_json || {}));
  scoring.judge = judge;
  await arena.update({ status: 'running', winner_run_id: null, ranking_json: [],
                       completed_at: null, scoring_json: scoring, updated_at: new Date() });
  const started = [];
  for (const run of runs) {
    const sims = await ForgeSim.findAll({
      where: { run_id: run.id, kind: 'dataset' },
      attributes: ['sim_uid', 'probe', 'idx', 'transcript_json', 'ended', 'tool_calls_json'],
      order: [['id', 'ASC']],
    });
    if (!sims.length) continue; // nothing stored (e.g. failed before any conversation)
    const v0 = await ForgeVersion.findOne({ where: { run_id: run.id, version: 0 } });
    const sp = (v0 && v0.merged_markdown) || String((run.original_prompt_snapshot || {}).blob || '');
    const configPayload = (v0 && v0.config_json) || { blob: (run.original_prompt_snapshot || {}).blob };
    await ForgeVersion.destroy({ where: { run_id: run.id } }); // v0 will be re-emitted
    await run.update({ status: 'optimizing', error_message: null, solved_pct: null,
                       final_composite: null, completed_at: null, updated_at: new Date() });
    await forgeEngine.regradeForge(run.id, {
      sims: sims.map((x) => ({ sim_uid: x.sim_uid, probe: x.probe, idx: x.idx,
                               transcript: x.transcript_json, ended: x.ended,
                               tool_calls: x.tool_calls_json || [] })),
      problems,
      denominator: run.denominator_snapshot_json || [],
      system_prompt: sp,
      config_for_scorer: {},
      direction: run.direction || 'outbound',
      gate_pct: Number((run.scoring_json || {}).gate_pct || 95),
      config_payload: configPayload,
      greeting: '',
    }, {
      judge_base_url: judge ? judge.base_url : undefined,
      judge_model: judge ? judge.model : undefined,
      judge_api_key: judge ? judge.api_key : undefined,
    });
    started.push(run.id);
  }
  res.json({ ok: true, regrading: started });
}

// Retry ONE contestant from scratch: wipe its data, re-dispatch, reopen the arena.
async function retryArenaContestant(req, res) {
  const arena = await ForgeArena.findByPk(req.params.id);
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  const contestant = (arena.contestants_json || []).find((c) => c.run_id === req.params.runId);
  if (!contestant) return res.status(404).json({ error: 'contestant not found' });
  const run = await ForgeRun.findByPk(contestant.run_id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (['optimizing', 'collecting'].includes(run.status)) {
    return res.status(400).json({ error: 'contestant is still running' });
  }
  // fresh slate for this run only
  await ForgeSim.destroy({ where: { run_id: run.id } });
  await ForgeEvent.destroy({ where: { run_id: run.id } });
  await ForgeVersion.destroy({ where: { run_id: run.id } });
  await run.update({ status: 'queued', error_message: null, solved_pct: null,
                     final_composite: null, current_version: 0, completed_at: null, updated_at: new Date() });
  await arena.update({ status: 'running', winner_run_id: null, ranking_json: [], completed_at: null, updated_at: new Date() });
  try {
    await dispatchArenaContestant(arena, contestant);
  } catch (e) {
    await run.update({ status: 'failed', error_message: `dispatch failed: ${e.message}`.slice(0, 1000) });
    return res.status(502).json({ error: `dispatch failed: ${e.message}` });
  }
  res.json({ ok: true, run_id: run.id, status: 'optimizing' });
}

async function createArena(req, res) {
  const b = req.body || {};
  const contestants = Array.isArray(b.contestants) ? b.contestants : [];
  if (contestants.length < 2) return res.status(400).json({ error: 'need at least 2 contestants' });
  for (const c of contestants) {
    if (!c.label || !c.model || !c.base_url || !c.prompt) {
      return res.status(400).json({ error: 'each contestant needs label, base_url, model, prompt' });
    }
  }
  if (!b.dataset_id) return res.status(400).json({ error: 'dataset_id required' });
  const ds = await ForgeDataset.findByPk(b.dataset_id);
  if (!ds) return res.status(400).json({ error: 'dataset not found' });

  const scoring = {
    // SINGLE PASS is the arena default: one conversation per dataset persona, no retries,
    // problems checked INSIDE those conversations, metrics from the same conversations.
    single_pass: true, votes: 1, confirm_votes: 0, best_of_n: 1, stress_target: 0,
    milestone_every: 1, gate_pct: 95, max_iterations: 0, verify_k: 1, ...(b.scoring || {}),
    max_iterations: 0, // evaluate-only — an arena never coaches
    judge: b.judge || null, // optional judge override (default = the engine's env judge)
  };
  const arenaTools = Array.isArray(b.tools) ? b.tools.filter((t) => typeof t === 'string') : null;
  const arenaId = nanoid(10);
  const enriched = [];
  for (const c of contestants) {
    const runId = nanoid(12);
    await ForgeRun.create({
      id: runId, name: `[arena] ${c.label}`, mode: 'standalone', status: 'queued',
      tools_json: arenaTools ? { enabled: arenaTools, source: 'manual' } : null,
      dataset_kind: 'authored', dataset_json: { kind: 'authored', n: ds.n, dataset_id: ds.id },
      scoring_json: scoring, direction: b.direction || 'outbound', lead_status: b.lead_status || 'fresh',
      original_prompt_snapshot: { mode: 'standalone', blob: c.prompt },
      probes_json: ds.personas_json, arena_id: arenaId,
    });
    enriched.push({ label: c.label, base_url: c.base_url, model: c.model,
                    api_key: c.api_key || null, params: c.params || null, run_id: runId });
  }
  const arena = await ForgeArena.create({
    id: arenaId, name: b.name || `arena ${new Date().toISOString().slice(0, 10)}`,
    dataset_id: ds.id, contestants_json: enriched, scoring_json: scoring,
  });
  try {
    // ALL contestants launch concurrently — the engine runs each as its own async
    // task and its global LLM semaphore handles endpoint pressure. (The old
    // sequential chain in run_complete still drains any 'queued' members, so
    // arenas created before this change keep working.)
    const results = await Promise.allSettled(enriched.map((c) => dispatchArenaContestant(arena, c)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === enriched.length) throw new Error(failed[0].reason?.message || 'all dispatches failed');
  } catch (e) {
    await arena.update({ status: 'failed' });
    return res.status(502).json({ error: `dispatch failed: ${e.message}` });
  }
  res.json({ arena_id: arenaId, status: 'running', contestants: enriched.length });
}

// An arena is 'running' only while contestant runs are actually alive. Two ways it
// can lie: the engine dies mid-dispatch and the runs never materialise, or every run
// reached a terminal state but the completion ingest never fired (a restart between
// the last run finishing and its callback). Either way the arena sits 'running'
// forever and the UI shows a spinner nobody can clear. Reconcile on every read —
// cheap, and the list page is exactly where a stale one is noticed.
const LIVE_RUN_STATES = ['queued', 'collecting', 'optimizing'];

// An arena is only stale if it has been untouched for a while. reevaluate() and
// retry() set the arena to 'running' BEFORE the first contestant flips to a live
// status, and a concurrent poll landing in that window would otherwise settle a
// run that is just starting.
const REAP_GRACE_MS = 90_000;

async function reapStaleArenas() {
  const live = await ForgeArena.findAll({ where: { status: 'running' } });
  for (const arena of live) {
    if (Date.now() - new Date(arena.updated_at || arena.created_at).getTime() < REAP_GRACE_MS) continue;
    const runs = await ForgeRun.findAll({
      where: { arena_id: arena.id }, attributes: ['id', 'status'],
    });
    if (!runs.length) {
      // the contestant runs it names are gone — nothing can ever finish this arena
      await arena.update({ status: 'failed', completed_at: new Date(), updated_at: new Date() });
      console.warn(`[forge] reaped arena ${arena.id}: contestant runs no longer exist`);
      continue;
    }
    if (runs.some((r) => LIVE_RUN_STATES.includes(r.status))) continue;  // genuinely live
    // every run is terminal but the arena never closed — settle it now
    const anyScored = runs.some((r) => !['failed', 'stopped'].includes(r.status));
    await arena.update({ status: anyScored ? 'complete' : 'failed', completed_at: new Date(), updated_at: new Date() });
    console.warn(`[forge] reaped arena ${arena.id}: all runs terminal, marked ${anyScored ? 'complete' : 'failed'}`);
  }
}

async function listArenas(_req, res) {
  await reapStaleArenas();
  res.json(await ForgeArena.findAll({ order: [['created_at', 'DESC']] }));
}

async function getArena(req, res) {
  await reapStaleArenas();
  const arena = await ForgeArena.findByPk(req.params.id);
  if (!arena) return res.status(404).json({ error: 'not found' });
  const runs = await ForgeRun.findAll({
    where: { arena_id: arena.id },
    attributes: ['id', 'name', 'status', 'solved_pct', 'final_composite', 'current_version', 'error_message'],
  });
  // failed runs from before error persistence: recover the reason from the event log
  for (const r of runs) {
    if (r.status === 'failed' && !r.error_message) {
      const ev = await ForgeEvent.findOne({
        where: { run_id: r.id, event_type: 'run_complete' }, order: [['id', 'DESC']],
      });
      if (ev && ev.event_data && ev.event_data.error) r.setDataValue('error_message', ev.event_data.error);
    }
  }
  // latest per-problem verdicts + metrics for each contestant (the comparison grid)
  const detail = {};
  for (const r of runs) {
    const v = await ForgeVersion.findOne({
      where: { run_id: r.id, statuses_json: { [Op.ne]: null } },
      order: [['version', 'DESC']],
    });
    // live heartbeat: the newest progress event tells the UI exactly what this
    // contestant is doing right now ("matrix p12 · 14/37") instead of a bare chip.
    const lastEv = await ForgeEvent.findOne({
      where: { run_id: r.id, event_type: 'progress' },
      order: [['id', 'DESC']],
    });
    detail[r.id] = {
      statuses: v ? v.statuses_json : {},
      metrics: v ? v.metrics_json : null,
      sections: v ? v.section_scores_json : null,
      latency: v ? v.latency_json : null,
      tool_checks: v ? v.tool_checks_json : null,
      activity: lastEv ? { ...lastEv.event_data, at: lastEv.created_at } : null,
    };
  }
  res.json({ ...arena.toJSON(), runs, detail });
}

async function deleteArena(req, res) {
  // deep-delete every contestant run (versions/events/sims included), then the arena
  const members = await ForgeRun.findAll({ where: { arena_id: req.params.id }, attributes: ['id'] });
  await destroyRunDeep(members.map((m) => m.id));
  await ForgeArena.destroy({ where: { id: req.params.id } });
  res.json({ deleted: true });
}

// ---- run lifecycle --------------------------------------------------------

async function createRun(req, res) {
  const b = req.body || {};
  // Tools the agent under test is offered. [] = tools disabled entirely;
  // omitted = engine default (every tool production can gate on).
  const toolsSel = Array.isArray(b.tools) ? b.tools.filter((t) => typeof t === 'string') : null;
  const mode = b.mode === 'layered' ? 'layered' : 'standalone';
  const direction = b.direction || 'outbound';
  const lead_status = b.lead_status || 'fresh';
  const vertical = b.vertical || null;
  const scoring = { ...DEFAULT_SCORING, ...(b.scoring || {}) };
  const runId = nanoid(12);

  let champion;
  let originalSnapshot;
  const layersJson = [];

  if (mode === 'layered') {
    const layers = b.layers || {};
    const universal = await resolveLayer('universal', layers.universal);
    const vert = await resolveLayer('vertical', layers.vertical);
    const campaign = await resolveLayer('campaign', layers.campaign);
    if (!campaign) return res.status(400).json({ error: 'campaign layer is required for layered mode' });
    const addon = Array.isArray(layers.addon) ? layers.addon : [];
    champion = {
      layers: {
        universal: universal ? universal.prompt : {},
        vertical: vert ? vert.prompt : {},
        campaign: campaign.prompt,
        addon,
      },
      override_keys: {
        universal: universal ? universal.override_keys : [],
        vertical: vert ? vert.override_keys : [],
        campaign: campaign.override_keys,
      },
    };
    for (const [lt, snap] of [['universal', universal], ['vertical', vert], ['campaign', campaign]]) {
      if (snap) {
        layersJson.push({
          layer_type: lt, source: snap.source, source_prompt_id: snap.source_prompt_id,
          override_keys: snap.override_keys, editable: lt === 'campaign',
          config_snapshot: snap.prompt,
        });
      }
    }
    originalSnapshot = { mode, layers: champion.layers, override_keys: champion.override_keys };
  } else {
    champion = { blob: b.standalone_prompt || b.prompt || '' };
    originalSnapshot = { mode, blob: champion.blob };
  }

  // applicable problems (denominator source) — filtered to this run's context.
  const allProblems = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  const problems = allProblems
    .map((p) => p.toJSON())
    .filter((p) => applies(p, { vertical, mode, direction, language: b.language }))
    .map((p) => ({
      id: p.id, behaviour: p.behaviour, layer_for_fix: p.layer_for_fix,
      has_detector: p.has_detector, filter_territory: p.filter_territory,
      winning_lever: p.winning_lever,
      // worked examples the coach imitates — the lever says WHAT to do, these show HOW
      references: Array.isArray(p.references_json) ? p.references_json : [],
    }));

  // dataset: real (fetch transcripts read-only, engine mines+scrubs) or authored personas.
  let dataset = {};
  let probesJson = [];
  if (b.dataset_kind === 'real') {
    const ids = Array.isArray(b.call_ids) ? b.call_ids : [];
    let transcripts = [];
    if (vertical && ids.length) {
      try {
        const calls = await verticalSource.fetchCalls(vertical, ids);
        transcripts = calls.map((c) => c.transcript).filter(Boolean);
      } catch (e) {
        return res.status(400).json({ error: `import failed: ${e.message}` });
      }
    }
    if (!transcripts.length) return res.status(400).json({ error: 'no transcripts fetched for the given call IDs' });
    dataset = { kind: 'real', transcripts, vertical, max_personas: b.max_personas || 25 };
  } else {
    let personas = Array.isArray(b.personas) ? b.personas : [];
    if (b.dataset_id) {
      const saved = await ForgeDataset.findByPk(b.dataset_id);
      if (!saved) return res.status(400).json({ error: `dataset '${b.dataset_id}' not found` });
      personas = saved.personas_json;
    } else if (personas.length) {
      // Every pasted dataset is stored once — reusable from the Setup page next time.
      await ForgeDataset.create({
        id: nanoid(10), name: b.dataset_name || `${b.name || 'run'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        kind: 'authored', personas_json: personas, n: personas.length, source: 'pasted',
      });
    }
    dataset = { kind: 'authored', personas };
    probesJson = personas.map((p) => ({ ...p, source: 'authored' }));
  }

  await ForgeRun.create({
    id: runId, name: b.name || null, mode, status: 'optimizing',
    tools_json: toolsSel ? { enabled: toolsSel, source: b.tools_source || 'manual' } : null,
    dataset_kind: b.dataset_kind || 'authored',
    dataset_json: { kind: dataset.kind, n: (dataset.transcripts || dataset.personas || []).length },
    scoring_json: scoring, vertical, language: b.language || null, direction, lead_status,
    original_prompt_snapshot: originalSnapshot,
    layers_json: layersJson, probes_json: probesJson,
    coach_guidance: b.coach_guidance || null,
    combos_json: b.combo_resolutions ? { resolutions: b.combo_resolutions } : {},
  });

  const spec = { mode, direction, lead_status, vertical, language: b.language, champion, problems, scoring, dataset,
    coach_guidance: b.coach_guidance || null,
    combo_resolutions: b.combo_resolutions || null };
  // Optional agent-under-test override (default = the production model / env Gemma).
  // The judge, customer and coach stay on the fixed judge model regardless.
  const agent = b.agent_llm || {};
  const agentConfig = agent.base_url && agent.model ? {
    llm_base_url: String(agent.base_url).trim(), llm_model: String(agent.model).trim(),
    llm_api_key: agent.api_key || undefined, llm_params: agent.params || undefined,
  } : {};
  if (toolsSel) {
    agentConfig.enabled_tools = toolsSel;
    agentConfig.tools_enabled = toolsSel.length > 0;
  }
  try {
    await forgeEngine.dispatchForge(runId, spec, agentConfig);
  } catch (e) {
    await ForgeRun.update({ status: 'failed', error_message: e.message }, { where: { id: runId } });
    return res.status(502).json({ error: `engine dispatch failed: ${e.message}` });
  }
  res.json({ run_id: runId, status: 'optimizing' });
}

// The engine re-reads this before EVERY coach proposal, so the operator can steer a run
// while it is still going. Kept deliberately dumb: one column, no history.
async function getCoachGuidance(req, res) {
  const run = await ForgeRun.findByPk(req.params.id, { attributes: ['id', 'coach_guidance'] });
  if (!run) return res.status(404).json({ error: 'not found' });
  res.json({ coach_guidance: run.coach_guidance || '' });
}

async function setCoachGuidance(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const text = String((req.body || {}).coach_guidance || '').slice(0, 4000);
  await run.update({ coach_guidance: text, updated_at: new Date() });
  res.json({ ok: true, coach_guidance: text });
}

// The human's rulings on combos the prompt could not serve. Storing them RESUMES the run:
// the engine is re-dispatched with the same champion plus the resolutions, and the
// written-in content is also handed to the coach as a problem it must fix for real.
async function resolveCombos(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  if (run.status !== 'awaiting_human') {
    return res.status(400).json({ error: `run is '${run.status}', not awaiting_human` });
  }
  const resolutions = (req.body || {}).resolutions || {};
  if (!Object.keys(resolutions).length) return res.status(400).json({ error: 'no resolutions supplied' });

  const cj = run.combos_json || {};
  const blocked = cj.blocked || [];
  const unresolved = blocked.filter((b) => !resolutions[b.key]).map((b) => b.key);
  if (unresolved.length) {
    return res.status(400).json({ error: `still unresolved: ${unresolved.join(', ')}` });
  }
  // Anything the human WROTE is a genuine hole in the prompt — tell the coach so the
  // optimized prompt actually contains it, instead of the gap living only in Forge.
  const authored = Object.entries(resolutions)
    .filter(([, r]) => r && r.action === 'content' && (r.text || '').trim())
    .map(([key, r]) => `- ${key}: the prompt had no greeting for this call; the operator supplied "${String(r.text).slice(0, 200)}". Add it to the campaign layer's greeting_message.`);
  const guidance = [run.coach_guidance || '', authored.length
    ? `MISSING PROMPT CONTENT the operator had to supply by hand — fix these in the prompt itself:\n${authored.join('\n')}`
    : ''].filter(Boolean).join('\n\n').slice(0, 4000);

  const snap = run.original_prompt_snapshot || {};
  const champion = run.mode === 'layered'
    ? { layers: { addon: [], ...(snap.layers || {}) }, override_keys: snap.override_keys || {} }
    : { blob: snap.blob || '' };

  const allProblems = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  const problems = allProblems.map((p) => p.toJSON()).map((p) => ({
    id: p.id, behaviour: p.behaviour, layer_for_fix: p.layer_for_fix,
    has_detector: p.has_detector, filter_territory: p.filter_territory, winning_lever: p.winning_lever,
  }));

  await run.update({
    status: 'optimizing', coach_guidance: guidance,
    // back to work: the end time is re-stamped when it next stops, so the reported
    // duration is always start -> the handover that actually finished the run
    completed_at: null,
    combos_json: { ...cj, resolutions, blocked: [] }, updated_at: new Date(),
  });

  const spec = {
    mode: run.mode, direction: run.direction, lead_status: run.lead_status,
    vertical: run.vertical, language: run.language, champion, problems,
    scoring: run.scoring_json || {},
    dataset: { kind: 'authored', personas: run.probes_json || [] },
    coach_guidance: guidance, combo_resolutions: resolutions,
  };
  const agentConfig = (run.tools_json && run.tools_json.enabled)
    ? { enabled_tools: run.tools_json.enabled, tools_enabled: run.tools_json.enabled.length > 0 } : {};
  try {
    await forgeEngine.dispatchForge(run.id, spec, agentConfig);
  } catch (e) {
    await run.update({ status: 'failed', error_message: e.message });
    return res.status(502).json({ error: `engine dispatch failed: ${e.message}` });
  }
  res.json({ ok: true, status: 'optimizing', resolutions });
}

async function listRuns(_req, res) {
  const runs = await ForgeRun.findAll({
    attributes: { exclude: ['probes_json', 'original_prompt_snapshot', 'layers_json'] }, // keep the list light
    order: [['created_at', 'DESC']],
  });
  res.json(runs);
}

async function getRun(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const versions = await ForgeVersion.findAll({ where: { run_id: run.id }, order: [['version', 'ASC']] });
  const r = run.toJSON();
  res.json({
    ...r,
    versions,
    escalations: r.escalations_json || [],
    review: r.review_json || {},
    layers: r.layers_json || [],
  });
}

async function renameRun(req, res) {
  const [n] = await ForgeRun.update({ name: req.body.name, updated_at: new Date() }, { where: { id: req.params.id } });
  if (!n) return res.status(404).json({ error: 'not found' });
  res.json({ id: req.params.id, name: req.body.name });
}

// Everything a run owns dies with it — versions, events, sims. No orphans.
async function destroyRunDeep(runIds) {
  const ids = Array.isArray(runIds) ? runIds : [runIds];
  if (!ids.length) return;
  await ForgeSim.destroy({ where: { run_id: ids } });
  await ForgeEvent.destroy({ where: { run_id: ids } });
  await ForgeVersion.destroy({ where: { run_id: ids } });
  await ForgeRun.destroy({ where: { id: ids } });
}

async function deleteRun(req, res) {
  await destroyRunDeep(req.params.id);
  res.json({ deleted: true });
}

async function stopRun(req, res) {
  try { await forgeEngine.stopForge(req.params.id); } catch (_e) { /* best-effort */ }
  // stopping ends the run, so the clock stops here too — otherwise a stopped run is the
  // one terminal state with no duration
  const patch = { status: 'stopped', updated_at: new Date() };
  // The engine writes the real per-problem unsolved report on run_complete, but it only
  // notices the stop flag between iterations — and if the process is killed first (restart,
  // crash) that report never arrives. Reconstruct what the stored verdicts can tell us so a
  // stopped run still accounts for its gap instead of showing nothing.
  const run = await ForgeRun.findByPk(req.params.id);
  // never move an end time that is already recorded — stopping twice must not restate
  // how long the run took
  if (!run?.completed_at) patch.completed_at = new Date();
  if (run && !Object.keys(run.unsolved_json || {}).length) {
    const latest = await ForgeVersion.findOne({
      where: { run_id: run.id, statuses_json: { [Op.ne]: null } }, order: [['version', 'DESC']],
    });
    const statuses = latest?.statuses_json || {};
    const unsolved = {};
    for (const pid of run.denominator_snapshot_json || []) {
      const st = statuses[pid] || {};
      if (st.verdict === 'Y') continue;
      const ev = String(st.evidence || '');
      unsolved[pid] = {
        verdict: st.verdict ?? null,
        category: st.verdict === '~' ? (ev.includes('never exercised') ? 'not_exercised' : 'unknown')
          : st.verdict === 'N' ? 'in_progress' : 'iteration_budget',
        why: st.verdict
          ? (ev || 'still failing when the run was stopped')
          : 'the run was stopped before this problem was reached',
        attempts: 0, evidence: ev.slice(0, 160),
      };
    }
    patch.unsolved_json = unsolved;
  }
  await ForgeRun.update(patch, { where: { id: req.params.id } });
  res.json({ id: req.params.id, status: 'stopped' });
}

async function getLog(req, res) {
  const after = Number(req.query.after || 0);
  const events = await ForgeEvent.findAll({
    where: { run_id: req.params.id, id: { [Op.gt]: after } },
    order: [['id', 'ASC']], limit: 1000,
  });
  res.json(events);
}

// Per-run problem grid — built from the versions' statuses_json (no extra table).
async function getMatrix(req, res) {
  const versions = await ForgeVersion.findAll({
    where: { run_id: req.params.id, statuses_json: { [Op.ne]: null } },
    attributes: ['version', 'status', 'statuses_json'],
    order: [['version', 'ASC']],
  });
  res.json(versions);
}

// ---- engine event ingest --------------------------------------------------

async function ingestForgeEvent(req, res) {
  const { event_type, data } = req.body || {};
  const runId = data && data.run_id;
  if (!runId) return res.status(400).json({ error: 'run_id required' });
  // Sim archive events bypass the generic event log: sim_recorded rows carry a
  // full transcript (stored once, in forge_sims), sims_graded is a backfill.
  if (event_type === 'sim_recorded') {
    try {
      await ForgeSim.create({
        sim_uid: data.sim_uid, run_id: runId, version: data.version || 0, kind: data.kind,
        problem_id: data.problem_id || null, probe: data.probe || null, idx: data.idx ?? null,
        combo: data.combo || null,
        transcript_json: data.transcript || [], ended: data.ended ?? null,
        tool_calls_json: data.tool_calls || null,
        tool_leaks_json: data.tool_leaks || null,
        tool_summary_json: data.tool_summary || null,
      });
      // slim log line (no transcript) so the progress page can show + link it
      await ForgeEvent.create({ run_id: runId, event_type, event_data: {
        run_id: runId, sim_uid: data.sim_uid, kind: data.kind, problem_id: data.problem_id || null,
        probe: data.probe || null, idx: data.idx ?? null, version: data.version || 0,
        combo: data.combo || null,
        n_turns: (data.transcript || []).length, ended: data.ended ?? null,
      } });
    } catch (e) { console.warn('[forge sim_recorded]', e.message); }
    return res.json({ ok: true });
  }
  if (event_type === 'sims_graded') {
    try {
      for (const g of (data.sims || [])) {
        await ForgeSim.update(
          { verdict: g.verdict, reason: g.reason || null, failing_turn: g.failing_turn ?? null },
          { where: { sim_uid: g.sim_uid } }
        );
      }
    } catch (e) { console.warn('[forge sims_graded]', e.message); }
    return res.json({ ok: true });
  }
  await ForgeEvent.create({ run_id: runId, event_type, event_data: data });

  try {
    if (event_type === 'run_start') {
      // Engine reports its EFFECTIVE gate denominator — persist it as the snapshot.
      await ForgeRun.update(
        { status: 'optimizing', denominator_snapshot_json: data.denominator || [], updated_at: new Date() },
        { where: { id: runId } }
      );
    } else if (event_type === 'probes_ready') {
      await ForgeRun.update({ probes_json: data.probes || [], updated_at: new Date() }, { where: { id: runId } });
    } else if (event_type === 'version_recorded') {
      await ForgeVersion.upsert({
        run_id: runId, version: data.version, tier: data.tier, status: data.status,
        config_json: data.config_json || null, merged_markdown: data.merged_markdown || null,
        greeting: data.greeting || null, composite: data.composite ?? null,
        statuses_json: data.statuses || null,
        section_scores_json: data.section_scores || null, metrics_json: data.metrics || null,
        latency_json: data.latency || null,
        tool_checks_json: (data.tool_checks || data.tool_fixes)
          ? { ...(data.tool_checks || {}),
              ...(Array.isArray(data.tool_fixes) && data.tool_fixes.length ? { _fixes: data.tool_fixes } : {}) }
          : null,
        edits_json: data.edits || null, targeted_problem: data.targeted_problem || null,
        layer_for_fix: data.layer_for_fix || null, verify_json: data.verify || null,
        diagnosis: data.diagnosis || null, how_solved: data.how_solved || null,
        changes_summary: data.changes_summary || null,
      });
      const patch = { current_version: data.version, updated_at: new Date() };
      if (data.composite != null) patch.final_composite = data.composite;
      if (data.solved_pct != null) patch.solved_pct = data.solved_pct;
      await ForgeRun.update(patch, { where: { id: runId } });
      // CLOSE THE LOOP: an ACCEPTED fix teaches the global matrix. The lever that just
      // worked is written back onto every problem this version targeted and flipped to
      // Y, so the next run on any agent starts from a proven cure instead of rediscovering
      // it. A curated winning_lever is never overwritten — the new text lands in
      // how_solved, and only fills winning_lever when that column is still empty.
      if (data.status === 'accepted' && data.how_solved && data.targeted_problem) {
        const solved = String(data.targeted_problem).split('+')
          .map((x) => x.trim()).filter(Boolean)
          .filter((pid) => (data.statuses || {})[pid]?.verdict === 'Y');
        for (const pid of solved) {
          const prob = await ForgeProblem.findByPk(pid);
          if (!prob) continue;
          const up = { how_solved: data.how_solved, updated_at: new Date() };
          if (!prob.winning_lever) up.winning_lever = data.how_solved;
          await prob.update(up);
        }
        if (solved.length) console.log(`[forge] matrix learned from ${runId}: ${solved.join(', ')}`);
      }
    } else if (event_type === 'escalation_raised') {
      const run = await ForgeRun.findByPk(runId);
      if (run) {
        // Clone — mutating the model's own JSONB reference makes Sequelize's change
        // detection see "no change" and silently skip the column in the UPDATE.
        const esc = [...(run.escalations_json || [])];
        esc.push({
          id: esc.length + 1, version: data.version ?? null, problem_id: data.problem_id || null,
          question: data.question, options: data.options || [], rationale: data.rationale || '',
          answer: null, status: 'open', created_at: new Date().toISOString(),
        });
        await run.update({ escalations_json: esc, status: 'awaiting_human', updated_at: new Date() });
      }
    } else if (event_type === 'combo_matrix') {
      const run = await ForgeRun.findByPk(runId);
      await ForgeRun.update({
        combos_json: { ...(run.combos_json || {}), stages: data.stages, combos: data.combos,
          allocation: data.allocation, blocked: [] },
        updated_at: new Date(),
      }, { where: { id: runId } });
    } else if (event_type === 'combo_scored') {
      const run = await ForgeRun.findByPk(runId);
      const cj = { ...(run.combos_json || {}) };
      const results = (cj.results || []).filter((r) => r.key !== data.combo);
      results.push({ key: data.combo, solved_pct: data.solved_pct, composite: data.composite,
        passed: data.passed, n_sims: data.n_sims });
      await ForgeRun.update({ combos_json: { ...cj, results }, updated_at: new Date() },
        { where: { id: runId } });
    } else if (event_type === 'human_gate') {
      // The prompt cannot serve some combos. The run is HALTED until a human rules on
      // them — guessing would test a prompt production never sends.
      const run = await ForgeRun.findByPk(runId);
      await ForgeRun.update({
        status: 'awaiting_human',
        // The run HALTS here waiting on a person, so this is where the machine clock
        // stops — the duration a user cares about is start -> handover, and without
        // this a gated run had no end time at all.
        completed_at: new Date(),
        combos_json: { ...(run.combos_json || {}), stages: data.stages,
          blocked: data.blocked || [], gate_message: data.message },
        updated_at: new Date(),
      }, { where: { id: runId } });
    } else if (event_type === 'run_complete') {
      // needs_human_combo is the engine's way of saying "I halted, not finished" —
      // the human_gate handler already set awaiting_human; don't overwrite it with a
      // terminal-looking status or the resume button disappears.
      if (data.status === 'needs_human_combo') {
        const halted = await ForgeRun.findByPk(runId);
        await ForgeRun.update(
          { updated_at: new Date(), completed_at: halted?.completed_at || new Date() },
          { where: { id: runId } });
        return res.json({ ok: true });
      }
      const patch = { status: data.status, current_version: data.final_version, completed_at: new Date(), updated_at: new Date() };
      if (data.solved_pct != null) patch.solved_pct = data.solved_pct;
      // why each remaining problem is unsolved — the run's account of its own gap
      if (data.unsolved && typeof data.unsolved === 'object') patch.unsolved_json = data.unsolved;
      if (data.error) patch.error_message = String(data.error).slice(0, 1000); // the card shows this
      await ForgeRun.update(patch, { where: { id: runId } });

      // Arena chain: this contestant finished → dispatch the next queued one, or crown a winner.
      const finished = await ForgeRun.findByPk(runId);
      if (finished && finished.arena_id) {
        const arena = await ForgeArena.findByPk(finished.arena_id);
        if (arena && arena.status === 'running') {
          const members = await ForgeRun.findAll({ where: { arena_id: arena.id } });
          const queued = members.find((m) => m.status === 'queued');
          if (queued) {
            const contestant = (arena.contestants_json || []).find((c) => c.run_id === queued.id);
            try { await dispatchArenaContestant(arena, contestant); }
            catch (e) { await arena.update({ status: 'failed' }); }
          } else if (members.every((m) => !['queued', 'optimizing', 'collecting'].includes(m.status))) {
            // Rank by the deepeval battery FIRST (the code-computed metric checks are the
            // primary signal), composite second, problems-solved third.
            const scored = [];
            const metricMaps = [];
            for (const m of members) {
              const v = await ForgeVersion.findOne({
                where: { run_id: m.id, metrics_json: { [Op.ne]: null } }, order: [['version', 'DESC']],
              });
              metricMaps.push({ m, metrics: (v && v.metrics_json) || {} });
            }
            // Average ONLY over metrics every contestant has a number for — a null metric
            // (e.g. tool_calling when no tool fired) must not shrink one side's denominator.
            // intersect ONLY over contestants that produced metrics — a failed run
            // must not blank the average for everyone else
            const withMetrics = metricMaps.filter(({ metrics }) => Object.keys(metrics || {}).length > 0);
            const shared = Object.keys(withMetrics[0] ? withMetrics[0].metrics : {}).filter((k) =>
              withMetrics.every(({ metrics }) => typeof metrics[k] === 'number'));
            for (const { m, metrics } of metricMaps) {
              const vals = shared.map((k) => metrics[k]);
              const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
              scored.push({ run_id: m.id, deepeval_avg: avg, composite: m.final_composite, solved_pct: m.solved_pct });
            }
            scored.sort((a, b) =>
              (b.deepeval_avg ?? -1) - (a.deepeval_avg ?? -1) ||
              (b.composite ?? -1) - (a.composite ?? -1) ||
              (b.solved_pct ?? -1) - (a.solved_pct ?? -1));
            await arena.update({ status: 'complete', winner_run_id: scored[0] ? scored[0].run_id : null,
                                 ranking_json: scored, completed_at: new Date() });
          }
        }
      }
    }
  } catch (e) {
    // Never fail the engine's callback loop on a persistence hiccup; the raw event row is saved.
    console.warn('[forge ingest]', event_type, e.message);
  }
  res.json({ ok: true });
}

// ---- simulation archive (run-then-grade proof) ----------------------------

// Per-run TOOL REPORT: for every tool the model was offered — how often it was
// called correctly, hallucinated, or merely SPOKEN (leaked, never executed).
async function toolReport(req, res) {
  const sims = await ForgeSim.findAll({
    where: { run_id: req.params.id },
    attributes: ['sim_uid', 'kind', 'problem_id', 'probe', 'tool_calls_json', 'tool_leaks_json', 'tool_summary_json'],
  });
  const tools = {};
  const touch = (name) => (tools[name] = tools[name] || { name, fired: 0, unknown: 0, leaked: 0, sims: [] });
  let offered = new Set();
  let convosWithTools = 0, convosWithLeaks = 0;
  for (const s of sims) {
    const summ = s.tool_summary_json || null;
    if (summ && Array.isArray(summ.offered)) summ.offered.forEach((n) => offered.add(n));
    const calls = s.tool_calls_json || [];
    const leaks = s.tool_leaks_json || [];
    if (calls.length) convosWithTools += 1;
    if (leaks.length) convosWithLeaks += 1;
    for (const c of calls) {
      const t = touch(c.name);
      if (String(c.result || '').startsWith('Unknown function')) t.unknown += 1; else t.fired += 1;
      if (t.sims.length < 12) t.sims.push(s.sim_uid);
    }
    for (const l of leaks) {
      const t = touch(l.name);
      t.leaked += 1;
      if (t.sims.length < 12) t.sims.push(s.sim_uid);
    }
  }
  const rows = Object.values(tools).sort((a, b) => (b.fired + b.leaked + b.unknown) - (a.fired + a.leaked + a.unknown));
  res.json({
    n_sims: sims.length, convos_with_tools: convosWithTools, convos_with_leaks: convosWithLeaks,
    offered: Array.from(offered).sort(), tools: rows,
  });
}


async function listSims(req, res) {
  const where = { run_id: req.params.id };
  for (const k of ['kind', 'problem_id', 'verdict', 'probe', 'combo']) {
    if (req.query[k]) where[k] = req.query[k];
  }
  if (req.query.version != null && req.query.version !== '') where.version = Number(req.query.version);
  const rows = await ForgeSim.findAll({
    where,
    attributes: ['id', 'sim_uid', 'version', 'kind', 'problem_id', 'probe', 'idx', 'combo',
                 'ended', 'verdict', 'reason', 'failing_turn', 'created_at',
                 [require('sequelize').literal('jsonb_array_length(transcript_json)'), 'n_turns'],
                 [require('sequelize').literal("coalesce(jsonb_array_length(tool_calls_json), 0)"), 'n_tools'],
                 [require('sequelize').literal("coalesce(jsonb_array_length(tool_leaks_json), 0)"), 'n_leaks'],
                 [require('sequelize').literal("tool_summary_json->>'check_verdict'"), 'check_verdict']],
    order: [['id', 'ASC']],
    limit: Math.min(Number(req.query.limit) || 500, 2000),
  });
  res.json(rows);
}

async function getSim(req, res) {
  const row = await ForgeSim.findOne({ where: { sim_uid: req.params.uid } });
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}

// ---- global problem catalog (definitions) ---------------------------------

async function listProblems(_req, res) {
  res.json(await ForgeProblem.findAll({ order: PROBLEM_ORDER }));
}

async function patchProblem(req, res) {
  // Human-editable. filter_territory is human-ONLY by design (the coach can never set it).
  const allowed = ['behaviour', 'layer_for_fix', 'category', 'filter_territory', 'winning_lever',
                   'how_solved', 'applicability_json', 'has_detector', 'references_json'];
  const patch = { updated_at: new Date() };
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const [n] = await ForgeProblem.update(patch, { where: { id: req.params.id } });
  if (!n) return res.status(404).json({ error: 'not found' });
  res.json(await ForgeProblem.findByPk(req.params.id));
}

async function addProblem(req, res) {
  const b = req.body || {};
  if (!b.id || !b.behaviour) return res.status(400).json({ error: 'id and behaviour required' });
  const row = await ForgeProblem.create({
    id: b.id, behaviour: b.behaviour, layer_for_fix: b.layer_for_fix || null,
    category: b.category || null, filter_territory: !!b.filter_territory,
    winning_lever: b.winning_lever || null, applicability_json: b.applicability_json || {},
    has_detector: !!b.has_detector, source: 'human',
  });
  res.json(row);
}

// ---- layer library (agent_db_dev prompts, READ-ONLY) ----------------------

async function listLayers(req, res) {
  const type = req.query.type || 'universal';
  const out = { configured: agentDb.isConfigured(), db_name: agentDb.AGENT_DB_NAME, rows: [] };
  if (out.configured) {
    try { out.rows = await agentDb.listByType(type); } catch (e) { out.error = e.message; }
  }
  res.json(out);
}

async function getLayer(req, res) {
  try {
    const row = await agentDb.getById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

async function mergePreview(req, res) {
  try {
    const out = await forgeEngine.mergePreview(req.body.layers || {}, req.body.direction || 'outbound',
                                               req.body.lead_status || 'fresh');
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// ---- escalations (JSONB on the run row) -----------------------------------

async function answerEscalation(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  // Deep-clone rows: same-reference JSONB updates are skipped by Sequelize change detection.
  const esc = (run.escalations_json || []).map((e) => ({ ...e }));
  const item = esc.find((e) => String(e.id) === String(req.params.escId));
  if (!item) return res.status(404).json({ error: 'escalation not found' });
  item.answer = req.body.answer || '';
  item.status = 'answered';
  item.answered_at = new Date().toISOString();
  await run.update({ escalations_json: esc, updated_at: new Date() });
  res.json(item);
}

// ---- Phase-2 human review (JSONB on the run row) --------------------------

async function getReview(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  res.json(run.review_json || {});
}

async function submitReview(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const review = { ...(run.review_json || {}) };
  for (const k of ['reviewer_notes', 'resolved', 'edited_prompt', 'chat_log']) {
    if (k in b) review[k] = b[k];
  }
  const patch = { review_json: review, updated_at: new Date() };
  if (b.finalize) {
    review.finalized_at = new Date().toISOString();
    patch.status = 'finalized';
    patch.review_json = review;
  }
  await run.update(patch);
  res.json(review);
}

async function chat(req, res) {
  try {
    const out = await forgeEngine.chatTurn(req.params.id, req.body || {});
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// Human-loop "re-run the datasets": baseline pipeline (matrix + stress + deepeval) with NO
// coaching, against the reviewer's edited prompt if present, else the latest champion.
async function evaluateRun(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });

  const review = run.review_json || {};
  const latest = await ForgeVersion.findOne({
    where: { run_id: run.id, status: { [Op.in]: ['accepted', 'baseline'] } },
    order: [['version', 'DESC']],
  });

  let champion;
  if (run.mode === 'layered') {
    const layers = (latest && latest.config_json) || (run.original_prompt_snapshot || {}).layers || {};
    // override_keys are load-bearing: they DELETE a dot-path before that layer merges.
    // Dropping them here silently produced a different merged prompt than the run's own
    // baseline. Rebuild them from layers_json (recorded at createRun).
    const ok = {};
    for (const l of run.layers_json || []) {
      if (l && l.layer_type) ok[l.layer_type] = l.override_keys || [];
    }
    champion = { layers: { addon: [], ...layers }, override_keys: ok };
  } else {
    const blob = review.edited_prompt
      || (latest && latest.config_json && latest.config_json.blob)
      || (run.original_prompt_snapshot || {}).blob || '';
    champion = { blob };
  }
  // Standalone reviewer edits override the blob; layered reviewer edits are campaign JSON.
  if (run.mode === 'layered' && review.edited_prompt) {
    try { champion.layers.campaign = JSON.parse(review.edited_prompt); } catch (_e) { /* keep as-is */ }
  }

  const allProblems = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  const problems = allProblems.map((p) => p.toJSON()).map((p) => ({
    id: p.id, behaviour: p.behaviour, layer_for_fix: p.layer_for_fix,
    has_detector: p.has_detector, filter_territory: p.filter_territory, winning_lever: p.winning_lever,
  }));

  const spec = {
    mode: run.mode, direction: run.direction || 'outbound', lead_status: run.lead_status || 'fresh',
    vertical: run.vertical, champion, problems,
    scoring: { ...(run.scoring_json || {}), max_iterations: 0 },
    probes: run.probes_json || [],
  };
  // A child run row of its own, so the evaluation's events/versions persist cleanly and the
  // original run's history is never overwritten. It shows up in the list as "<name> · re-eval".
  const evalId = nanoid(12);
  await ForgeRun.create({
    id: evalId, name: `${run.name || run.id} · re-eval`, mode: run.mode, status: 'optimizing',
    dataset_kind: run.dataset_kind, dataset_json: run.dataset_json, scoring_json: spec.scoring,
    vertical: run.vertical, language: run.language, direction: run.direction, lead_status: run.lead_status,
    original_prompt_snapshot: run.mode === 'layered' ? { mode: 'layered', layers: champion.layers } : { mode: 'standalone', blob: champion.blob },
    probes_json: run.probes_json || [],
  });
  try {
    await forgeEngine.evaluateOnly(evalId, spec, {});
  } catch (e) {
    await ForgeRun.update({ status: 'failed', error_message: e.message }, { where: { id: evalId } });
    return res.status(502).json({ error: `engine dispatch failed: ${e.message}` });
  }
  res.json({ ok: true, eval_run_id: evalId });
}

// Export merged markdown + per-layer JSONs (deploy stays a human act — no prod write).
async function exportRun(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const latest = await ForgeVersion.findOne({
    where: { run_id: run.id, status: { [Op.in]: ['accepted', 'baseline'] } },
    order: [['version', 'DESC']],
  });
  res.json({
    run_id: run.id, mode: run.mode, status: run.status,
    solved_pct: run.solved_pct, composite: run.final_composite,
    merged_markdown: latest ? latest.merged_markdown : null,
    greeting: latest ? latest.greeting : null,
    config: latest && latest.config_json ? latest.config_json : run.original_prompt_snapshot,
    // The human reviewer's edit is the FINAL deliverable when present (Phase 2 output).
    reviewed_prompt: (run.review_json && run.review_json.edited_prompt) || null,
    reviewer_notes: (run.review_json && run.review_json.reviewer_notes) || null,
  });
}

module.exports = {
  listSavedPrompts, getSavedPrompt, createSavedPrompt, updateSavedPrompt, deleteSavedPrompt,
  linkSavedPrompt, unlinkSavedPrompt,
  getCoachGuidance,
  setCoachGuidance,
  resolveCombos,
  createRun, listRuns, getRun, renameRun, deleteRun, stopRun, getLog, getMatrix, ingestForgeEvent,
  listDatasets, getDataset, createDataset, deleteDataset,
  listLlms, createLlm, updateLlm, deleteLlm,
  createArena, listArenas, getArena, deleteArena, testArenaLlm, retryArenaContestant, updateArenaContestant, reevaluateArena,
  listSims, getSim, toolReport,
  listProblems, patchProblem, addProblem,
  listLayers, getLayer, mergePreview,
  answerEscalation, getReview, submitReview, chat, evaluateRun, exportRun,
};
