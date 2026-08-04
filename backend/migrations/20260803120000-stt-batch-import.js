'use strict';

// STT batch-upload + production-call-import: per-result provenance/gating on
// stt_results, and mode/vertical/status bookkeeping on stt_batches.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'upload'`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS vertical TEXT`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS external_call_id TEXT`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS gcs_path TEXT`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS gcs_bucket TEXT`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS duration_ms INTEGER`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS gated_reason TEXT`);

    await sql.query(`ALTER TABLE stt_batches ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'`);
    await sql.query(`ALTER TABLE stt_batches ADD COLUMN IF NOT EXISTS vertical TEXT`);
    // Not in the DB list of the contract but required to persist the 'scoring'->'done'
    // lifecycle the background workers set (mirrors call_batches.status).
    await sql.query(`ALTER TABLE stt_batches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;

    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS source_type`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS vertical`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS external_call_id`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS gcs_path`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS gcs_bucket`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS duration_ms`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS gated_reason`);

    await sql.query(`ALTER TABLE stt_batches DROP COLUMN IF EXISTS mode`);
    await sql.query(`ALTER TABLE stt_batches DROP COLUMN IF EXISTS vertical`);
    await sql.query(`ALTER TABLE stt_batches DROP COLUMN IF EXISTS status`);
  },
};
