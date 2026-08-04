import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, label } from '../theme'
import { api } from '../api/client'
import { usePersisted } from '../usePersisted'
import { ScoreRing, MetricBar, SECTION_LABELS, METRIC_LABELS, score100Color } from '../components/analysis'

type Batch = { id: string; name: string | null; direction: string; status: string; summary_json: any; created_at: string }
type Analysis = { id: number; call_id: string | null; composite_score: number | null; gated_reason: string | null }

export function ScoreboardPage() {
  const nav = useNavigate()
  const [batches, setBatches] = useState<Batch[]>([])
  const [sel, setSel] = usePersisted<string>('scoreboard:sel', '')
  const [detail, setDetail] = useState<(Batch & { analyses: Analysis[] }) | null>(null)

  useEffect(() => {
    api.listCallBatches().then((bs) => {
      setBatches(bs)
      // Keep the previously-selected batch if it still exists; else default to newest.
      if (bs.length && !bs.some((b: Batch) => b.id === sel)) setSel(bs[0].id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (sel) api.getCallBatch(sel).then(setDetail).catch(() => {})
  }, [sel])

  if (!batches.length) {
    return (
      <div>
        <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Scoreboard</h1>
        <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>The metrics board across a batch of calls.</p>
        <div style={{ ...card, padding: 44, marginTop: 24, textAlign: 'center', color: T.faint }}>
          No batches yet — analyze some calls first.
        </div>
      </div>
    )
  }

  const s = detail?.summary_json || {}
  const worst = (detail?.analyses || [])
    .filter((a) => a.composite_score != null)
    .sort((a, b) => (a.composite_score! - b.composite_score!))
    .slice(0, 6)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Scoreboard</h1>
          <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>How the agent performs across a batch — and where it fails most.</p>
        </div>
        <select value={sel} onChange={(e) => setSel(e.target.value)}
          style={{ marginLeft: 'auto', padding: '10px 13px', borderRadius: T.rInput, background: T.surface2, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, outline: 'none' }}>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name || b.id} ({b.summary_json?.n_scored ?? 0})</option>)}
        </select>
      </div>

      {/* Top metric tiles */}
      <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 14, minWidth: 210 }}>
          <ScoreRing value={s.composite_mean ?? null} size={64} />
          <div>
            <div style={label}>Composite</div>
            <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>{s.n_scored ?? 0} scored · {s.n_gated ?? 0} skipped</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 280, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          {Object.keys(METRIC_LABELS).map((k) => <MetricBar key={k} name={k} value={s.metric_means?.[k] ?? null} />)}
        </div>
      </div>

      {/* Section averages */}
      <div style={{ ...label, margin: '26px 0 12px' }}>Section averages</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
        {Object.keys(SECTION_LABELS).map((k) => {
          const v = s.section_means?.[k] ?? null
          return (
            <div key={k} style={{ ...card, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: T.text2 }}>{SECTION_LABELS[k]}</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: score100Color(v) }}>{v ?? '—'}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${v ?? 0}%`, background: score100Color(v), borderRadius: 99 }} />
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 26 }} className="hist-grid">
        {/* Worst calls */}
        <div>
          <div style={{ ...label, marginBottom: 12 }}>Needs attention · lowest scores</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {worst.map((a) => (
              <div key={a.id} className="ev-row" onClick={() => nav(`/analyze/${sel}/call/${a.id}`)}
                style={{ ...card, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: T.mono, color: score100Color(a.composite_score), width: 42 }}>{a.composite_score}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontFamily: T.mono, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.call_id || `#${a.id}`}</span>
              </div>
            ))}
            {worst.length === 0 && <div style={{ color: T.faint, fontSize: 13 }}>No scored calls.</div>}
          </div>
        </div>

        {/* Top improvement themes */}
        <div>
          <div style={{ ...label, marginBottom: 12 }}>Recurring improvement themes</div>
          <div style={{ ...card, padding: 16 }}>
            {(s.top_themes || []).length === 0 && <div style={{ color: T.faint, fontSize: 13 }}>Nothing recurring yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(s.top_themes || []).map((t: { text: string; count: number }, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: 'var(--accent)', background: T.accentSoft, borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>×{t.count}</span>
                  <span style={{ fontSize: 13, color: T.text2, lineHeight: 1.5 }}>{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
