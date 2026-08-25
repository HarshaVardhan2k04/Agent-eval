// forge_runs — one PromptForge optimization run (standalone or layered).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeRun',
    {
      id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      mode: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'standalone' }, // standalone | layered
      // collecting|optimizing|awaiting_human|llm_complete|human_review|finalized|stopped|failed|converged_below_gate
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'collecting' },
      dataset_kind: { type: DataTypes.TEXT, allowNull: true }, // real | authored
      dataset_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      tools_json: { type: DataTypes.JSONB, allowNull: true }, // {enabled:[], source}
      scoring_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      vertical: { type: DataTypes.TEXT, allowNull: true },
      language: { type: DataTypes.TEXT, allowNull: true },
      direction: { type: DataTypes.TEXT, allowNull: true, defaultValue: 'outbound' },
      lead_status: { type: DataTypes.TEXT, allowNull: true },
      original_prompt_snapshot: { type: DataTypes.JSONB, allowNull: true },
      denominator_snapshot_json: { type: DataTypes.JSONB, allowNull: true },
      // Consolidated sub-entities (house style: JSONB on the parent, not extra tables):
      layers_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },      // pinned layer snapshots
      probes_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },      // dataset personas/probes
      escalations_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // coach->human questions
      review_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },      // Phase-2 human review state
      // {stages, combos, allocation, blocked, resolutions, results} — the direction x
      // lead_status cross-product this run covers, and the human's rulings on gaps.
      combos_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // operator's live instructions to the coach, per run, editable mid-run
      coach_guidance: { type: DataTypes.TEXT, allowNull: true },
      final_composite: { type: DataTypes.REAL, allowNull: true },
      solved_pct: { type: DataTypes.REAL, allowNull: true },
      current_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      arena_id: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'forge_runs',
      timestamps: false,
      indexes: [{ fields: ['status'] }, { fields: ['created_at'] }],
    }
  );
