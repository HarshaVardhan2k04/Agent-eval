'use strict';
// Which tools the agent under test is offered — chosen per run (or imported from
// agent_db.agents.available_tools), so tool checks measure the real toolset.
module.exports = {
  async up(q, S) {
    await q.addColumn('forge_runs', 'tools_json', { type: S.JSONB, allowNull: true });
    await q.addColumn('forge_versions', 'tool_checks_json', { type: S.JSONB, allowNull: true });
  },
  async down(q) {
    await q.removeColumn('forge_runs', 'tools_json');
    await q.removeColumn('forge_versions', 'tool_checks_json');
  },
};
