import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { migrate } from './db/schema.js'
import { evalsRouter } from './routes/evals.js'
import { promptsRouter } from './routes/prompts.js'
import { progressRouter } from './routes/progress.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/evals', evalsRouter)
app.use('/api/evals', promptsRouter)
app.use('/api/evals', progressRouter)
app.use('/api', progressRouter)

async function start() {
  await migrate()
  console.log('Database migrated')

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`)
  })
}

start().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
