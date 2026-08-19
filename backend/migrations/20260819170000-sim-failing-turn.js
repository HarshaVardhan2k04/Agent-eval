'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('forge_sims', 'failing_turn',
      { type: Sequelize.INTEGER, allowNull: true }); // transcript row index the check tripped on
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('forge_sims', 'failing_turn');
  },
};
