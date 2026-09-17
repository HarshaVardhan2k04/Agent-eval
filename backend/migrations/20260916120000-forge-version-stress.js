'use strict';

// The engine measures five habits in code across every agent turn of the stress
// battery (yapping, bot-words, spoken digits, formatting characters, repeat loops)
// and folds them into problem verdicts — then dropped the raw percentages on the
// floor. A verification report is exactly where those numbers ARE the finding:
// "p15 present at scale" is far less actionable than "sqft spoken in 34% of turns".
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('forge_versions', 'stress_json', {
      type: Sequelize.JSONB,
      allowNull: true, // null = the stress battery did not run for this version
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('forge_versions', 'stress_json');
  },
};
