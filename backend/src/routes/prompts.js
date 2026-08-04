const { Router } = require('express');
const c = require('../controllers/promptsController');

const router = Router();

router.get('/:id/prompts', c.listPromptVersions);
router.get('/:id/prompts/:version/diff', c.getVersionDiff);

module.exports = router;
