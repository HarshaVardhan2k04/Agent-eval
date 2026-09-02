import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEvalStore } from '../stores/evalStore'
import { T, backBtn } from '../theme'

/** Rough token estimate (~4 chars/token) — good enough for a live counter without a tokenizer. */
const estimateTokens = (text: string) => Math.max(0, Math.round(text.length / 4))

export function EvalSetupPage() {
  const navigate = useNavigate()
  const createEval = useEvalStore((s) => s.createEval)
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [scenariosText, setScenariosText] = useState('')
  const [scenariosPreview, setScenariosPreview] = useState<Array<Record<string, unknown>>>([])
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [config, setConfig] = useState({
    max_iterations: 5,
    quality_threshold: 0.9,
    tools_enabled: true,
    dynamic_context_enabled: false,
    rag: undefined as { enabled: boolean; server_url: string; collection_name: string } | undefined,
  })

  const parseScenarios = (text: string) => {
    try {
      const parsed = JSON.parse(text)
      const scenarios = parsed.scenarios || parsed
      setScenariosPreview(Array.isArray(scenarios) ? scenarios : [])
      return true
    } catch {
      setScenariosPreview([])
      return false
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setScenariosText(text)
      setFileName(file.name)
      if (parseScenarios(text)) {
        setError('')
      } else {
        setError('Invalid JSON in scenarios file')
      }
    }
    reader.readAsText(file)
  }

  const handleStart = async () => {
    if (!prompt.trim()) {
      setError('System prompt is required')
      return
    }
    if (!scenariosText.trim()) {
      setError('Scenarios JSON is required')
      return
    }

    try {
      setLoading(true)
      setError('')
      const parsed = JSON.parse(scenariosText)
      const evalId = await createEval(name, prompt, parsed, config)
      navigate(`/eval/${evalId}/progress`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start eval')
    } finally {
      setLoading(false)
    }
  }

  const promptReady = prompt.trim().length > 0
  const scenariosReady = scenariosPreview.length > 0
  const canStart = promptReady && scenariosReady && !loading

  // Does the scenarios text fail to parse? (only relevant once something's typed)
  let scenParseError = false
  if (scenariosText.trim()) {
    try {
      JSON.parse(scenariosText)
    } catch {
      scenParseError = true
    }
  }

  const thresholdPct = Math.round(config.quality_threshold * 100)

  const toggles = [
    {
      label: 'Tools enabled',
      on: config.tools_enabled,
      toggle: () => setConfig((c) => ({ ...c, tools_enabled: !c.tools_enabled })),
    },
    {
      label: 'Dynamic context',
      on: config.dynamic_context_enabled,
      toggle: () => setConfig((c) => ({ ...c, dynamic_context_enabled: !c.dynamic_context_enabled })),
    },
    {
      label: 'RAG enabled',
      on: !!config.rag,
      toggle: () =>
        setConfig((c) => ({
          ...c,
          rag: c.rag ? undefined : { enabled: true, server_url: '', collection_name: '' },
        })),
    },
  ]

  return (
    <div className="page-enter">
      <button onClick={() => navigate('/')} style={backBtn}>
        ← Back to evaluations
      </button>

      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600, letterSpacing: '-0.025em', color: T.text }}>
        New Evaluation
      </h1>
      <p style={{ margin: '8px 0 0', color: T.muted, fontSize: 15 }}>
        Paste your agent's system prompt and a scenarios file, tune the loop, then run it. We'll take it from
        there.
      </p>

      {/* Name */}
      <div style={{ marginTop: 28 }}>
        <label style={labelStyle}>
          Name{' '}
          <span style={{ color: T.faint, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· optional</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Aanya v3 · tighten pricing & tool timing"
          style={nameInput}
        />
      </div>

      {/* Editors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 20 }} className="editors-grid">
        {/* System Prompt */}
        <div style={card}>
          <div style={cardHeader}>
            <div>
              <div style={cardTitle}>System Prompt</div>
              <div style={cardHint}>The agent instructions we'll evaluate &amp; improve</div>
            </div>
            <div style={statusChip(promptReady)}>{promptReady ? 'ready' : 'empty'}</div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
            placeholder="You are Aanya, a warm and efficient scheduling assistant for..."
            style={wellArea}
          />
          <div style={cardFooter}>
            <span>{prompt.length} chars</span>
            <span>{estimateTokens(prompt)} tokens</span>
          </div>
        </div>

        {/* Scenarios JSON */}
        <div style={card}>
          <div style={cardHeader}>
            <div>
              <div style={cardTitle}>Scenarios JSON</div>
              <div style={cardHint}>{fileName ? `Loaded: ${fileName}` : 'Upload a file or paste JSON'}</div>
            </div>
            <button onClick={() => fileRef.current?.click()} style={uploadBtn}>
              Upload File
            </button>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          </div>
          <textarea
            value={scenariosText}
            onChange={(e) => {
              setScenariosText(e.target.value)
              parseScenarios(e.target.value || '{}')
            }}
            spellCheck={false}
            placeholder={'[ { "name": "Booking happy path", "type": "booking", "goal": "..." } ]'}
            style={wellArea}
          />
          <div style={cardFooter}>
            <span>{scenariosText.length} chars</span>
            <span>{estimateTokens(scenariosText)} tokens</span>
            {(scenParseError || scenariosPreview.length > 0) && (
              <span style={{ color: scenParseError ? T.red : T.green }}>
                {scenParseError ? 'invalid JSON' : `${scenariosPreview.length} scenarios loaded`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Scenarios parse error banner */}
      {scenParseError && (
        <div style={parseBanner}>
          <span style={{ fontWeight: 700 }}>!</span> That JSON doesn't parse yet — check for a missing comma or
          bracket. No rush, we'll wait.
        </div>
      )}

      {/* Configuration */}
      <div style={configCard}>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Configuration</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>
          How hard should we push, and when should we stop?
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, marginTop: 20 }} className="config-grid">
          <div>
            <label style={ctrlLabel}>
              Max iterations{' '}
              <span
                title="One iteration = run every scenario, score, and let the coach try one improvement."
                style={helpMark}
              >
                ?
              </span>
            </label>
            <div style={ctrlHint}>More rounds = more polish, more time.</div>
            <input
              type="number"
              min={1}
              max={20}
              value={config.max_iterations}
              onChange={(e) => setConfig((c) => ({ ...c, max_iterations: Number(e.target.value) }))}
              style={numInput}
            />
          </div>

          <div>
            <label style={{ ...ctrlLabel, justifyContent: 'space-between' }}>
              Quality threshold{' '}
              <span style={{ fontFamily: T.mono, color: T.accentHi, fontWeight: 600 }}>{thresholdPct}%</span>
            </label>
            <div style={ctrlHint}>We'll stop early once the best version reaches this.</div>
            <input
              type="range"
              min={0}
              max={100}
              value={thresholdPct}
              onChange={(e) => setConfig((c) => ({ ...c, quality_threshold: Number(e.target.value) / 100 }))}
              style={{ width: '100%', accentColor: T.accent, height: 6 }}
            />
          </div>
        </div>

        <div style={{ height: 1, background: T.divider, margin: '22px 0' }} />

        {/* Toggle pills */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {toggles.map((t) => (
            <button key={t.label} onClick={t.toggle} role="switch" aria-checked={t.on} style={pillStyle(t.on)}>
              <span style={trackStyle(t.on)}>
                <span style={thumbStyle(t.on)} />
              </span>
              {t.label}
            </button>
          ))}
        </div>

        {/* RAG inputs */}
        {config.rag && (
          <div style={ragGrid} className="config-grid">
            <div>
              <label style={ragLabel}>RAG server URL</label>
              <input
                value={config.rag.server_url}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, rag: c.rag ? { ...c.rag, server_url: e.target.value } : c.rag }))
                }
                placeholder="https://rag.internal/v1"
                style={ragInput}
              />
            </div>
            <div>
              <label style={ragLabel}>Collection</label>
              <input
                value={config.rag.collection_name}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, rag: c.rag ? { ...c.rag, collection_name: e.target.value } : c.rag }))
                }
                placeholder="dealership-kb"
                style={ragInput}
              />
            </div>
          </div>
        )}
      </div>

      {/* Generic error (start / upload failures) */}
      {error && (
        <div style={errorBox}>
          <span style={{ fontWeight: 700 }}>⚠ </span>
          {error}
        </div>
      )}

      {/* Footer bar */}
      <div style={footerBar}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}>
            <span style={readyDot(promptReady)}>{promptReady ? '✓' : '○'}</span>
            <span style={{ color: promptReady ? T.text2 : T.muted }}>Prompt</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}>
            <span style={readyDot(scenariosReady)}>{scenariosReady ? '✓' : '○'}</span>
            <span style={{ color: scenariosReady ? T.text2 : T.muted }}>Scenarios</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: T.faint, maxWidth: 240, lineHeight: 1.4 }}>
            When you press Start, we run all {scenariosPreview.length || 'your'} scenarios, score them, and begin
            coaching — you'll watch it live.
          </span>
          <button onClick={handleStart} disabled={!canStart} style={startBtn(canStart)}>
            {loading ? 'Starting…' : 'Start Evaluation →'}
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: T.muted,
  marginBottom: 9,
}

