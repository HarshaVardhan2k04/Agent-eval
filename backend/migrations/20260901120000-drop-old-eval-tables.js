'use strict';
// The old Prompt Eval system is fully replaced by Forge. Code lives in
// deprecated/, data snapshot in deprecated/old-eval-tables-backup.sql.gz.
module.exports = {
  async up(queryInterface) {
    // children first (FKs cascade off evals)
    await queryInterface.dropTable('eval_events', { cascade: true });
    await queryInterface.dropTable('scenario_results', { cascade: true });
    await queryInterface.dropTable('prompt_versions', { cascade: true });
    await queryInterface.dropTable('evals', { cascade: true });
  },
  async down() {
    throw new Error('restore from deprecated/old-eval-tables-backup.sql.gz instead');
  },
};
