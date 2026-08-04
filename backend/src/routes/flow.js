const { Router } = require('express');
const { validateRequest, schemas } = require('../middleware/validation');
const c = require('../controllers/flowController');

const router = Router();

router.post('/generate', validateRequest(schemas.generateFlow), c.generate);
router.post('/edit', validateRequest(schemas.editFlow), c.edit);
router.post('/flows', validateRequest(schemas.saveFlow), c.createFlow);
router.get('/flows', c.listFlows);
router.get('/flows/:id', c.getFlow);
router.put('/flows/:id', validateRequest(schemas.updateFlow), c.updateFlow);
router.delete('/flows/:id', c.deleteFlow);

module.exports = router;
