// Prompt history + per-version diff for the eval report / prompt-history view.
const { getPromptVersions, getPromptDiff } = require('../services/promptStore');

async function listPromptVersions(req, res) {
  try {
    const versions = await getPromptVersions(req.params.id);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getVersionDiff(req, res) {
  try {
    const version = parseInt(req.params.version, 10);
    const row = await getPromptDiff(req.params.id, version);
    if (!row) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = { listPromptVersions, getVersionDiff };
