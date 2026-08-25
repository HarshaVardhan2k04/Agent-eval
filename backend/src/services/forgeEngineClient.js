// Thin client over the Python engine's Forge routes. The backend owns persistence;
// the engine owns the optimization compute. Events flow back to /api/internal/forge-events.
const { engineUrl, selfUrl } = require('../config/app');

async function post(path, body) {
  const res = await fetch(`${engineUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine error: ${res.status} ${text}`);
  }
  return res.json();
}

function dispatchForge(runId, spec, config = {}) {
  return post('/api/forge/start', {
    run_id: runId,
    spec,
    config,
    callback_url: `${selfUrl}/api/internal/forge-events`,
  });
}

function evaluateOnly(runId, spec, config = {}) {
  return post('/api/forge/evaluate', {
    run_id: runId,
    spec,
    config,
    callback_url: `${selfUrl}/api/internal/forge-events`,
  });
}

function regradeForge(runId, spec, config = {}) {
  return post('/api/forge/regrade', {
    run_id: runId,
    spec,
    config,
    callback_url: `${selfUrl}/api/internal/forge-events`,
  });
}

async function stopForge(runId) {
  const res = await fetch(`${engineUrl}/api/forge/${runId}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(`Engine error: ${res.status} ${await res.text()}`);
  return res.json();
}

function mergePreview(layers, direction, leadStatus) {
  return post('/api/forge/merge-preview', { layers, direction, lead_status: leadStatus });
}

function chatTurn(runId, body) {
  return post(`/api/forge/${runId}/chat`, body);
}

module.exports = { dispatchForge, evaluateOnly, regradeForge, stopForge, mergePreview, chatTurn };
