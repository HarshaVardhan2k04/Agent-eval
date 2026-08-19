'use strict';
// Per-turn LLM latency profile per version (avg/p50/p99 + turn-by-turn detail),
// foundation mirrored from engage-voice-agents' per-turn metrics store.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE forge_versions ADD COLUMN IF NOT EXISTS latency_json JSONB`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE forge_versions DROP COLUMN IF EXISTS latency_json`);
  },
};
