// RAG Testing: list collections (proxy), run an evaluation (retrieve -> optional
// generate -> score), and browse saved runs.
const { nanoid } = require('nanoid');
const { RagTest, RagBatch } = require('../models');
const ragClient = require('../services/ragClient');
const { ragApiUrl } = require('../config/app');
const verticalSource = require('../services/verticalSource');

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

// One query, end to end: retrieve -> answer -> score -> persist. Used by the single
// endpoint and by every member of a batch, so a batch member is byte-identical to a
// standalone run and can be read with the same UI.
async function runOneQuery(opts) {
  const {
    url, collection, query, gold_answer, batch_id = null, name = null, kind = null,
    search_type, top_k, alpha, rerank, distance_threshold,
    answer_mode = 'generate', providedAnswer = null,
  } = opts;

  const searchParams = { query, collection, search_type, top_k, alpha, rerank };
  if (distance_threshold != null) searchParams.distance_threshold = distance_threshold;
  const searchRes = await ragClient.search(url, searchParams);
  const results = searchRes.results || [];
  const chunks = results.map((r) => r.content || r.text || '').filter(Boolean);

  const stored = {
    id: nanoid(12), name, rag_url: url, collection, query, batch_id, kind,
    search_params: { search_type, top_k, alpha, rerank, distance_threshold: distance_threshold ?? null },
    gold_answer: gold_answer || null,
    retrieval_json: results,
  };

  // Retrieval finding nothing IS the result — record it as a scored-zero row rather
  // than dropping the query, otherwise a collection that answers nothing looks clean.
  if (chunks.length === 0) {
    return RagTest.create({
      ...stored, answer: null,
      metrics_json: { _no_context: true, _reason: 'retrieval returned no chunks' },
    });
  }

  let answer = null;
  if (answer_mode === 'generate') {
    try { answer = await ragClient.generateAnswer(query, chunks); } catch (_) { answer = null; }
  } else if (answer_mode === 'provided' && providedAnswer) {
    answer = String(providedAnswer);
  }

  const metrics = await ragClient.ragSuite({
    input: query,
    output: answer || undefined,
    expected_output: gold_answer || undefined,
    retrieval_context: chunks,
  });

  return RagTest.create({ ...stored, answer, metrics_json: metrics });
}

// Combine member scores into the batch read. Mean per metric over the queries that
// produced that metric (a metric only some queries could run must not be diluted by
// the ones that couldn't), plus the weak tail — which query to look at first.
function aggregate(rows, threshold = 0.5) {
  const per = {};
  let noContext = 0;
  for (const r of rows) {
    const m = r.metrics_json || {};
    if (m._no_context) { noContext += 1; continue; }
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith('_') || !v || typeof v !== 'object') continue;
      if (typeof v.score !== 'number') continue;
      (per[k] = per[k] || []).push({ id: r.id, query: r.query, score: v.score });
    }
  }
  const per_metric = {};
  for (const [k, items] of Object.entries(per)) {
    const scores = items.map((i) => i.score);
    per_metric[k] = {
      mean: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)),
      score_100: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100),
      n: scores.length,
      weak: items.filter((i) => i.score < threshold).length,
      worst: items.slice().sort((a, b) => a.score - b.score).slice(0, 3),
    };
  }
  // Production injects whatever comes back into the LLM context, on every turn. So the
  // question is not only "were the chunks relevant" but "how often did we inject at all,
  // and how much of that landed on turns that were not questions" — that is context
  // pollution the live agent was actually fed.
  const byKind = {};
  for (const r of rows) {
    const k = r.kind || 'unlabelled';
    const got = Array.isArray(r.retrieval_json) && r.retrieval_json.length > 0;
    const b = (byKind[k] = byKind[k] || { turns: 0, injected: 0 });
    b.turns += 1;
    if (got) b.injected += 1;
  }
  const noise = ['chit_chat', 'call_action'].reduce(
    (a, k) => a + ((byKind[k] || {}).injected || 0), 0);
  const noiseTurns = ['chit_chat', 'call_action'].reduce(
    (a, k) => a + ((byKind[k] || {}).turns || 0), 0);

  return {
    per_metric,
    by_kind: byKind,
    injected: rows.filter((r) => Array.isArray(r.retrieval_json) && r.retrieval_json.length).length,
    // chunks pushed into context on turns that asked the knowledge base nothing
    noise_injections: noise,
    noise_turns: noiseTurns,
    n_scored: rows.length - noContext,
    no_context: noContext,
    // one number for the batch: the mean of the metric means actually produced
    overall_100: Object.keys(per_metric).length
      ? Math.round(Object.values(per_metric).reduce((a, m) => a + m.score_100, 0) / Object.keys(per_metric).length)
      : null,
  };
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

    // Same path a batch member takes — one implementation, so the two can never drift.
    const row = await runOneQuery({
      url, collection, query, gold_answer, name: name && name.trim() ? name.trim() : null,
      search_type, top_k, alpha, rerank, distance_threshold, answer_mode, providedAnswer,
    });

    // Interactive single runs report an empty retrieval as an error the user can act on;
    // a batch stores the same case as a scored-zero member instead of failing the run.
    if ((row.metrics_json || {})._no_context) {
      await row.destroy();
      res.status(422).json({ error: 'Retrieval returned no chunks for this query/collection.' });
      return;
    }

    res.json(row);
  } catch (err) {
    res.status(502).json({ error: err.message || 'RAG evaluation failed' });
  }
}

