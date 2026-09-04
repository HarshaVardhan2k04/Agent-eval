import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, btnPrimary } from '../../theme'
import { score100Color, ScoreRing } from '../../components/analysis'
import { RunStatusChip, RunDuration } from '../../components/forge'
import { useForgeStore, type ForgeRunSummary } from '../../stores/forgeStore'


const LIVE = new Set(['collecting', 'optimizing'])

export function ForgeListPage() {
  const nav = useNavigate()
  const { runs, fetchRuns, renameRun, deleteRun } = useForgeStore()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchRuns().finally(() => setLoading(false)) }, [fetchRuns])
  useEffect(() => { if (editing) editRef.current?.focus() }, [editing])

  const FILTERS: { key: string; label: string; match: (r: ForgeRunSummary) => boolean }[] = [
    { key: 'all', label: 'All', match: () => true },
    { key: 'active', label: 'Active', match: (r) => LIVE.has(r.status) || r.status === 'awaiting_human' },
    { key: 'llm_complete', label: 'LLM-complete', match: (r) => r.status === 'llm_complete' || r.status === 'converged_below_gate' },
    { key: 'review', label: 'In review', match: (r) => r.status === 'human_review' },
    { key: 'finalized', label: 'Finalized', match: (r) => r.status === 'finalized' },
  ]

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0]
    const q = search.trim().toLowerCase()
    return runs.filter((r) => f.match(r) && (!q || (r.name || '').toLowerCase().includes(q) || r.id.toLowerCase().includes(q)))
  }, [runs, filter, search]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowClick = (r: ForgeRunSummary) => {
    if (editing === r.id || confirmDel) return
    if (LIVE.has(r.status)) nav(`/forge/${r.id}/progress`)
    else if (r.status === 'awaiting_human' || r.status === 'human_review') nav(`/forge/${r.id}/review`)
    else nav(`/forge/${r.id}/results`)
  }

  const saveRename = async (id: string) => {
    const name = draftName.trim()
    setEditing(null)
    if (name) await renameRun(id, name)
  }

  const fmtDate = (s: string) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Forge runs</h1>
          <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>
            Optimize a voice-agent prompt end-to-end, then hand it to a human.
          </p>
        </div>
        <button onClick={() => nav('/forge/new')} style={btnPrimary}>+ New run</button>
      </div>

      {/* filters + search */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{
              padding: '6px 14px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer',
              border: `1px solid ${filter === f.key ? 'var(--accent)' : T.border2}`,
              background: filter === f.key ? T.accentSoft : 'transparent',
              color: filter === f.key ? T.text : T.muted, fontWeight: filter === f.key ? 600 : 500,
            }}>{f.label}</button>
        ))}
        {/* same search pill as the Evaluations page — magnifier + name/ID search */}
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

      {loading ? (
        <div style={{ color: T.faint, fontSize: 13, marginTop: 24 }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={{ marginTop: 24, border: `1px dashed ${T.border2}`, borderRadius: 18, padding: '64px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 21, fontWeight: 650, color: T.text }}>No runs yet</div>
          <div style={{ fontSize: 14, color: T.muted, margin: '10px auto 0', maxWidth: 440, lineHeight: 1.55 }}>
            Give Forge a prompt (standalone or layered), a dataset, and it will iterate against the problem
            matrix until the LLM judge can't improve it — then hand it to you.
          </div>
          <button onClick={() => nav('/forge/new')} style={{ ...btnPrimary, marginTop: 22 }}>Start your first run</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {filtered.map((r) => (
            <div key={r.id} className="ev-row" onClick={() => rowClick(r)}
              style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', borderLeft: `3px solid ${score100Color(r.solved_pct)}` }}>
              <ScoreRing value={r.solved_pct} size={46} />
              <div style={{ flex: 1, minWidth: 0 }} onClick={(e) => { if (editing === r.id) e.stopPropagation() }}>
                {editing === r.id ? (
                  <input ref={editRef} value={draftName} onChange={(e) => setDraftName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => saveRename(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(r.id); if (e.key === 'Escape') setEditing(null) }}
                    style={{ width: '100%', maxWidth: 380, padding: '6px 9px', borderRadius: 8, background: T.well, border: `1px solid var(--accent)`, color: T.text, fontSize: 13.5, outline: 'none' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name || r.id}
                    </span>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                      background: (r.mode === 'layered' ? T.purple : T.muted) + '22',
                      color: r.mode === 'layered' ? T.purple : T.muted,
                    }}>{r.mode}</span>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.fainter }}>{r.id}</span>
                  </div>
                )}
                <div style={{ fontSize: 12, color: T.faint, marginTop: 3 }}>
                  {fmtDate(r.created_at)} · v{r.current_version} · {r.dataset_kind || '—'} dataset{' · '}
                  <RunDuration createdAt={r.created_at} completedAt={r.completed_at} live={LIVE.has(r.status)} />
                  {r.vertical ? ` · ${r.vertical}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: T.mono, color: score100Color(r.final_composite) }}>
                  {r.final_composite ?? '—'}
                </div>
                <div style={{ fontSize: 10.5, color: T.fainter, textTransform: 'uppercase', letterSpacing: '0.05em' }}>composite</div>
              </div>
              <RunStatusChip status={r.status} />
              <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                {confirmDel === r.id ? (
                  <>
                    <button onClick={() => { setConfirmDel(null); deleteRun(r.id) }} title="Confirm delete" style={iconBtn(T.red)}>✓</button>
                    <button onClick={() => setConfirmDel(null)} title="Cancel" style={iconBtn(T.faint)}>✕</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditing(r.id); setDraftName(r.name || '') }} title="Rename" style={iconBtn(T.muted)}>✎</button>
                    <button onClick={() => setConfirmDel(r.id)} title="Delete" style={iconBtn(T.muted)}>🗑</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ ...card, padding: 30, textAlign: 'center', color: T.faint, fontSize: 13 }}>No runs match.</div>
          )}
        </div>
      )}
    </div>
  )
}

const iconBtn = (color: string): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.border2}`, background: T.surface2,
  color, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
})
