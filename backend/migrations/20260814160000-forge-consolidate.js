'use strict';

// Consolidate the Forge schema 11 -> 4 tables (house style: parent row + child rows +
// JSONB blobs, like Call Analysis / Test STT). Sub-entities that were their own tables
// fold into JSONB columns:
//   forge_run_layers        -> forge_runs.layers_json
//   forge_probes            -> forge_runs.probes_json
//   forge_escalations       -> forge_runs.escalations_json
//   forge_human_reviews     -> forge_runs.review_json
//   forge_run_problem_status-> forge_versions.statuses_json  (one write per version, not ~20)
//   forge_prompts           -> dropped (layer library IS agent_db_dev.prompts, read-only;
//                              pasted layers live on the run; promote = export payload)
//   forge_scenario_results  -> dropped (evidence lives in statuses_json; raw in forge_events)
// Also adds forge_runs.solved_pct so it never squats in final_composite again.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS layers_json JSONB NOT NULL DEFAULT '[]'`);
    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS probes_json JSONB NOT NULL DEFAULT '[]'`);
    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS escalations_json JSONB NOT NULL DEFAULT '[]'`);
    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS review_json JSONB NOT NULL DEFAULT '{}'`);
    await sql.query(`ALTER TABLE forge_runs ADD COLUMN IF NOT EXISTS solved_pct REAL`);
    await sql.query(`ALTER TABLE forge_versions ADD COLUMN IF NOT EXISTS statuses_json JSONB`);

    for (const t of [
      'forge_run_problem_status', 'forge_prompts', 'forge_run_layers', 'forge_probes',
      'forge_scenario_results', 'forge_escalations', 'forge_human_reviews',
    ]) {
      await sql.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  },

  async down() {
    // One-way consolidation; the original tables are recreatable from 20260814120000 if ever needed.
  },
};
