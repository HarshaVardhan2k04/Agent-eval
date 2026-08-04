// Settings (single-user key/value) + Test-an-LLM proxy.
const { AppSetting } = require('../models');
const llmClient = require('../services/llmClient');

async function getAll(_req, res) {
  try {
    const rows = await AppSetting.findAll();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getOne(req, res) {
  try {
    const row = await AppSetting.findByPk(req.params.key);
    res.json({ key: req.params.key, value: row ? row.value : null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function setOne(req, res) {
  try {
    const key = req.params.key;
    const value = req.body.value;
    const [row, created] = await AppSetting.findOrCreate({
      where: { key },
      defaults: { value, updated_at: new Date() },
    });
    if (!created) await row.update({ value, updated_at: new Date() });
    res.json({ key, value });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function llmInfo(_req, res) {
  try {
    res.json(await llmClient.info());
  } catch (err) {
    res.status(502).json({ error: err.message || 'LLM engine unreachable' });
  }
}

async function llmTest(req, res) {
  try {
    res.json(await llmClient.test(req.body));
  } catch (err) {
    res.status(502).json({ error: err.message || 'LLM test failed' });
  }
}

module.exports = { getAll, getOne, setOne, llmInfo, llmTest };
