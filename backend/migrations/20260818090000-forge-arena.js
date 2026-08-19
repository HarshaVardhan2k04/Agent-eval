'use strict';

// LLM Arena: N hosted LLMs, each with its own prompt, evaluated on one dataset with the
// full battery (matrix + deep-confirm + deepeval + stress), judge held constant. One
// parent row per arena; member runs carry arena_id and execute sequentially.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_arenas (
        id TEXT PRIMARY KEY,
        name TEXT,
        dataset_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',        -- running | complete | failed
        contestants_json JSONB NOT NULL DEFAULT '[]',  -- [{label, base_url, model, prompt, run_id}]
        scoring_json JSONB NOT NULL DEFAULT '{}',
        winner_run_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS arena_id TEXT`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_runs_arena ON forge_runs(arena_id)`);
  },
  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`DROP TABLE IF EXISTS forge_arenas CASCADE`);
    await sql.query(`ALTER TABLE forge_runs DROP COLUMN IF EXISTS arena_id`);
  },
};
