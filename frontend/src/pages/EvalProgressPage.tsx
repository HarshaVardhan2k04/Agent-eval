import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEvalStore } from '../stores/evalStore'
import { api } from '../api/client'
import { T, scoreColor } from '../theme'

interface EvalEventRow {
  id: number
  event_type: string
  event_data: Record<string, unknown>
  created_at: string
}

type LogLine = { icon: string; color: string; text: string }

const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}%`

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '')
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** Hex → rgba with alpha, for soft tag/badge backgrounds. */
function tint(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function summarizeEdits(edits: Array<Record<string, unknown>> | undefined): string {
  if (!edits || edits.length === 0) return ''
  const parts = edits.slice(0, 3).map((e) => {
    const op = String(e.op || '')
    if (op === 'append') return `+ "${clip(e.text, 55)}"`
    if (op === 'prepend') return `+top "${clip(e.text, 55)}"`
    if (op === 'replace') return `~ "${clip(e.find, 22)}"→"${clip(e.replace, 22)}"`
    if (op === 'rewrite') return '⟳ full rewrite'
    return op
  })
  const more = edits.length > 3 ? `  (+${edits.length - 3} more)` : ''
  return parts.join('   ') + more
}

function formatEvent(e: EvalEventRow): LogLine | null {
  const d = e.event_data || {}
  switch (e.event_type) {
    case 'iteration_start':
      return {
        icon: '▶', color: T.blue,
        text: `Iteration ${d.iteration === 0 ? 'baseline' : d.iteration} started${d.total_iterations ? ` · max ${d.total_iterations}` : ''}`,
      }
    case 'scenario_complete':
      return {
        icon: '·', color: T.muted,
        text: `${d.scenario_name} → ${pct(d.composite_score)}  [${d.scenario_index}/${d.total_scenarios}]`,
      }
    case 'iteration_complete': {
      const chal = d.challenger_score != null ? ` · challenger ${pct(d.challenger_score)}` : ''
      return {
        icon: '■', color: T.text,
        text: `Iteration ${d.iteration} complete — champion ${pct(d.champion_score ?? d.score)}${chal}`,
      }
    }
    case 'prompt_improved': {
      const patch = summarizeEdits(d.edits as Array<Record<string, unknown>> | undefined)
      const detail = patch || String(d.changes || '').slice(0, 140)
      return { icon: '↑', color: T.green, text: `ACCEPTED v${d.version} (${pct(d.score)}) — ${detail}` }
    }
    case 'prompt_reverted': {
      const reg = (d.regressed as Array<{ scenario: string }> | undefined)?.map((r) => r.scenario).join(', ')
      const patch = summarizeEdits(d.edits as Array<Record<string, unknown>> | undefined)
      return {
        icon: '↩', color: T.amber,
        text: `REVERTED v${d.version} — ${d.reason}${patch ? ` · tried: ${patch}` : ''}${reg ? ` · broke: ${reg}` : ''}`,
      }
    }
    case 'threshold_met':
      return { icon: '🎯', color: T.green, text: `Threshold met at ${pct(d.score)}` }
    case 'converged':
      return { icon: '⏹', color: T.amber, text: String(d.message || 'Converged — stopping') }
    case 'eval_complete':
      return { icon: '✅', color: T.green, text: `Complete — final ${pct(d.final_score)} (${d.status})` }
    default:
      return null
  }
}

export function EvalProgressPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { currentEval, fetchEval, stopEval } = useEvalStore()

  const [events, setEvents] = useState<EvalEventRow[]>([])
  const [done, setDone] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const lastIdRef = useRef(0)
  const bestScoreRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    fetchEval(id)
    let stopped = false

    const poll = async () => {
      try {
        const rows: EvalEventRow[] = await api.getEventLog(id, lastIdRef.current)
        if (rows.length) {
          lastIdRef.current = rows[rows.length - 1].id
          setEvents((prev) => [...prev, ...rows])
          if (rows.some((r) => r.event_type === 'eval_complete')) setDone(true)
        }
      } catch {
        /* keep polling */
      }
    }

    poll()
    const iv = setInterval(() => { if (!stopped) poll() }, 1500)
    return () => { stopped = true; clearInterval(iv) }
  }, [id])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  useEffect(() => {
    if (done && id) {
      const t = setTimeout(() => navigate(`/eval/${id}/results`), 1500)
      return () => clearTimeout(t)
    }
  }, [done, id, navigate])

  // Derive progress from the accumulated events (reliable — no SSE dependency).
  const evalData = currentEval as Record<string, unknown> | null
  const totalIterations = (evalData?.max_iterations as number) || 0
  let iteration = 0, scenarioIndex = 0, totalScenarios = 0, currentScore = 0
  const scores: number[] = []
  for (const e of events) {
    const d = e.event_data || {}
    if (e.event_type === 'iteration_start') iteration = (d.iteration as number) ?? iteration
    if (e.event_type === 'scenario_complete') {
      scenarioIndex = (d.scenario_index as number) ?? scenarioIndex
      totalScenarios = (d.total_scenarios as number) ?? totalScenarios
    }
    if (e.event_type === 'iteration_complete') {
      currentScore = (d.champion_score as number) ?? (d.score as number) ?? currentScore
      scores.push(currentScore)
    }
  }

  // Brief celebration ring when a new best score lands.
  useEffect(() => {
    if (currentScore > bestScoreRef.current) {
      bestScoreRef.current = currentScore
      setCelebrating(true)
      const t = setTimeout(() => setCelebrating(false), 750)
      return () => clearTimeout(t)
    }
  }, [currentScore])

  const lines = events.map((e) => ({ row: e, line: formatEvent(e)! })).filter((x) => x.line)
  const visible = lines.slice(-400)

  // Coach is "thinking" between finishing an iteration and starting the next.
  const lastType = events.length ? events[events.length - 1].event_type : ''
  const coachThinking = !done && (lastType === 'iteration_complete' || lastType === 'scenario_complete')

  const scoreText = currentScore ? `${Math.round(currentScore * 100)}%` : '—'
  const statusColor = done ? T.green : T.blue
  const statusLabel = done ? 'Complete' : 'Running'
  const statusLine = done
    ? 'Finished — the best version is ready.'
    : iteration
      ? `Iteration ${iteration}${totalIterations ? ` of ${totalIterations}` : ''} · ${scenarioIndex}/${totalScenarios || '…'} scenarios this round`
      : 'Warming up the judges and the coach…'

  // SVG "Score over iterations" — 300×120 viewBox, y = 110 − score·100.
  const n = scores.length
  const xAt = (i: number) => (n <= 1 ? 150 : 6 + (i * 288) / (n - 1))
  const yAt = (s: number) => 110 - s * 100
  const chartPoints = scores.map((s, i) => `${xAt(i).toFixed(1)},${yAt(s).toFixed(1)}`).join(' ')
  const chartArea =
    n >= 2
      ? `M ${scores.map((s, i) => `${xAt(i).toFixed(1)} ${yAt(s).toFixed(1)}`).join(' L ')} L ${xAt(n - 1).toFixed(1)} 120 L ${xAt(0).toFixed(1)} 120 Z`
      : ''

  return (
    <div className="page-enter" style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: T.text }}>
              {(evalData?.name as string) || 'Evaluation'}
            </h1>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 99,
              fontSize: 12.5, fontWeight: 600, background: tint(statusColor, 0.15), color: statusColor,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: statusColor,
                animation: done ? undefined : 'pulse-dot 1.1s infinite',
              }} />
              {statusLabel}
            </div>
          </div>
          <p style={{ margin: '7px 0 0', color: T.muted, fontSize: 13.5 }}>{statusLine}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!done ? (
            <button
              onClick={() => id && stopEval(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 11,
                border: `1px solid ${tint(T.red, 0.4)}`, background: tint(T.red, 0.1), color: '#f3948f',
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: T.red, display: 'inline-block' }} />
              Stop
            </button>
          ) : (
            <button
              onClick={() => id && navigate(`/eval/${id}/results`)}
              style={{
                padding: '11px 20px', borderRadius: 11, border: 'none', background: T.accentGrad,
                color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: T.accentGlow,
              }}
            >
              View results →
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="prog-grid" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18, marginTop: 24 }}>
        {/* LEFT column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Best score */}
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 22,
            textAlign: 'center', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.muted }}>
              Best score so far
            </div>
            <div style={{ position: 'relative', display: 'inline-block', marginTop: 8 }}>
              {celebrating && (
                <span style={{
                  position: 'absolute', inset: 0, margin: 'auto', width: 90, height: 90, borderRadius: '50%',
                  border: `3px solid ${T.green}`, animation: 'ring-pulse .7s ease-out',
                }} />
              )}
              <div style={{ display: 'inline-block', animation: 'pop .5s ease' }}>
                <div style={{
                  fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1,
                  color: scoreColor(currentScore), fontFamily: T.mono,
                }}>
                  {scoreText}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: T.muted }}>
              {currentScore ? `across ${totalScenarios || '…'} scenarios` : 'waiting for the first round…'}
            </div>
          </div>

          {/* Progress bars */}
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.muted, marginBottom: 7 }}>
                <span>Iteration</span>
                <span style={{ fontFamily: T.mono, color: T.text2 }}>{iteration} / {totalIterations}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${totalIterations ? Math.round((iteration / totalIterations) * 100) : 0}%`,
                  borderRadius: 99, background: T.accentGrad, transition: 'width .4s',
                }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.muted, marginBottom: 7 }}>
                <span>Scenario this round</span>
                <span style={{ fontFamily: T.mono, color: T.text2 }}>{scenarioIndex} / {totalScenarios}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${totalScenarios ? Math.round((scenarioIndex / totalScenarios) * 100) : 0}%`,
                  borderRadius: 99, background: T.blue, transition: 'width .3s',
                }} />
              </div>
            </div>
          </div>

          {/* Score chart */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{
              fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: T.muted, marginBottom: 12,
            }}>
              Score over iterations
            </div>
            <svg viewBox="0 0 300 120" style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="Score over iterations chart">
              <line x1="0" y1="30" x2="300" y2="30" stroke={T.borderFaint} strokeWidth="1" />
              <line x1="0" y1="60" x2="300" y2="60" stroke={T.borderFaint} strokeWidth="1" />
              <line x1="0" y1="90" x2="300" y2="90" stroke={T.borderFaint} strokeWidth="1" />
              {n >= 2 && (
                <>
                  <path d={chartArea} style={{ fill: 'rgba(var(--accent-hi-rgb),0.16)' }} />
                  <polyline
                    points={chartPoints} fill="none" style={{ stroke: 'var(--accent-hi)' }}
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  />
                  <circle
                    cx={xAt(n - 1).toFixed(1)} cy={yAt(scores[n - 1]).toFixed(1)} r="4.5"
                    style={{ fill: 'var(--accent-hi)' }} stroke={T.bg} strokeWidth="2"
                  />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* RIGHT column — live log */}
        <div style={{
          background: T.well, border: `1px solid ${T.border}`, borderRadius: 16, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', minHeight: 460,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
            borderBottom: `1px solid ${T.divider}`, background: T.surface,
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: T.red, opacity: 0.7 }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: T.amber, opacity: 0.7 }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: T.green, opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.muted, marginLeft: 4 }}>live log</span>
            {!done && (
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: T.blue }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.blue, animation: 'pulse-dot 1.1s infinite' }} />
                streaming
              </span>
            )}
          </div>
          <div
            role="log" aria-live="polite"
            style={{
              flex: 1, overflowY: 'auto', padding: '16px 18px', fontFamily: T.mono,
              fontSize: 12.8, lineHeight: 1.7, maxHeight: 520,
            }}
          >
            {visible.length === 0 && (
              <div style={{ color: T.faint }}>Waiting for the engine to emit events…</div>
            )}
            {visible.map(({ row, line }) => {
              const d = row.event_data || {}
              const isRevert = row.event_type === 'prompt_reverted'
              const detail =
                row.event_type === 'prompt_improved' || isRevert
                  ? summarizeEdits(d.edits as Array<Record<string, unknown>> | undefined)
                  : ''
              return (
                <div key={row.id} className="logline" style={{ display: 'flex', gap: 12, padding: '3px 0' }}>
                  <span style={{ color: T.fainter, flexShrink: 0, userSelect: 'none' }}>
                    {new Date(row.created_at).toLocaleTimeString()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 7px', borderRadius: 6, marginRight: 9,
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
                      background: tint(line.color, 0.15), color: line.color,
                    }}>
                      {line.icon}
                    </span>
                    <span style={{ color: line.color }}>{line.text}</span>
                    {detail && (
                      <div style={{
                        marginTop: 4, padding: '7px 11px', borderRadius: 8,
                        background: isRevert ? tint(T.amber, 0.08) : tint(T.green, 0.07),
                        borderLeft: `2px solid ${isRevert ? T.amber : T.green}`,
                        color: T.text3, fontSize: 12,
                      }}>
                        {detail}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {coachThinking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', color: T.purple }}>
                <span style={{
                  width: 14, height: 14, border: `2px solid ${tint(T.purple, 0.35)}`, borderTopColor: T.purple,
                  borderRadius: '50%', animation: 'spin .8s linear infinite', display: 'inline-block',
                }} />
                <span>The coach is reading the transcripts and drafting one improvement…</span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
