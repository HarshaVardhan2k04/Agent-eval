// RAG Testing: list collections (proxy), run an evaluation (retrieve -> optional
// generate -> score), and browse saved runs.
const { nanoid } = require('nanoid');
const { RagTest } = require('../models');
const ragClient = require('../services/ragClient');
const { ragApiUrl } = require('../config/app');

const isUrl = (u) => /^https?:\/\/.+/i.test(String(u || ''));

// Suggested default URL for the UI to prefill (fully editable there).
async function defaultUrl(_req, res) {
  res.json({ url: ragApiUrl });
}

async function getCollections(req, res) {
  const url = req.query.url ? String(req.query.url) : ragApiUrl;
  if (!isUrl(url)) {
    res.status(400).json({ error: 'A valid http(s) RAG API URL is required' });
    return;
  }
  try {
    const d = await ragClient.collections(url);
    res.json({ ...d, url });
  } catch (err) {
    res.status(502).json({ error: err.message || 'RAG API unreachable', url });
  }
}

async function evaluate(req, res) {
  try {
    const {
      name, collection, query, gold_answer, rag_url,
      search_type = 'hybrid', top_k = 5, alpha = 0.7, rerank = true,
      distance_threshold, answer_mode = 'generate', answer: providedAnswer,
    } = req.body;

    const url = isUrl(rag_url) ? rag_url : ragApiUrl;
    if (!isUrl(url)) {
      res.status(400).json({ error: 'A valid http(s) RAG API URL is required' });
      return;
    }

    // 1) retrieve from the supplied RAG endpoint
    const searchParams = { query, collection, search_type, top_k, alpha, rerank };
    if (distance_threshold != null) searchParams.distance_threshold = distance_threshold;
    const searchRes = await ragClient.search(url, searchParams);
    const results = searchRes.results || [];
    const chunks = results.map((r) => r.content || r.text || '').filter(Boolean);

    if (chunks.length === 0) {
      res.status(422).json({ error: 'Retrieval returned no chunks for this query/collection.' });
      return;
    }

    // 2) obtain an answer (generate on Gemma, paste your own, or skip)
    let answer = null;
    if (answer_mode === 'generate') {
      try { answer = await ragClient.generateAnswer(query, chunks); } catch (_) { answer = null; }
    } else if (answer_mode === 'provided' && providedAnswer) {
      answer = String(providedAnswer);
    }

    // 3) score whatever the inputs allow
    const metrics = await ragClient.ragSuite({
      input: query,
      output: answer || undefined,
      expected_output: gold_answer || undefined,
      retrieval_context: chunks,
    });

    // 4) persist
    const row = await RagTest.create({
      id: nanoid(12),
      name: name && name.trim() ? name.trim() : null,
      rag_url: url,
      collection,
      query,
      search_params: { search_type, top_k, alpha, rerank, distance_threshold: distance_threshold ?? null },
      gold_answer: gold_answer || null,
      answer,
      retrieval_json: results,
      metrics_json: metrics,
    });

    res.json(row);
  } catch (err) {
    res.status(502).json({ error: err.message || 'RAG evaluation failed' });
  }
}

async function listTests(_req, res) {
  try {
    const rows = await RagTest.findAll({
      attributes: ['id', 'name', 'collection', 'query', 'search_params', 'metrics_json', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 100,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getTest(req, res) {
  try {
    const row = await RagTest.findByPk(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'RAG test not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function deleteTest(req, res) {
  try {
    await RagTest.destroy({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = { defaultUrl, getCollections, evaluate, listTests, getTest, deleteTest };
