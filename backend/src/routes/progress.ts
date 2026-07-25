import { Router } from 'express'
import type { Request, Response } from 'express'
import { query } from '../db/connection.js'
import { storePromptVersion } from '../services/promptStore.js'

export const progressRouter = Router()

const sseClients = new Map<string, Set<Response>>()

export function broadcastToEval(evalId: string, event: Record<string, unknown>) {
  const clients = sseClients.get(evalId)
  if (!clients) return
  const data = JSON.stringify(event)
  for (const res of clients) {
    res.write(`data: ${data}\n\n`)
  }
}

progressRouter.get('/:id/events', (req: Request, res: Response) => {
  const evalId = req.params.id as string

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  if (!sseClients.has(evalId)) {
    sseClients.set(evalId, new Set())
  }
  sseClients.get(evalId)!.add(res)

  req.on('close', () => {
    sseClients.get(evalId)?.delete(res)
    if (sseClients.get(evalId)?.size === 0) {
      sseClients.delete(evalId)
    }
  })
})

progressRouter.post('/internal/eval-events', async (req: Request, res: Response) => {
  try {
    const event = req.body as { event_type: string; data: Record<string, unknown> }
    const evalId = event.data?.eval_id as string

    if (!evalId) {
      res.status(400).json({ error: 'Missing eval_id in event data' })
      return
    }

    await query(
      'INSERT INTO eval_events (eval_id, event_type, event_data) VALUES ($1, $2, $3)',
      [evalId, event.event_type, JSON.stringify(event.data)]
    )

    if (event.event_type === 'iteration_complete') {
      const data = event.data
      const iteration = data.iteration as number
      const scenarioResults = data.scenario_results as Array<Record<string, unknown>>

      await query(
        "UPDATE evals SET iterations_run = $1, final_score = $2, updated_at = NOW() WHERE id = $3",
        [iteration, data.score, evalId]
      )

      if (scenarioResults) {
        for (const sr of scenarioResults) {
          await query(
            `INSERT INTO scenario_results
              (eval_id, iteration, scenario_name, scenario_type, response_text, transcript_json, tool_calls_json, scores_json, voice_analysis_json, judge_reasoning, composite_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              evalId,
              iteration,
              sr.scenario_name,
              sr.scenario_type,
              sr.response || null,
              JSON.stringify(sr.transcript || []),
              JSON.stringify(sr.tool_calls || []),
              JSON.stringify(sr.scores || {}),
              JSON.stringify(sr.voice_analysis || {}),
              sr.judge_reasoning || null,
              sr.composite_score,
            ]
          )
        }
      }
    }

    if (event.event_type === 'prompt_improved') {
      const data = event.data
      const promptVersions = data.prompt_versions as Array<{ version: number; prompt: string; score: number; changes: string }> | undefined
      if (promptVersions) {
        const latest = promptVersions[promptVersions.length - 1]
        if (latest) {
          await storePromptVersion(evalId, latest.version, latest.prompt, latest.score, latest.changes)
        }
      }
    }

    if (event.event_type === 'eval_complete') {
      const data = event.data
      const status = data.status as string || 'completed'

      await query(
        "UPDATE evals SET status = $1, final_score = $2, iterations_run = $3, completed_at = NOW(), updated_at = NOW() WHERE id = $4",
        [status, data.final_score, data.iterations_run, evalId]
      )

      const promptVersions = data.prompt_versions as Array<{ version: number; prompt: string; score: number; changes: string; edits?: unknown[] }> | undefined
      if (promptVersions) {
        for (const pv of promptVersions) {
          await storePromptVersion(evalId, pv.version, pv.prompt, pv.score, pv.changes, pv.edits || [])
        }
      }
    }

    broadcastToEval(evalId, event)

    res.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
