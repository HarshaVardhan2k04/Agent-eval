'use strict';

// A RAG evaluation is rarely one query — you ask five and want each scored plus a
// combined read. rag_batches is the parent; every existing rag_tests row becomes a
// member via batch_id (null = a standalone single-query run, as before).
// House style: one new table + one column, aggregates as JSONB on the parent.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('rag_batches', {
      id: { type: Sequelize.TEXT, primaryKey: true, allowNull: false },
      name: { type: Sequelize.TEXT, allowNull: true },
      collection: { type: Sequelize.TEXT, allowNull: false },
      rag_url: { type: Sequelize.TEXT, allowNull: true },
      search_params: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // 'manual' = pasted queries · 'call' = mined from a production transcript
      source: { type: Sequelize.TEXT, allowNull: false, defaultValue: 'manual' },
      // { vertical, call_id, agent_id, direction, n_turns, n_candidates, extract_mode }
      source_meta: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.TEXT, allowNull: false, defaultValue: 'running' },
      n_queries: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      n_done: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // { per_metric: {name: {mean, n, weak}}, weakest: [...], no_context: n }
      aggregate_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('rag_batches', ['created_at']);

    await queryInterface.addColumn('rag_tests', 'batch_id', {
      type: Sequelize.TEXT, allowNull: true,
      references: { model: 'rag_batches', key: 'id' },
      onDelete: 'CASCADE', onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('rag_tests', ['batch_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('rag_tests', 'batch_id');
    await queryInterface.dropTable('rag_batches');
  },
};
