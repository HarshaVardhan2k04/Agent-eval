const { Router } = require('express');
const c = require('../controllers/progressController');

const router = Router();

// Mounted at both /api/evals (for :id/events) and /api (for internal callback).
router.get('/:id/events', c.subscribeEvents);
router.post('/internal/eval-events', c.ingestEvent);

module.exports = router;
