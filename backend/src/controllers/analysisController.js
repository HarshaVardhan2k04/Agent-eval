// Call Analysis: batches (agent config + tool set) + per-call scoring via the
// engine's Gemma judge. Scoring runs in the background; the UI polls the batch.
const { nanoid } = require('nanoid');
const { CallBatch, CallAnalysis, Flow } = require('../models');
const { scoreCall } = require('../services/analysisClient');
const sttClient = require('../services/sttClient');
const verticalSource = require('../services/verticalSource');

const SECTION_KEYS = [
  'greeting_intro', 'empathy', 'information_push_goal',
  'conversation_management_flow', 'call_closing', 'tool_calling',
];
const METRIC_KEYS = [
  'customer_retention_frustration', 'repetition',
  'instruction_flow_following', 'tool_calling', 'human_likeness',
  'faithfulness',       // claim-level hallucination check vs the KB (null when no KB)
  'answer_relevancy',   // did the agent answer the customer's questions
  'self_consistency',   // did the agent contradict itself (no KB needed)
];

function mean(nums) {
  const v = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  return v.length ? Number((v.reduce((s, n) => s + n, 0) / v.length).toFixed(1)) : null;
}

function summarize(rows) {
  const scored = rows.filter((r) => !r.gated_reason && r.composite_score != null);
  const section_means = {};
  for (const k of SECTION_KEYS) {
    section_means[k] = mean(scored.map((r) => (r.sections_json?.[k]?.score)));
  }
  const metric_means = {};
  for (const k of METRIC_KEYS) {
    metric_means[k] = mean(scored.map((r) => (r.metrics_json?.[k])));
  }
  // Recurring improvement themes — group by a normalized key, count, take top.
  const tally = new Map();
  for (const r of rows) {
    for (const a of r.areas_json || []) {
      const key = String(a).toLowerCase().slice(0, 48);
      const cur = tally.get(key) || { text: String(a), count: 0 };
      cur.count += 1;
      tally.set(key, cur);
    }
  }
  const top_themes = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  return {
    n_total: rows.length,
    n_scored: scored.length,
    n_gated: rows.filter((r) => r.gated_reason).length,
    composite_mean: mean(scored.map((r) => r.composite_score)),
    section_means,
    metric_means,
    top_themes,
  };
}

async function refreshSummary(batchId, status) {
  const rows = await CallAnalysis.findAll({ where: { batch_id: batchId } });
  const summary = summarize(rows.map((r) => r.toJSON()));
  const patch = { summary_json: summary };
  if (status) patch.status = status;
  await CallBatch.update(patch, { where: { id: batchId } });
  return summary;
}

// Score an array of call records in the background (bounded concurrency).
async function scoreBatchInBackground(batch, calls) {
  const CONCURRENCY = 3;
  let idx = 0;

  async function worker() {
    while (idx < calls.length) {
      const call = calls[idx++];
      const payload = {
        call_id: call.call_id || null,
        transcript: call.transcript || '',
        call_direction: call.direction || call.call_direction || batch.direction,
        editable_config: call.editable_config || batch.editable_config || {},
        available_tools: call.available_tools || batch.tools_json || [],
        tool_events: call.tool_events || [],
      };
      let result;
      try {
        result = await scoreCall(payload);
      } catch (e) {
        result = {
          sections: {}, metrics: {}, flow_adherence: [],
          areas_of_improvement: [], composite_score: null,
          gated_reason: `error: ${e.message}`.slice(0, 200),
        };
      }
      // Guard the DB writes too — one bad row must not abort the whole batch and
      // strand its status at 'scoring'.
      try {
        await CallAnalysis.create({
          batch_id: batch.id,
          call_id: payload.call_id,
          direction: payload.call_direction,
          transcript: payload.transcript,
          sections_json: result.sections || {},
          metrics_json: result.metrics || {},
          flow_json: result.flow_adherence || [],
          areas_json: result.areas_of_improvement || [],
          tool_events_json: payload.tool_events,
          gated_reason: result.gated_reason || null,
          composite_score: result.composite_score,
        });
        await refreshSummary(batch.id, 'scoring');
      } catch (e) {
        console.error('[analysis] failed to store scored call', batch.id, e.message);
      }
    }
  }

  // Always reach a terminal status, even if a worker throws — otherwise the UI
  // polls 'scoring' forever.
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, calls.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch((e) =>
      console.error('[analysis] failed to finalize batch', batch.id, e.message)
    );
  }
}

