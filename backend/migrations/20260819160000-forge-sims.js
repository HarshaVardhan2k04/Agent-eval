'use strict';
// forge_sims — the conversation archive for run-then-grade evaluation.
// EVERY simulated conversation (detector screen, deep-confirm, stress, deepeval)
// is stored with its full transcript, then the grading pass backfills verdict +
// reason. This is what makes verdicts provable in the UI ("here is the exchange")
// and judging re-runnable without re-simulating.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('forge_sims', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      sim_uid: { type: Sequelize.TEXT, allowNull: false, unique: true }, // engine-issued, correlates grade→row
      run_id: { type: Sequelize.TEXT, allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      kind: { type: Sequelize.TEXT, allowNull: false }, // detector | deep_confirm | stress | deepeval
      problem_id: { type: Sequelize.TEXT, allowNull: true },
      probe: { type: Sequelize.TEXT, allowNull: true },
      idx: { type: Sequelize.INTEGER, allowNull: true }, // vote / grid index within its group
      transcript_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      tool_calls_json: { type: Sequelize.JSONB, allowNull: true },
      ended: { type: Sequelize.BOOLEAN, allowNull: true }, // agent hung up via tool
      verdict: { type: Sequelize.TEXT, allowNull: true }, // pass | fail (backfilled by grading)
      reason: { type: Sequelize.TEXT, allowNull: true },  // checker evidence / judge reason
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('forge_sims', ['run_id']);
    await queryInterface.addIndex('forge_sims', ['run_id', 'problem_id']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('forge_sims');
  },
};
