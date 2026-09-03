// forge_arenas — one LLM-comparison tournament (contestants run sequentially).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeArena',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      dataset_id: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'running' },
      contestants_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      scoring_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      winner_run_id: { type: DataTypes.TEXT, allowNull: true },
      ranking_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'forge_arenas', timestamps: false }
  );
