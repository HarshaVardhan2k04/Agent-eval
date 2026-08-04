// stt_batches — one STT accuracy run (a single test is a batch of 1).
// Aggregate metrics live in summary_json (avg_wer, avg_cer, counts by verdict).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'SttBatch',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      language: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'en' },
      provider: { type: DataTypes.TEXT, allowNull: true },
      // 'single' | 'batch' | 'import'. Imports pull recordings from a vertical.
      mode: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'single' },
      vertical: { type: DataTypes.TEXT, allowNull: true },
      // Background lifecycle for batch/import runs: 'ready' -> 'scoring' -> 'done'.
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'ready' },
      summary_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'stt_batches',
      timestamps: false,
      indexes: [{ fields: ['created_at'] }],
    }
  );
