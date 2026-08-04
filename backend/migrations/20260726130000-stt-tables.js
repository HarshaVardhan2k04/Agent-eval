'use strict';

// Test STT storage: batches (a run, single test = batch of 1) + per-clip results.
// Audio is never stored — only reference/hypothesis text and the metrics blob.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    await sql.query(`
      CREATE TABLE IF NOT EXISTS stt_batches (
        id TEXT PRIMARY KEY,
        name TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        provider TEXT,
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS stt_results (
        id SERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES stt_batches(id) ON DELETE CASCADE,
        filename TEXT,
        reference_text TEXT,
        hypothesis_text TEXT,
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_stt_batches_created ON stt_batches(created_at)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_stt_results_batch ON stt_results(batch_id)`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`DROP TABLE IF EXISTS stt_results CASCADE`);
    await sql.query(`DROP TABLE IF EXISTS stt_batches CASCADE`);
  },
};
