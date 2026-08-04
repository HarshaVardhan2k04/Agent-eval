// scenario_results — one row per scenario per iteration.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ScenarioResult',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      eval_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        references: { model: 'evals', key: 'id' },
      },
      iteration: { type: DataTypes.INTEGER, allowNull: false },
      scenario_name: { type: DataTypes.TEXT, allowNull: false },
      scenario_type: { type: DataTypes.TEXT, allowNull: false },
      response_text: { type: DataTypes.TEXT, allowNull: true },
      transcript_json: { type: DataTypes.JSONB, allowNull: true },
      tool_calls_json: { type: DataTypes.JSONB, allowNull: true },
      scores_json: { type: DataTypes.JSONB, allowNull: true },
      voice_analysis_json: { type: DataTypes.JSONB, allowNull: true },
      judge_reasoning: { type: DataTypes.TEXT, allowNull: true },
      composite_score: { type: DataTypes.REAL, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'scenario_results',
      timestamps: false,
      indexes: [{ fields: ['eval_id', 'iteration'] }],
    }
  );
