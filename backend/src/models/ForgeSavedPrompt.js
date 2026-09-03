// A prompt worth keeping: saved once, linked to the problems it demonstrably solves.
// The link is what matters — a linked EXCERPT becomes a reference the coach imitates.
module.exports = (sequelize, DataTypes) => sequelize.define('ForgeSavedPrompt', {
  id: { type: DataTypes.TEXT, primaryKey: true },
  name: { type: DataTypes.TEXT, allowNull: false },
  kind: { type: DataTypes.TEXT, defaultValue: 'blob' },   // blob | layer | fragment
  body_json: { type: DataTypes.JSONB },
  body_text: { type: DataTypes.TEXT },
  vertical: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },
  problem_ids: { type: DataTypes.JSONB, defaultValue: [] },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'forge_saved_prompts', timestamps: false });
