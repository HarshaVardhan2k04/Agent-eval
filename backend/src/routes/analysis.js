const { Router } = require('express');
const multer = require('multer');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/analysisController');

// Recordings are held in memory and forwarded to the engine for transcription.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 100 } });

const router = Router();

router.post('/batches', validateRequest(schemas.createCallBatch), c.createBatch);
router.get('/batches', c.listBatches);
router.get('/batches/:id', c.getBatch);
router.delete('/batches/:id', c.deleteBatch);
router.post('/batches/:id/calls', validateRequest(schemas.addCalls), c.addCalls);
router.post('/batches/:id/recordings', upload.array('recordings'), c.addRecordings);
router.get('/calls/:callId', c.getCall);

module.exports = router;
