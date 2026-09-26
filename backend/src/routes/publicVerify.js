// /api/v1 — the public surface. Versioned in the path because outside systems pin to
// it; anything that changes the response shape gets /api/v2, never an edit here.
const express = require('express');
const c = require('../controllers/publicVerifyController');

const router = express.Router();

// Every route behind the key. No unauthenticated endpoint exists on /api/v1 — not
// even a health check, which would otherwise confirm the host to a scanner.
router.use(c.requireApiKey);

router.get('/models', c.getModels);
router.post('/verify', c.createVerify);
router.get('/verify/:id', c.getVerify);

module.exports = router;
