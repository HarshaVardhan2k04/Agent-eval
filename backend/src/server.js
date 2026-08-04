// Process entrypoint: verify the DB connection, then listen.
// Schema is managed by sequelize-cli migrations (`npm run migrate`), not sync().
const app = require('./app');
const { port } = require('./config/app');
const { sequelize } = require('./models');

async function start() {
  await sequelize.authenticate();
  console.log('Database connection OK');

  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