// ---- batches: N queries, each scored, plus the combined read -------------------

const BATCH_CONCURRENCY = 3;   // the judge does ~5 model calls per query; stay polite

// Runs a batch to completion in the background, writing progress to the parent row.
// Shared by POST /batches and POST /call-report so the two can never drift — a
// call report IS a batch, only sourced differently.
function runBatchInBackground(batch, items, opts) {
  const { url, collection, search_type, top_k, alpha, rerank,
          distance_threshold, answer_mode, searchParams } = opts;
  (async () => {
    const rows = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const it = items[cursor++];
        try {
          rows.push(await runOneQuery({
            url, collection, query: it.query, gold_answer: it.gold_answer, batch_id: batch.id,
            kind: it.kind || null,
            search_type, top_k, alpha, rerank, distance_threshold, answer_mode,
          }));
        } catch (e) {
          // one bad query must not lose the other sixty-nine — record it and continue
          rows.push(await RagTest.create({
            id: nanoid(12), rag_url: url, collection, query: it.query, batch_id: batch.id,
            kind: it.kind || null,
            search_params: searchParams, gold_answer: it.gold_answer || null, answer: null,
            retrieval_json: [], metrics_json: { _error: String(e.message || e).slice(0, 300) },
          }));
        }
        await batch.update({ n_done: rows.length, updated_at: new Date() });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, worker));
      await batch.update({ status: 'complete', n_done: rows.length,
                           aggregate_json: aggregate(rows), updated_at: new Date() });
    } catch (e) {
      await batch.update({ status: 'failed', error_message: String(e.message || e).slice(0, 1000),
                           aggregate_json: aggregate(rows), updated_at: new Date() });
    }
  })();
}

async function evaluateBatch(req, res) {
  try {
    const {
      name, collection, queries, rag_url, gold_answers,
      search_type = 'hybrid', top_k = 5, alpha = 0.7, rerank = true,
      distance_threshold, answer_mode = 'generate',
      source = 'manual', source_meta = {},
    } = req.body || {};

    const url = isUrl(rag_url) ? rag_url : ragApiUrl;
    if (!isUrl(url)) return res.status(400).json({ error: 'A valid http(s) RAG API URL is required' });
    if (!collection) return res.status(400).json({ error: 'collection is required' });

    // accept ["q", ...] or [{query, gold_answer}, ...]
    const items = (Array.isArray(queries) ? queries : [])
      .map((q, i) => (typeof q === 'string'
        ? { query: q.trim(), gold_answer: (gold_answers || [])[i] || null }
        : { query: String(q.query || '').trim(), gold_answer: q.gold_answer || null,
            said: q.said || null, kind: q.kind || null }))
      .filter((q) => q.query);
    if (!items.length) return res.status(400).json({ error: 'at least one query is required' });
    // A verbatim production replay is one query per user turn, and a 14-minute call
    // runs to 70+ turns — the old cap of 50 rejected real calls. The ceiling exists
    // only to stop a runaway batch, so it sits above the longest plausible call.
    if (items.length > 250) return res.status(400).json({ error: 'too many queries (max 250)' });

    const searchParams = { search_type, top_k, alpha, rerank, distance_threshold: distance_threshold ?? null };
    const batch = await RagBatch.create({
      id: nanoid(12), name: name && name.trim() ? name.trim() : null,
      rag_url: url, collection, search_params: searchParams,
      source, source_meta: source_meta || {}, status: 'running', n_queries: items.length,
    });
    // answer immediately; the batch runs in the background and is polled
    res.json({ batch_id: batch.id, status: 'running', n_queries: items.length });

    runBatchInBackground(batch, items, {
      url, collection, search_type, top_k, alpha, rerank, distance_threshold,
      answer_mode, searchParams,
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'batch failed' });
  }
}

async function listBatches(_req, res) {
  res.json(await RagBatch.findAll({
    attributes: ['id', 'name', 'collection', 'source', 'source_meta', 'status',
                 'n_queries', 'n_done', 'aggregate_json', 'created_at'],
    order: [['created_at', 'DESC']], limit: 100,
  }));
}

