// stt_results — one clip's transcription + scoring. Audio itself is NOT stored
// (forwarded to the engine, discarded); we keep text + the full metrics blob.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'SttResult',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      batch_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        references: { model: 'stt_batches', key: 'id' },
      },
      filename: { type: DataTypes.TEXT, allowNull: true },
      reference_text: { type: DataTypes.TEXT, allowNull: true },
      hypothesis_text: { type: DataTypes.TEXT, allowNull: true },
      // { wer, cer, match_pct, verdict, diff[], detected_language, duration_ms, ... }
      metrics_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // 'upload' (batch/single), 'import' (production call), or 'noise' (noise test).
      source_type: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'upload' },
      // Noise test: which noise was mixed in (preset key / custom filename; null = Clean
      // baseline) and at what intensity ('light'|'medium'|'heavy'; null on the baseline).
      noise_label: { type: DataTypes.TEXT, allowNull: true },
      noise_level: { type: DataTypes.TEXT, allowNull: true },
      // Import provenance: which vertical, source call id, recording path in GCS.
      vertical: { type: DataTypes.TEXT, allowNull: true },
      external_call_id: { type: DataTypes.TEXT, allowNull: true },
      gcs_path: { type: DataTypes.TEXT, allowNull: true },
      gcs_bucket: { type: DataTypes.TEXT, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER, allowNull: true },
      // Why a row has no metrics: not_found / no_recording / no_reference / error:… / transcription_failed.
      gated_reason: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'stt_results',
      timestamps: false,
      indexes: [{ fields: ['batch_id'] }],
    }
  );
