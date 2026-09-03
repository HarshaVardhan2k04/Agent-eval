// forge_problems — the GLOBAL problem catalog (definitions only). Per-run status
// lives in forge_run_problem_status. filter_territory is HUMAN-SET ONLY.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeProblem',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      behaviour: { type: DataTypes.TEXT, allowNull: false },
      btc_problem: { type: DataTypes.TEXT, allowNull: true },
      layer_for_fix: { type: DataTypes.TEXT, allowNull: true }, // universal | vertical | campaign
      category: { type: DataTypes.TEXT, allowNull: true },
      filter_territory: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      winning_lever: { type: DataTypes.TEXT, allowNull: true },
      how_solved: { type: DataTypes.TEXT, allowNull: true },
      // { verticals:[], modes:[], languages:[], directions:[] } — empty = applies everywhere
      applicability_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // worked examples fed to the coach — see forge_saved_prompts linking
      references_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      has_detector: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      source: { type: DataTypes.TEXT, allowNull: true }, // matrix_csv | catalog | discovered
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'forge_problems',
      timestamps: false,
      indexes: [{ fields: ['layer_for_fix'] }],
    }
  );
