// evals — one row per evaluation run. id is an app-generated nanoid (TEXT), not UUID,
// to stay compatible with the existing table + data.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Eval',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending' },
      original_prompt: { type: DataTypes.TEXT, allowNull: false },
      scenarios_json: { type: DataTypes.JSONB, allowNull: false },
      config_json: { type: DataTypes.JSONB, allowNull: false },
      final_score: { type: DataTypes.REAL, allowNull: true },
      iterations_run: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
      max_iterations: { type: DataTypes.INTEGER, allowNull: false },
      quality_threshold: { type: DataTypes.REAL, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'evals',
      timestamps: false,
      indexes: [{ fields: ['status'] }, { fields: ['created_at'] }],
    }
  );
