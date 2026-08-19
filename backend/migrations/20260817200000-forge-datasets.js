'use strict';

// Dataset library: every persona dataset ever given (pasted, mined, or authored) is
// stored once and reusable across runs — the Setup page offers select-or-paste.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'authored',       -- authored | mined | generated
        personas_json JSONB NOT NULL DEFAULT '[]',
        n INTEGER NOT NULL DEFAULT 0,
        source TEXT,                                  -- run id / 'claude' / 'prompt-team'
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_datasets_created ON forge_datasets(created_at)`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS forge_datasets CASCADE`);
  },
};
