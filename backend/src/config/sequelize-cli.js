// sequelize-cli env config. Uses the same DATABASE_URL as the app.
require('dotenv').config();

const common = { use_env_variable: 'DATABASE_URL', dialect: 'postgres' };

module.exports = {
  development: common,
  test: common,
  production: common,
};
