// Eval lifecycle: create, list, read, results, live log, stop, delete, rerun.
const { nanoid } = require('nanoid');
const { Eval, ScenarioResult, EvalEvent } = require('../models');
const { dispatchEval, stopEval } = require('../services/engineClient');
const { storePromptVersion } = require('../services/promptStore');

async function createEval(req, res) {
  try {
    const { name, system_prompt, scenarios, config } = req.body;

    const evalId = nanoid(12);
    const evalName = name && name.trim() ? name.trim() : null;

    await Eval.create({
      id: evalId,
      name: evalName,
      status: 'running',
      original_prompt: system_prompt,
      scenarios_json: scenarios,
      config_json: config,
      max_iterations: config.max_iterations || 5,
      quality_threshold: config.quality_threshold || 0.9,
    });

    await storePromptVersion(evalId, 0, system_prompt, null, 'Initial prompt');
    await dispatchEval(evalId, system_prompt, scenarios, config);

    res.json({ eval_id: evalId, status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function listEvals(_req, res) {
  try {
    const rows = await Eval.findAll({
      attributes: [
        'id', 'name', 'status', 'final_score', 'iterations_run',
        'max_iterations', 'quality_threshold', 'created_at', 'completed_at',
      ],
      order: [['created_at', 'DESC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getEval(req, res) {
  try {
    const row = await Eval.findByPk(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Eval not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getEvalResults(req, res) {
  try {
    const where = { eval_id: req.params.id };
    if (req.query.iteration !== undefined) {
      where.iteration = parseInt(req.query.iteration, 10);
    }
    const rows = await ScenarioResult.findAll({
      where,
      order: [['iteration', 'ASC'], ['scenario_name', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Live progress log — polled by the progress page (id-cursor via ?after=).
async function getEvalLog(req, res) {
  try {
    const { Op } = require('sequelize');
    const after = req.query.after ? parseInt(req.query.after, 10) : 0;
    const rows = await EvalEvent.findAll({
      where: { eval_id: req.params.id, id: { [Op.gt]: after } },
      attributes: ['id', 'event_type', 'event_data', 'created_at'],
      order: [['id', 'ASC']],
      limit: 1000,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function stopEvalHandler(req, res) {
  try {
    // Best-effort: ask the engine to stop, but don't fail the request if it has
    // already finished/forgotten the eval — the DB must still move to 'stopped'.
    try {
      await stopEval(req.params.id);
    } catch (e) {
      console.warn('[eval] engine stop returned an error (continuing):', e.message);
    }
    await Eval.update(
      { status: 'stopped', updated_at: new Date() },
      { where: { id: req.params.id } }
    );
    res.json({ eval_id: req.params.id, status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function deleteEval(req, res) {
  try {
    // ON DELETE CASCADE clears prompt_versions / scenario_results / eval_events.
    await Eval.destroy({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function rerunEval(req, res) {
  try {
    const { version } = req.body;
    const original = await Eval.findByPk(req.params.id);
    if (!original) {
      res.status(404).json({ error: 'Eval not found' });
      return;
    }

    const { PromptVersion } = require('../models');
    const pv = await PromptVersion.findOne({
      where: { eval_id: req.params.id, version },
      attributes: ['prompt_text'],
    });
    if (!pv) {
      res.status(404).json({ error: 'Prompt version not found' });
      return;
    }

    const newId = nanoid(12);
    const config = original.config_json;
    const rerunName = `Rerun: ${original.name || original.id} v${version}`;

    await Eval.create({
      id: newId,
      name: rerunName,
      status: 'running',
      original_prompt: pv.prompt_text,
      scenarios_json: original.scenarios_json,
      config_json: config,
      max_iterations: config.max_iterations || 5,
      quality_threshold: config.quality_threshold || 0.9,
    });

    await storePromptVersion(
      newId, 0, pv.prompt_text, null,
      `Re-run from eval ${req.params.id} version ${version}`
    );
    await dispatchEval(newId, pv.prompt_text, original.scenarios_json, config);

    res.json({ eval_id: newId, status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = {
  createEval, listEvals, getEval, getEvalResults,
  getEvalLog, stopEvalHandler, deleteEval, rerunEval,
};
