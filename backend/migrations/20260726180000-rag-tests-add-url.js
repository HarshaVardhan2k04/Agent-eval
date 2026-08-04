'use strict';

// The RAG endpoint is now supplied per test (generic tool) — record which one.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE rag_tests ADD COLUMN IF NOT EXISTS rag_url TEXT`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE rag_tests DROP COLUMN IF EXISTS rag_url`);
  },
};
