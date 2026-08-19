import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, backBtn } from '../../theme'
import { api } from '../../api/client'
import { useForgeStore, type GlobalProblem } from '../../stores/forgeStore'
import { LayerBadge, VerdictCell, LAYER_COLORS } from '../../components/forge'

type MatrixRow = { version: number; status: string; statuses_json: Record<string, { verdict: string; evidence?: string }> }

const COLS = '46px 1.4fr 96px 84px 2.3fr 74px'

// /forge/matrix (global only) and /forge/:id/matrix (global + this run's grid). Wide layout.
export function ForgeMatrixPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const { problems, fetchProblems, patchProblem } = useForgeStore()
  const [tab, setTab] = useState<'global' | 'run'>(id ? 'run' : 'global')
  const [grid, setGrid] = useState<MatrixRow[]>([])
  const [selPid, setSelPid] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'id' | 'layer' | 'autotest'>('id')
  const [adding, setAdding] = useState(false)
  const [newProblem, setNewProblem] = useState({ id: '', behaviour: '', layer_for_fix: 'universal' })

  useEffect(() => { fetchProblems() }, [fetchProblems])
  useEffect(() => { if (id) api.getForgeMatrix(id).then(setGrid).catch(() => {}) }, [id])

  const versions = grid.map((g) => g.version)
  const gridPids = useMemo(() => {
    const set = new Set<string>()
    grid.forEach((g) => Object.keys(g.statuses_json || {}).forEach((p) => set.add(p)))
    return [...set].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  }, [grid])
  const problemOf = (pid: string) => problems.find((p) => p.id === pid)
  const howSolved = useMemo(() => {
    if (!selPid) return null
    for (const g of grid) {
      if (g.statuses_json?.[selPid]?.verdict === 'Y') {
        return { version: g.version, evidence: g.statuses_json[selPid].evidence || '', lever: problemOf(selPid)?.winning_lever || '' }
      }
    }
    return { version: null, evidence: '', lever: problemOf(selPid)?.winning_lever || '' }
  }, [selPid, grid, problems]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = !q ? [...problems] : problems.filter((p) =>
      p.id.includes(q) || (p.behaviour || '').toLowerCase().includes(q) ||
      (p.winning_lever || '').toLowerCase().includes(q) || (p.layer_for_fix || '').includes(q))
    const num = (p: GlobalProblem) => Number(p.id.slice(1)) || 0
    if (sortBy === 'layer') {
      // campaign first, universal at the bottom
      const order: Record<string, number> = { campaign: 0, vertical: 1, universal: 2 }
      list.sort((a, b) => (order[a.layer_for_fix || ''] ?? 3) - (order[b.layer_for_fix || ''] ?? 3) || num(a) - num(b))
    } else if (sortBy === 'autotest') {
      list.sort((a, b) => Number(b.has_detector) - Number(a.has_detector) || num(a) - num(b))
    } else {
      list.sort((a, b) => num(a) - num(b))
    }
    return list
  }, [problems, search, sortBy])

  const addProblem = async () => {
    if (!newProblem.id.trim() || !newProblem.behaviour.trim()) return
    await api.createForgeProblem(newProblem)
    setAdding(false)
    setNewProblem({ id: '', behaviour: '', layer_for_fix: 'universal' })
    fetchProblems()
  }

  return (
    <div>
      {id && <button onClick={() => nav(`/forge/${id}/results`)} style={backBtn}>← Back to results</button>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>Problem matrix</h1>
        <div style={{ display: 'inline-flex', background: T.well, borderRadius: 12, padding: 3, border: `1px solid ${T.border}` }}>
          {([['global', 'Global library'], ...(id ? [['run', 'This run']] : [])] as [string, string][]).map(([v, lbl]) => (
            <button key={v} onClick={() => setTab(v as 'global' | 'run')}
              style={{
                padding: '7px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5,
                background: tab === v ? T.surface2 : 'transparent', color: tab === v ? T.text : T.muted, fontWeight: tab === v ? 600 : 500,
              }}>{lbl}</button>
          ))}
        </div>
        {tab === 'global' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div title="Sort" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.well, borderRadius: 10, padding: '3px 4px 3px 10px', border: `1px solid ${T.border}` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: T.faint }}>
                <path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" />
              </svg>
              {([['id', 'ID'], ['layer', 'Layer'], ['autotest', 'Auto-test']] as ['id' | 'layer' | 'autotest', string][]).map(([v, lbl]) => (
                <button key={v} onClick={() => setSortBy(v)}
                  title={v === 'layer' ? 'campaign → vertical → universal (universal at the bottom)' : undefined}
                  style={{
                    padding: '5px 11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                    background: sortBy === v ? T.surface2 : 'transparent',
                    color: sortBy === v ? T.text : T.muted, fontWeight: sortBy === v ? 600 : 500,
                  }}>{lbl}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search problems…"
              style={{ padding: '7px 13px', borderRadius: 99, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13, outline: 'none', width: 190 }} />
          </div>
        )}
      </div>

      {tab === 'global' ? (
        <>
          <div style={{ ...card, marginTop: 14, overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '9px 14px', borderBottom: `1px solid ${T.divider}`, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.muted }}>
                <span>ID</span><span>Behaviour</span><span>Layer</span><span>Category</span><span>Winning lever / how solved</span>
                <span title="Does Forge have an automated behavioural test for this problem? Auto-tested problems are scripted, scored and verdicted Y/N/~ on every version and count in the 95% gate. Without one, the problem is catalog knowledge only.">Auto-test</span>
              </div>
              {shown.map((p) => <ProblemRow key={p.id} p={p} onPatch={patchProblem} />)}
              {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: T.faint, fontSize: 13 }}>No problems match.</div>}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {adding ? (
              <div style={{ ...card, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={newProblem.id} onChange={(e) => setNewProblem({ ...newProblem, id: e.target.value })} placeholder="id (e.g. p42)"
                  style={{ ...inputStyle, width: 100, fontFamily: T.mono }} />
                <input value={newProblem.behaviour} onChange={(e) => setNewProblem({ ...newProblem, behaviour: e.target.value })} placeholder="behaviour description"
                  style={{ ...inputStyle, flex: 1, minWidth: 260 }} />
                <select value={newProblem.layer_for_fix} onChange={(e) => setNewProblem({ ...newProblem, layer_for_fix: e.target.value })} style={{ ...inputStyle, width: 130 }}>
                  {['universal', 'vertical', 'campaign'].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={addProblem} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: T.accentGrad, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                <button onClick={() => setAdding(false)} style={{ padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.border2}`, background: 'transparent', color: T.muted, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)}
                style={{ padding: '8px 15px', borderRadius: 10, border: `1px dashed ${T.border2}`, background: 'transparent', color: T.muted, fontSize: 13, cursor: 'pointer' }}>
                + Add problem
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginTop: 14, alignItems: 'start' }}>
          <div style={{ ...card, overflowX: 'auto' }}>
            {grid.length === 0 ? (
              <div style={{ padding: 26, fontSize: 13, color: T.faint }}>No scored versions yet.</div>
            ) : (
              <table style={{ borderCollapse: 'collapse', minWidth: 420, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>problem</th>
                    {versions.map((v) => <th key={v} style={thStyle}>v{v}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {gridPids.map((pid) => {
                    const p = problemOf(pid)
                    return (
                      <tr key={pid} onClick={() => setSelPid(pid)} style={{ cursor: 'pointer', background: selPid === pid ? T.accentSoft : 'transparent' }}>
                        <td style={{ padding: '5px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text3, marginRight: 8 }}>{pid}</span>
                          <LayerBadge layer={p?.layer_for_fix} />
                          <span style={{ fontSize: 12, color: T.muted, marginLeft: 10 }}>{p?.behaviour?.slice(0, 60)}</span>
                        </td>
                        {versions.map((v) => {
                          const cell = grid.find((g) => g.version === v)?.statuses_json?.[pid]
                          return (
                            <td key={v} style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <VerdictCell verdict={cell?.verdict ?? null} title={cell?.evidence} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ ...card, padding: 14, position: 'sticky', top: 20 }}>
            <div style={{ ...label, marginBottom: 10 }}>How it was solved</div>
            {selPid ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.text }}>{selPid}</span>
                  <LayerBadge layer={problemOf(selPid)?.layer_for_fix} />
                </div>
                <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, marginBottom: 10 }}>{problemOf(selPid)?.behaviour}</div>
                {howSolved?.version != null
                  ? <div style={{ fontSize: 12.5, color: T.green, marginBottom: 8 }}>First solved at v{howSolved.version}</div>
                  : <div style={{ fontSize: 12.5, color: T.amber, marginBottom: 8 }}>Not yet solved in this run</div>}
                {howSolved?.lever && (
                  <pre style={{ margin: 0, background: T.well, borderRadius: 10, padding: '9px 11px', fontSize: 11.5, color: T.text3, lineHeight: 1.5, whiteSpace: 'pre-wrap', fontFamily: T.mono }}>
                    {howSolved.lever}
                  </pre>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: T.faint }}>Click a row to see its lever.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProblemRow({ p, onPatch }: { p: GlobalProblem; onPatch: (pid: string, patch: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const layerCol = LAYER_COLORS[p.layer_for_fix || ''] || T.muted
  const save = (field: string) => {
    setEditing(null)
    if (draft.trim() && draft !== (p as unknown as Record<string, string>)[field]) onPatch(p.id, { [field]: draft.trim() })
  }
  const editable = (field: 'behaviour' | 'winning_lever', value: string | null, fs = 12.5) =>
    editing === field ? (
      <textarea autoFocus defaultValue={value || ''} rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(field)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', borderRadius: 7, background: T.well, border: `1px solid var(--accent)`, color: T.text, fontSize: 12, outline: 'none', resize: 'vertical' }} />
    ) : (
      <span onClick={() => { setEditing(field); setDraft(value || '') }} title="Click to edit"
        style={{ fontSize: fs, color: value ? T.text3 : T.fainter, lineHeight: 1.45, cursor: 'text' }}>
        {value || '—'}
      </span>
    )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '8px 14px', borderBottom: `1px solid ${T.divider}`, alignItems: 'start' }}>
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text2, fontWeight: 600, paddingTop: 2 }}>{p.id}</span>
      <div>{editable('behaviour', p.behaviour)}</div>
      <select value={p.layer_for_fix || ''} onChange={(e) => onPatch(p.id, { layer_for_fix: e.target.value || null })}
        style={{ ...inputStyle, padding: '3px 5px', fontSize: 11.5, width: '100%', fontWeight: 700, color: layerCol, border: `1px solid ${layerCol}55` }}>
        <option value="">—</option>
        {['universal', 'vertical', 'campaign'].map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <span style={{ fontSize: 11.5, color: T.muted, paddingTop: 3 }}>{p.category || '—'}</span>
      <div>{editable('winning_lever', p.how_solved || p.winning_lever, 11.5)}</div>
      <span title={p.has_detector
          ? 'Forge auto-tests this problem on every version (scripted conversation → Y/N/~ verdict). Counts in the 95% gate.'
          : 'No automated test yet — catalog knowledge only. Excluded from the auto-gate until a detector is built.'}
        style={{ fontSize: 11, color: p.has_detector ? T.green : T.fainter, cursor: 'help', paddingTop: 3, whiteSpace: 'nowrap' }}>
        {p.has_detector ? '✓ auto' : 'no test'}
      </span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 11px', borderRadius: 9, background: T.well, border: `1px solid ${T.border2}`,
  color: T.text, fontSize: 13, outline: 'none',
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: T.muted, textAlign: 'center', borderBottom: `1px solid ${T.divider}`, position: 'sticky', top: 0, background: T.surface,
}
