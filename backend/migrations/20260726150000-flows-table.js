'use strict';

// Flow Builder: one row per saved flow; the whole node/edge graph is one JSONB blob.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'inbound',
        definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_flows_created ON flows(created_at)`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS flows CASCADE`);
  },
};
