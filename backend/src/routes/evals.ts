import { Router } from 'express'
import { nanoid } from 'nanoid'
import { query } from '../db/connection.js'
import { dispatchEval, stopEval } from '../services/evalOrchestrator.js'
import { storePromptVersion } from '../services/promptStore.js'
import type { EvalConfig } from '../types/index.js'

export const evalsRouter = Router()

evalsRouter.post('/', async (req, res) => {
  try {
    const { name, system_prompt, scenarios, config } = req.body as {
      name?: string
      system_prompt: string
      scenarios: unknown
      config: EvalConfig
    }

    if (!system_prompt || !scenarios) {
      res.status(400).json({ error: 'system_prompt and scenarios are required' })
      return
    }

    const evalId = nanoid(12)
    const evalName = name && name.trim() ? name.trim() : null

    await query(
      `INSERT INTO evals (id, name, status, original_prompt, scenarios_json, config_json, max_iterations, quality_threshold)
       VALUES ($1, $2, 'running', $3, $4, $5, $6, $7)`,
      [
        evalId,
        evalName,
        system_prompt,
        JSON.stringify(scenarios),
        JSON.stringify(config),
        config.max_iterations || 5,
        config.quality_threshold || 0.9,
      ]
    )

    await storePromptVersion(evalId, 0, system_prompt, null, 'Initial prompt')

    await dispatchEval(evalId, system_prompt, scenarios, config)

    res.json({ eval_id: evalId, status: 'running' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.get('/', async (_req, res) => {
  try {
    const result = await query(
      'SELECT id, name, status, final_score, iterations_run, max_iterations, quality_threshold, created_at, completed_at FROM evals ORDER BY created_at DESC'
    )
    res.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM evals WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Eval not found' })
      return
    }
    res.json(result.rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.get('/:id/results', async (req, res) => {
  try {
    const iteration = req.query.iteration ? parseInt(req.query.iteration as string) : null
    let sql = 'SELECT * FROM scenario_results WHERE eval_id = $1'
    const params: unknown[] = [req.params.id]

    if (iteration !== null) {
      sql += ' AND iteration = $2'
      params.push(iteration)
    }
    sql += ' ORDER BY iteration, scenario_name'

    const result = await query(sql, params)
    res.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.get('/:id/log', async (req, res) => {
  try {
    const after = req.query.after ? parseInt(req.query.after as string) : 0
    const result = await query(
      `SELECT id, event_type, event_data, created_at
       FROM eval_events
       WHERE eval_id = $1 AND id > $2
       ORDER BY id ASC
       LIMIT 1000`,
      [req.params.id, after]
    )
    res.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.post('/:id/stop', async (req, res) => {
  try {
    await stopEval(req.params.id)
    await query(
      "UPDATE evals SET status = 'stopped', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    )
    res.json({ eval_id: req.params.id, status: 'stopped' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM evals WHERE id = $1', [req.params.id])
    res.json({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

evalsRouter.post('/:id/rerun', async (req, res) => {
  try {
    const { version } = req.body as { version: number }
    const evalResult = await query('SELECT * FROM evals WHERE id = $1', [req.params.id])
    if (evalResult.rows.length === 0) {
      res.status(404).json({ error: 'Eval not found' })
      return
    }

    const promptResult = await query(
      'SELECT prompt_text FROM prompt_versions WHERE eval_id = $1 AND version = $2',
      [req.params.id, version]
    )
    if (promptResult.rows.length === 0) {
      res.status(404).json({ error: 'Prompt version not found' })
      return
    }

    const original = evalResult.rows[0]
    const newId = nanoid(12)
    const config = original.config_json
    const rerunName = `Rerun: ${original.name || original.id} v${version}`

    await query(
      `INSERT INTO evals (id, name, status, original_prompt, scenarios_json, config_json, max_iterations, quality_threshold)
       VALUES ($1, $2, 'running', $3, $4, $5, $6, $7)`,
      [newId, rerunName, promptResult.rows[0].prompt_text, original.scenarios_json, JSON.stringify(config), config.max_iterations || 5, config.quality_threshold || 0.9]
    )

    await storePromptVersion(newId, 0, promptResult.rows[0].prompt_text, null, `Re-run from eval ${req.params.id} version ${version}`)
    await dispatchEval(newId, promptResult.rows[0].prompt_text, original.scenarios_json, config)

    res.json({ eval_id: newId, status: 'running' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
