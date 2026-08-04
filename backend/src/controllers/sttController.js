// Test STT: batches (a run) + per-clip results. A single test is a batch of 1.
// Two bulk paths land here too: batch uploads and production call imports.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { SttBatch, SttResult } = require('../models');
const sttClient = require('../services/sttClient');
const verticalSource = require('../services/verticalSource');

// Mixed noise-test audio is kept for playback (unlike other STT audio, which is
// forwarded and discarded). Stored on disk under the OS temp dir, keyed by result id.
const MIXED_DIR = path.join(os.tmpdir(), 'agent-eval-mixed');
const mixedPath = (resultId) => path.join(MIXED_DIR, `${resultId}.wav`);

function storeMixedAudio(resultId, base64) {
  if (!base64) return;
  fs.mkdirSync(MIXED_DIR, { recursive: true });
  fs.writeFileSync(mixedPath(resultId), Buffer.from(base64, 'base64'));
}

// A row passes when both WER and CER are tight (engine emits fractions, not %).
const PASS_WER = 0.12;
const PASS_CER = 0.06;

// Roll per-clip metrics up into the batch summary (recomputed on each row).
function summarize(results) {
  const scored = results.filter((r) => r.metrics_json && r.metrics_json.wer != null);
  const n = scored.length;
  const avg = (key, dp) =>
    (n ? Number((scored.reduce((s, r) => s + (r.metrics_json[key] || 0), 0) / n).toFixed(dp)) : null);
  const n_pass = scored.filter(
    (r) => r.metrics_json.wer <= PASS_WER && r.metrics_json.cer <= PASS_CER
  ).length;
  return {
    n_total: results.length,
    n_scored: n,
    n_gated: results.filter((r) => r.gated_reason).length,
    avg_wer: avg('wer', 4),
    avg_cer: avg('cer', 4),
    avg_match: avg('match_pct', 1),
    n_pass,
    n_flag: n - n_pass,
  };
}

async function refreshSummary(batchId, status) {
  const results = await SttResult.findAll({ where: { batch_id: batchId } });
  const summary = summarize(results.map((r) => r.toJSON()));
  const patch = { summary_json: summary };
  if (status) patch.status = status;
  await SttBatch.update(patch, { where: { id: batchId } });
  return summary;
}

async function getProviders(_req, res) {
  try {
    res.json(await sttClient.providers());
  } catch (err) {
    // Engine down — let the UI show a soft "STT engine offline" state.
    res.status(502).json({ error: err.message || 'STT engine unreachable' });
  }
}

