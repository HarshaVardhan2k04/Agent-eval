'use strict';
// Referential integrity for the tables that had none. Until now a run could be
// deleted while its 594 conversations stayed behind, and an arena could point at
// contestant runs that no longer existed (that is exactly how arena PwWtDxWhyd
// ended up stuck). forge_versions and forge_events already had these; these three
// were the gap.
//
// ON DELETE choice per edge:
//   sims.run_id        CASCADE  - a conversation has no meaning without its run
//   runs.arena_id      SET NULL - the run is still a valid standalone run
//   arenas.winner_run  SET NULL - the arena survives losing its winner
module.exports = {
  async up(q) {
    await q.sequelize.query(`
      ALTER TABLE forge_sims
        ADD CONSTRAINT forge_sims_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES forge_runs(id) ON DELETE CASCADE;
    `);
    await q.sequelize.query(`
      ALTER TABLE forge_runs
        ADD CONSTRAINT forge_runs_arena_id_fkey
        FOREIGN KEY (arena_id) REFERENCES forge_arenas(id) ON DELETE SET NULL;
    `);
    await q.sequelize.query(`
      ALTER TABLE forge_arenas
        ADD CONSTRAINT forge_arenas_winner_run_id_fkey
        FOREIGN KEY (winner_run_id) REFERENCES forge_runs(id) ON DELETE SET NULL;
    `);
  },
  async down(q) {
    await q.sequelize.query('ALTER TABLE forge_arenas DROP CONSTRAINT IF EXISTS forge_arenas_winner_run_id_fkey;');
    await q.sequelize.query('ALTER TABLE forge_runs DROP CONSTRAINT IF EXISTS forge_runs_arena_id_fkey;');
    await q.sequelize.query('ALTER TABLE forge_sims DROP CONSTRAINT IF EXISTS forge_sims_run_id_fkey;');
  },
};
