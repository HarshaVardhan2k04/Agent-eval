import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEvalStore } from '../stores/evalStore'
import { T, scoreColor, statusMeta } from '../theme'
import { hexToRgb } from '../accent'

type Filter = 'all' | 'running' | 'completed'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'completed', label: 'Completed' },
]

interface EvalRow {
  id: string
  name: string | null
  status: string
  final_score: number | null
  iterations_run: number
  max_iterations: number
  created_at: string
}

/** Iteration pips: kept (accent-green) vs to-come (track); last pulses while running. */
function pips(ev: EvalRow) {
  const cap = Math.min(ev.max_iterations || 1, 12)
  const shown = ev.max_iterations ? Math.round((ev.iterations_run / ev.max_iterations) * cap) : 0
  const out: React.CSSProperties[] = []
  for (let i = 0; i < cap; i++) {
    const on = i < shown
    const pulsing = ev.status === 'running' && i === shown - 1
    out.push({
      flex: 1, height: 7, minWidth: 4, borderRadius: 3,
      background: on ? T.green : T.track,
      animation: pulsing ? 'pulse-dot 1.3s infinite' : undefined,
    })
  }
  return out
}

/** Small synthetic sparkline that lands on the final score. */
function spark(ev: EvalRow): { points: string; last: [number, number] } {
  const score = ev.final_score != null ? ev.final_score * 100 : 0
  const base = Math.max(18, score - 24)
  const vals = [base, base + 8, base + 4, Math.max(base, score - 8), score]
  const pts = vals.map((v, i) => {
    const x = 4 + (i * 84) / (vals.length - 1)
    const y = 36 - Math.max(0, Math.min(100, v)) / 100 * 30
    return [x, y] as [number, number]
  })
  return { points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), last: pts[pts.length - 1] }
}

