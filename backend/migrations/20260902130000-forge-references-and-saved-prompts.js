'use strict';
// Worked examples for the coach.
//
// Today the coach gets a one-line `winning_lever` — advice. A reference is a
// passage that already WORKED, which a model imitates far more reliably than it
// follows an abstract rule. references_json is an ARRAY so a problem can carry a
// contrastive pair (this wording fixed it / this wording caused it) and so a stale
// reference can be retired without losing the rest.
//
// forge_saved_prompts is the library those references are usually cut from: save a
// prompt once, link it to the problems it solves, and the linked EXCERPT (not the
// whole 58k-char prompt) becomes a reference the coach can actually use.
module.exports = {
  async up(q, S) {
    await q.addColumn('forge_problems', 'references_json', {
      type: S.JSONB, allowNull: false, defaultValue: [],
    });
    await q.createTable('forge_saved_prompts', {
      id: { type: S.TEXT, primaryKey: true },
      name: { type: S.TEXT, allowNull: false },
      kind: { type: S.TEXT, allowNull: false, defaultValue: 'blob' }, // blob | layer | fragment
      body_json: { type: S.JSONB, allowNull: true },   // structured layers, when kind = layer
      body_text: { type: S.TEXT, allowNull: true },    // the prompt itself, when kind = blob/fragment
      vertical: { type: S.TEXT, allowNull: true },
      notes: { type: S.TEXT, allowNull: true },
      problem_ids: { type: S.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: S.DATE, defaultValue: S.NOW },
      updated_at: { type: S.DATE, defaultValue: S.NOW },
    });
    await q.addIndex('forge_saved_prompts', ['created_at'], { name: 'idx_forge_saved_prompts_created' });
  },
  async down(q) {
    await q.dropTable('forge_saved_prompts');
    await q.removeColumn('forge_problems', 'references_json');
  },
};
