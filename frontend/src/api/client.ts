const BASE_URL = import.meta.env.VITE_API_URL || ''

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    cache: 'no-store', // always fetch fresh — never serve a stale/failed cached response
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  createEval(name: string, systemPrompt: string, scenarios: unknown, config: Record<string, unknown>) {
    return request('/api/evals', {
      method: 'POST',
      body: JSON.stringify({ name, system_prompt: systemPrompt, scenarios, config }),
    })
  },

  listEvals() {
    return request('/api/evals')
  },

  getEval(id: string) {
    return request(`/api/evals/${id}`)
  },

  getResults(id: string, iteration?: number) {
    const q = iteration !== undefined ? `?iteration=${iteration}` : ''
    return request(`/api/evals/${id}/results${q}`)
  },

  getEventLog(id: string, after: number) {
    return request(`/api/evals/${id}/log?after=${after}`)
  },

  stopEval(id: string) {
    return request(`/api/evals/${id}/stop`, { method: 'POST' })
  },

  deleteEval(id: string) {
    return request(`/api/evals/${id}`, { method: 'DELETE' })
  },

  getPromptVersions(id: string) {
    return request(`/api/evals/${id}/prompts`)
  },

  getPromptDiff(id: string, version: number) {
    return request(`/api/evals/${id}/prompts/${version}/diff`)
  },

  rerunFromVersion(id: string, version: number) {
    return request(`/api/evals/${id}/rerun`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    })
  },

  // --- Test STT ---
  sttProviders() {
    return request('/api/stt/providers')
  },
  // Verticals (production call sources) available for "Import from calls".
  sttVerticals() {
    return request('/api/stt/verticals')
  },
  createSttBatch(body: { name?: string; language: string; provider?: string; mode?: 'single' | 'batch' | 'import' | 'noise'; vertical?: string }) {
    return request('/api/stt/batches', { method: 'POST', body: JSON.stringify(body) })
  },
  listSttBatches() {
    return request('/api/stt/batches')
  },
  getSttBatch(id: string) {
    return request(`/api/stt/batches/${id}`)
  },
  deleteSttBatch(id: string) {
    return request(`/api/stt/batches/${id}`, { method: 'DELETE' })
  },
  // Multipart — must NOT set a JSON content-type (browser sets the boundary).
  async addSttResult(batchId: string, form: FormData) {
    const res = await fetch(`${BASE_URL}/api/stt/batches/${batchId}/results`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },
  // Batch upload — many audio files in one FormData (each appended as `audio`),
  // plus an optional `references` field = JSON { filename: refText }. Multipart,
  // so no JSON content-type. Returns { queued } immediately; poll getSttBatch.
  async addSttUploads(batchId: string, form: FormData) {
    const res = await fetch(`${BASE_URL}/api/stt/batches/${batchId}/uploads`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },
  // Import from calls — fetch recordings/transcripts for a vertical's call IDs,
  // re-transcribe + score. Returns { queued } immediately; poll getSttBatch.
  importSttCalls(batchId: string, body: { vertical: string; call_ids: string[] }) {
    return request(`/api/stt/batches/${batchId}/import`, { method: 'POST', body: JSON.stringify(body) })
  },
  // Signed URL for a result's source audio ({ url } — null for uploads).
  sttResultAudioUrl(resultId: number | string) {
    return request(`/api/stt/results/${resultId}/audio-url`)
  },
  // Add-noise mode: available noise presets + intensity levels.
  sttNoises(): Promise<{ noises: { key: string; label: string; filename: string }[]; levels: string[] }> {
    return request('/api/stt/noises')
  },
  // Add-noise mode — one `recording` file + zero+ custom `noise` files, plus
  // text fields `reference`, `level`, `noise_presets` (JSON array of keys).
  // Multipart, so no JSON content-type. Returns { queued }; poll getSttBatch.
  async runNoiseTest(batchId: string, form: FormData) {
    const res = await fetch(`${BASE_URL}/api/stt/batches/${batchId}/noise-test`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },
  // Direct URL to a noise row's merged (noisy) WAV, for use as an <audio src>.
  // 404s for the clean baseline row (which has no mixed audio).
  sttResultMixedAudioUrl(resultId: number | string): string {
    return `${BASE_URL}/api/stt/results/${resultId}/mixed-audio`
  },

  // --- Call Analysis ---
  createCallBatch(body: { name?: string; direction?: string; flow_id?: string; editable_config?: unknown; tools?: string[] }) {
    return request('/api/analysis/batches', { method: 'POST', body: JSON.stringify(body) })
  },
  addCalls(batchId: string, calls: unknown[]) {
    return request(`/api/analysis/batches/${batchId}/calls`, { method: 'POST', body: JSON.stringify({ calls }) })
  },
  // Multipart — upload call recordings (audio); the backend transcribes + scores them.
  async addRecordings(batchId: string, form: FormData) {
    const res = await fetch(`${BASE_URL}/api/analysis/batches/${batchId}/recordings`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },
  // Import from calls — verticals (with db/gcs config flags) + fetch-and-score by call ID.
  analysisVerticals(): Promise<{ key: string; label: string; dbConfigured: boolean; gcsConfigured: boolean }[]> {
    return request('/api/analysis/verticals')
  },
  importAnalysisCalls(batchId: string, body: { vertical: string; call_ids: string[] }) {
    return request(`/api/analysis/batches/${batchId}/import`, { method: 'POST', body: JSON.stringify(body) })
  },
  // Signed URL to play an imported call's recording (null for uploads/pastes).
  callAudioUrl(callId: number | string) {
    return request(`/api/analysis/calls/${callId}/audio-url`)
  },
  listCallBatches() {
    return request('/api/analysis/batches')
  },
  getCallBatch(id: string) {
    return request(`/api/analysis/batches/${id}`)
  },
  getCall(callId: number | string) {
    return request(`/api/analysis/calls/${callId}`)
  },
  renameCallBatch(id: string, name: string) {
    return request(`/api/analysis/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  },
  deleteCallBatch(id: string) {
    return request(`/api/analysis/batches/${id}`, { method: 'DELETE' })
  },

  // --- Flow Builder ---
  generateFlow(body: { text: string; notes?: string; direction?: string }) {
    return request('/api/flow/generate', { method: 'POST', body: JSON.stringify(body) })
  },
  editFlow(graph: unknown, instruction: string) {
    return request('/api/flow/edit', { method: 'POST', body: JSON.stringify({ graph, instruction }) })
  },
  saveFlow(body: { name: string; direction?: string; definition: unknown }) {
    return request('/api/flow/flows', { method: 'POST', body: JSON.stringify(body) })
  },
  listFlows() {
    return request('/api/flow/flows')
  },
  getFlow(id: string) {
    return request(`/api/flow/flows/${id}`)
  },
  updateFlow(id: string, body: { name?: string; direction?: string; definition?: unknown }) {
    return request(`/api/flow/flows/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  },
  deleteFlow(id: string) {
    return request(`/api/flow/flows/${id}`, { method: 'DELETE' })
  },

  // --- Settings / Test-an-LLM ---
  getSettings() {
    return request('/api/settings')
  },
  setSetting(key: string, value: unknown) {
    return request(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) })
  },
  llmInfo() {
    return request('/api/settings/llm/info')
  },
  llmTest(body: { prompt: string; system?: string; base_url?: string; model?: string; enable_thinking?: boolean; max_tokens?: number }) {
    return request('/api/settings/llm/test', { method: 'POST', body: JSON.stringify(body) })
  },

  // --- RAG Testing ---
  ragDefaultUrl() {
    return request('/api/rag/default-url')
  },
  ragCollections(url: string) {
    return request(`/api/rag/collections?url=${encodeURIComponent(url)}`)
  },
  ragEvaluate(body: Record<string, unknown>) {
    return request('/api/rag/evaluate', { method: 'POST', body: JSON.stringify(body) })
  },
  listRagTests() {
    return request('/api/rag/tests')
  },
  getRagTest(id: string) {
    return request(`/api/rag/tests/${id}`)
  },
  deleteRagTest(id: string) {
    return request(`/api/rag/tests/${id}`, { method: 'DELETE' })
  },

  // --- Forge (promptforge optimizer) ---
  createForgeRun(body: Record<string, unknown>) {
    return request('/api/forge/runs', { method: 'POST', body: JSON.stringify(body) })
  },
  listForgeRuns() {
    return request('/api/forge/runs')
  },
  getForgeRun(id: string) {
    return request(`/api/forge/runs/${id}`)
  },
  renameForgeRun(id: string, name: string) {
    return request(`/api/forge/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  },
  deleteForgeRun(id: string) {
    return request(`/api/forge/runs/${id}`, { method: 'DELETE' })
  },
  stopForgeRun(id: string) {
    return request(`/api/forge/runs/${id}/stop`, { method: 'POST' })
  },
  // forge_events cursor feed — the progress page's live source (id > after).
  getForgeLog(id: string, after: number) {
    return request(`/api/forge/runs/${id}/log?after=${after}`)
  },
  // Per-run problem×version grid: [{version, status, statuses_json}]
  getForgeMatrix(id: string) {
    return request(`/api/forge/runs/${id}/matrix`)
  },
  answerForgeEscalation(id: string, escId: number | string, answer: string) {
    return request(`/api/forge/runs/${id}/escalations/${escId}/answer`, { method: 'POST', body: JSON.stringify({ answer }) })
  },
  getForgeReview(id: string) {
    return request(`/api/forge/runs/${id}/review`)
  },
  saveForgeReview(id: string, patch: Record<string, unknown>) {
    return request(`/api/forge/runs/${id}/review`, { method: 'POST', body: JSON.stringify(patch) })
  },
  forgeChat(id: string, body: Record<string, unknown>) {
    return request(`/api/forge/runs/${id}/chat`, { method: 'POST', body: JSON.stringify(body) })
  },
  forgeEvaluate(id: string) {
    return request(`/api/forge/runs/${id}/evaluate`, { method: 'POST' })
  },
  exportForgeRun(id: string) {
    return request(`/api/forge/runs/${id}/export`, { method: 'POST', body: JSON.stringify({}) })
  },
  // Global problem catalog (definitions; filter_territory is human-only)
  listForgeProblems() {
    return request('/api/forge/problems')
  },
  createForgeProblem(body: Record<string, unknown>) {
    return request('/api/forge/problems', { method: 'POST', body: JSON.stringify(body) })
  },
  patchForgeProblem(id: string, patch: Record<string, unknown>) {
    return request(`/api/forge/problems/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  },
  // Layer library — READ-ONLY list from agent_db_dev.prompts (same Postgres)
  listForgeLayers(type: string): Promise<{ configured: boolean; db_name: string; rows: { id: string; prompt_type: string; friendly_name: string }[]; error?: string }> {
    return request(`/api/forge/layers?type=${encodeURIComponent(type)}`)
  },
  getForgeLayer(id: string) {
    return request(`/api/forge/layers/${id}`)
  },
  // LLM Arena — compare N hosted LLMs (own prompt each) on one dataset, judge fixed.
  createForgeArena(body: Record<string, unknown>) {
    return request('/api/forge/arenas', { method: 'POST', body: JSON.stringify(body) })
  },
  testArenaLlm(body: { base_url: string; api_key?: string; model: string; params?: Record<string, unknown> }): Promise<{ ok: boolean; reply?: string; error?: string; ms?: number }> {
    return request('/api/forge/arenas/test-llm', { method: 'POST', body: JSON.stringify(body) })
  },
  // Simulation archive (run-then-grade proof)
  listForgeSims(runId: string, filters?: Record<string, string | number>) {
    const q = filters ? '?' + new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString() : ''
    return request(`/api/forge/runs/${runId}/sims${q}`)
  },
  getForgeSim(uid: string) {
    return request(`/api/forge/sims/${uid}`)
  },
  listForgeArenas() {
    return request('/api/forge/arenas')
  },
  getForgeArena(id: string) {
    return request(`/api/forge/arenas/${id}`)
  },
  deleteForgeArena(id: string) {
    return request(`/api/forge/arenas/${id}`, { method: 'DELETE' })
  },
  // Dataset library — every dataset ever given is stored; Setup offers select-or-paste.
  listForgeDatasets(): Promise<{ id: string; name: string; kind: string; n: number; created_at: string }[]> {
    return request('/api/forge/datasets')
  },
  getForgeDataset(id: string) {
    return request(`/api/forge/datasets/${id}`)
  },
  // Production-faithful merged preview (markdown + greeting + sliced stage)
  forgeMergePreview(body: Record<string, unknown>) {
    return request('/api/forge/merge-preview', { method: 'POST', body: JSON.stringify(body) })
  },

  subscribeToEvents(id: string, onEvent: (event: Record<string, unknown>) => void) {
    const source = new EventSource(`${BASE_URL}/api/evals/${id}/events`)
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data))
      } catch {
        // ignore parse errors
      }
    }
    return source
  },
}
