import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { T, card, backBtn } from '../../theme'
import { api } from '../../api/client'
import { SimTranscript, ToolCallsStrip, type SimRow } from '../../components/forge'
import { useForgeStore } from '../../stores/forgeStore'

// The full conversation archive of a run — literally everything both LLMs said,
// filterable, with the failing turn highlighted per graded sim.
export function ForgeSimsPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { problems, fetchProblems, currentRun, fetchRun } = useForgeStore()
  const [sp] = useSearchParams()
  const [sims, setSims] = useState<SimRow[]>([])
  const [kind, setKind] = useState(sp.get('kind') || '')
  const [pid, setPid] = useState(sp.get('problem_id') || '')
  const [verdict, setVerdict] = useState(sp.get('verdict') || '')
  const [openUid, setOpenUid] = useState<string | null>(null)
  const [full, setFull] = useState<Record<string, SimRow>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchProblems(); if (id) fetchRun(id) }, [fetchProblems, fetchRun, id])
  const runLive = currentRun && currentRun.id === id && ['optimizing', 'collecting'].includes(currentRun.status)
  useEffect(() => {
    if (!id) return
    setLoading(true)
    const f: Record<string, string> = {}
    if (kind) f.kind = kind
    if (pid) f.problem_id = pid
    if (verdict) f.verdict = verdict
    api.listForgeSims(id, f).then((rows: SimRow[]) => { setSims(rows); setLoading(false) }).catch(() => setLoading(false))
  }, [id, kind, pid, verdict])

  const toggle = (uid: string) => {
    if (openUid === uid) return setOpenUid(null)
    setOpenUid(uid)
    if (!full[uid]) api.getForgeSim(uid).then((row: SimRow) => setFull((m) => ({ ...m, [uid]: row })))
  }

  const behaviourOf = (p: string | null) => (p && problems.find((x) => x.id === p)?.behaviour) || ''
  const pids = useMemo(() => Array.from(new Set(sims.map((s) => s.problem_id).filter(Boolean))) as string[], [sims])
  // a tool check's verdict lives in check_verdict ('called' = pass), a problem
  // sim's in verdict — fold both so the header counts every conversation.
  const passed = (s: SimRow) => s.verdict === 'pass' || s.check_verdict === 'called'
  const failed = (s: SimRow) => s.verdict === 'fail'
    || (s.check_verdict != null && s.check_verdict !== 'called')
  const counts = useMemo(() => ({
    total: sims.length,
    fail: sims.filter(failed).length,
    pass: sims.filter(passed).length,
  }), [sims])

  const sel: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 9, border: `1px solid ${T.border2}`,
    background: T.surface2, color: T.text2, fontSize: 12.5,
  }

  return (
    <div>
      <button onClick={() => nav(runLive ? `/forge/${id}/progress` : `/forge/${id}/results`)} style={backBtn}>
        {runLive ? '← Back to progress' : '← Back to results'}
      </button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 650, margin: 0, color: T.text }}>Simulations</h1>
        <span style={{ fontSize: 13, color: T.muted }}>
          {counts.total} conversations · <span style={{ color: T.green }}>{counts.pass} pass</span> · <span style={{ color: T.red }}>{counts.fail} fail</span>
        </span>
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={sel}>
          <option value="">all kinds</option>
          <option value="dataset">dataset conversations</option>
          <option value="toolcheck">tool checks</option>
          <option value="detector">problem checks</option>
          <option value="deep_confirm">deep-confirm</option>
          <option value="stress">stress sims</option>
          <option value="deepeval">deepeval</option>
        </select>
        <select value={pid} onChange={(e) => setPid(e.target.value)} style={sel}>
          <option value="">all problems</option>
          {pids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((p) => (
            <option key={p} value={p}>{p} — {behaviourOf(p).slice(0, 40)}</option>
          ))}
        </select>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)} style={sel}>
          <option value="">all verdicts</option>
          <option value="fail">fail only</option>
          <option value="pass">pass only</option>
        </select>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '40px 110px 60px 1fr 56px minmax(160px,0.6fr)', gap: 10, padding: '8px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
          <span /><span>Kind</span><span>Ref</span><span>Scenario</span><span>Turns</span><span>Reason</span>
        </div>
        {sims.map((s, i) => (
          <div key={s.sim_uid}>
            <div className="ev-row" onClick={() => toggle(s.sim_uid)}
              style={{ display: 'grid', gridTemplateColumns: '40px 110px 60px 1fr 56px minmax(160px,0.6fr)', gap: 10, alignItems: 'center', padding: '7px 14px', cursor: 'pointer', background: openUid === s.sim_uid ? T.chip : i % 2 ? T.well : 'transparent', borderTop: `1px solid ${T.divider}` }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: failed(s) ? T.red : passed(s) ? T.green : T.fainter, textAlign: 'center' }}>
                {failed(s) ? '✕' : passed(s) ? '✓' : '·'}
              </span>
              <span style={{ fontSize: 11.5, color: T.muted }}>{s.kind === 'deep_confirm' ? 'deep-confirm' : s.kind}</span>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>{s.problem_id || `#${(s.idx ?? 0) + 1}`}</span>
              <span style={{ fontSize: 12.5, color: T.text3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.problem_id ? behaviourOf(s.problem_id) : s.probe || '—'}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fainter }}>
                {s.n_turns ?? '—'}{s.n_tools ? ` · ${s.n_tools}🔧` : ''}
                {s.n_leaks ? <span style={{ color: T.red }}> · {s.n_leaks}⚠</span> : null}
              </span>
              <span style={{ fontSize: 11.5, color: failed(s) ? T.red : T.fainter, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.reason || (s.check_verdict === 'called' ? 'tool called correctly'
                  : s.check_verdict === 'spoken_only' ? 'spoke the tool name — never called it'
                  : s.check_verdict === 'not_called' ? 'tool never called' : '')}
              </span>
            </div>
            {openUid === s.sim_uid && (
              <div style={{ padding: '14px 20px', background: T.well, borderTop: `1px solid ${T.divider}` }}>
                {full[s.sim_uid]?.transcript_json
                  ? (<>
                      <SimTranscript transcript={full[s.sim_uid].transcript_json!} failingTurn={full[s.sim_uid].failing_turn} />
                      <ToolCallsStrip calls={full[s.sim_uid].tool_calls_json}
                        leaks={full[s.sim_uid].tool_leaks_json} summary={full[s.sim_uid].tool_summary_json} />
                    </>)
                  : <div style={{ color: T.faint, fontSize: 12.5 }}>Loading conversation…</div>}
              </div>
            )}
          </div>
        ))}
        {!loading && sims.length === 0 && (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: T.fainter, fontSize: 13 }}>
            No stored conversations{kind || pid || verdict ? ' for these filters' : ' — this run predates the simulation archive'}.
          </div>
        )}
      </div>
    </div>
  )
}
