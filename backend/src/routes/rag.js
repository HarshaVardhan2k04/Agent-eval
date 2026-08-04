const { Router } = require('express');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/ragController');

const router = Router();

router.get('/default-url', c.defaultUrl);
router.get('/collections', c.getCollections);
router.post('/evaluate', validateRequest(schemas.ragEvaluate), c.evaluate);
router.get('/tests', c.listTests);
router.get('/tests/:id', c.getTest);
router.delete('/tests/:id', c.deleteTest);

module.exports = router;
