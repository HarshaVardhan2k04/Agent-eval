const { Router } = require('express');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/evalsController');

const router = Router();

router.post('/', validateRequest(schemas.createEval), c.createEval);
router.get('/', c.listEvals);
router.get('/:id', c.getEval);
router.get('/:id/results', c.getEvalResults);
router.get('/:id/log', c.getEvalLog);
router.post('/:id/stop', c.stopEvalHandler);
router.delete('/:id', c.deleteEval);
router.post('/:id/rerun', validateRequest(schemas.rerunEval), c.rerunEval);

module.exports = router;
