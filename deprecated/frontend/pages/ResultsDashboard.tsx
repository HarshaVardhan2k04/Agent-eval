import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useEvalStore } from '../stores/evalStore'
import { T, scoreColor, statusMeta } from '../theme'

const PASS = 0.7
const CIRC = 2 * Math.PI * 33 // ≈ 207.3

type Filter = 'all' | 'passed' | 'failed'

const DIM_LABELS: Record<string, string> = {
  factual_accuracy: 'Factual accuracy',
  voice_friendliness: 'Voice friendliness',
  human_likeness: 'Human likeness',
  tool_correctness: 'Tool use',
  response_quality: 'Response quality',
}
const DIM_ORDER = Object.keys(DIM_LABELS)

export function ResultsDashboard() {
  const { id } = useParams<{ id: string }>()
  const { currentEval, scenarioResults, fetchEval, fetchResults } = useEvalStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [allRounds, setAllRounds] = useState(false)

  // One fetch, guaranteed to populate. We filter to the final round client-side
  // for display so big evals (hundreds–thousands of rows) don't choke the device.
  useEffect(() => {
    if (!id) return
    fetchEval(id)
    fetchResults(id)
  }, [id])

  const evalData = currentEval as Record<string, unknown> | null
  const iterationsRunVal = evalData?.iterations_run as number | undefined

  const maxIter = scenarioResults.reduce((m, r) => Math.max(m, (r.iteration as number) ?? 0), 0)
  const roundResults = allRounds
    ? scenarioResults
    : scenarioResults.filter((r) => ((r.iteration as number) ?? 0) === maxIter)

  const name = (evalData?.name as string) || (evalData?.id as string) || (id ?? 'Evaluation')
  const status = (evalData?.status as string) || 'pending'
  const sMeta = statusMeta(status)
  const finalScore = (evalData?.final_score as number | null) ?? null
  const iterationsRun = (evalData?.iterations_run as number) ?? 0
  const maxIterations = (evalData?.max_iterations as number) ?? 0

  const passCount = roundResults.filter((r) => r.composite_score >= PASS).length
  const total = roundResults.length

  const filtered = roundResults.filter((r) => {
    if (filter === 'passed') return r.composite_score >= PASS
    if (filter === 'failed') return r.composite_score < PASS
    return true
  })

  const finalPct = finalScore != null ? Math.round(finalScore * 100) : 0
  const finalColor = scoreColor(finalScore)
  const arcOffset = CIRC * (1 - (finalScore ?? 0))

  return (
    <div
      className="page-enter"
      style={{ maxWidth: 1180, margin: '0 auto', padding: '38px 24px 90px', fontFamily: T.sans }}
    >
      <Link to="/" style={backLink}>← Back to evaluations</Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', color: T.text }}>{name}</h1>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: T.rPill, fontSize: 12.5, fontWeight: 600, background: sMeta.color + '26', color: sMeta.color }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: sMeta.color }} />
              {sMeta.label}
            </div>
          </div>
          <p style={{ margin: '7px 0 0', color: T.muted, fontSize: 13.5 }}>
            We ran {total} {total === 1 ? 'scenario' : 'scenarios'} over {iterationsRun} {iterationsRun === 1 ? 'round' : 'rounds'} and kept only the changes that helped. Here's how the best version did.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <Link to={`/eval/${id}/prompts`} style={headerLink}>Prompt History →</Link>
          <Link to={`/eval/${id}/voice`} style={headerLink}>Voice Report →</Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="cards-3 stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginTop: 24 }}>
        {/* Final score */}
        <div style={{ ...summaryCard, display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg viewBox="0 0 80 80" style={{ width: 78, height: 78, flexShrink: 0 }}>
            <circle cx="40" cy="40" r="33" fill="none" stroke={T.track} strokeWidth="8" />
            <circle
              cx="40" cy="40" r="33" fill="none" stroke={finalColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={arcOffset} transform="rotate(-90 40 40)"
            />
          </svg>
          <div>
            <div style={cardLabel}>Final score</div>
            <div style={{ fontSize: 34, fontWeight: 600, color: finalColor, fontFamily: T.mono, lineHeight: 1.1, marginTop: 2 }}>
              {finalScore != null ? `${finalPct}%` : '—'}
            </div>
          </div>
        </div>

        {/* Iterations run */}
        <div style={summaryCard}>
          <div style={cardLabel}>Iterations run</div>
          <div style={{ fontSize: 34, fontWeight: 600, color: T.text, fontFamily: T.mono, lineHeight: 1.1, marginTop: 6 }}>
            {iterationsRun} <span style={{ fontSize: 16, color: T.faint }}>/ {maxIterations}</span>
          </div>
          <div style={{ fontSize: 12.5, color: T.faint, marginTop: 4 }}>Rounds of scoring and coaching.</div>
        </div>

        {/* Pass rate */}
        <div style={summaryCard}>
          <div style={cardLabel}>Pass rate</div>
          <div style={{ fontSize: 34, fontWeight: 600, color: T.text, fontFamily: T.mono, lineHeight: 1.1, marginTop: 6 }}>
            {passCount} <span style={{ fontSize: 16, color: T.faint }}>/ {total}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
            {roundResults.map((r, i) => (
              <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: r.composite_score >= PASS ? T.green : T.red }} />
            ))}
          </div>
        </div>
      </div>

      {/* Scenario results heading + filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '28px 0 14px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: T.text }}>Scenario results</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {iterationsRunVal ? (
            <button
              onClick={() => setAllRounds((v) => !v)}
              title={allRounds ? 'Showing every round (heavier)' : 'Showing only the final round'}
              style={{ ...filterPill(allRounds), marginRight: 4 }}
            >
              {allRounds ? 'All rounds' : 'Final round'}
            </button>
          ) : null}
          {(['all', 'passed', 'failed'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={filterPill(filter === f)}>
              {f === 'all' ? 'All' : f === 'passed' ? 'Passed' : 'Failed'}
            </button>
          ))}
        </div>
      </div>

      {/* Scenario rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((r) => {
          const key = `${r.scenario_name}-${r.iteration}`
          const open = expanded === key
          const pass = r.composite_score >= PASS
          const rowColor = scoreColor(r.composite_score)
          return (
            <div key={key} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
              <div
                onClick={() => setExpanded(open ? null : key)}
                role="button" tabIndex={0}
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', cursor: 'pointer' }}
              >
                <span style={{ color: T.muted, fontSize: 12, transition: 'transform .2s ease', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, color: T.text }}>{r.scenario_name}</div>
                  <div style={{ fontSize: 12.5, color: T.faint, marginTop: 2 }}>{r.scenario_type} · scored on iteration {r.iteration}</div>
                </div>
                <div style={{ fontSize: 19, fontWeight: 600, color: rowColor, fontFamily: T.mono }}>{(r.composite_score * 100).toFixed(0)}%</div>
                <div style={passPill(pass)}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: pass ? T.green : T.red }} />
                  {pass ? 'PASS' : 'FAIL'}
                </div>
              </div>

              {open && (
                <div style={{ padding: '4px 20px 22px', animation: 'expand-in .32s cubic-bezier(.22,.61,.36,1) both' }}>
                  {/* Judge's read */}
                  <div style={{ padding: '14px 16px', borderRadius: 11, background: T.well, border: `1px solid ${T.borderFaint}`, fontSize: 13.5, lineHeight: 1.6, color: T.text3 }}>
                    <span style={{ color: T.muted, fontWeight: 600 }}>Judge's read: </span>
                    {r.judge_reasoning}
                  </div>

                  {/* Dimension mini-cards */}
                  <div className="dims-grid stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginTop: 14 }}>
                    {DIM_ORDER.map((k) => {
                      const v = Number((r.scores_json as Record<string, unknown>)?.[k] ?? 0)
                      const dc = scoreColor(v)
                      return (
                        <div key={k} style={{ background: T.well, border: `1px solid ${T.borderFaint}`, borderRadius: 11, padding: '13px 14px' }}>
                          <div style={{ fontSize: 11, color: T.muted, fontWeight: 500, lineHeight: 1.3, height: 28 }}>{DIM_LABELS[k]}</div>
                          <div style={{ fontSize: 22, fontWeight: 600, color: dc, fontFamily: T.mono, marginTop: 4 }}>{(v * 100).toFixed(0)}%</div>
                          <div style={{ height: 4, borderRadius: T.rPill, background: T.track, marginTop: 7, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${v * 100}%`, background: dc, borderRadius: T.rPill }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Transcript */}
                  {r.transcript_json && r.transcript_json.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.muted, margin: '20px 0 12px' }}>
                        Conversation transcript
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {r.transcript_json.map((turn, ti) => {
                          const agent = turn.role === 'agent'
                          return (
                            <div key={ti} style={{ display: 'flex', flexDirection: 'column', alignItems: agent ? 'flex-end' : 'flex-start' }}>
                              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: T.faint, margin: '0 4px 4px' }}>
                                {agent ? 'Agent' : 'Caller'}
                              </div>
                              <div
                                style={{
                                  maxWidth: '76%',
                                  padding: '10px 14px',
                                  borderRadius: 14,
                                  fontSize: 13.5,
                                  lineHeight: 1.5,
                                  background: agent ? T.accentSoft : T.chip,
                                  color: agent ? T.text : T.text2,
                                  border: agent ? `1px solid rgba(var(--accent-rgb),0.25)` : `1px solid ${T.border}`,
                                  borderBottomRightRadius: agent ? 4 : 14,
                                  borderBottomLeftRadius: agent ? 14 : 4,
                                }}
                              >
                                {turn.content}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const backLink: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: T.muted,
  fontSize: 13.5,
  textDecoration: 'none',
  marginBottom: 16,
}

const headerLink: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 11,
  border: `1px solid ${T.border2}`,
  background: T.surface2,
  color: T.text2,
  fontSize: 13.5,
  fontWeight: 500,
  textDecoration: 'none',
}

const summaryCard: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
  padding: 22,
}

const cardLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: T.muted,
}

function filterPill(active: boolean): React.CSSProperties {
  return {
    padding: '7px 14px',
    borderRadius: T.rPill,
    border: `1px solid ${active ? 'transparent' : T.border2}`,
    background: active ? T.accent : T.surface2,
    color: active ? '#fff' : T.text2,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  }
}

function passPill(pass: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 11px',
    borderRadius: T.rPill,
    fontSize: 12,
    fontWeight: 600,
    background: (pass ? T.green : T.red) + '26',
    color: pass ? T.green : T.red,
  }
}