async function createBatch(req, res) {
  try {
    const { name, language, provider, mode, vertical } = req.body;
    const id = nanoid(12);
    const batch = await SttBatch.create({
      id,
      name: name && name.trim() ? name.trim() : null,
      language: language || 'en',
      provider: provider || null,
      mode: mode || 'single',
      vertical: vertical || null,
      status: 'ready',
      summary_json: summarize([]),
    });
    res.json(batch);
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
    const rows = await SttBatch.findAll({ order: [['created_at', 'DESC']] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function getBatch(req, res) {
  try {
    const batch = await SttBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const results = await SttResult.findAll({
      where: { batch_id: req.params.id },
      order: [['created_at', 'ASC']],
    });
    res.json({ ...batch.toJSON(), results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

async function deleteBatch(req, res) {
  try {
    // Best-effort remove any stored mixed-audio files for this batch's rows before
    // the cascade drops them (files live outside the DB, so they won't cascade).
    try {
      const rows = await SttResult.findAll({
        where: { batch_id: req.params.id },
        attributes: ['id'],
      });
      for (const r of rows) {
        fs.rmSync(mixedPath(r.id), { force: true });
      }
    } catch (e) {
      console.error('[stt] failed to clean mixed audio', req.params.id, e.message);
    }
    await SttBatch.destroy({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Multipart: audio file + reference/language fields. Transcribes via engine, stores.
async function addResult(req, res) {
  try {
    const batch = await SttBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'audio file is required' });
      return;
    }

    const language = req.body.language || batch.language || 'en';
    const provider = req.body.provider || batch.provider || undefined;

    const result = await sttClient.transcribe({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      reference: req.body.reference || '',
      language,
      provider,
    });

    const { hypothesis, reference, filename, ...metrics } = result;
    const row = await SttResult.create({
      batch_id: batch.id,
      filename: filename || req.file.originalname,
      reference_text: reference || req.body.reference || '',
      hypothesis_text: hypothesis || '',
      metrics_json: metrics,
    });

    const summary = await refreshSummary(batch.id);
    res.json({ result: row, summary });
  } catch (err) {
    res.status(502).json({ error: err.message || 'STT failed' });
  }
}

// --- Batch upload path ------------------------------------------------------
// Transcribe+score many files in the background (concurrency 2). WER/CER only
// when a per-file reference was supplied; otherwise store the hypothesis alone.
async function processUploadsInBackground(batch, files, references) {
  const CONCURRENCY = 2;  // transcription is heavy; keep it gentle on the engine
  let idx = 0;

  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      const reference = (references && references[f.originalname]) || '';
      // Guard each row — one bad file must not strand the batch at 'scoring'.
      try {
        const result = await sttClient.transcribe({
          buffer: f.buffer,
          filename: f.originalname,
          reference,
          language: batch.language,
        });
        const { hypothesis, reference: ref, filename, ...metrics } = result;
        await SttResult.create({
          batch_id: batch.id,
          source_type: 'upload',
          filename: filename || f.originalname,
          reference_text: reference || '',
          hypothesis_text: hypothesis || '',
          duration_ms: metrics.duration_ms != null ? Math.round(metrics.duration_ms) : null,
          metrics_json: reference.trim() ? metrics : {},
        });
      } catch (e) {
        try {
          await SttResult.create({
            batch_id: batch.id,
            source_type: 'upload',
            filename: f.originalname,
            reference_text: reference || '',
            hypothesis_text: '',
            gated_reason: `transcription_failed: ${e.message}`.slice(0, 200),
            metrics_json: {},
          });
        } catch (e2) {
          console.error('[stt] failed to store upload row', batch.id, e2.message);
        }
      }
      await refreshSummary(batch.id, 'scoring').catch(() => {});
    }
  }

  // Always reach 'done' — otherwise the UI polls 'scoring' forever.
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch((e) =>
      console.error('[stt] failed to finalize batch', batch.id, e.message)
    );
  }
}

async function addUploads(req, res) {
  try {
    const batch = await SttBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: 'audio files are required' });
      return;
    }
    // Optional multipart text field: { "<filename>": "<referenceText>" }.
    let references = {};
    if (req.body.references) {
      try {
        references = JSON.parse(req.body.references) || {};
      } catch {
        res.status(400).json({ error: 'references must be a JSON object' });
        return;
      }
    }

    await SttBatch.update({ status: 'scoring' }, { where: { id: batch.id } });
    processUploadsInBackground(batch.toJSON(), files, references).catch((e) =>
      console.error('[stt] uploads processing failed', batch.id, e.message)
    );
    res.json({ queued: files.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// --- Import path ------------------------------------------------------------
// Pull recordings + reference transcripts from a vertical's production DB/GCS
// (SELECT-only, read-only), re-transcribe with our STT, score WER/CER.
async function processImportInBackground(batch, vertical, callIds) {
  const CONCURRENCY = 2;

  async function storeGated(row, reason) {
    await SttResult.create({
      batch_id: batch.id,
      source_type: 'import',
      vertical,
      external_call_id: row.id != null ? String(row.id) : null,
      gcs_path: row.gcs_path || null,
      gcs_bucket: row.gcs_bucket || null,
      filename: row.gcs_path ? path.posix.basename(row.gcs_path) : (row.id != null ? String(row.id) : null),
      reference_text: row.transcript || '',
      hypothesis_text: '',
      gated_reason: reason,
      metrics_json: {},
    });
  }

  let rows;
  try {
    rows = await verticalSource.fetchCalls(vertical, callIds);
  } catch (e) {
    // Whole fetch failed (unconfigured vertical, bad creds, DB unreachable). Gate
    // every requested id with the reason so the UI shows WHY nothing scored rather
    // than an empty "done" batch.
    console.error('[stt] import fetchCalls failed', batch.id, e.message);
    const reason = `import_failed: ${e.message}`.slice(0, 200);
    for (const id of callIds) {
      try { await storeGated({ id }, reason); } catch { /* keep going */ }
    }
    await refreshSummary(batch.id, 'done').catch(() => {});
    return;
  }

  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const row = rows[idx++];
      try {
        if (row._missing) {
          await storeGated(row, 'not_found');
        } else if (!row.gcs_path) {
          await storeGated(row, 'no_recording');
        } else {
          const buffer = await verticalSource.downloadRecording(vertical, row.gcs_path, row.gcs_bucket);
          const filename = path.posix.basename(row.gcs_path) || `${row.id}.mp3`;
          const reference = row.transcript || '';
          const result = await sttClient.transcribe({
            buffer,
            filename,
            reference,
            language: batch.language,
          });
          const { hypothesis, reference: ref, filename: fn, ...metrics } = result;
          const hasRef = !!reference.trim();
          await SttResult.create({
            batch_id: batch.id,
            source_type: 'import',
            vertical,
            external_call_id: String(row.id),
            gcs_path: row.gcs_path,
            gcs_bucket: row.gcs_bucket || null,
            filename,
            reference_text: row.transcript || '',
            hypothesis_text: hypothesis || '',
            duration_ms: metrics.duration_ms != null ? Math.round(metrics.duration_ms) : null,
            // No production transcript -> no WER/CER; keep the hypothesis, gate the row.
            metrics_json: hasRef ? metrics : {},
            gated_reason: hasRef ? null : 'no_reference',
          });
        }
      } catch (e) {
        try {
          await storeGated(row, `error: ${e.message}`.slice(0, 200));
        } catch (e2) {
          console.error('[stt] failed to store import row', batch.id, e2.message);
        }
      }
      await refreshSummary(batch.id, 'scoring').catch(() => {});
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch((e) =>
      console.error('[stt] failed to finalize batch', batch.id, e.message)
    );
  }
}

async function importCalls(req, res) {
  try {
    const batch = await SttBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const { vertical, call_ids } = req.body;
    if (!verticalSource.isVertical(vertical)) {
      res.status(400).json({ error: `unknown vertical '${vertical}'` });
      return;
    }
    // Reject up-front if this vertical has no credentials — clearer than gating
    // every row after the fact.
    const cfg = verticalSource.listVerticals().find((v) => v.key === vertical);
    if (!cfg || !cfg.configured) {
      res.status(400).json({ error: `vertical '${vertical}' is not configured — set its VERTICAL_${String(vertical).toUpperCase()}_* creds in backend/.env` });
      return;
    }

    await SttBatch.update({ status: 'scoring', vertical }, { where: { id: batch.id } });
    processImportInBackground(batch.toJSON(), vertical, call_ids).catch((e) =>
      console.error('[stt] import processing failed', batch.id, e.message)
    );
    res.json({ queued: call_ids.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Short-lived signed URL for playback (imports only; upload audio isn't stored).
async function getAudioUrl(req, res) {
  try {
    const row = await SttResult.findByPk(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).json({ error: 'Result not found' });
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

// --- Noise test path --------------------------------------------------------
// Proxy the engine's catalogue of preset noise environments + intensity levels.
async function getNoises(_req, res) {
  try {
    res.json(await sttClient.listNoises());
  } catch (err) {
    res.status(502).json({ error: err.message || 'STT engine unreachable' });
  }
}

// One clean recording is mixed against each chosen noise (presets + custom uploads)
// at a single intensity, transcribed noisy, and scored vs the reference. A "Clean"
// baseline row (the recording with no noise) gives the reference WER/CER to compare
// against. Concurrency 2 — transcription is heavy; keep it gentle on the engine.
async function processNoiseTestInBackground(batch, recording, reference, level, presets, noiseFiles) {
  const CONCURRENCY = 2;

  // Job kinds: the clean baseline, each preset key, each uploaded noise file.
  const jobs = [
    { kind: 'clean' },
    ...presets.map((key) => ({ kind: 'preset', key })),
    ...noiseFiles.map((f) => ({ kind: 'custom', file: f })),
  ];

  async function storeGated(label, reason) {
    await SttResult.create({
      batch_id: batch.id,
      source_type: 'noise',
      filename: recording.originalname,
      reference_text: reference || '',
      hypothesis_text: '',
      noise_label: label,
      noise_level: label ? level : null,
      gated_reason: reason,
      metrics_json: {},
    });
  }

  async function runJob(job) {
    if (job.kind === 'clean') {
      // Baseline: no noise, just transcribe + score the clean recording.
      const result = await sttClient.transcribe({
        buffer: recording.buffer,
        filename: recording.originalname,
        reference,
        language: 'auto',
      });
      const { hypothesis, reference: ref, filename, ...metrics } = result;
      await SttResult.create({
        batch_id: batch.id,
        source_type: 'noise',
        filename: filename || recording.originalname,
        reference_text: reference || '',
        hypothesis_text: hypothesis || '',
        duration_ms: metrics.duration_ms != null ? Math.round(metrics.duration_ms) : null,
        noise_label: null,
        noise_level: null,
        metrics_json: reference.trim() ? metrics : {},
      });
      return;
    }

    const label = job.kind === 'preset' ? job.key : job.file.originalname;
    const result = await sttClient.noiseTranscribe({
      buffer: recording.buffer,
      filename: recording.originalname,
      reference,
      language: 'auto',
      level,
      noisePreset: job.kind === 'preset' ? job.key : undefined,
      noiseBuffer: job.kind === 'custom' ? job.file.buffer : undefined,
      noiseFilename: job.kind === 'custom' ? job.file.originalname : undefined,
    });
    const { hypothesis, reference: ref, filename, merged_audio_b64, ...metrics } = result;
    const row = await SttResult.create({
      batch_id: batch.id,
      source_type: 'noise',
      filename: recording.originalname,
      reference_text: reference || '',
      hypothesis_text: hypothesis || '',
      duration_ms: metrics.duration_ms != null ? Math.round(metrics.duration_ms) : null,
      noise_label: label,
      noise_level: level,
      metrics_json: metrics,
    });
    // Keep the mixed audio for playback, keyed by the new row id.
    try {
      storeMixedAudio(row.id, merged_audio_b64);
    } catch (e) {
      console.error('[stt] failed to store mixed audio', row.id, e.message);
    }
  }

  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      // Guard each job — one bad noise must not strand the batch at 'scoring'.
      try {
        await runJob(job);
      } catch (e) {
        const label = job.kind === 'clean' ? null
          : job.kind === 'preset' ? job.key : job.file.originalname;
        try {
          await storeGated(label, `noise_test_failed: ${e.message}`.slice(0, 200));
        } catch (e2) {
          console.error('[stt] failed to store noise row', batch.id, e2.message);
        }
      }
      await refreshSummary(batch.id, 'scoring').catch(() => {});
    }
  }

  // Always reach 'done' — otherwise the UI polls 'scoring' forever.
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  } finally {
    await refreshSummary(batch.id, 'done').catch((e) =>
      console.error('[stt] failed to finalize batch', batch.id, e.message)
    );
  }
}

async function runNoiseTest(req, res) {
  try {
    const batch = await SttBatch.findByPk(req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    const recording = req.files && req.files.recording && req.files.recording[0];
    if (!recording) {
      res.status(400).json({ error: 'recording file is required' });
      return;
    }
    const reference = req.body.reference || '';
    const level = req.body.level || 'medium';

    // Preset keys arrive as a JSON array text field; custom noises as noise[] files.
    let presets = [];
    if (req.body.noise_presets) {
      try {
        presets = JSON.parse(req.body.noise_presets) || [];
      } catch {
        res.status(400).json({ error: 'noise_presets must be a JSON array' });
        return;
      }
    }
    const noiseFiles = (req.files && req.files.noise) || [];

    await SttBatch.update({ status: 'scoring' }, { where: { id: batch.id } });
    processNoiseTestInBackground(batch.toJSON(), recording, reference, level, presets, noiseFiles).catch((e) =>
      console.error('[stt] noise test processing failed', batch.id, e.message)
    );
    // queued = clean baseline + presets + custom files.
    res.json({ queued: 1 + presets.length + noiseFiles.length, batch_id: batch.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

// Stream the stored mixed WAV for a noise-test row (404 for clean/upload/import rows).
async function getMixedAudio(req, res) {
  try {
    const file = mixedPath(parseInt(req.params.id, 10));
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'No mixed audio for this result' });
      return;
    }
    res.setHeader('Content-Type', 'audio/wav');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = {
  getProviders, getVerticals, createBatch, listBatches, getBatch, deleteBatch,
  addResult, addUploads, importCalls, getAudioUrl,
  getNoises, runNoiseTest, getMixedAudio,
};