const nameInput: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: `1px solid ${T.border2}`,
  background: T.surface,
  color: T.text,
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
}

const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
}

const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '16px 18px',
  borderBottom: `1px solid ${T.divider}`,
}

const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: T.text }
const cardHint: React.CSSProperties = { fontSize: 12.5, color: T.muted, marginTop: 2 }

const wellArea: React.CSSProperties = {
  border: 'none',
  background: T.well,
  color: T.text2,
  padding: '16px 18px',
  fontSize: 13,
  lineHeight: 1.65,
  minHeight: 280,
  resize: 'vertical',
  width: '100%',
  outline: 'none',
  fontFamily: T.mono,
}

const cardFooter: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  padding: '11px 18px',
  borderTop: `1px solid ${T.divider}`,
  fontFamily: T.mono,
  fontSize: 11.5,
  color: T.faint,
}

const statusChip = (ready: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  borderRadius: T.rPill,
  fontSize: 11.5,
  fontWeight: 600,
  background: ready ? 'rgba(76,201,138,0.15)' : T.chip,
  color: ready ? T.green : T.faint,
  whiteSpace: 'nowrap',
})

const uploadBtn: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 9,
  border: '1px solid rgba(var(--accent-hi-rgb),0.4)',
  background: 'rgba(var(--accent-rgb),0.1)',
  color: T.accentHi,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const parseBanner: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '11px 14px',
  borderRadius: 11,
  background: 'rgba(236,90,84,0.1)',
  border: '1px solid rgba(236,90,84,0.32)',
  color: '#f3948f',
  fontSize: 13,
}

