'use strict';

// Production runs RAG on EVERY user turn (RAGEnricher.enrich via on_user_turn_completed),
// not only on knowledge-base questions. So an eval must be able to replay every turn —
// and then the kind of turn is what makes a score readable: retrieving nothing for
// "Sorry, sorry, sorry." is correct behaviour, while retrieving chunks for it is context
// pollution the live agent would have been fed.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('rag_tests', 'kind', {
      type: Sequelize.TEXT, allowNull: true,   // kb_question | call_action | chit_chat
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('rag_tests', 'kind');
  },
};
