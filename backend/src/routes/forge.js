const { Router } = require('express');
const c = require('../controllers/forgeController');

const router = Router();

// runs
router.post('/runs', c.createRun);
router.get('/runs', c.listRuns);
router.get('/runs/:id', c.getRun);
router.patch('/runs/:id', c.renameRun);
router.delete('/runs/:id', c.deleteRun);
router.post('/runs/:id/stop', c.stopRun);
router.get('/runs/:id/log', c.getLog);
router.get('/runs/:id/matrix', c.getMatrix);

// escalations (JSONB on the run row)
router.post('/runs/:id/escalations/:escId/answer', c.answerEscalation);

// Phase-2 human review + live-chat + export
router.get('/runs/:id/review', c.getReview);
router.post('/runs/:id/review', c.submitReview);
router.post('/runs/:id/chat', c.chat);
router.post('/runs/:id/evaluate', c.evaluateRun); // human-loop dataset re-run (no coaching)
router.post('/runs/:id/export', c.exportRun);

// LLM Arena — compare N hosted LLMs (own prompt each) on one dataset, fixed judge
router.post('/arenas/test-llm', c.testArenaLlm);
router.get('/runs/:id/sims', c.listSims);
router.get('/sims/:uid', c.getSim);
router.post('/arenas', c.createArena);
router.get('/arenas', c.listArenas);
router.get('/arenas/:id', c.getArena);
router.delete('/arenas/:id', c.deleteArena);

// dataset library (select-or-paste on Setup; every pasted set is saved once)
router.get('/datasets', c.listDatasets);
router.get('/datasets/:id', c.getDataset);
router.post('/datasets', c.createDataset);
router.delete('/datasets/:id', c.deleteDataset);

// global problem catalog (definitions)
router.get('/problems', c.listProblems);
router.post('/problems', c.addProblem);
router.patch('/problems/:id', c.patchProblem);

// layer library — agent_db_dev prompts, READ-ONLY (same Postgres as agent_eval)
router.get('/layers', c.listLayers);
router.get('/layers/:id', c.getLayer);

// merge preview (proxied to the engine's production-faithful merger)
router.post('/merge-preview', c.mergePreview);

module.exports = router;
