'use strict';

// Call batches can be judged against a saved Flow (Flow Builder). Store which flow,
// plus audio/transcription bookkeeping for recording-based batches.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE call_batches ADD COLUMN IF NOT EXISTS flow_id TEXT`);
    await sql.query(`ALTER TABLE call_batches ADD COLUMN IF NOT EXISTS flow_name TEXT`);
    // per-call source audio filename (recordings) + detected language, when transcribed here
    await sql.query(`ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS source_filename TEXT`);
  },
  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE call_batches DROP COLUMN IF EXISTS flow_id`);
    await sql.query(`ALTER TABLE call_batches DROP COLUMN IF EXISTS flow_name`);
    await sql.query(`ALTER TABLE call_analyses DROP COLUMN IF EXISTS source_filename`);
  },
};
