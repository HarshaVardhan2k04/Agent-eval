// Thin client over the Python engine. The backend owns persistence; the engine
// owns the LLM/eval compute. Kept dumb on purpose — no ret/backoff here yet.
const { engineUrl, selfUrl } = require('../config/app');

async function dispatchEval(evalId, systemPrompt, scenarios, evalConfig) {
  const response = await fetch(`${engineUrl}/api/eval/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eval_id: evalId,
      system_prompt: systemPrompt,
      scenarios,
      config: evalConfig,
      callback_url: `${selfUrl}/api/internal/eval-events`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Engine error: ${response.status} ${text}`);
  }
  return response.json();
}

async function stopEval(evalId) {
  const response = await fetch(`${engineUrl}/api/eval/${evalId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Engine error: ${response.status} ${text}`);
  }
  return response.json();
}

module.exports = { dispatchEval, stopEval };