const configCard: React.CSSProperties = {
  marginTop: 22,
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
  padding: '22px 24px',
}

const ctrlLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 13.5,
  fontWeight: 500,
  color: T.text2,
  marginBottom: 6,
}

const ctrlHint: React.CSSProperties = { fontSize: 11.5, color: T.faint, marginBottom: 9 }

const helpMark: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: T.track,
  color: T.muted,
  fontSize: 10,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'help',
}

const numInput: React.CSSProperties = {
  width: 120,
  padding: '11px 14px',
  borderRadius: 10,
  border: `1px solid ${T.border2}`,
  background: T.well,
  color: T.text,
  fontSize: 15,
  fontFamily: T.mono,
}

const pillStyle = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 11,
  padding: '10px 15px',
  borderRadius: 11,
  fontSize: 13.5,
  fontWeight: 500,
  cursor: 'pointer',
  border: `1px solid ${on ? 'rgba(var(--accent-hi-rgb),0.45)' : T.border2}`,
  background: on ? 'rgba(var(--accent-rgb),0.12)' : T.well,
  color: on ? T.accentHi : T.muted,
})

const trackStyle = (on: boolean): React.CSSProperties => ({
  position: 'relative',
  width: 36,
  height: 21,
  borderRadius: T.rPill,
  flexShrink: 0,
  transition: 'background .2s ease',
  background: on ? T.accent : '#3a332a',
  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)',
})

const thumbStyle = (on: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 2.5,
  left: on ? 17.5 : 2.5,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#fff',
  transition: 'left .2s cubic-bezier(.34,1.56,.64,1)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
})

const ragGrid: React.CSSProperties = {
  marginTop: 16,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
  padding: 16,
  borderRadius: 12,
  background: T.well,
  border: `1px solid ${T.divider}`,
  animation: 'expand-in .3s cubic-bezier(.22,.61,.36,1) both',
}

const ragLabel: React.CSSProperties = { display: 'block', fontSize: 12, color: T.muted, marginBottom: 6 }

const ragInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 13px',
  borderRadius: 9,
  border: `1px solid ${T.border2}`,
  background: T.surface,
  color: T.text,
  fontSize: 13.5,
  fontFamily: T.mono,
}

const errorBox: React.CSSProperties = {
  marginTop: 16,
  padding: '11px 14px',
  borderRadius: 11,
  background: 'rgba(236,90,84,0.1)',
  border: '1px solid rgba(236,90,84,0.32)',
  color: '#f3948f',
  fontSize: 13,
}

const footerBar: React.CSSProperties = {
  marginTop: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 20,
  flexWrap: 'wrap',
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
  padding: '20px 24px',
}

const readyDot = (ok: boolean): React.CSSProperties => ({
  width: 19,
  height: 19,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
  background: ok ? 'rgba(76,201,138,0.18)' : T.track,
  color: ok ? T.green : T.faint,
})

const startBtn = (enabled: boolean): React.CSSProperties => ({
  padding: '13px 24px',
  borderRadius: 12,
  border: 'none',
  fontWeight: 600,
  fontSize: 15,
  transition: 'opacity .15s',
  ...(enabled
    ? {
        background: T.accentGrad,
        color: '#fff',
        cursor: 'pointer',
        boxShadow: T.accentGlow,
      }
    : {
        background: T.track,
        color: '#5a5348',
        cursor: 'not-allowed',
      }),
})
