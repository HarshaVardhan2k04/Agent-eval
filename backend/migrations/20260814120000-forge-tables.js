'use strict';

// Forge (PromptForge) module — the promptforge-style prompt optimizer that replaces
// the old Prompt-Eval loop. Split-schema per design Revision 2: GLOBAL problem
// definitions (forge_problems) are kept separate from PER-RUN status
// (forge_run_problem_status). Non-destructive: IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS so it is a no-op on an existing DB and fully creates on a fresh one.
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    // ---- runs -----------------------------------------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_runs (
        id TEXT PRIMARY KEY,
        name TEXT,
        mode TEXT NOT NULL DEFAULT 'standalone',        -- standalone | layered
        status TEXT NOT NULL DEFAULT 'collecting',      -- collecting|optimizing|awaiting_human|
                                                        -- llm_complete|human_review|finalized|
                                                        -- stopped|failed|converged_below_gate
        dataset_kind TEXT,                              -- real | authored
        dataset_json JSONB NOT NULL DEFAULT '{}',
        scoring_json JSONB NOT NULL DEFAULT '{}',       -- best_of_n, thresholds, gate_pct, critical sets
        vertical TEXT,                                  -- domain, for problem applicability filtering
        language TEXT,
        direction TEXT DEFAULT 'outbound',
        lead_status TEXT,                               -- layered conversational_flow slice
        original_prompt_snapshot JSONB,                 -- what the user gave at start (blob or layer stack)
        denominator_snapshot_json JSONB,                -- applicable problem_ids snapshotted at run start
        final_composite REAL,
        current_version INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    // ---- GLOBAL problem catalog (definitions only) ----------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_problems (
        id TEXT PRIMARY KEY,                            -- stable problem_id
        behaviour TEXT NOT NULL,
        btc_problem TEXT,                               -- catalog mapping (dedup key)
        layer_for_fix TEXT,                             -- universal | vertical | campaign (nullable)
        category TEXT,
        filter_territory BOOLEAN NOT NULL DEFAULT FALSE,-- HUMAN-SET ONLY (coach must never self-tag)
        winning_lever TEXT,
        how_solved TEXT,
        applicability_json JSONB NOT NULL DEFAULT '{}', -- {verticals:[],modes:[],languages:[],directions:[]}
        has_detector BOOLEAN NOT NULL DEFAULT FALSE,    -- excluded from auto-gate denominator when false
        source TEXT,                                    -- matrix_csv | catalog | discovered
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- PER-RUN problem status (verdict grid) --------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_run_problem_status (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        problem_id TEXT NOT NULL REFERENCES forge_problems(id) ON DELETE CASCADE,
        verdict TEXT NOT NULL,                          -- Y | N | ~
        in_denominator BOOLEAN NOT NULL DEFAULT TRUE,
        detail_json JSONB,                              -- best-of-3 raw per-run verdicts
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(run_id, version, problem_id)
      )
    `);

    // ---- local layer library (versions of universal/vertical/campaign/addon) ----
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_prompts (
        id TEXT PRIMARY KEY,
        prompt_type TEXT NOT NULL,                      -- universal | vertical | campaign | addon
        prompt JSONB NOT NULL,
        override_keys JSONB NOT NULL DEFAULT '[]',
        friendly_name TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        source TEXT,                                    -- agent_db_import | pasted | promoted
        source_ref TEXT,                                -- original agent_db prompt id when imported
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- run -> pinned layers -------------------------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_run_layers (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        layer_type TEXT NOT NULL,                       -- universal | vertical | campaign | addon
        source TEXT NOT NULL,                           -- agent_db | local | pasted
        source_prompt_id TEXT,                          -- agent_db id or forge_prompts id
        pinned_version INTEGER,
        config_snapshot JSONB NOT NULL,                 -- the layer JSON snapshotted at run start
        override_keys JSONB NOT NULL DEFAULT '[]',
        editable BOOLEAN NOT NULL DEFAULT FALSE,        -- campaign true; universal/vertical fixed
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- versions (every variation, accepted AND reverted) --------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_versions (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        tier TEXT,                                      -- baseline | candidate | accepted | milestone
        status TEXT NOT NULL,                           -- baseline | accepted | reverted
        config_json JSONB,                              -- standalone blob OR {layer_type: overlay} for layered
        merged_markdown TEXT,                           -- prompt-under-test (layered render)
        greeting TEXT,
        flow_stage TEXT,
        composite REAL,                                 -- accepted only
        section_scores_json JSONB,                      -- accepted only
        metrics_json JSONB,                             -- deepeval, accepted/final only
        edits_json JSONB,
        targeted_problem TEXT,
        layer_for_fix TEXT,
        verify_json JSONB,                              -- adversarial verify result
        diagnosis TEXT,
        how_solved TEXT,
        changes_summary TEXT,
        diff_from_previous TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(run_id, version)
      )
    `);

    // ---- probes / dataset ------------------------------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_probes (
        id SERIAL PRIMARY KEY,
        run_id TEXT REFERENCES forge_runs(id) ON DELETE CASCADE,
        source TEXT NOT NULL,                           -- real | authored
        vertical TEXT,
        probe_json JSONB NOT NULL,                      -- {id,persona,category,moods?} or {utterance/turns}
        tags JSONB NOT NULL DEFAULT '[]',
        critical BOOLEAN NOT NULL DEFAULT FALSE,
        pii_scrubbed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- scenario results (per version x probe) -------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_scenario_results (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        probe_id INTEGER REFERENCES forge_probes(id) ON DELETE SET NULL,
        kind TEXT,                                      -- detector | stress | deepeval
        problem_id TEXT,                                -- when kind = detector
        transcripts_json JSONB,                         -- best-of-N transcripts
        per_run_composites JSONB,
        composite REAL,
        section_scores_json JSONB,
        detector_verdict TEXT,                          -- Y | N | ~
        areas_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- append-only event/progress log ---------------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_events (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        event_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- coach->human layer-routing escalations -------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_escalations (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        version INTEGER,
        problem_id TEXT,
        question TEXT NOT NULL,
        options_json JSONB,
        coach_rationale TEXT,
        answer TEXT,
        status TEXT NOT NULL DEFAULT 'open',            -- open | answered
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        answered_at TIMESTAMPTZ
      )
    `);

    // ---- Phase-2 human review -------------------------------------------
    await sql.query(`
      CREATE TABLE IF NOT EXISTS forge_human_reviews (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
        reviewer_notes TEXT,
        resolved_json JSONB NOT NULL DEFAULT '{}',      -- problem_id -> bool
        edited_prompt_json JSONB,
        chat_log_json JSONB NOT NULL DEFAULT '[]',
        export_json JSONB,
        finalized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- indexes ---------------------------------------------------------
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_runs_status ON forge_runs(status)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_runs_created ON forge_runs(created_at)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_problems_layer ON forge_problems(layer_for_fix)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_rps_run ON forge_run_problem_status(run_id, version)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_prompts_type ON forge_prompts(prompt_type)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_run_layers_run ON forge_run_layers(run_id)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_versions_run ON forge_versions(run_id)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_probes_run ON forge_probes(run_id)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_sr_run ON forge_scenario_results(run_id, version)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_events_run ON forge_events(run_id)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_escalations_run ON forge_escalations(run_id, status)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_forge_reviews_run ON forge_human_reviews(run_id)`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    for (const t of [
      'forge_human_reviews', 'forge_escalations', 'forge_events', 'forge_scenario_results',
      'forge_probes', 'forge_versions', 'forge_run_layers', 'forge_prompts',
      'forge_run_problem_status', 'forge_problems', 'forge_runs',
    ]) {
      await sql.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  },
};
