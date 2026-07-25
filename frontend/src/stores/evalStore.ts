import { create } from 'zustand'
import { api } from '../api/client'

interface LiveProgress {
  iteration: number
  totalIterations: number
  scenarioIndex: number
  totalScenarios: number
  currentScore: number
  scores: number[]
}

interface EvalSummary {
  id: string
  name: string | null
  status: string
  final_score: number | null
  iterations_run: number
  max_iterations: number
  quality_threshold: number
  created_at: string
  completed_at: string | null
}

interface ScenarioResult {
  scenario_name: string
  scenario_type: string
  composite_score: number
  scores_json: Record<string, unknown>
  voice_analysis_json: Record<string, unknown>
  transcript_json: Array<{ role: string; content: string }>
  tool_calls_json: Array<Record<string, unknown>>
  judge_reasoning: string
  iteration: number
}

interface PromptVersion {
  version: number
  prompt_text: string
  score: number | null
  changes_summary: string
  diff_from_previous: string | null
  edits_json: Array<Record<string, unknown>> | null
}

interface EvalStore {
  evalList: EvalSummary[]
  currentEval: Record<string, unknown> | null
  scenarioResults: ScenarioResult[]
  promptVersions: PromptVersion[]
  liveProgress: LiveProgress | null
  eventSource: EventSource | null

  fetchEvalList: () => Promise<void>
  fetchEval: (id: string) => Promise<void>
  fetchResults: (id: string, iteration?: number) => Promise<void>
  fetchPromptVersions: (id: string) => Promise<void>
  createEval: (name: string, prompt: string, scenarios: unknown, config: Record<string, unknown>) => Promise<string>
  stopEval: (id: string) => Promise<void>
  connectToProgress: (id: string) => void
  disconnectProgress: () => void
}

export const useEvalStore = create<EvalStore>((set, get) => ({
  evalList: [],
  currentEval: null,
  scenarioResults: [],
  promptVersions: [],
  liveProgress: null,
  eventSource: null,

  fetchEvalList: async () => {
    const list = await api.listEvals()
    set({ evalList: list })
  },

  fetchEval: async (id) => {
    try {
      const data = await api.getEval(id)
      set({ currentEval: data })
    } catch (err) {
      console.error('[agent-eval] fetchEval failed for', id, err)
    }
  },

  fetchResults: async (id, iteration?) => {
    try {
      const data = await api.getResults(id, iteration)
      set({ scenarioResults: Array.isArray(data) ? data : [] })
    } catch (err) {
      console.error('[agent-eval] fetchResults failed for', id, err)
    }
  },

  fetchPromptVersions: async (id) => {
    try {
      const data = await api.getPromptVersions(id)
      set({ promptVersions: Array.isArray(data) ? data : [] })
    } catch (err) {
      console.error('[agent-eval] fetchPromptVersions failed for', id, err)
    }
  },

  createEval: async (name, prompt, scenarios, config) => {
    const result = await api.createEval(name, prompt, scenarios, config)
    return result.eval_id
  },

  stopEval: async (id) => {
    await api.stopEval(id)
    get().disconnectProgress()
  },

  connectToProgress: (id) => {
    get().disconnectProgress()

    const source = api.subscribeToEvents(id, (event) => {
      const type = event.event_type as string
      const data = event.data as Record<string, unknown>

      if (type === 'iteration_start') {
        set((state) => ({
          liveProgress: {
            ...(state.liveProgress || { scenarioIndex: 0, totalScenarios: 0, currentScore: 0, scores: [] }),
            iteration: data.iteration as number,
            totalIterations: data.total_iterations as number,
          },
        }))
      }

      if (type === 'scenario_complete') {
        set((state) => ({
          liveProgress: {
            ...(state.liveProgress || { iteration: 0, totalIterations: 0, currentScore: 0, scores: [] }),
            scenarioIndex: data.scenario_index as number,
            totalScenarios: data.total_scenarios as number,
          },
        }))
      }

      if (type === 'iteration_complete') {
        const score = data.score as number
        set((state) => ({
          liveProgress: {
            ...(state.liveProgress || { iteration: 0, totalIterations: 0, scenarioIndex: 0, totalScenarios: 0 }),
            currentScore: score,
            scores: [...(state.liveProgress?.scores || []), score],
          },
        }))
      }

      if (type === 'eval_complete') {
        get().disconnectProgress()
        get().fetchEval(id)
        get().fetchResults(id)
        get().fetchPromptVersions(id)
      }
    })

    set({ eventSource: source, liveProgress: { iteration: 0, totalIterations: 0, scenarioIndex: 0, totalScenarios: 0, currentScore: 0, scores: [] } })
  },

  disconnectProgress: () => {
    const { eventSource } = get()
    if (eventSource) {
      eventSource.close()
      set({ eventSource: null })
    }
  },
}))
