import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, btnPrimary } from '../theme'
import { api } from '../api/client'
import { score100Color } from '../components/analysis'

type Batch = { id: string; name: string | null; direction: string; status: string; flow_name?: string | null; summary_json: any; created_at: string }

export function ScoreboardPage() {
  const nav = useNavigate()
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const load = () => api.listCallBatches().then((bs) => setBatches(bs)).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  useEffect(() => { if (editing) editRef.current?.focus() }, [editing])

  const startRename = (b: Batch) => { setEditing(b.id); setDraftName(b.name || '') }
  const saveRename = async (id: string) => {
    const name = draftName.trim()
    setEditing(null)
    if (!name) return
    setBatches((bs) => bs.map((b) => (b.id === id ? { ...b, name } : b)))
    try { await api.renameCallBatch(id, name) } catch { load() }
  }
  const doDelete = async (id: string) => {
    setConfirmDel(null)
    setBatches((bs) => bs.filter((b) => b.id !== id))
    try { await api.deleteCallBatch(id) } catch { load() }
  }

  const fmtDate = (s: string) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Scoreboard</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>Every test run you've analyzed. Open one to see its full metrics.</p>

      {loading ? (
        <div style={{ color: T.faint, fontSize: 13, marginTop: 24 }}>Loading…</div>
      ) : batches.length === 0 ? (
        <div style={{ marginTop: 24, border: `1px dashed ${T.border2}`, borderRadius: 18, padding: '68px 24px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 22px', borderRadius: 15, background: T.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="12.5" width="3.4" height="7.5" rx="1.3" fill="var(--accent-hi)" />
              <rect x="10.3" y="7" width="3.4" height="13" rx="1.3" fill="var(--accent-hi)" />
              <rect x="16.6" y="10" width="3.4" height="10" rx="1.3" fill="var(--accent-hi)" />
            </svg>
          </div>
          <div style={{ fontSize: 21, fontWeight: 650, color: T.text }}>No calls analyzed yet</div>
          <div style={{ fontSize: 14, color: T.muted, margin: '10px auto 0', maxWidth: 430, lineHeight: 1.55 }}>
            Upload a batch of real transcripts and this board fills in — averages, weak spots, and the calls worth listening to again.
          </div>
          <button onClick={() => nav('/analyze')} style={{ ...btnPrimary, marginTop: 24 }}>Analyze your first batch</button>
        </div>
      ) : (
        <div style={{ ...card, overflow: 'hidden', marginTop: 22 }}>
          {/* header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 90px 150px 84px', gap: 12, padding: '11px 18px', borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.muted }}>
            <span>Test run</span><span>Flow</span><span>Calls</span><span>Composite</span><span>When</span><span></span>
          </div>
          {batches.map((b) => {
            const comp = b.summary_json?.composite_mean ?? null
            const n = b.summary_json?.n_scored ?? 0
            const scoring = b.status === 'scoring'
            return (
              <div key={b.id} className="ev-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 90px 150px 84px', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${T.divider}`, alignItems: 'center', cursor: editing === b.id ? 'default' : 'pointer' }}
                onClick={() => { if (editing !== b.id && !confirmDel) nav(`/scoreboard/${b.id}`) }}>
                {/* name (rename inline) */}
                <div style={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                  {editing === b.id ? (
                    <input ref={editRef} value={draftName} onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => saveRename(b.id)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(b.id); if (e.key === 'Escape') setEditing(null) }}
                      style={{ width: '100%', padding: '6px 9px', borderRadius: 8, background: T.well, border: `1px solid var(--accent)`, color: T.text, fontSize: 13.5, outline: 'none' }} />
                  ) : (
                    <div onClick={() => nav(`/scoreboard/${b.id}`)} style={{ fontSize: 13.5, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name || b.id}
                      {scoring && <span style={{ marginLeft: 8, fontSize: 11, color: T.blue }}>· scoring…</span>}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12.5, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.flow_name || b.direction}</span>
                <span style={{ fontSize: 13, fontFamily: T.mono, color: T.text3 }}>{n}</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: score100Color(comp) }}>{comp ?? '—'}</span>
                <span style={{ fontSize: 12, color: T.faint }}>{fmtDate(b.created_at)}</span>
                {/* actions */}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                  {confirmDel === b.id ? (
                    <>
                      <button onClick={() => doDelete(b.id)} title="Confirm delete" style={iconBtn(T.red)}>✓</button>
                      <button onClick={() => setConfirmDel(null)} title="Cancel" style={iconBtn(T.faint)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startRename(b)} title="Rename" style={iconBtn(T.muted)}>✎</button>
                      <button onClick={() => setConfirmDel(b.id)} title="Delete" style={iconBtn(T.muted)}>🗑</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const iconBtn = (color: string): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.border2}`, background: T.surface2,
  color, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
})
