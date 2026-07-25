export interface EvalConfig {
  max_iterations: number
  quality_threshold: number
  rag?: {
    enabled: boolean
    server_url: string
    collection_name: string
    search_type?: string
    top_k?: number
    alpha?: number
    rerank?: boolean
  }
  tools_enabled: boolean
  enabled_tools?: string[]
  dynamic_context_enabled: boolean
  context_data?: Record<string, unknown>
  concurrent_scenarios?: number
  included_scenarios?: string[]
  excluded_scenarios?: string[]
}

export interface PromptVersion {
  version: number
  prompt: string
  score: number
  changes: string
  diff_from_previous?: string
}

export interface ScenarioResult {
  scenario_name: string
  scenario_type: string
  scores: Record<string, number>
  voice_analysis: Record<string, unknown>
  composite_score: number
  transcript: Array<{ role: string; content: string }>
  tool_calls: Array<Record<string, unknown>>
  judge_reasoning: string
}

export interface EvalEvent {
  event_type: string
  data: Record<string, unknown>
}
