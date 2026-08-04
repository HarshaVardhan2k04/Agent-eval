// call_batches — one Call Analysis run. The agent config + tool set apply to the
// whole batch; aggregate metrics live in summary_json.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'CallBatch',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      direction: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'outbound' },
      flow_id: { type: DataTypes.TEXT, allowNull: true },     // saved Flow judged against
      flow_name: { type: DataTypes.TEXT, allowNull: true },
      // agent_details + guiding_prompt.conversation_flow, used for flow/instruction scoring
      editable_config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      tools_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'ready' },
      // { n_total, n_scored, n_gated, section_means, metric_means, top_themes }
      summary_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'call_batches',
      timestamps: false,
      indexes: [{ fields: ['created_at'] }, { fields: ['status'] }],
    }
  );
