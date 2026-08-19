'use strict';
// Arena winners are ranked by the deepeval metric battery FIRST (code-computed checks),
// then composite, then problems-solved. The full ranking is stored for the UI.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE forge_arenas ADD COLUMN IF NOT EXISTS ranking_json JSONB NOT NULL DEFAULT '[]'`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE forge_arenas DROP COLUMN IF EXISTS ranking_json`);
  },
};
