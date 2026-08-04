// Calls the engine to score one call. The engine owns the Gemma judge.
const { engineUrl } = require('../config/app');

async function scoreCall(payload) {
  const res = await fetch(`${engineUrl}/api/analysis/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine analysis error: ${res.status} ${text}`);
  }
  return res.json();
}

module.exports = { scoreCall };
