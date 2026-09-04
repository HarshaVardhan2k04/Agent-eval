import { create } from 'zustand'
import { api } from '../api/client'

// ---- types mirroring the consolidated forge_* schema ----------------------
export type ForgeMode = 'standalone' | 'layered'
export type Verdict = 'Y' | 'N' | '~'

export interface ForgeRunSummary {
  id: string
  name: string | null
  mode: ForgeMode
  status: string
  dataset_kind: 'real' | 'authored' | null
  vertical: string | null
  direction: string | null
  lead_status: string | null
  final_composite: number | null // 0..100
  solved_pct: number | null // % of snapshot denominator at Y
  current_version: number
  arena_id: string | null
  created_at: string
  completed_at: string | null
}

export interface ForgeVersionRow {
  id: number
  version: number
  tier: string | null
  status: 'baseline' | 'accepted' | 'reverted'
  config_json: unknown
  merged_markdown: string | null
  greeting: string | null
  composite: number | null
  statuses_json: Record<string, { verdict: Verdict; evidence?: string }> | null
  section_scores_json: Record<string, number | null> | null
  metrics_json: Record<string, number | null> | null
  tool_checks_json?: Record<string, { verdict: string; called: number; spoken_only: number; not_called: number; n: number }> | null
  edits_json: { op: string; path?: string; text?: string; find?: string; replace?: string }[] | null
  targeted_problem: string | null
  layer_for_fix: string | null
  verify_json: { holds?: boolean; strict_verdict?: string; refutations?: number; k?: number } | null
  diagnosis: string | null
  how_solved: string | null
  changes_summary: string | null
  created_at: string
}

export interface ForgeEscalation {
  id: number
  version: number | null
  problem_id: string | null
  question: string
  options: string[]
  rationale: string
  answer: string | null
  status: 'open' | 'answered'
  created_at: string
}

export interface ForgeLayerPin {
  layer_type: string
  source: string
  source_prompt_id: string | null
  editable: boolean
  config_snapshot: Record<string, unknown>
  override_keys: string[]
}

export interface ForgeRunDetail extends ForgeRunSummary {
  scoring_json: Record<string, number>
  dataset_json: Record<string, unknown>
  original_prompt_snapshot: { mode: string; blob?: unknown; layers?: Record<string, unknown> } | null
  denominator_snapshot_json: string[] | null
  probes_json: Record<string, unknown>[]
  versions: ForgeVersionRow[]
  escalations: ForgeEscalation[]
  review: Record<string, unknown>
  layers: ForgeLayerPin[]
  error_message: string | null
  // why each still-open problem is not solved — written when the run finishes
  unsolved_json: Record<string, UnsolvedReason> | null
}

export interface UnsolvedReason {
  verdict: string | null
  category: 'regression' | 'refuted' | 'retry_budget' | 'needs_you' | 'not_exercised'
    | 'unknown' | 'no_detector' | 'iteration_budget' | 'in_progress'
  why: string
  attempts: number
  evidence: string
}

export interface GlobalProblem {
  id: string
  behaviour: string
  btc_problem: string | null
  layer_for_fix: string | null
  category: string | null
  filter_territory: boolean // HUMAN-SET ONLY
  winning_lever: string | null
  how_solved: string | null
  applicability_json: Record<string, string[]>
  has_detector: boolean
  source: string | null
}

interface ForgeStore {
  runs: ForgeRunSummary[]
  currentRun: ForgeRunDetail | null
  problems: GlobalProblem[]
  fetchRuns: () => Promise<void>
  fetchRun: (id: string) => Promise<void>
  fetchProblems: () => Promise<void>
  stopRun: (id: string) => Promise<void>
  renameRun: (id: string, name: string) => Promise<void>
  deleteRun: (id: string) => Promise<void>
  answerEscalation: (id: string, escId: number, answer: string) => Promise<void>
  patchProblem: (pid: string, patch: Record<string, unknown>) => Promise<void>
}

export const useForgeStore = create<ForgeStore>((set, get) => ({
  runs: [],
  currentRun: null,
  problems: [],

  fetchRuns: async () => {
    const runs = await api.listForgeRuns()
    set({ runs })
  },

  fetchRun: async (id) => {
    const run = await api.getForgeRun(id)
    set({ currentRun: run })
  },

  fetchProblems: async () => {
    const problems = await api.listForgeProblems()
    set({ problems })
  },

  stopRun: async (id) => {
    await api.stopForgeRun(id)
    await get().fetchRun(id)
  },

  renameRun: async (id, name) => {
    set({ runs: get().runs.map((r) => (r.id === id ? { ...r, name } : r)) })
    try { await api.renameForgeRun(id, name) } catch { await get().fetchRuns() }
  },

  deleteRun: async (id) => {
    set({ runs: get().runs.filter((r) => r.id !== id) })
    try { await api.deleteForgeRun(id) } catch { await get().fetchRuns() }
  },

  answerEscalation: async (id, escId, answer) => {
    await api.answerForgeEscalation(id, escId, answer)
    await get().fetchRun(id)
  },

  patchProblem: async (pid, patch) => {
    set({ problems: get().problems.map((p) => (p.id === pid ? { ...p, ...patch } : p)) })
    try { await api.patchForgeProblem(pid, patch) } catch { await get().fetchProblems() }
  },
}))
