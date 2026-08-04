// Proxy to the engine's Test-an-LLM endpoints (the engine owns the model calls).
const { engineUrl } = require('../config/app');

async function info() {
  const res = await fetch(`${engineUrl}/api/llm/info`);
  if (!res.ok) throw new Error(`Engine LLM error: ${res.status}`);
  return res.json();
}

async function test(body) {
  const res = await fetch(`${engineUrl}/api/llm/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Engine LLM error: ${res.status} ${t}`);
  }
  return res.json();
}

module.exports = { info, test };
