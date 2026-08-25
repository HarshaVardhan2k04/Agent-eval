'use strict';

// Forge coverage across the FULL direction x lead_status cross-product, the human gate
// for combos the prompt cannot serve, and the per-run coach guidance panel.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('forge_runs', 'combos_json', {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {},
    });
    await queryInterface.addColumn('forge_runs', 'coach_guidance', {
      type: Sequelize.TEXT, allowNull: true,
    });
    await queryInterface.addColumn('forge_sims', 'combo', {
      type: Sequelize.TEXT, allowNull: true,
    });
    await queryInterface.addIndex('forge_sims', ['run_id', 'combo']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('forge_sims', ['run_id', 'combo']);
    await queryInterface.removeColumn('forge_sims', 'combo');
    await queryInterface.removeColumn('forge_runs', 'coach_guidance');
    await queryInterface.removeColumn('forge_runs', 'combos_json');
  },
};
