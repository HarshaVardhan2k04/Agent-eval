const { Router } = require('express');
const multer = require('multer');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/sttController');

// Audio is held in memory and forwarded to the engine — never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.get('/providers', c.getProviders);
router.get('/verticals', c.getVerticals);
router.get('/noises', c.getNoises);
router.post('/batches', validateRequest(schemas.createSttBatch), c.createBatch);
router.get('/batches', c.listBatches);
router.get('/batches/:id', c.getBatch);
router.delete('/batches/:id', c.deleteBatch);
router.post('/batches/:id/results', upload.single('audio'), c.addResult);
router.post('/batches/:id/uploads', upload.array('audio', 100), c.addUploads);
router.post('/batches/:id/import', validateRequest(schemas.importSttCalls), c.importCalls);
router.post(
  '/batches/:id/noise-test',
  upload.fields([{ name: 'recording', maxCount: 1 }, { name: 'noise', maxCount: 20 }]),
  c.runNoiseTest
);
router.get('/results/:id/audio-url', c.getAudioUrl);
router.get('/results/:id/mixed-audio', c.getMixedAudio);

module.exports = router;
