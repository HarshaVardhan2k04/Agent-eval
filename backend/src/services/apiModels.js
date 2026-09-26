// The models a public-API caller may choose, by slug, for each of the three roles.
//
// An ALLOWLIST, not a passthrough: a caller sends a slug, never a base URL, a model id
// or a key. That keeps our endpoints and credentials off the wire, stops the API being
// turned into an open proxy for whatever the caller fancies, and means a report can
// always say exactly which model produced it.
//
// PIN THE PROVIDER. OpenRouter serves one model id from many providers at different
// quantisations, prices and context limits — deepseek-v4.1-flash has 27. Unpinned, the
// same request lands on a different machine run to run and the judge silently changes.
// `allow_fallbacks: false` means a request fails loudly rather than quietly rerouting
// to a provider charging 5x.
//
// Secrets resolve from env at call time and are never stored on a run or returned.
const MODELS = {
  'gemma-26b': {
    label: 'Gemma 4 26B (self-hosted)',
    base_url: 'http://16.112.145.206:8000/v1',
    model: '/models/gemma4-awq',
    api_key_env: null,              // open on our network
    context: 32768,
    cost: { in_per_m: 0, out_per_m: 0 },   // our own box — no per-token cost
    notes: 'The production model. Default for every role.',
  },
  'gemma-31b': {
    label: 'Gemma 4 31B QAT (self-hosted)',
    base_url: 'http://98.130.134.64:8000/v1',
    model: '/mnt/modelstore/g31b-qat-w4a16',
    api_key_env: 'GEMMA_31B_API_KEY',
    context: 32768,
    cost: { in_per_m: 0, out_per_m: 0 },
    notes: 'Larger self-hosted Gemma.',
  },
  'deepseek-flash': {
    label: 'DeepSeek V4.1 Flash (OpenRouter · Morph)',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4.1-flash',
    api_key_env: 'OPENROUTER_API_KEY',
    context: 1048576,
    // Morph, measured 2026-09-25. Emits no reasoning tokens on judge calls, which is
    // what makes it cheap enough to grade with: a reasoning model billed ~80x more for
    // the same verdict.
    provider: { order: ['Morph'], allow_fallbacks: false },
    cost: { in_per_m: 0.075, out_per_m: 0.30 },
    notes: 'Cheapest capable judge. JSON mode verified against the Morph endpoint.',
  },
};

const DEFAULT_MODEL = 'gemma-26b';
const ROLES = ['agent', 'human', 'judge'];

function listModels() {
  return Object.entries(MODELS).map(([slug, m]) => ({
    slug, label: m.label, context: m.context, cost: m.cost, notes: m.notes,
  }));
}

// slug -> the engine config keys for one role. Throws on an unknown slug so a typo is a
// 400 the caller can read, never a silent fall back to a different model.
function resolveRole(role, slug) {
  const m = MODELS[slug];
  if (!m) {
    const err = new Error(`unknown model "${slug}" for role "${role}" — choose one of: ${Object.keys(MODELS).join(', ')}`);
    err.status = 400;
    err.code = 'unknown_model';
    throw err;
  }
  const key = m.api_key_env ? process.env[m.api_key_env] : null;
  if (m.api_key_env && !key) {
    const err = new Error(`model "${slug}" is not available on this deployment (missing ${m.api_key_env})`);
    err.status = 503;
    err.code = 'model_unavailable';
    throw err;
  }
  // 'agent' uses the bare llm_* keys the engine already reads; the other two are prefixed.
  const p = role === 'agent' ? 'llm' : role === 'human' ? 'human' : 'judge';
  const cfg = {
    [`${p}_base_url`]: m.base_url,
    [`${p}_model`]: m.model,
  };
  if (key) cfg[`${p}_api_key`] = key;
  if (m.provider) cfg[`${p}_params`] = { provider: m.provider };
  return cfg;
}

// What a run cost, from the per-role token tallies the engine reports.
function priceRun(tokensJson, chosen) {
  const out = {};
  let total = 0;
  for (const role of ROLES) {
    const u = (tokensJson || {})[role];
    const m = MODELS[(chosen || {})[role]];
    if (!u || !m || typeof u.prompt_tokens !== 'number') continue;
    const usd = (u.prompt_tokens / 1e6) * m.cost.in_per_m
              + (u.completion_tokens / 1e6) * m.cost.out_per_m;
    out[role] = {
      model: chosen[role],
      calls: u.calls,
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      usd: Math.round(usd * 1e6) / 1e6,
    };
    total += usd;
  }
  return { by_role: out, total_usd: Math.round(total * 1e6) / 1e6 };
}

module.exports = { MODELS, DEFAULT_MODEL, ROLES, listModels, resolveRole, priceRun };
