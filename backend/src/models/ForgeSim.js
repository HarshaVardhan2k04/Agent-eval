// forge_sims — every simulated conversation, stored BEFORE grading (run-then-grade).
// verdict/reason are backfilled by the grading pass; sim_uid correlates the two.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeSim',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      sim_uid: { type: DataTypes.TEXT, allowNull: false, unique: true },
      run_id: { type: DataTypes.TEXT, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      kind: { type: DataTypes.TEXT, allowNull: false }, // detector | deep_confirm | stress | deepeval
      problem_id: { type: DataTypes.TEXT, allowNull: true },
      probe: { type: DataTypes.TEXT, allowNull: true },
      idx: { type: DataTypes.INTEGER, allowNull: true },
      combo: { type: DataTypes.TEXT, allowNull: true },  // "outbound·fresh" — which cross-product cell
      transcript_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      tool_calls_json: { type: DataTypes.JSONB, allowNull: true },
      ended: { type: DataTypes.BOOLEAN, allowNull: true },
      verdict: { type: DataTypes.TEXT, allowNull: true }, // pass | fail
      reason: { type: DataTypes.TEXT, allowNull: true },
      failing_turn: { type: DataTypes.INTEGER, allowNull: true },
      tool_leaks_json: { type: DataTypes.JSONB, allowNull: true },     // spoken, never executed
      tool_summary_json: { type: DataTypes.JSONB, allowNull: true },   // offered/fired/leaked/missed
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'forge_sims',
      timestamps: false,
      indexes: [{ fields: ['run_id'] }, { fields: ['run_id', 'problem_id'] }],
    }
  );
