// Public verification API (/api/v1) — the ONE thing an outside system can ask Forge to
// do: "here is a prompt, tell me what is wrong with it".
//
// Deliberately narrow. The caller sends a prompt and nothing else that could move the
// score: the judge is ours (pinned by env), the dataset is ours (houseDataset.js), the
// problem matrix is ours. Two callers' numbers are therefore comparable, and a score
// cannot be gamed by sending easier personas. Nothing here can optimize or edit a
// prompt — objective is hard-coded to 'verify'.
const { nanoid } = require('nanoid');
const { ForgeRun, ForgeProblem, ForgeVersion } = require('../models');
const forgeEngine = require('../services/forgeEngineClient');
const { HOUSE_PERSONAS, HOUSE_DATASET_VERSION } = require('../services/houseDataset');
const { DEFAULT_MODEL, ROLES, listModels, resolveRole, priceRun } = require('../services/apiModels');
const { PROBLEM_ORDER, applies } = require('./forgeController');

// Scoring is fixed too — a caller must not be able to buy a better score by asking for
// fewer votes. 3 votes + 5 deep-confirm sims is what the in-product default uses.
const API_SCORING = Object.freeze({
  best_of_n: 1, votes: 3, confirm_votes: 5, stress_target: 48,
  tool_checks: true, fix_tools: false, objective: 'verify',
});

const MAX_PROMPT_CHARS = 120000;

// ---- auth ------------------------------------------------------------------
// Keys live ONLY in backend/.env (gitignored), comma-separated, never logged. A
// request is rejected outright when none are configured, so a misconfigured deploy
// fails closed rather than serving the world.
function apiKeys() {
  return String(process.env.FORGE_API_KEYS || '')
    .split(',').map((k) => k.trim()).filter(Boolean);
}

function requireApiKey(req, res, next) {
  const keys = apiKeys();
  if (!keys.length) {
    return res.status(503).json({ error: 'api_not_configured', message: 'No FORGE_API_KEYS configured on this deployment.' });
  }
  const hdr = String(req.headers.authorization || '');
  const tok = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!tok || !keys.includes(tok)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Send a valid key as: Authorization: Bearer <key>' });
  }
  // The key itself never leaves this function — downstream only sees a short, stable
  // fingerprint, so a key can be traced through the logs without ever being written.
  req.apiKeyId = require('crypto').createHash('sha256').update(tok).digest('hex').slice(0, 12);
  next();
}

// ---- model selection ------------------------------------------------------
// Three roles, three models, chosen by slug from the allowlist in apiModels.js:
//   agent — the prompt under test, speaks as the agent
//   human — plays the lead on the other end of every call
//   judge — reads FINISHED transcripts and rules on each problem, with a reason
// The judge never speaks and the agent never grades. All three default to the
// self-hosted Gemma, so a caller who sends only a prompt is never billed.
function pickModels(body) {
  const chosen = {};
  for (const role of ROLES) {
    const v = body[role];
    if (v != null && typeof v !== 'string') {
      const e = new Error(`"${role}" must be a model slug string`);
      e.status = 400; e.code = 'bad_model'; throw e;
    }
    chosen[role] = v || DEFAULT_MODEL;
  }
  let config = {};
  for (const role of ROLES) config = { ...config, ...resolveRole(role, chosen[role]) };
  return { chosen, config };
}

// ---- POST /api/v1/verify ---------------------------------------------------
async function createVerify(req, res) {
  const b = req.body || {};
  const mode = b.mode || 'standalone';

  if (mode === 'layered') {
    return res.status(400).json({
      error: 'not_supported_yet',
      message: 'Layered prompts are not accepted on this API yet. Send mode "standalone" with the merged prompt text.',
    });
  }
  if (mode !== 'standalone') {
    return res.status(400).json({ error: 'bad_mode', message: `mode must be "standalone" (got ${JSON.stringify(mode)}).` });
  }

  const prompt = typeof b.prompt === 'string' ? b.prompt : '';
  if (prompt.trim().length < 20) {
    return res.status(400).json({ error: 'prompt_required', message: 'Send the agent prompt as "prompt" (at least 20 characters).' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: 'prompt_too_large', message: `Prompt is ${prompt.length} characters; the limit is ${MAX_PROMPT_CHARS}.` });
  }

  const vertical = typeof b.vertical === 'string' ? b.vertical : null;
  const direction = b.direction === 'inbound' ? 'inbound' : 'outbound';

  const all = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  const problems = all.map((p) => p.toJSON())
    .filter((p) => applies(p, { vertical, mode: 'standalone', direction, language: null }))
    .map((p) => ({
      id: p.id, behaviour: p.behaviour, layer_for_fix: p.layer_for_fix,
      has_detector: p.has_detector, filter_territory: p.filter_territory,
      winning_lever: p.winning_lever,
      references: Array.isArray(p.references_json) ? p.references_json : [],
    }));

  let chosen, engineConfig;
  try {
    ({ chosen, config: engineConfig } = pickModels(b));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.code || 'bad_request', message: e.message, models: listModels() });
  }

  const runId = nanoid(12);
  const scoring = {
    ...API_SCORING, source: 'api', api_key_id: req.apiKeyId,
    dataset_version: HOUSE_DATASET_VERSION,
    models: chosen, // slugs only — never a url or a key
  };

  await ForgeRun.create({
    id: runId,
    name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim().slice(0, 120) : `api · ${runId}`,
    mode: 'standalone', status: 'optimizing',
    dataset_kind: 'authored',
    dataset_json: { kind: 'authored', n: HOUSE_PERSONAS.length, version: HOUSE_DATASET_VERSION },
    scoring_json: scoring, vertical, direction, lead_status: 'fresh',
    original_prompt_snapshot: { mode: 'standalone', blob: prompt },
    probes_json: HOUSE_PERSONAS.map((p) => ({ ...p, source: 'house' })),
  });

  const spec = {
    mode: 'standalone', direction, lead_status: 'fresh', vertical,
    champion: { blob: prompt },
    problems, scoring, objective: 'verify',
    dataset: { kind: 'authored', personas: HOUSE_PERSONAS },
    probes: HOUSE_PERSONAS,
  };

  try {
    await forgeEngine.dispatchForge(runId, spec, engineConfig);
  } catch (e) {
    await ForgeRun.update({ status: 'failed', error_message: e.message }, { where: { id: runId } });
    return res.status(502).json({ error: 'dispatch_failed', message: e.message });
  }

  res.status(202).json({
    id: runId,
    status: 'running',
    poll: `/api/v1/verify/${runId}`,
    dataset_version: HOUSE_DATASET_VERSION,
    models: chosen,
    estimated_seconds: 600,
  });
}

