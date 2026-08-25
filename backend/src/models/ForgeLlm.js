// Saved LLM endpoints library (agent-under-test / arena contestants).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeLlm',
    {
      id: { type: DataTypes.TEXT, primaryKey: true },
      name: { type: DataTypes.TEXT, allowNull: false },
      base_url: { type: DataTypes.TEXT, allowNull: false },
      model: { type: DataTypes.TEXT, allowNull: false },
      api_key: { type: DataTypes.TEXT, allowNull: true },
      params_json: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: 'forge_llms', timestamps: false }
  );
