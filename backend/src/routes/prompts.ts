import { Router } from 'express'
import { getPromptVersions, getPromptDiff } from '../services/promptStore.js'

export const promptsRouter = Router()

promptsRouter.get('/:id/prompts', async (req, res) => {
  try {
    const versions = await getPromptVersions(req.params.id)
    res.json(versions)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

promptsRouter.get('/:id/prompts/:version/diff', async (req, res) => {
  try {
    const version = parseInt(req.params.version)
    const result = await getPromptDiff(req.params.id, version)
    if (!result) {
      res.status(404).json({ error: 'Version not found' })
      return
    }
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
