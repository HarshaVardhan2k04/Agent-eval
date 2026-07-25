import { createTwoFilesPatch } from 'diff'
import { query } from '../db/connection.js'

export async function storePromptVersion(
  evalId: string,
  version: number,
  promptText: string,
  score: number | null,
  changesSummary: string,
  edits: unknown[] = []
) {
  let diffText: string | null = null

  if (version > 0) {
    const prev = await query(
      'SELECT prompt_text FROM prompt_versions WHERE eval_id = $1 AND version = $2',
      [evalId, version - 1]
    )
    if (prev.rows.length > 0) {
      diffText = createTwoFilesPatch(
        `prompt_v${version - 1}`,
        `prompt_v${version}`,
        prev.rows[0].prompt_text,
        promptText,
        '', '',
        { context: 3 }
      )
    }
  }

  await query(
    `INSERT INTO prompt_versions (eval_id, version, prompt_text, score, changes_summary, diff_from_previous, edits_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (eval_id, version) DO UPDATE SET
       score = EXCLUDED.score,
       changes_summary = EXCLUDED.changes_summary,
       diff_from_previous = EXCLUDED.diff_from_previous,
       edits_json = EXCLUDED.edits_json`,
    [evalId, version, promptText, score, changesSummary, diffText, JSON.stringify(edits || [])]
  )
}

export async function getPromptVersions(evalId: string) {
  const result = await query(
    'SELECT * FROM prompt_versions WHERE eval_id = $1 ORDER BY version',
    [evalId]
  )
  return result.rows
}

export async function getPromptDiff(evalId: string, version: number) {
  const result = await query(
    'SELECT diff_from_previous, prompt_text FROM prompt_versions WHERE eval_id = $1 AND version = $2',
    [evalId, version]
  )
  if (result.rows.length === 0) return null
  return result.rows[0]
}