// A saved Flow (nodes+edges) -> a conversation_flow the judge can score against.
// Nodes are ordered left-to-right (their canvas layout); each becomes a stage.
function flowToConfig(definition, direction) {
  const nodes = (definition?.nodes || []).slice().sort(
    (a, b) => (a.position?.x || 0) - (b.position?.x || 0) || (a.position?.y || 0) - (b.position?.y || 0)
  );
  const stages = {};
  for (const n of nodes) {
    if (n.type === 'start') continue; // entry marker, not a stage
    const key = String(n.name || n.id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || n.id;
    const prefix = n.type === 'tool' ? `Call the tool "${n.name}". ` : n.type === 'branch' ? 'Decision: ' : '';
    stages[key] = (prefix + (n.description || n.name || '')).trim();
  }
  return { guiding_prompt: { conversation_flow: { [direction || 'inbound']: stages } } };
}

async function createBatch(req, res) {
  try {
    const { name, direction, editable_config, tools, flow_id } = req.body;
    let config = editable_config || {};
    let flowName = null;

    // If judged against a saved Flow, derive the conversation_flow from it.
    if (flow_id) {
      const flow = await Flow.findByPk(flow_id);
      if (!flow) {
        res.status(404).json({ error: 'Flow not found' });
        return;
      }
      flowName = flow.name;
      config = { ...config, ...flowToConfig(flow.definition, direction || flow.direction) };
    }

    const batch = await CallBatch.create({
      id: nanoid(12),
      name: name && name.trim() ? name.trim() : null,
      direction: direction || 'outbound',
      flow_id: flow_id || null,
      flow_name: flowName,
      editable_config: config,
      tools_json: tools || [],
      status: 'ready',
      summary_json: summarize([]),
    });
    res.json(batch);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Recordings path: transcribe each audio file to labelled turns, then score it.
async function scoreRecordingsInBackground(batch, files) {
  const CONCURRENCY = 2;  // transcription is heavy; keep it gentle on Soniox + vLLM
  let idx = 0;

  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      let transcript = '';
      let transErr = null;
      try {
        const t = await sttClient.transcribeTurns({ buffer: f.buffer, filename: f.originalname });
        transcript = t.transcript || '';
      } catch (e) {
        transErr = e.message;
      }

      let result;
      if (transErr || !transcript.trim()) {
        result = {
          sections: {}, metrics: {}, flow_adherence: [], areas_of_improvement: [],
          composite_score: null, gated_reason: `transcription_failed: ${transErr || 'empty'}`.slice(0, 200),
        };
      } else {
        try {
          result = await scoreCall({
            call_id: f.originalname,
            transcript,
            call_direction: batch.direction,
            editable_config: batch.editable_config || {},
            available_tools: batch.tools_json || [],
            tool_events: [],
          });
        } catch (e) {
          result = {
            sections: {}, metrics: {}, flow_adherence: [], areas_of_improvement: [],
            composite_score: null, gated_reason: `error: ${e.message}`.slice(0, 200),
          };
        }
      }
      try {
        await CallAnalysis.create({
          batch_id: batch.id,
          call_id: f.originalname,
          source_filename: f.originalname,
          direction: batch.direction,
          transcript,
          sections_json: result.sections || {},
          metrics_json: result.metrics || {},
          flow_json: result.flow_adherence || [],
          areas_json: result.areas_of_improvement || [],
          tool_events_json: [],
          gated_reason: result.gated_reason || null,
          composite_score: result.composite_score,
        });
        await refreshSummary(batch.id, 'scoring');
      } catch (e) {
        console.error('[analysis] failed to store recording', batch.id, e.message);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch(() => {});
  }
}

async function addRecordings(req, res) {
  try {
    const batch = await CallBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: 'audio recordings are required' });
      return;
    }
    await CallBatch.update({ status: 'scoring' }, { where: { id: batch.id } });
    scoreRecordingsInBackground(batch.toJSON(), files).catch((e) =>
      console.error('[analysis] recordings scoring failed', batch.id, e.message)
    );
    res.json({ queued: files.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function addCalls(req, res) {
  try {
    const batch = await CallBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const calls = req.body.calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      res.status(400).json({ error: 'calls[] is required' });
      return;
    }
    await CallBatch.update({ status: 'scoring' }, { where: { id: batch.id } });
    // Fire and forget — the UI polls GET /batches/:id for progress.
    scoreBatchInBackground(batch.toJSON(), calls).catch((e) =>
      console.error('[analysis] batch scoring failed', batch.id, e.message)
    );
    res.json({ queued: calls.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// --- Import path ------------------------------------------------------------
// Pull real calls from a vertical's production DB (read-only) and score their
// stored transcripts against the batch's flow/tools/direction. The production
// `transcript` is the actual conversation — we judge it directly (no re-STT);
// `gcs_path` is kept so the call report can play the recording.
async function scoreImportInBackground(batch, vertical, callIds) {
  const CONCURRENCY = 3;

  async function storeGated(row, reason) {
    await CallAnalysis.create({
      batch_id: batch.id,
      call_id: row.id != null ? String(row.id) : null,
      source_type: 'import',
      vertical,
      gcs_path: row.gcs_path || null,
      gcs_bucket: row.gcs_bucket || null,
      direction: batch.direction,
      transcript: row.transcript || '',
      gated_reason: reason,
      composite_score: null,
    });
  }

  let rows;
  try {
    rows = await verticalSource.fetchCalls(vertical, callIds);
  } catch (e) {
    // Unconfigured vertical / bad creds / DB down — gate every id so the UI shows why.
    console.error('[analysis] import fetchCalls failed', batch.id, e.message);
    const reason = `import_failed: ${e.message}`.slice(0, 200);
    for (const id of callIds) { try { await storeGated({ id }, reason); } catch { /* keep going */ } }
    await refreshSummary(batch.id, 'done').catch(() => {});
    return;
  }

  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const row = rows[idx++];
      try {
        if (row._missing) { await storeGated(row, 'not_found'); continue; }
        if (!row.transcript || !row.transcript.trim()) { await storeGated(row, 'no_transcript'); continue; }

        const payload = {
          call_id: String(row.id),
          transcript: row.transcript,
          call_direction: batch.direction,
          editable_config: batch.editable_config || {},
          available_tools: batch.tools_json || [],
          tool_events: [],
        };
        let result;
        try {
          result = await scoreCall(payload);
        } catch (e) {
          result = { sections: {}, metrics: {}, flow_adherence: [], areas_of_improvement: [], composite_score: null, gated_reason: `error: ${e.message}`.slice(0, 200) };
        }
        await CallAnalysis.create({
          batch_id: batch.id,
          call_id: payload.call_id,
          source_type: 'import',
          vertical,
          gcs_path: row.gcs_path || null,
          gcs_bucket: row.gcs_bucket || null,
          direction: payload.call_direction,
          transcript: payload.transcript,
          sections_json: result.sections || {},
          metrics_json: result.metrics || {},
          flow_json: result.flow_adherence || [],
          areas_json: result.areas_of_improvement || [],
          tool_events_json: [],
          gated_reason: result.gated_reason || null,
          composite_score: result.composite_score,
        });
        await refreshSummary(batch.id, 'scoring');
      } catch (e) {
        console.error('[analysis] failed to store imported call', batch.id, e.message);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch(() => {});
  }
}

async function importCalls(req, res) {
  try {
    const batch = await CallBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const { vertical, call_ids } = req.body;
    if (!verticalSource.isVertical(vertical)) {
      res.status(400).json({ error: `unknown vertical '${vertical}'` });
      return;
    }
    // Analyze Calls only needs the transcript (DB); GCS is optional (playback only).
    if (!verticalSource.dbConfigured(vertical)) {
      res.status(400).json({ error: `vertical '${vertical}' has no database credentials — set its VERTICAL_${String(vertical).toUpperCase()}_DB_* keys in backend/.env` });
      return;
    }
    if (!Array.isArray(call_ids) || call_ids.length === 0) {
      res.status(400).json({ error: 'call_ids[] is required' });
      return;
    }
    await CallBatch.update({ status: 'scoring' }, { where: { id: batch.id } });
    scoreImportInBackground(batch.toJSON(), vertical, call_ids).catch((e) =>
      console.error('[analysis] import scoring failed', batch.id, e.message)
    );
    res.json({ queued: call_ids.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// verticalSource.listVerticals() — each with a `configured` flag for the UI.
function getVerticals(_req, res) {
  try {
    res.json(verticalSource.listVerticals());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function listBatches(_req, res) {
  try {
    const rows = await CallBatch.findAll({ order: [['created_at', 'DESC']] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getBatch(req, res) {
  try {
    const batch = await CallBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const analyses = await CallAnalysis.findAll({
      where: { batch_id: req.params.id },
      order: [['created_at', 'ASC']],
    });
    res.json({ ...batch.toJSON(), analyses });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getCall(req, res) {
  try {
    const id = parseInt(req.params.callId, 10);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    const row = await CallAnalysis.findByPk(id);
    if (!row) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Short-lived signed URL to play an imported call's recording from GCS (null for
// uploaded/pasted calls, whose audio we don't retain).
async function getCallAudioUrl(req, res) {
  try {
    const row = await CallAnalysis.findByPk(parseInt(req.params.callId, 10));
    if (!row) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    if (row.source_type === 'import' && row.vertical && row.gcs_path) {
      const url = await verticalSource.signedUrl(row.vertical, row.gcs_path, row.gcs_bucket);
      res.json({ url });
      return;
    }
    res.json({ url: null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function renameBatch(req, res) {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const [n] = await CallBatch.update({ name }, { where: { id: req.params.id } });
    if (!n) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    res.json({ id: req.params.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function deleteBatch(req, res) {
  try {
    await CallBatch.destroy({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = {
  createBatch, addCalls, addRecordings, importCalls, getVerticals,
  listBatches, getBatch, getCall, getCallAudioUrl, renameBatch, deleteBatch,
};
