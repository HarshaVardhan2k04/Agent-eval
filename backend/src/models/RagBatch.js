// rag_batches — one batch of RAG queries evaluated together. Members live in
// rag_tests (batch_id), so a single query and a batch member are the same shape;
// this row holds only what is true of the SET: the shared collection and search
// params, where the queries came from, and the combined scores.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RagBatch',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      rag_url: { type: DataTypes.TEXT, allowNull: true },
      collection: { type: DataTypes.TEXT, allowNull: false },
      search_params: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      source: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'manual' },
      source_meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'running' },
      n_queries: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      n_done: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      aggregate_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: 'rag_batches', timestamps: false, indexes: [{ fields: ['created_at'] }] }
  );
