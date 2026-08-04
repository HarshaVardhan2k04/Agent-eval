// Asks the engine's Gemma instance to turn pasted flow text into a node graph.
const { engineUrl } = require('../config/app');

async function generate({ text, notes, direction }) {
  const res = await fetch(`${engineUrl}/api/flow/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, notes: notes || '', direction: direction || 'inbound' }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Engine flow error: ${res.status} ${t}`);
  }
  return res.json();
}

async function edit({ graph, instruction }) {
  const res = await fetch(`${engineUrl}/api/flow/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, instruction }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Engine flow error: ${res.status} ${t}`);
  }
  return res.json();
}

module.exports = { generate, edit };
