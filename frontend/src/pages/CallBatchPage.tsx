import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { T, card, label, backBtn, btnSecondary } from '../theme'
import { api } from '../api/client'
import { ScoreRing, MetricBar, METRIC_LABELS, score100Color } from '../components/analysis'

type Analysis = {
  id: number; call_id: string | null; composite_score: number | null
  gated_reason: string | null; sections_json: Record<string, { score: number | null }>
}
type Batch = {
  id: string; name: string | null; direction: string; status: string
  summary_json: {
    n_total?: number; n_scored?: number; n_gated?: number; composite_mean?: number | null
    metric_means?: Record<string, number | null>
  }
  analyses: Analysis[]
}

export function CallBatchPage() {
  const { batchId } = useParams()
  const nav = useNavigate()
  const [batch, setBatch] = useState<Batch | null>(null)

  useEffect(() => {
    if (!batchId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    // Poll while 'scoring'; stop on ANY terminal status, and hard-cap so a stuck
    // backend can never make this spin forever (~13 min).
    const tick = async (): Promise<boolean> => {
      attempts += 1
      try {
        const b = await api.getCallBatch(batchId)
        if (!alive) return false
        setBatch(b)
        if (b.status !== 'scoring') return false
      } catch { /* transient — keep trying */ }
      return attempts < 200
    }
    const loop = async () => { if (await tick()) timer = setTimeout(loop, 4000) }
    loop()
    return () => { alive = false; clearTimeout(timer) }
  }, [batchId])

  if (!batch) return <div style={{ color: T.muted }}>Loading…</div>

  const s = batch.summary_json
  const total = s.n_total ?? batch.analyses.length
  const scored = s.n_scored ?? 0
  const scoring = batch.status !== 'done'
  const pct = total ? Math.round(((scored + (s.n_gated ?? 0)) / total) * 100) : 0

  return (
    <div>
      <button style={backBtn} onClick={() => nav('/analyze')}>← Back to Analyze Calls</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 650, margin: 0, color: T.text }}>{batch.name || 'Call batch'}</h1>
        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.faint }}>{batch.direction}</span>
        <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: scoring ? 'rgba(91,157,255,0.14)' : 'rgba(76,201,138,0.14)', color: scoring ? T.blue : T.green }}>
          {scoring ? 'Scoring…' : 'Done'}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <Link to="/scoreboard" style={{ ...btnSecondary, textDecoration: 'none' }}>Scoreboard →</Link>
        </div>
      </div>

      {/* Progress / summary */}
      <div style={{ ...card, padding: 20, marginTop: 18 }}>
        {scoring ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: T.muted, marginBottom: 8 }}>
              <span>Scoring calls on the judge…</span>
              <span style={{ fontFamily: T.mono }}>{scored + (s.n_gated ?? 0)} / {total}</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: T.accentGrad, borderRadius: 99, transition: 'width .5s' }} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ScoreRing value={s.composite_mean ?? null} size={68} />
              <div>
                <div style={{ ...label }}>Avg composite</div>
                <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{scored} scored · {s.n_gated ?? 0} skipped</div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 260, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.keys(METRIC_LABELS).map((k) => <MetricBar key={k} name={k} value={s.metric_means?.[k] ?? null} />)}
            </div>
          </div>
        )}
      </div>

      {/* Call list */}
      <div style={{ marginTop: 22 }}>
        <div style={{ ...label, marginBottom: 12 }}>Calls</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {batch.analyses.map((a) => {
            const col = score100Color(a.composite_score)
            return (
              <div key={a.id} className="ev-row" onClick={() => nav(`/analyze/${batch.id}/call/${a.id}`)}
                style={{ ...card, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', borderLeft: `3px solid ${col}` }}>
                <ScoreRing value={a.composite_score} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.call_id || `call #${a.id}`}
                  </div>
                  {a.gated_reason
                    ? <div style={{ fontSize: 12, color: T.amber, marginTop: 2 }}>skipped — {a.gated_reason}</div>
                    : <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>
                        {Object.entries(a.sections_json).slice(0, 3).map(([k, v]) => `${k.split('_')[0]} ${v?.score ?? '—'}`).join(' · ')}
                      </div>}
                </div>
                <span style={{ fontSize: 12.5, color: T.muted }}>›</span>
              </div>
            )
          })}
          {batch.analyses.length === 0 && <div style={{ color: T.faint, fontSize: 13 }}>No calls scored yet…</div>}
        </div>
      </div>
    </div>
  )
}
