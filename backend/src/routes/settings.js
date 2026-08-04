const { Router } = require('express');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/settingsController');

const router = Router();

// Test-an-LLM (declare before /:key so they aren't shadowed).
router.get('/llm/info', c.llmInfo);
router.post('/llm/test', validateRequest(schemas.llmTest), c.llmTest);

router.get('/', c.getAll);
router.get('/:key', c.getOne);
router.put('/:key', validateRequest(schemas.setSetting), c.setOne);

module.exports = router;
