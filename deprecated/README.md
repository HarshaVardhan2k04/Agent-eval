# Deprecated: old Prompt Eval system

Fully replaced by **Forge** (runs, problem matrix, LLM arena). Removed 2026-09-01.

- `frontend/` — the 6 old pages (EvalList/Setup/Progress/ResultsDashboard/PromptHistory/VoiceReport) + `evalStore`
- `backend/` — evals/progress/prompts controllers + routes, engineClient, promptStore, the 4 Sequelize models
- `engine/` — `eval_runner.py` (champion/challenger loop), `judge.py`, `resolver.py`, `voice_analyzer.py`, `scoring/`, old `/api/eval/*` router
- `old-eval-tables-backup.sql.gz` — pg_dump of `evals`, `prompt_versions`, `scenario_results`, `eval_events`
  (11 evals / 2,205 scenario results) taken right before the drop migration
  `20260901120000-drop-old-eval-tables.js`. Restore with:
  `gunzip -c old-eval-tables-backup.sql.gz | psql -h localhost -p 6666 -U postgres -d agent_eval`

Nothing in here is imported by live code — it exists for reference only.
