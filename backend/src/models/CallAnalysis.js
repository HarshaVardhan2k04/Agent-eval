// call_analyses — one scored call. Scores/metrics/flow/areas are JSONB blobs.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'CallAnalysis',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      batch_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        references: { model: 'call_batches', key: 'id' },
      },
      call_id: { type: DataTypes.TEXT, allowNull: true },
      source_filename: { type: DataTypes.TEXT, allowNull: true }, // audio file (recordings)
      // 'upload' (recordings), 'paste' (transcripts), or 'import' (production call).
      source_type: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'upload' },
      // Import provenance: which vertical + recording location in GCS (for playback).
      vertical: { type: DataTypes.TEXT, allowNull: true },
      gcs_path: { type: DataTypes.TEXT, allowNull: true },
      gcs_bucket: { type: DataTypes.TEXT, allowNull: true },
      direction: { type: DataTypes.TEXT, allowNull: true },
      transcript: { type: DataTypes.TEXT, allowNull: true },
      sections_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metrics_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      flow_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      areas_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      tool_events_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      gated_reason: { type: DataTypes.TEXT, allowNull: true },
      composite_score: { type: DataTypes.REAL, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'call_analyses',
      timestamps: false,
      indexes: [{ fields: ['batch_id'] }, { fields: ['call_id'] }],
    }
  );
