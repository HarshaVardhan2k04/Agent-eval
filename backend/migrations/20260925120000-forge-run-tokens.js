'use strict';

// What a run actually spent, split by role: {judge:{calls,prompt_tokens,
// completion_tokens,total_tokens}, agent:{...}, judge_model, agent_model}.
// Needed to price a hosted verification — the judge half is the cost we carry on the
// public API, since the caller supplies only the prompt.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('forge_runs', 'tokens_json', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {}, // {} = a run that finished before accounting existed
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('forge_runs', 'tokens_json');
  },
};
