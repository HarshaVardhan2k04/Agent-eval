'use strict';
// Per-conversation tool verdict: what the model SPOKE but never called (leaks) and
// the computed summary (offered/fired/leaked/unknown/expected/missed/score).
module.exports = {
  async up(q, S) {
    await q.addColumn('forge_sims', 'tool_leaks_json', { type: S.JSONB, allowNull: true });
    await q.addColumn('forge_sims', 'tool_summary_json', { type: S.JSONB, allowNull: true });
  },
  async down(q) {
    await q.removeColumn('forge_sims', 'tool_leaks_json');
    await q.removeColumn('forge_sims', 'tool_summary_json');
  },
};
