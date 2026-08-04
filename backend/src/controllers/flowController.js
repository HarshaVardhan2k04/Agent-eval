// Flow Builder: Gemma generation (proxy to engine) + CRUD on saved flows.
const { nanoid } = require('nanoid');
const { Flow } = require('../models');
const flowClient = require('../services/flowClient');

async function generate(req, res) {
  try {
    const graph = await flowClient.generate(req.body);
    res.json(graph);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Flow generation failed' });
  }
}

async function edit(req, res) {
  try {
    const result = await flowClient.edit(req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Flow edit failed' });
  }
}

async function createFlow(req, res) {
  try {
    const { name, direction, definition } = req.body;
    const flow = await Flow.create({
      id: nanoid(12),
      name: name.trim(),
      direction: direction || 'inbound',
      definition: definition || { nodes: [], edges: [] },
    });
    res.json(flow);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function listFlows(_req, res) {
  try {
    const rows = await Flow.findAll({ order: [['updated_at', 'DESC']] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getFlow(req, res) {
  try {
    const flow = await Flow.findByPk(req.params.id);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json(flow);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function updateFlow(req, res) {
  try {
    const flow = await Flow.findByPk(req.params.id);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    const patch = { updated_at: new Date() };
    if (req.body.name !== undefined) patch.name = req.body.name.trim();
    if (req.body.direction !== undefined) patch.direction = req.body.direction;
    if (req.body.definition !== undefined) patch.definition = req.body.definition;
    await flow.update(patch);
    res.json(flow);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function deleteFlow(req, res) {
  try {
    await Flow.destroy({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = { generate, edit, createFlow, listFlows, getFlow, updateFlow, deleteFlow };
