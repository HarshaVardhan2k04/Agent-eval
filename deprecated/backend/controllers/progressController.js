// Progress ingestion from the engine + optional SSE fan-out.
// The engine POSTs events to /internal/eval-events; we persist them (the progress
// page polls /:id/log) and also broadcast to any open SSE clients.
const { Eval, ScenarioResult, EvalEvent } = require('../models');
const { storePromptVersion } = require('../services/promptStore');

// evalId -> Set<res>. In-memory; fine for single-instance single-user.
const sseClients = new Map();

function broadcastToEval(evalId, event) {
  const clients = sseClients.get(evalId);
  if (!clients) return;
  const data = JSON.stringify(event);
  for (const res of clients) {
    res.write(`data: ${data}\n\n`);
  }
}

function subscribeEvents(req, res) {
  const evalId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(evalId)) sseClients.set(evalId, new Set());
  sseClients.get(evalId).add(res);

  req.on('close', () => {
    sseClients.get(evalId)?.delete(res);
    if (sseClients.get(evalId)?.size === 0) sseClients.delete(evalId);
  });
}

async function ingestEvent(req, res) {
  try {
    const event = req.body;
    const evalId = event?.data?.eval_id;
    if (!evalId) {
      res.status(400).json({ error: 'Missing eval_id in event data' });
      return;
    }

    await EvalEvent.create({
      eval_id: evalId,
      event_type: event.event_type,
      event_data: event.data,
    });

    if (event.event_type === 'iteration_complete') {
      const data = event.data;
      await Eval.update(
        { iterations_run: data.iteration, final_score: data.score, updated_at: new Date() },
        { where: { id: evalId } }
      );

      const scenarioResults = data.scenario_results;
      if (Array.isArray(scenarioResults)) {
        for (const sr of scenarioResults) {
          await ScenarioResult.create({
            eval_id: evalId,
            iteration: data.iteration,
            scenario_name: sr.scenario_name,
            scenario_type: sr.scenario_type,
            response_text: sr.response || null,
            transcript_json: sr.transcript || [],
            tool_calls_json: sr.tool_calls || [],
            scores_json: sr.scores || {},
            voice_analysis_json: sr.voice_analysis || {},
            judge_reasoning: sr.judge_reasoning || null,
            composite_score: sr.composite_score,
          });
        }
      }
    }

    if (event.event_type === 'prompt_improved') {
      const versions = event.data.prompt_versions;
      if (Array.isArray(versions) && versions.length) {
        const latest = versions[versions.length - 1];
        await storePromptVersion(
          evalId, latest.version, latest.prompt, latest.score, latest.changes
        );
      }
    }

    if (event.event_type === 'eval_complete') {
      const data = event.data;
      await Eval.update(
        {
          status: data.status || 'completed',
          final_score: data.final_score,
          iterations_run: data.iterations_run,
          completed_at: new Date(),
          updated_at: new Date(),
        },
        { where: { id: evalId } }
      );

      const versions = data.prompt_versions;
      if (Array.isArray(versions)) {
        for (const pv of versions) {
          await storePromptVersion(
            evalId, pv.version, pv.prompt, pv.score, pv.changes, pv.edits || []
          );
        }
      }
    }

    broadcastToEval(evalId, event);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

module.exports = { subscribeEvents, ingestEvent };
