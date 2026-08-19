// forge_events — append-only progress/audit log; id is the poll cursor for /log?after=.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeEvent',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      run_id: { type: DataTypes.TEXT, allowNull: false },
      event_type: { type: DataTypes.TEXT, allowNull: false },
      event_data: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'forge_events',
      timestamps: false,
      indexes: [{ fields: ['run_id'] }],
    }
  );
