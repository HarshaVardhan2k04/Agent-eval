// eval_events — raw event audit log (iteration_start, scenario_complete, prompt_improved,
// prompt_reverted, converged, eval_complete, ...). Polled by the live progress page.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'EvalEvent',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      eval_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        references: { model: 'evals', key: 'id' },
      },
      event_type: { type: DataTypes.TEXT, allowNull: false },
      event_data: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'eval_events',
      timestamps: false,
      indexes: [{ fields: ['eval_id'] }],
    }
  );
