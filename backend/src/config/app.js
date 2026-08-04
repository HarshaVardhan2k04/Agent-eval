// Non-secret app config. Secrets (DATABASE_URL) live in .env; these have safe defaults.
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  engineUrl: process.env.ENGINE_URL || 'http://localhost:8002',
  selfUrl: process.env.SELF_URL || 'http://localhost:3001',
  ragApiUrl: process.env.RAG_API_URL || 'http://45.119.112.68:7070',
};
