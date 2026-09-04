'use strict';

/**
 * Why each problem is NOT solved, recorded per run.
 *
 * A run that stops below the gate has to account for the gap problem by problem —
 * "26% solved" alone tells you nothing about whether to spend more compute, fix the
 * dataset, or make a human decision. Shape: { [problem_id]: { verdict, category, why,
 * attempts, evidence } }, written from the engine's run_complete event.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('forge_runs', 'unsolved_json', {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {},
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('forge_runs', 'unsolved_json');
  },
};
