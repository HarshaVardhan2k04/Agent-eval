import { query } from './connection.js'

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS evals (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      original_prompt TEXT NOT NULL,
      scenarios_json JSONB NOT NULL,
      config_json JSONB NOT NULL,
      final_score REAL,
      iterations_run INTEGER DEFAULT 0,
      max_iterations INTEGER NOT NULL,
      quality_threshold REAL NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error_message TEXT
    )
  `)

  // Added after initial release — safe to run repeatedly.
  await query(`ALTER TABLE evals ADD COLUMN IF NOT EXISTS name TEXT`)

  await query(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id SERIAL PRIMARY KEY,
      eval_id TEXT NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      score REAL,
      changes_summary TEXT,
      diff_from_previous TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(eval_id, version)
    )
  `)

  // Added after initial release — the coach's patch (list of edits) for this version.
  await query(`ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS edits_json JSONB`)

  await query(`
    CREATE TABLE IF NOT EXISTS scenario_results (
      id SERIAL PRIMARY KEY,
      eval_id TEXT NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
      iteration INTEGER NOT NULL,
      scenario_name TEXT NOT NULL,
      scenario_type TEXT NOT NULL,
      response_text TEXT,
      transcript_json JSONB,
      tool_calls_json JSONB,
      scores_json JSONB,
      voice_analysis_json JSONB,
      judge_reasoning TEXT,
      composite_score REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS eval_events (
      id SERIAL PRIMARY KEY,
      eval_id TEXT NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`CREATE INDEX IF NOT EXISTS idx_prompt_versions_eval ON prompt_versions(eval_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_scenario_results_eval ON scenario_results(eval_id, iteration)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_eval_events_eval ON eval_events(eval_id)`)
}
