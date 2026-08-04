'use strict';

// Analyze Calls "import from calls": store provenance for calls pulled from a
// production vertical (which vertical, source call id, recording location) so the
// call report can play the recording and we can trace where a scored call came from.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'upload'`);
    await sql.query(`ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS vertical TEXT`);
    await sql.query(`ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS gcs_path TEXT`);
    await sql.query(`ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS gcs_bucket TEXT`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE call_analyses DROP COLUMN IF EXISTS source_type`);
    await sql.query(`ALTER TABLE call_analyses DROP COLUMN IF EXISTS vertical`);
    await sql.query(`ALTER TABLE call_analyses DROP COLUMN IF EXISTS gcs_path`);
    await sql.query(`ALTER TABLE call_analyses DROP COLUMN IF EXISTS gcs_bucket`);
  },
};
