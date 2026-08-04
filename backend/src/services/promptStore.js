// Prompt-version persistence. Upserts a version row and computes a unified diff
// against the previous version so the UI can render prompt history + patches.
const { createTwoFilesPatch } = require('diff');
const { PromptVersion } = require('../models');

async function storePromptVersion(evalId, version, promptText, score, changesSummary, edits = []) {
  let diffText = null;

  if (version > 0) {
    const prev = await PromptVersion.findOne({
      where: { eval_id: evalId, version: version - 1 },
      attributes: ['prompt_text'],
    });
    if (prev) {
      diffText = createTwoFilesPatch(
        `prompt_v${version - 1}`,
        `prompt_v${version}`,
        prev.prompt_text,
        promptText,
        '',
        '',
        { context: 3 }
      );
    }
  }

  // Upsert on (eval_id, version) — the unique index makes re-sends idempotent.
  const [row, created] = await PromptVersion.findOrCreate({
    where: { eval_id: evalId, version },
    defaults: {
      prompt_text: promptText,
      score,
      changes_summary: changesSummary,
      diff_from_previous: diffText,
      edits_json: edits || [],
    },
  });

  if (!created) {
    await row.update({
      score,
      changes_summary: changesSummary,
      diff_from_previous: diffText,
      edits_json: edits || [],
    });
  }
}

async function getPromptVersions(evalId) {
  return PromptVersion.findAll({
    where: { eval_id: evalId },
    order: [['version', 'ASC']],
  });
}

async function getPromptDiff(evalId, version) {
  return PromptVersion.findOne({
    where: { eval_id: evalId, version },
    attributes: ['diff_from_previous', 'prompt_text'],
  });
}

module.exports = { storePromptVersion, getPromptVersions, getPromptDiff };
