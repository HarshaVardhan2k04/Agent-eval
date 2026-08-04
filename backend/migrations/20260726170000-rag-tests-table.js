'use strict';

// RAG Testing: one row per evaluation run (query + retrieval + answer + metrics).
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`
      CREATE TABLE IF NOT EXISTS rag_tests (
        id TEXT PRIMARY KEY,
        name TEXT,
        collection TEXT NOT NULL,
        query TEXT NOT NULL,
        search_params JSONB NOT NULL DEFAULT '{}'::jsonb,
        gold_answer TEXT,
        answer TEXT,
        retrieval_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_rag_tests_created ON rag_tests(created_at)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_rag_tests_collection ON rag_tests(collection)`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS rag_tests CASCADE`);
  },
};
