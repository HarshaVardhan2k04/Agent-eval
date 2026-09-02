// prompt_versions — one row per prompt version in an eval (baseline + each accepted/reverted).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PromptVersion',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      eval_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        references: { model: 'evals', key: 'id' },
      },
      version: { type: DataTypes.INTEGER, allowNull: false },
      prompt_text: { type: DataTypes.TEXT, allowNull: false },
      score: { type: DataTypes.REAL, allowNull: true },
      changes_summary: { type: DataTypes.TEXT, allowNull: true },
      diff_from_previous: { type: DataTypes.TEXT, allowNull: true },
      edits_json: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'prompt_versions',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['eval_id', 'version'] },
        { fields: ['eval_id'] },
      ],
    }
  );