export function EvalListPage() {
  const { evalList, fetchEvalList } = useEvalStore()
  const navigate = useNavigate()

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => { fetchEvalList() }, [])

  const view = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (evalList as EvalRow[]).filter((ev) => {
      if (filter === 'running' && ev.status !== 'running') return false
      if (filter === 'completed' && ev.status === 'running') return false
      if (!q) return true
      return (ev.name || '').toLowerCase().includes(q) || ev.id.toLowerCase().includes(q)
    })
  }, [evalList, filter, search])

  const isEmpty = evalList.length === 0
  const isNoMatch = !isEmpty && view.length === 0

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 600, letterSpacing: '-0.025em', color: T.text }}>Evaluations</h1>
          <p style={{ margin: '8px 0 0', color: T.muted, fontSize: 15, maxWidth: 560, lineHeight: 1.5 }}>
            Agent Eval tests your voice agent against real scenarios, scores every call, and coaches the prompt until it gets better. Here's everything you've run.
          </p>
        </div>
        <button
          onClick={() => navigate('/new')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: 'none', background: T.accentGrad, color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer', boxShadow: T.accentGlow, whiteSpace: 'nowrap' }}
        >
          <span style={{ fontSize: 14, lineHeight: 1, opacity: 0.85 }}>+</span> New Eval
        </button>
      </div>

      {/* Filters + search pill */}
      <div style={{ display: 'flex', gap: 14, margin: '26px 0 18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ padding: '9px 16px', borderRadius: T.rPill, border: `1px solid ${active ? 'transparent' : T.border}`, background: active ? T.accentSoft : T.surface2, color: active ? T.accentHi : T.muted, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
                {f.label}
              </button>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 17, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 1, display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9080" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.6" y1="16.6" x2="21" y2="21" />
            </svg>
          </span>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID…"
            style={{ width: '100%', padding: '13px 20px 13px 44px', borderRadius: 999, border: `1px solid ${T.border}`, background: 'linear-gradient(180deg,#2b241d,#17130f)', color: T.text, fontSize: 14, fontFamily: 'inherit', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07),inset 0 -12px 20px -12px rgba(0,0,0,0.75),0 10px 26px -12px rgba(0,0,0,0.85)' }}
          />
        </div>
      </div>

      {/* Rows */}
      {view.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {view.map((ev) => {
            const meta = statusMeta(ev.status)
            const running = ev.status === 'running'
            const done = ev.status === 'completed' || ev.status === 'converged'
            const pct = ev.max_iterations ? Math.min(100, (ev.iterations_run / ev.max_iterations) * 100) : 0
            const fillPct = done ? 100 : pct
            const mrgb = hexToRgb(meta.color)
            const sc = scoreColor(ev.final_score)
            const sp = spark(ev)
            const scoreText = ev.final_score != null ? (ev.final_score * 100).toFixed(0) + '%' : '—'
            const go = () => navigate(running ? `/eval/${ev.id}/progress` : `/eval/${ev.id}/results`)

            return (
              <div
                key={ev.id} role="button" tabIndex={0} onClick={go}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
                className="logline ev-row"
                style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '18px 22px', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 16, cursor: 'pointer', boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset,0 12px 30px -20px rgba(0,0,0,0.8)' }}
              >
                {/* progress fill background */}
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${fillPct}%`, background: `linear-gradient(90deg, rgba(${mrgb},0.10), rgba(${mrgb},0.02) 70%, transparent)`, pointerEvents: 'none' }} />

                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 18, width: '100%' }}>
                  <div style={{ width: 4, alignSelf: 'stretch', minHeight: 46, borderRadius: 99, background: meta.color, flexShrink: 0 }} />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, fontWeight: 600, color: T.text, letterSpacing: '-0.01em' }}>{ev.name || ev.id}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, background: T.chip, padding: '2px 7px', borderRadius: 6 }}>{ev.id}</span>
                    </div>
                    <div style={{ marginTop: 7, color: T.muted, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{new Date(ev.created_at).toLocaleString()}</span>
                      <span style={{ color: '#4a443a' }}>·</span>
                      <span style={{ fontFamily: T.mono, fontSize: 12 }}>{ev.iterations_run} / {ev.max_iterations} iterations</span>
                    </div>
                    <div style={{ marginTop: 11, display: 'flex', gap: 4, maxWidth: 300 }} title="Each iteration — kept (green) or still to come">
                      {pips(ev).map((s, i) => <span key={i} style={s} />)}
                    </div>
                  </div>

                  <svg className="ev-spark" viewBox="0 0 92 40" style={{ width: 88, height: 40, flexShrink: 0 }} aria-hidden="true">
                    <polyline points={sp.points} fill="none" style={{ stroke: sc }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={sp.last[0]} cy={sp.last[1]} r="3" style={{ fill: sc }} />
                  </svg>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, flexShrink: 0 }}>
                    <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: sc, fontFamily: T.mono }}>{scoreText}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: `rgba(${mrgb},0.14)`, color: meta.color }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, animation: running ? 'pulse-dot 1.1s infinite' : undefined }} />
                      {meta.label}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div style={{ textAlign: 'center', padding: '72px 24px', background: T.well, border: `1px dashed ${T.border2}`, borderRadius: 20 }}>
          <div style={{ width: 76, height: 76, margin: '0 auto 22px', borderRadius: 22, background: 'linear-gradient(140deg,rgba(var(--accent-hi-rgb),0.22),rgba(var(--accent-rgb),0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', border: '4px solid var(--accent-hi)' }} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600, color: T.text }}>No evaluations yet — let's run your first one</h2>
          <p style={{ margin: '0 auto 24px', color: T.muted, fontSize: 14.5, maxWidth: 420, lineHeight: 1.55 }}>
            Paste your agent's prompt and a few test scenarios. We'll run the calls, score them, and coach the prompt until it's genuinely better.
          </p>
          <button onClick={() => navigate('/new')} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', background: T.accentGrad, color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer', boxShadow: T.accentGlow }}>
            Start your first eval
          </button>
        </div>
      )}

      {/* No-match state */}
      {isNoMatch && (
        <div style={{ textAlign: 'center', padding: '56px 24px', background: T.well, border: `1px dashed ${T.border2}`, borderRadius: 20 }}>
          <div style={{ fontSize: 26, color: T.faint, marginBottom: 10 }}>⌕</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: T.text }}>No evaluations match your search</h2>
          <p style={{ margin: 0, color: T.muted, fontSize: 14 }}>Try a different name, ID, or status filter.</p>
        </div>
      )}
    </div>
  )
}
