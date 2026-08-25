// Express app wiring. Kept free of process/listen concerns so it can be imported
// in tests. Route mounts preserve the original paths exactly:
//   /api/evals/*            eval lifecycle + prompt history + SSE
//   /api/internal/eval-events   engine progress callback
const express = require('express');
const cors = require('cors');

const evalsRouter = require('./routes/evals');
const promptsRouter = require('./routes/prompts');
const progressRouter = require('./routes/progress');
const sttRouter = require('./routes/stt');
const analysisRouter = require('./routes/analysis');
const flowRouter = require('./routes/flow');
const settingsRouter = require('./routes/settings');
const ragRouter = require('./routes/rag');
const forgeRouter = require('./routes/forge');
const forgeController = require('./controllers/forgeController');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/evals', evalsRouter);
app.use('/api/evals', promptsRouter);
app.use('/api/evals', progressRouter); // GET /api/evals/:id/events (SSE)
app.use('/api', progressRouter); // POST /api/internal/eval-events
app.use('/api/stt', sttRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/flow', flowRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/rag', ragRouter);
app.use('/api/forge', forgeRouter);
app.post('/api/internal/forge-events', forgeController.ingestForgeEvent); // engine progress callback
// engine re-reads the operator's live coach guidance before each proposal
app.get('/api/internal/forge/:id/coach-guidance', forgeController.getCoachGuidance);

module.exports = app;
