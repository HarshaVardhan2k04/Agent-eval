// forge_versions — every prompt variation (accepted AND reverted; never lose one).
// composite/section_scores/metrics are populated only for accepted versions (tiered eval).
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ForgeVersion',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      run_id: { type: DataTypes.TEXT, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false },
      tier: { type: DataTypes.TEXT, allowNull: true }, // baseline | candidate | accepted | milestone
      status: { type: DataTypes.TEXT, allowNull: false }, // baseline | accepted | reverted
      // standalone blob OR { layer_type: overlay_config } for layered edits
      config_json: { type: DataTypes.JSONB, allowNull: true },
      merged_markdown: { type: DataTypes.TEXT, allowNull: true },
      greeting: { type: DataTypes.TEXT, allowNull: true },
      flow_stage: { type: DataTypes.TEXT, allowNull: true },
      composite: { type: DataTypes.REAL, allowNull: true },
      // Per-version problem verdict grid {problem_id: {verdict: 'Y'|'N'|'~', evidence}} —
      // replaces the old forge_run_problem_status table (one JSONB write per version).
      statuses_json: { type: DataTypes.JSONB, allowNull: true },
      section_scores_json: { type: DataTypes.JSONB, allowNull: true },
      metrics_json: { type: DataTypes.JSONB, allowNull: true },
      tool_checks_json: { type: DataTypes.JSONB, allowNull: true }, // {tool:{verdict,...}}
      latency_json: { type: DataTypes.JSONB, allowNull: true }, // {avg_ms,p50_ms,p99_ms,n_turns,detail}
      edits_json: { type: DataTypes.JSONB, allowNull: true },
      targeted_problem: { type: DataTypes.TEXT, allowNull: true },
      layer_for_fix: { type: DataTypes.TEXT, allowNull: true },
      verify_json: { type: DataTypes.JSONB, allowNull: true },
      diagnosis: { type: DataTypes.TEXT, allowNull: true },
      how_solved: { type: DataTypes.TEXT, allowNull: true },
      changes_summary: { type: DataTypes.TEXT, allowNull: true },
      diff_from_previous: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'forge_versions',
      timestamps: false,
      indexes: [{ fields: ['run_id'] }, { unique: true, fields: ['run_id', 'version'] }],
    }
  );