// ---- GET /api/v1/verify/:id ------------------------------------------------
// Shapes the internal run into a stable external contract. Internal status names
// (optimizing/llm_complete/...) are NOT leaked — a caller should never have to care
// that a verification is implemented on the optimizer's plumbing.
const PHASE_LABEL = {
  tool_checks: 'checking whether the tools fire',
  conversations: 'running the problem-matrix conversations',
  judging: 'judging the conversations',
  confirm_convos: 'confirming the passes at scale',
  stress: 'running the free-play stress battery',
  deepeval: 'scoring conversation quality',
};

async function getVerify(req, res) {
  const run = await ForgeRun.findByPk(req.params.id);
  if (!run) return res.status(404).json({ error: 'not_found' });
  // A key may only read its own runs.
  if ((run.scoring_json || {}).api_key_id !== req.apiKeyId) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (run.status === 'failed') {
    return res.json({ id: run.id, status: 'failed', error: run.error_message || 'the run failed' });
  }
  if (run.status !== 'verified') {
    const { ForgeEvent } = require('../models');
    const last = await ForgeEvent.findOne({
      where: { run_id: run.id, event_type: 'progress' }, order: [['id', 'DESC']],
    });
    const d = (last && last.event_data) || {};
    return res.json({
      id: run.id,
      status: run.status === 'stopped' ? 'cancelled' : 'running',
      progress: d.phase ? { stage: PHASE_LABEL[d.phase] || d.phase, done: d.done ?? null, total: d.total ?? null } : null,
    });
  }

  const version = await ForgeVersion.findOne({ where: { run_id: run.id, version: 0 } });
  const statuses = (version && version.statuses_json) || {};
  const unsolved = run.unsolved_json || {};
  const problems = await ForgeProblem.findAll({ order: PROBLEM_ORDER });
  const behaviourOf = Object.fromEntries(problems.map((p) => [p.id, p.behaviour]));
  const leverOf = Object.fromEntries(problems.map((p) => [p.id, p.winning_lever]));
  const layerOf = Object.fromEntries(problems.map((p) => [p.id, p.layer_for_fix]));

  const denom = run.denominator_snapshot_json || [];
  const byNum = (a, b) => Number(String(a.id).replace(/\D/g, '')) - Number(String(b.id).replace(/\D/g, ''));

  const found = Object.entries(unsolved).map(([id, u]) => ({
    id,
    problem: behaviourOf[id] || id,
    verdict: u.verdict,                 // 'N' = present, '~' = could not be concluded
    status: u.verdict === 'N' ? 'present' : 'inconclusive',
    why: u.why,
    evidence: u.evidence || null,
    // What normally fixes this one, from the shared matrix. Null when we have never
    // recorded a proven lever — better than inventing advice.
    suggested_fix: leverOf[id] || null,
    fix_belongs_in: layerOf[id] || null,
  })).sort(byNum);

  const clean = denom.filter((id) => (statuses[id] || {}).verdict === 'Y')
    .map((id) => ({ id, problem: behaviourOf[id] || id })).sort(byNum);

  res.json({
    id: run.id,
    status: 'done',
    dataset_version: (run.scoring_json || {}).dataset_version || null,
    models: (run.scoring_json || {}).models || null,
    started_at: run.created_at,
    finished_at: run.completed_at,
    duration_seconds: run.completed_at
      ? Math.round((new Date(run.completed_at) - new Date(run.created_at)) / 1000) : null,
    summary: {
      problems_checked: denom.length,
      clean: clean.length,
      found: found.length,
      score_pct: run.solved_pct,
    },
    found,
    clean,
    // Habits counted in code over every agent turn of the free-play battery. These are
    // rates, not verdicts — they say HOW OFTEN, which is what a caller acts on.
    habits_at_scale: (version && version.stress_json) || null,
    // Conversation-quality battery. Reported, but see the caveat: it scores high even
    // on prompts with many failing problems, so `found` is the signal, not this.
    quality_metrics: (version && version.metrics_json) || null,
    tool_checks: (version && version.tool_checks_json) || null,
    // What this verification cost on our side. Only the judge half is ours — it does
    // the grading AND plays the simulated human on every turn. Reported so a caller
    // (and we) can price a verification instead of guessing at it.
    // What this verification actually cost, per role, at the chosen models' rates.
    // Self-hosted models price at zero, so a default run reports 0 honestly rather
    // than pretending it was free of compute.
    cost: priceRun(run.tokens_json, (run.scoring_json || {}).models),
  });
}

// GET /api/v1/models — what a caller may choose, with rates. Behind the same key.
async function getModels(_req, res) { res.json({ models: listModels(), default: DEFAULT_MODEL, roles: ROLES }); }

module.exports = { requireApiKey, createVerify, getVerify, getModels, API_SCORING };
