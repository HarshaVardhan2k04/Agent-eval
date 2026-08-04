// flows — one saved conversation flow. The whole node/edge graph lives in the
// single definition JSONB blob (mirrors the automation-lab one-table model).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Flow',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: false },
      direction: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'inbound' },
      // { nodes: [{id,type,name,description,params,position}], edges: [{from,to,label}] }
      definition: { type: DataTypes.JSONB, allowNull: false, defaultValue: { nodes: [], edges: [] } },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'flows',
      timestamps: false,
      indexes: [{ fields: ['created_at'] }],
    }
  );