async function getBatch(req, res) {
  const batch = await RagBatch.findByPk(req.params.id, {
    include: [{ model: RagTest, as: 'queries' }],
  });
  if (!batch) return res.status(404).json({ error: 'not found' });
  res.json(batch);
}

async function deleteBatch(req, res) {
  await RagBatch.destroy({ where: { id: req.params.id } });   // members cascade
  res.json({ deleted: true });
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

// ---- mine a production call for the questions it actually asked -----------------
// Read-only: the vertical databases are opened with default_transaction_read_only.
// This does NOT run anything — it returns candidates for the user to review, because
// a mined query list always needs a human eye before it is worth spending judge calls on.
// ---- ONE-SHOT: "check this call's RAG relevancy" -------------------------------
// POST /api/rag/call-report  { vertical, call_id, collection, ... }
//   -> { report_id, status, poll } immediately (a 14-minute call is 70+ searches)
// GET  /api/rag/call-report/:id
//   -> the full, parseable report: every turn, what was retrieved for it, whether
//      production would have injected it, and how relevant it was.
// Defaults mirror the production RAGEnricher: the raw text of EVERY user turn is
// searched, because that is what the live agent does on on_user_turn_completed.
async function startCallReport(req, res) {
  try {
    const {
      vertical, call_id, collection, rag_url,
      mode = 'verbatim',                 // verbatim = every turn as production sends it
      search_type = 'keyword',           // BM25 — what the live call uses
      top_k = 5, alpha = 0.7, rerank = true, distance_threshold,
      answer_mode = 'none',              // the enricher injects; it does not generate
      name,
    } = req.body || {};

    if (!verticalSource.isVertical(vertical)) {
      return res.status(400).json({ error: `unknown vertical '${vertical}'`,
                                    verticals: verticalSource.listVerticals().map((v) => v.key) });
    }
    if (!String(call_id || '').trim()) return res.status(400).json({ error: 'call_id is required' });
    if (!collection) return res.status(400).json({ error: 'collection is required' });
    const url = isUrl(rag_url) ? rag_url : ragApiUrl;
    if (!isUrl(url)) return res.status(400).json({ error: 'A valid http(s) RAG API URL is required' });

    const [call] = await verticalSource.fetchCalls(vertical, [String(call_id).trim()]);
    if (!call || call._missing) return res.status(404).json({ error: `call ${call_id} not found in ${vertical}` });
    if (!String(call.transcript || '').trim()) {
      return res.status(422).json({ error: `call ${call_id} has no transcript` });
    }

    const mined = await ragClient.extractQueries(call.transcript, mode);
    const queries = mined.queries || [];
    if (!queries.length) {
      return res.status(422).json({ error: 'no customer turns to test in this call',
                                    n_turns: mined.n_turns, n_user_turns: mined.n_user_turns });
    }

    const searchParams = { search_type, top_k, alpha, rerank, distance_threshold: distance_threshold ?? null };
    const batch = await RagBatch.create({
      id: nanoid(12),
      name: name || `call ${String(call.id).slice(0, 8)} · ${collection}`,
      rag_url: url, collection, search_params: searchParams,
      source: 'call', status: 'running', n_queries: queries.length,
      source_meta: {
        vertical, call_id: call.id, agent_id: call.agent_id || null,
        direction: call.direction || null, duration: call.duration ?? null,
        extract_mode: mined.mode, n_turns: mined.n_turns, n_user_turns: mined.n_user_turns,
        n_kb: mined.n_kb ?? null, n_call_action: mined.n_call_action ?? null,
        n_chit_chat: mined.n_chit_chat ?? null, answer_mode,
      },
    });

    res.json({
      report_id: batch.id, status: 'running', n_queries: queries.length,
      call: { id: call.id, vertical, agent_id: call.agent_id || null,
              direction: call.direction || null, duration: call.duration ?? null },
      turns: { total: mined.n_turns, user: mined.n_user_turns,
               kb_question: mined.n_kb ?? null, call_action: mined.n_call_action ?? null,
               chit_chat: mined.n_chit_chat ?? null },
      poll: `/api/rag/call-report/${batch.id}`,
    });

    runBatchInBackground(batch, queries, {
      url, collection, search_type, top_k, alpha, rerank, distance_threshold, answer_mode,
      searchParams,
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'call report failed' });
  }
}

// GET /api/rag/call-report/:id — everything the UI needs, already shaped.
async function getCallReport(req, res) {
  const batch = await RagBatch.findByPk(req.params.id, { include: [{ model: RagTest, as: 'queries' }] });
  if (!batch) return res.status(404).json({ error: 'report not found' });

  const rows = (batch.queries || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const meta = batch.source_meta || {};
  const agg = batch.aggregate_json || {};

  const turns = rows.map((r) => {
    const chunks = Array.isArray(r.retrieval_json) ? r.retrieval_json : [];
    const m = r.metrics_json || {};
    const rel = m.contextual_relevancy || null;
    return {
      id: r.id,
      query: r.query,                       // exactly what was searched with
      kind: r.kind || 'unlabelled',         // kb_question | call_action | chit_chat
      injected: chunks.length > 0,          // production would have pushed this into context
      n_chunks: chunks.length,
      chunks: chunks.map((c) => ({
        section: c.section || null,
        score: c.score ?? c.distance ?? null,
        preview: String(c.content || c.text || '').slice(0, 280),
      })),
      answer: r.answer || null,
      metrics: Object.fromEntries(Object.entries(m)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => [k, { score: v.score ?? null, score_100: v.score_100 ?? null,
                               reason: v.reason || null }])),
      relevancy_100: rel ? rel.score_100 ?? null : null,
      // the actionable bit: chunks pushed into context for a turn that asked nothing
      noise: (r.kind && r.kind !== 'kb_question' && chunks.length > 0) || false,
      error: m._error || (m._no_context ? 'retrieval returned no chunks' : null),
    };
  });

  const scored = turns.filter((t) => t.relevancy_100 != null);
  res.json({
    report_id: batch.id,
    status: batch.status,                   // running | complete | failed
    progress: { done: batch.n_done, total: batch.n_queries },
    error: batch.error_message || null,
    created_at: batch.created_at,

    call: { id: meta.call_id, vertical: meta.vertical, agent_id: meta.agent_id,
            direction: meta.direction, duration: meta.duration },
    // echoed so a report is reproducible and arguable
    config: { collection: batch.collection, rag_url: batch.rag_url,
              ...batch.search_params, extract_mode: meta.extract_mode,
              answer_mode: meta.answer_mode },

    summary: {
      turns_total: meta.n_turns ?? null,
      user_turns: meta.n_user_turns ?? null,
      tested: turns.length,
      by_kind: agg.by_kind || {},
      injected: agg.injected ?? turns.filter((t) => t.injected).length,
      no_context: agg.no_context ?? turns.filter((t) => !t.injected).length,
      // how much of what production injected landed on turns that asked nothing
      noise_injections: agg.noise_injections ?? turns.filter((t) => t.noise).length,
      noise_turns: agg.noise_turns ?? null,
      injection_rate_pct: turns.length
        ? Math.round((turns.filter((t) => t.injected).length / turns.length) * 100) : null,
      relevancy_mean_100: scored.length
        ? Math.round(scored.reduce((a, t) => a + t.relevancy_100, 0) / scored.length) : null,
      weak_turns: scored.filter((t) => t.relevancy_100 < 50).length,
      per_metric: agg.per_metric || {},
    },

    // ranked worst first — what to look at, without sorting client-side
    worst: scored.slice().sort((a, b) => a.relevancy_100 - b.relevancy_100).slice(0, 10)
      .map((t) => ({ id: t.id, query: t.query, kind: t.kind, relevancy_100: t.relevancy_100 })),
    noise_turns: turns.filter((t) => t.noise)
      .map((t) => ({ id: t.id, query: t.query, kind: t.kind, n_chunks: t.n_chunks })),

    turns,
  });
}

async function callQueries(req, res) {
  try {
    const { vertical, call_id, mode = 'llm' } = req.body || {};   // llm | verbatim | rules
    if (!verticalSource.isVertical(vertical)) {
      return res.status(400).json({ error: `unknown vertical '${vertical}'` });
    }
    if (!String(call_id || '').trim()) return res.status(400).json({ error: 'call_id is required' });

    const [call] = await verticalSource.fetchCalls(vertical, [String(call_id).trim()]);
    if (!call || call._missing) return res.status(404).json({ error: `call ${call_id} not found in ${vertical}` });
    if (!String(call.transcript || '').trim()) {
      return res.status(422).json({ error: `call ${call_id} has no transcript` });
    }

    const mined = await ragClient.extractQueries(call.transcript, mode);
    res.json({
      call_id: call.id,
      vertical,
      agent_id: call.agent_id || null,
      direction: call.direction || null,
      duration: call.duration ?? null,
      n_turns: mined.n_turns,
      n_user_turns: mined.n_user_turns,
      mode: mined.mode,
      dropped: mined.dropped || null,
      n_kb: mined.n_kb ?? null,
      n_call_action: mined.n_call_action ?? null,
      n_chit_chat: mined.n_chit_chat ?? null,
      warning: mined.warning || null,
      // production takes collection_name from per-call dispatch metadata, which the
      // calls table does not store — so the collection cannot be derived here.
      collection_hint: null,
      queries: mined.queries || [],
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'call mining failed' });
  }
}

module.exports = {
  defaultUrl, getCollections, evaluate, listTests, getTest, deleteTest,
  evaluateBatch, listBatches, getBatch, deleteBatch, callQueries,
  startCallReport, getCallReport,
};
