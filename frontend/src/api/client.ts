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
