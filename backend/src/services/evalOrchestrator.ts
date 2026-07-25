import { config } from '../config.js'
import type { EvalConfig } from '../types/index.js'

export async function dispatchEval(
  evalId: string,
  systemPrompt: string,
  scenarios: unknown,
  evalConfig: EvalConfig
) {
  const response = await fetch(`${config.engineUrl}/api/eval/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eval_id: evalId,
      system_prompt: systemPrompt,
      scenarios,
      config: evalConfig,
      callback_url: `${config.selfUrl}/api/internal/eval-events`,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Engine error: ${response.status} ${text}`)
  }

  return response.json()
}

export async function stopEval(evalId: string) {
  const response = await fetch(`${config.engineUrl}/api/eval/${evalId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Engine error: ${response.status} ${text}`)
  }

  return response.json()
}
