import { useEffect, useState } from 'react'
import { T, card, btnPrimary, label } from '../theme'
import { api } from '../api/client'

// Judge model · Test-an-LLM — preview the model that scores calls/evals (Gemma
// today), with a thinking toggle so you can compare no-think vs thinking output.
export function LlmPage() {
  const [info, setInfo] = useState<{ base_url: string; model: string } | null>(null)
  const [offline, setOffline] = useState(false)
  const [system, setSystem] = useState('')
  const [prompt, setPrompt] = useState('')
  const [thinking, setThinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ response: string; latency_ms: number; model: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.llmInfo().then((i) => { setInfo(i); setOffline(false) }).catch(() => setOffline(true))
  }, [])

  const run = async () => {
    if (!prompt.trim()) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await api.llmTest({ prompt, system: system || undefined, enable_thinking: thinking, max_tokens: thinking ? 2000 : 512 })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LLM test failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Judge model</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>
        The model that scores your calls and evals. Agent &amp; user run on the production model; judge &amp; coach can differ. Test it here.
      </p>

      {/* Connection status */}
      <div style={{ ...card, padding: 18, marginTop: 20, borderLeft: `3px solid ${offline ? T.red : T.green}` }}>
        {offline ? (
          <div style={{ color: T.red, fontSize: 14, fontWeight: 600 }}>Not connected — scoring paused. Start the engine.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.green, fontSize: 14, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: T.green }} />Connected
            </span>
            <span style={{ fontSize: 13, color: T.muted, fontFamily: T.mono }}>{info?.model}</span>
            <span style={{ fontSize: 12.5, color: T.faint, fontFamily: T.mono }}>{info?.base_url}</span>
          </div>
        )}
      </div>

      {/* Tester */}
      <div style={{ ...card, padding: 20, marginTop: 18 }}>
        <div style={{ ...label, marginBottom: 7 }}>System prompt · optional</div>
        <input value={system} onChange={(e) => setSystem(e.target.value)} placeholder="You are a helpful assistant…"
          style={{ width: '100%', padding: '11px 13px', borderRadius: T.rInput, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, outline: 'none' }} />

        <div style={{ ...label, margin: '14px 0 7px' }}>Prompt</div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
          placeholder="Ask the model something…"
          style={{ width: '100%', padding: '12px 14px', borderRadius: T.rInput, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, fontFamily: T.mono, lineHeight: 1.6, outline: 'none', resize: 'vertical' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, color: T.text2 }}>
            <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
            Thinking mode <span style={{ color: T.faint, fontSize: 12 }}>(judge/coach use this)</span>
          </label>
          <button onClick={run} disabled={!prompt.trim() || busy || offline}
            style={{ ...btnPrimary, marginLeft: 'auto', opacity: (!prompt.trim() || busy || offline) ? 0.5 : 1 }}>
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>

        {error && <div style={{ color: T.red, fontSize: 13, marginTop: 12 }}>{error}</div>}

        {result && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
              <span style={{ ...label }}>Response</span>
              <span style={{ fontSize: 12, color: T.faint, fontFamily: T.mono, marginLeft: 'auto' }}>{result.latency_ms} ms · {result.model}</span>
            </div>
            <div style={{ background: T.well, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, fontSize: 14, color: T.text2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {result.response || '(empty response)'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
