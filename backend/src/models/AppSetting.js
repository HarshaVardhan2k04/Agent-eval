// app_settings — a tiny single-user key/value store (JSONB values). Holds the
// default tool set, judge-model config, etc. One table, no proliferation.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AppSetting',
    {
      key: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'app_settings',
      timestamps: false,
    }
  );
