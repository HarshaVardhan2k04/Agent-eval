export const config = {
  port: parseInt(process.env.PORT || '3001'),
  engineUrl: process.env.ENGINE_URL || 'http://localhost:8002',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:6666/agent_eval',
  selfUrl: process.env.SELF_URL || 'http://localhost:3001',
}
