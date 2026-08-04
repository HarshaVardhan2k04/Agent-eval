'use strict';

// Call Analysis storage: batches (agent config + tool set + aggregate) + per-call scores.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    await sql.query(`
      CREATE TABLE IF NOT EXISTS call_batches (
        id TEXT PRIMARY KEY,
        name TEXT,
        direction TEXT NOT NULL DEFAULT 'outbound',
        editable_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'ready',
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS call_analyses (
        id SERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES call_batches(id) ON DELETE CASCADE,
        call_id TEXT,
        direction TEXT,
        transcript TEXT,
        sections_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        flow_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        areas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        tool_events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        gated_reason TEXT,
        composite_score REAL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_call_batches_created ON call_batches(created_at)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_call_analyses_batch ON call_analyses(batch_id)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_call_analyses_call ON call_analyses(call_id)`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`DROP TABLE IF EXISTS call_analyses CASCADE`);
    await sql.query(`DROP TABLE IF EXISTS call_batches CASCADE`);
  },
};
