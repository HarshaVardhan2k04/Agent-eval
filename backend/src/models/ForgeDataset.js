// forge_datasets — reusable persona-dataset library (select-or-paste on Setup).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeDataset',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: false },
      kind: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'authored' },
      personas_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      n: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      source: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: 'forge_datasets', timestamps: false, indexes: [{ fields: ['created_at'] }] }
  );
