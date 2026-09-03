'use strict';

// forge_arenas had no updated_at, so "how long has this arena been untouched?"
// was unanswerable — the stale-arena reaper could only see created_at and would
// have settled a freshly re-evaluated arena as if it were abandoned.
module.exports = {
  async up(queryInterface, Sequelize) {
    // add nullable, backfill from real history, THEN constrain — adding it
    // NOT NULL up front leaves existing rows null and the migration fails.
    await queryInterface.addColumn('forge_arenas', 'updated_at', {
      type: Sequelize.DATE, allowNull: true,
    });
    await queryInterface.sequelize.query(
      'UPDATE forge_arenas SET updated_at = COALESCE(completed_at, created_at, now())');
    await queryInterface.changeColumn('forge_arenas', 'updated_at', {
      type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('forge_arenas', 'updated_at');
  },
};
