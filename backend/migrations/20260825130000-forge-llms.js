'use strict';
// forge_llms — saved LLM endpoints (name, url, model, key, params) so custom
// agents/contestants are picked from a library instead of retyped every time.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('forge_llms', {
      id: { type: Sequelize.TEXT, primaryKey: true },
      name: { type: Sequelize.TEXT, allowNull: false },
      base_url: { type: Sequelize.TEXT, allowNull: false },
      model: { type: Sequelize.TEXT, allowNull: false },
      api_key: { type: Sequelize.TEXT, allowNull: true },
      params_json: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('forge_llms'); },
};
