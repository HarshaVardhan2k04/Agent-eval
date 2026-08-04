// Sequelize connection — house style: snake_case columns, no ORM-managed timestamps.
require('dotenv').config();
const { Sequelize } = require('sequelize');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:6666/agent_eval';

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  define: { timestamps: false, underscored: true },
});

module.exports = sequelize;
