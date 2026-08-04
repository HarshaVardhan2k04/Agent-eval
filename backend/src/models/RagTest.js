// rag_tests — one RAG evaluation run: a query against a collection, the retrieved
// chunks, an (optional) answer, and the metric scores. All blobs are JSONB.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RagTest',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      rag_url: { type: DataTypes.TEXT, allowNull: true },
      collection: { type: DataTypes.TEXT, allowNull: false },
      query: { type: DataTypes.TEXT, allowNull: false },
      // { search_type, top_k, alpha, rerank, distance_threshold }
      search_params: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      gold_answer: { type: DataTypes.TEXT, allowNull: true },
      answer: { type: DataTypes.TEXT, allowNull: true },
      // [{ content, score, collection, section, ... }]
      retrieval_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      // { contextual_relevancy:{...}, faithfulness:{...}, answer_relevancy:{...}, ... }
      metrics_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'rag_tests',
      timestamps: false,
      indexes: [{ fields: ['created_at'] }, { fields: ['collection'] }],
    }
  );
