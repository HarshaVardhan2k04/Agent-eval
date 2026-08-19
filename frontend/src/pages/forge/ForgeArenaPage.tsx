import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, btnPrimary, backBtn } from '../../theme'
import { api } from '../../api/client'
import { score100Color, METRIC_LABELS } from '../../components/analysis'
import { RunStatusChip, VerdictCell, ProofPanel } from '../../components/forge'
import { useForgeStore } from '../../stores/forgeStore'

type Contestant = { label: string; base_url: string; model: string; api_key?: string; prompt: string; run_id?: string }
type ArenaRun = { id: string; name: string; status: string; solved_pct: number | null; final_composite: number | null }
type Ranking = { run_id: string; deepeval_avg: number | null; composite: number | null; solved_pct: number | null }
type Arena = {
  id: string; name: string; status: string; dataset_id: string; winner_run_id: string | null
  contestants_json: Contestant[]; ranking_json?: Ranking[]; created_at: string
  runs?: ArenaRun[]; detail?: Record<string, {
    statuses: Record<string, { verdict: string; evidence?: string }>
    metrics: Record<string, number | null> | null
    activity?: { phase: string; done: number; total: number; problem_id?: string; probe?: string; verdict?: string | null; at: string } | null
    latency?: { avg_ms: number; p50_ms: number; p99_ms: number; n_turns: number
      tokens_avg?: number | null; long_turn_pct?: number | null
      detail: { probe: string; turns: { ms: number; tokens?: number | null; text: string }[] }[] } | null
  }>
}

// Each contestant gets a stable identity color across every panel.
const C_COLORS = ['#5b9dff', '#9b7dff', '#4cc98a', '#f0a83c', '#ec5a54', '#3dd6d0']

// /forge/arena (list + 2-step create with judge confirm) and /forge/arena/:id (compare).
export function ForgeArenaPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id?: string }>()
  return id ? <ArenaDetail id={id} nav={nav} /> : <ArenaList nav={nav} />
}

function ArenaList({ nav }: { nav: (p: string) => void }) {
  const [arenas, setArenas] = useState<Arena[]>([])
  const [creating, setCreating] = useState(false)
  useEffect(() => { api.listForgeArenas().then(setArenas).catch(() => {}) }, [])
  const remove = async (e: React.MouseEvent, a: Arena) => {
    e.stopPropagation()
    if (!window.confirm(`Delete "${a.name}" and all its runs, conversations and results?`)) return
    try {
      await api.deleteForgeArena(a.id)
      setArenas((xs) => xs.filter((x) => x.id !== a.id))
    } catch { /* leave the row */ }
  }
  const fmt = (s: string) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 650, margin: 0, color: T.text }}>LLM Arena</h1>
          <p style={{ fontSize: 13.5, color: T.muted, margin: '6px 0 0' }}>
            Choose your LLMs, give each its own prompt, and let the deepeval battery decide — first pass only, fixed judge.
          </p>
        </div>
        {!creating && <button onClick={() => setCreating(true)} style={btnPrimary}>+ New arena</button>}
      </div>
      {creating ? <ArenaCreate nav={nav} onCancel={() => setCreating(false)} /> : (
        <div style={{ ...card, marginTop: 16, overflow: 'hidden' }}>
          {arenas.map((a, i) => (
            <div key={a.id} className="ev-row" onClick={() => nav(`/forge/arena/${a.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: i < arenas.length - 1 ? `1px solid ${T.divider}` : 'none' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{a.name}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                {(a.contestants_json || []).map((c, j) => (
                  <span key={j} title={c.label} style={{ width: 9, height: 9, borderRadius: 99, background: C_COLORS[j % C_COLORS.length] }} />
                ))}
              </span>
              <span style={{ fontSize: 11.5, color: T.fainter }}>{fmt(a.created_at)}</span>
              <span style={{ marginLeft: 'auto' }} />
              {a.winner_run_id && (
                <span style={{ fontSize: 12, color: T.green }}>
                  🏆 {(a.contestants_json || []).find((c) => c.run_id === a.winner_run_id)?.label}
                </span>
              )}
              <RunStatusChip status={a.status === 'complete' ? 'finalized' : a.status === 'running' ? 'optimizing' : a.status}
                label={a.status === 'complete' ? 'Complete' : a.status === 'running' ? 'Testing' : undefined} />
              <button onClick={(e) => remove(e, a)} title="Delete this arena (runs, conversations and results included)"
                style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border2}`, background: 'transparent', color: T.faint, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</button>
            </div>
          ))}
          {arenas.length === 0 && (
            <div style={{ padding: '44px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 650, color: T.text }}>No arenas yet</div>
              <div style={{ fontSize: 13, color: T.muted, marginTop: 7 }}>Select N LLMs, give each its prompt, pick a dataset — the battery decides.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ArenaCreate({ nav, onCancel }: { nav: (p: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [llms, setLlms] = useState<Contestant[]>([
    { label: '', base_url: '', model: '', api_key: '', prompt: '' },
    { label: '', base_url: '', model: '', api_key: '', prompt: '' },
  ])
  const [datasets, setDatasets] = useState<{ id: string; name: string; n: number }[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [battery, setBattery] = useState(false) // default: single pass — no retries
  const [confirmVotes, setConfirmVotes] = useState(30)
  const [stress, setStress] = useState(24)
  const [judgeModal, setJudgeModal] = useState(false)
  const [defaultJudge, setDefaultJudge] = useState<{ base_url?: string; model?: string }>({})
  const [changeJudge, setChangeJudge] = useState(false)
  const [judge, setJudge] = useState({ base_url: '', model: '', api_key: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // pre-flight per row: send "hi" to the endpoint before the prompt step
  type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string; ms?: number }
  const [tests, setTests] = useState<Record<number, TestState>>({})
  // per-row request parameters (thinking level, max_tokens, ...) sent verbatim with
  // every call this contestant makes — and with its pre-flight test.
  type CParams = { max_tokens?: string; temperature?: string; thinking?: string; extra?: string }
  const [cparams, setCparams] = useState<Record<number, CParams>>({})
  const [paramsOpen, setParamsOpen] = useState<number | null>(null)
  const updParams = (i: number, patch: Partial<CParams>) => {
    setCparams((ps) => ({ ...ps, [i]: { ...ps[i], ...patch } }))
    setTests((t) => ({ ...t, [i]: { status: 'idle' } })) // request shape changed
  }
  const buildParams = (i: number): Record<string, unknown> | undefined => {
    const p = cparams[i] || {}
    const out: Record<string, unknown> = {}
    if (p.max_tokens?.trim()) out.max_tokens = parseInt(p.max_tokens, 10)
    if (p.temperature?.trim()) out.temperature = parseFloat(p.temperature)
    if (p.thinking && p.thinking !== 'default')
      out.reasoning = p.thinking === 'off' ? { enabled: false } : { effort: p.thinking }
    if (p.extra?.trim()) {
      try { Object.assign(out, JSON.parse(p.extra)) } catch { /* shown invalid in UI */ }
    }
    return Object.keys(out).length ? out : undefined
  }
  const paramsSummary = (i: number) => {
    const o = buildParams(i)
    return o ? Object.keys(o).join(', ') : ''
  }

  useEffect(() => { api.listForgeDatasets().then(setDatasets).catch(() => {}) }, [])
  useEffect(() => { api.llmInfo().then(setDefaultJudge).catch(() => {}) }, [])

  const upd = (i: number, patch: Partial<Contestant>) => {
    setLlms((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    // connection fields changed → the old test result no longer proves anything
    if ('base_url' in patch || 'api_key' in patch || 'model' in patch)
      setTests((t) => ({ ...t, [i]: { status: 'idle' } }))
  }
  const testRow = async (i: number) => {
    const c = llms[i]
    if (!c.base_url.trim() || !c.model.trim()) return false
    setTests((t) => ({ ...t, [i]: { status: 'testing' } }))
    try {
      const r = await api.testArenaLlm({ base_url: c.base_url.trim(), api_key: c.api_key || undefined, model: c.model.trim(), params: buildParams(i) })
      setTests((t) => ({ ...t, [i]: r.ok ? { status: 'ok', msg: r.reply, ms: r.ms } : { status: 'fail', msg: r.error, ms: r.ms } }))
      return r.ok
    } catch (e) {
      setTests((t) => ({ ...t, [i]: { status: 'fail', msg: e instanceof Error ? e.message : 'request failed' } }))
      return false
    }
  }
  const verifyAndNext = async () => {
    // said "hi" to every LLM; only advance to prompts when every one answers
    const oks = await Promise.all(llms.map((_, i) => (tests[i]?.status === 'ok' ? Promise.resolve(true) : testRow(i))))
    if (oks.every(Boolean)) setStep(2)
  }
  const anyTesting = Object.values(tests).some((t) => t.status === 'testing')
  const rosterReady = llms.length >= 2 && llms.every((c) => c.label.trim() && c.base_url.trim() && c.model.trim())
  const promptsReady = rosterReady && datasetId && llms.every((c) => c.prompt.trim().length > 20)

  const launch = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || null, dataset_id: datasetId,
        contestants: llms.map((c, i) => ({ ...c, params: buildParams(i) || null })),
        scoring: battery
          ? { single_pass: false, votes: 3, confirm_votes: confirmVotes, best_of_n: 2, stress_target: stress }
          : { single_pass: true },
      }
      if (changeJudge && judge.base_url.trim() && judge.model.trim()) body.judge = judge
      const r = await api.createForgeArena(body)
      nav(`/forge/arena/${r.arena_id}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); setJudgeModal(false) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {([[1, 'Choose your LLMs'], [2, 'Give each its prompt']] as [1 | 2, string][]).map(([n, lbl]) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11.5, fontWeight: 700, background: step >= n ? 'var(--accent)' : T.chip, color: step >= n ? '#fff' : T.faint,
            }}>{n}</span>
            <span style={{ fontSize: 12.5, color: step === n ? T.text : T.faint, fontWeight: step === n ? 600 : 500 }}>{lbl}</span>
            {n === 1 && <span style={{ width: 30, height: 1, background: T.border2 }} />}
          </div>
        ))}
      </div>

      {step === 1 ? (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '30px 150px 1fr 150px 190px 64px 76px 34px', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${T.divider}`, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.muted }}>
              <span /><span>Label</span><span>Base URL</span><span>API key</span><span>Model id</span><span>Params</span><span>Test</span><span />
            </div>
            {llms.map((c, i) => {
              const ts = tests[i] || { status: 'idle' as const }
              return (
              <div key={i} style={{ borderBottom: `1px solid ${T.divider}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '30px 150px 1fr 150px 190px 64px 76px 34px', gap: 10, padding: '8px 14px', alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: C_COLORS[i % C_COLORS.length] }} />
                  <input value={c.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Gemma-27B" style={inp} />
                  <input value={c.base_url} onChange={(e) => upd(i, { base_url: e.target.value })} placeholder="http://host:8000/v1" style={inp} />
                  <input value={c.api_key || ''} onChange={(e) => upd(i, { api_key: e.target.value })} placeholder="optional" type="password" style={inp} />
                  <input value={c.model} onChange={(e) => upd(i, { model: e.target.value })} placeholder="/models/…" style={inp} />
                  <button onClick={() => setParamsOpen(paramsOpen === i ? null : i)}
                    title={paramsSummary(i) ? `overrides: ${paramsSummary(i)}` : 'request parameters (thinking, max tokens, …)'}
                    style={{ padding: '5px 0', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                             border: `1px solid ${paramsOpen === i || paramsSummary(i) ? 'var(--accent)' : T.border2}`,
                             background: paramsOpen === i ? 'var(--accent)' : 'transparent',
                             color: paramsOpen === i ? '#fff' : paramsSummary(i) ? 'var(--accent)' : T.muted }}>
                    {'\u2699'}{paramsSummary(i) ? ' \u2022' : ''}
                  </button>
                  <button onClick={() => testRow(i)} disabled={ts.status === 'testing' || !c.base_url.trim() || !c.model.trim()}
                    title={ts.status === 'ok' ? `replied in ${ts.ms}ms` : ts.status === 'fail' ? ts.msg : 'send "hi" to this endpoint'}
                    style={{ padding: '5px 0', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                             border: `1px solid ${ts.status === 'ok' ? T.green : ts.status === 'fail' ? T.red : T.border2}`,
                             background: ts.status === 'ok' ? T.green + '22' : ts.status === 'fail' ? T.red + '22' : 'transparent',
                             color: ts.status === 'ok' ? T.green : ts.status === 'fail' ? T.red : T.muted,
                             opacity: !c.base_url.trim() || !c.model.trim() ? 0.5 : 1 }}>
                    {ts.status === 'testing' ? '…' : ts.status === 'ok' ? `✓ ${ts.ms}ms` : ts.status === 'fail' ? '✕ retry' : 'Test'}
                  </button>
                  {llms.length > 2 ? (
                    <button onClick={() => { setLlms((cs) => cs.filter((_, j) => j !== i)); setTests({}) }}
                      style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border2}`, background: 'transparent', color: T.faint, cursor: 'pointer', fontSize: 11 }}>✕</button>
                  ) : <span />}
                </div>
                {paramsOpen === i && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 14px 10px 54px' }}>
                    <label style={{ fontSize: 11.5, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Thinking
                      <select value={cparams[i]?.thinking || 'default'} onChange={(e) => updParams(i, { thinking: e.target.value })} style={{ ...inp, width: 110 }}>
                        <option value="default">model default</option>
                        <option value="off">off</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 11.5, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Max tokens
                      <input value={cparams[i]?.max_tokens || ''} onChange={(e) => updParams(i, { max_tokens: e.target.value })} placeholder="300" style={{ ...inp, width: 70 }} />
                    </label>
                    <label style={{ fontSize: 11.5, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Temperature
                      <input value={cparams[i]?.temperature || ''} onChange={(e) => updParams(i, { temperature: e.target.value })} placeholder="0.3" style={{ ...inp, width: 60 }} />
                    </label>
                    <label style={{ fontSize: 11.5, color: T.muted, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}>
                      Extra JSON
                      <input value={cparams[i]?.extra || ''} onChange={(e) => updParams(i, { extra: e.target.value })}
                        placeholder={'{"top_p": 0.9}'}
                        style={{ ...inp, flex: 1, fontFamily: T.mono, fontSize: 11.5,
                                 borderColor: cparams[i]?.extra?.trim() && (() => { try { JSON.parse(cparams[i]!.extra!) ; return false } catch { return true } })() ? T.red : undefined }} />
                    </label>
                  </div>
                )}
                {ts.status === 'fail' && (
                  <div style={{ padding: '0 14px 8px 54px', fontSize: 11.5, color: T.red }}>
                    no response: {ts.msg}
                  </div>
                )}
                {ts.status === 'ok' && ts.msg && (
                  <div style={{ padding: '0 14px 8px 54px', fontSize: 11.5, color: T.faint }}>
                    said hi → “{ts.msg}”
                  </div>
                )}
              </div>
            )})}
            <button onClick={() => setLlms((cs) => [...cs, { label: '', base_url: '', model: '', api_key: '', prompt: '' }])}
              style={{ margin: 10, padding: '7px 14px', borderRadius: 9, border: `1px dashed ${T.border2}`, background: 'transparent', color: T.muted, fontSize: 12.5, cursor: 'pointer' }}>
              + Add an LLM
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arena name (optional)" style={{ ...inp, width: 300 }} />
            <span style={{ flex: 1 }} />
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            <button onClick={verifyAndNext} disabled={!rosterReady || anyTesting} style={{ ...btnPrimary, opacity: rosterReady && !anyTesting ? 1 : 0.5 }}>
              {anyTesting ? 'Saying hi to every LLM…' : 'Test all & continue →'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} style={{ ...inp, minWidth: 280 }}>
              <option value="">— pick the dataset every LLM is tested on —</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.n})</option>)}
            </select>
            <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: `1px solid ${T.border2}` }}>
              {([[false, 'Single pass'], [true, 'Full battery']] as [boolean, string][]).map(([v, lbl]) => (
                <button key={lbl} onClick={() => setBattery(v)}
                  title={v ? 'statistical mode: 3 tries per problem + confirmations + stress sims' : 'one conversation per problem, no retries — metrics from the same conversations'}
                  style={{ padding: '7px 13px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                           background: battery === v ? 'var(--accent)' : 'transparent',
                           color: battery === v ? '#fff' : T.muted }}>
                  {lbl}
                </button>
              ))}
            </div>
            {!battery && <span style={{ fontSize: 11.5, color: T.fainter }}>each LLM talks to every dataset persona once — problems are checked inside those conversations</span>}
            {battery && (<>
              <span title="a problem counts as solved only after this many sims pass at ≥90%" style={{ fontSize: 12, color: T.muted }}>confirm</span>
              <input type="number" value={confirmVotes} min={10} max={100} onChange={(e) => setConfirmVotes(Number(e.target.value) || 30)} style={{ ...inp, width: 70 }} />
              <span style={{ fontSize: 12, color: T.muted }}>stress</span>
              <input type="number" value={stress} min={6} max={300} onChange={(e) => setStress(Number(e.target.value) || 24)} style={{ ...inp, width: 70 }} />
            </>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
            {llms.map((c, i) => (
              <div key={i} style={{ ...card, padding: 14, borderTop: `3px solid ${C_COLORS[i % C_COLORS.length]}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: C_COLORS[i % C_COLORS.length] }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.label}</span>
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: T.faint }}>{c.model}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: c.prompt.trim().length > 20 ? T.green : T.faint }}>
                    {c.prompt.trim().length > 20 ? '✓' : 'prompt needed'}
                  </span>
                </div>
                <textarea value={c.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} rows={6}
                  placeholder={`The system prompt ${c.label || 'this LLM'} competes with…`}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, background: T.well, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 12, fontFamily: T.mono, lineHeight: 1.5, outline: 'none', resize: 'vertical' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={() => setStep(1)} style={ghostBtn}>← Back to LLMs</button>
            <span style={{ flex: 1 }} />
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            <button onClick={() => setJudgeModal(true)} disabled={!promptsReady || busy}
              style={{ ...btnPrimary, opacity: promptsReady && !busy ? 1 : 0.5 }}>
              Start the arena →
            </button>
          </div>
        </>
      )}
      {err && <div style={{ fontSize: 12.5, color: T.red }}>{err}</div>}

      {judgeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => !busy && setJudgeModal(false)}>
          <div style={{ ...card, background: T.surface2, padding: 22, width: 480, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>Who judges this arena?</div>
            <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.6 }}>
              The current default judge is
              <span style={{ fontFamily: T.mono, color: 'var(--accent)' }}> {defaultJudge.model || '(engine default)'} </span>
              at <span style={{ fontFamily: T.mono, color: T.muted }}>{defaultJudge.base_url || '—'}</span>.
              It scores every contestant AND plays the simulated customer, so results stay comparable.
            </div>
            {changeJudge && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 13 }}>
                <input value={judge.base_url} onChange={(e) => setJudge({ ...judge, base_url: e.target.value })} placeholder="Judge base URL (…/v1)" style={inp} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={judge.model} onChange={(e) => setJudge({ ...judge, model: e.target.value })} placeholder="Judge model id" style={{ ...inp, flex: 1 }} />
                  <input value={judge.api_key} onChange={(e) => setJudge({ ...judge, api_key: e.target.value })} placeholder="API key (optional)" type="password" style={{ ...inp, width: 150 }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setChangeJudge(!changeJudge)} style={ghostBtn}>
                {changeJudge ? 'Use the default instead' : 'Change judge'}
              </button>
              <span style={{ flex: 1 }} />
              <button onClick={() => setJudgeModal(false)} disabled={busy} style={ghostBtn}>Cancel</button>
              <button onClick={launch} disabled={busy || (changeJudge && (!judge.base_url.trim() || !judge.model.trim()))}
                style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Launching…' : changeJudge ? 'Proceed with new judge' : 'Proceed with default'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ArenaDetail({ id, nav }: { id: string; nav: (p: string) => void }) {
  const [arena, setArena] = useState<Arena | null>(null)
  const [latOpen, setLatOpen] = useState<string | null>(null)
  // proof drawer: which contestant-run + problem the user clicked in the grid
  const [proof, setProof] = useState<{ runId: string; pid: string } | null>(null)
  const { problems, fetchProblems } = useForgeStore()
  useEffect(() => { fetchProblems() }, [fetchProblems])
  useEffect(() => {
    let alive = true
    const tick = () => api.getForgeArena(id).then((a) => { if (alive) setArena(a) }).catch(() => {})
    tick()
    const iv = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(iv) }
  }, [id])

  const pids = useMemo(() => {
    const set = new Set<string>()
    Object.values(arena?.detail || {}).forEach((d) => Object.keys(d.statuses || {}).forEach((p) => set.add(p)))
    return [...set].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  }, [arena])

  if (!arena) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>
  const cs = arena.contestants_json
  const runs = arena.runs || []
  const runOf = (c: Contestant) => runs.find((r) => r.id === c.run_id)
  const colorOf = (c: Contestant) => C_COLORS[cs.indexOf(c) % C_COLORS.length]
  const winner = cs.find((c) => c.run_id === arena.winner_run_id)
  const liveAvg = (c: Contestant) => {
    const m = arena.detail?.[c.run_id || '']?.metrics
    const vals = m ? Object.values(m).filter((v): v is number => typeof v === 'number') : []
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
  }
  const rankOf = (c: Contestant) => {
    const r = (arena.ranking_json || []).find((x) => x.run_id === c.run_id)
    return r || { run_id: c.run_id || '', deepeval_avg: liveAvg(c), composite: null, solved_pct: null }
  }
  const behaviourOf = (pid: string) => problems.find((p) => p.id === pid)?.behaviour || ''
  const solvedCount = (c: Contestant) => {
    const st = arena.detail?.[c.run_id || '']?.statuses || {}
    return { y: Object.values(st).filter((s) => s.verdict === 'Y').length, total: Object.keys(st).length }
  }

  return (
    <div>
      <button onClick={() => nav('/forge/arena')} style={backBtn}>← All arenas</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 650, margin: 0, color: T.text }}>{arena.name}</h1>
        <RunStatusChip status={arena.status === 'complete' ? 'finalized' : 'optimizing'}
          label={arena.status === 'complete' ? 'Complete' : 'Testing'} />
        {arena.status === 'running' && (() => {
          const live = cs.filter((c) => ['optimizing', 'collecting'].includes(runOf(c)?.status || ''))
          if (!live.length) return null
          return (
            <span style={{ fontSize: 12.5, color: T.blue }}>
              {live.length > 1 ? <>testing <b>{live.length} LLMs</b> concurrently</> : <>now testing <b>{live[0].label}</b></>}
            </span>
          )
        })()}
      </div>

      {/* contestant stat strip — dense single-row cards */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`, gap: 10, marginTop: 14 }}>
        {cs.map((c) => {
          const r = runOf(c); const rk = rankOf(c); const sc = solvedCount(c)
          const isWin = arena.winner_run_id === c.run_id
          return (
            <div key={c.run_id} onClick={() => r && nav(`/forge/${r.id}/results`)}
              style={{ ...card, padding: '11px 14px', cursor: 'pointer', borderLeft: `3px solid ${colorOf(c)}`, background: isWin ? T.green + '0c' : T.surface }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.label}</span>
                {isWin && <span style={{ fontSize: 13 }}>🏆</span>}
                <span style={{ marginLeft: 'auto' }}>{r && (
                  <RunStatusChip status={r.status}
                    label={r.status === 'optimizing' ? 'Testing' : ['llm_complete', 'converged_below_gate'].includes(r.status) ? 'Done' : undefined} />
                )}</span>
              </div>
              {r && ['optimizing', 'collecting'].includes(r.status) && (() => {
                const a = arena.detail?.[c.run_id || '']?.activity
                const phase = a?.phase === 'matrix' ? 'problem checks' : a?.phase === 'deep_confirm' ? 'deep-confirm' : a?.phase === 'confirm_convos' ? 'confirm convos' : a?.phase === 'stress' ? 'stress sims' : a?.phase === 'deepeval' ? 'deepeval' : a?.phase === 'conversations' ? 'conversations' : a?.phase === 'judging' ? 'judging' : null
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, fontSize: 11.5, color: T.muted }}>
                    <span className="live-pulse" style={{ width: 7, height: 7, borderRadius: 99, background: colorOf(c), flexShrink: 0 }} />
                    {a && phase ? (
                      <span style={{ fontFamily: T.mono }}>
                        {phase} {a.done}/{a.total}
                        {a.problem_id ? ` · ${a.problem_id}${a.verdict ? ` → ${a.verdict}` : ''}` : ''}
                        {a.probe ? ` · ${a.probe}` : ''}
                      </span>
                    ) : (
                      <span>warming up — first conversations running…</span>
                    )}
                  </div>
                )
              })()}
              <div style={{ display: 'flex', gap: 16, marginTop: 8, alignItems: 'baseline' }}>
                <Stat label="deepeval" value={rk?.deepeval_avg} big />
                <Stat label="composite" value={rk?.composite ?? r?.final_composite} />
                <Stat label="solved" value={sc.total ? `${sc.y}/${sc.total}` : null} color={score100Color(sc.total ? (sc.y / sc.total) * 100 : null)} />
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: T.mono, color: T.fainter, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{c.model}</span>
              </div>
            </div>
          )
        })}
      </div>

      {proof && (() => {
        const cell = arena.detail?.[proof.runId]?.statuses?.[proof.pid] as
          { verdict?: string | null; evidence?: string; passes?: number; votes?: number
            sim_uids?: string[]; fails?: { sim_uid: string | null; reason?: string; failing_turn?: number | null }[] } | undefined
        return (
          <ProofPanel runId={proof.runId} problemId={proof.pid}
            behaviour={behaviourOf(proof.pid)} verdictInfo={cell || null}
            onClose={() => setProof(null)} />
        )
      })()}

      {arena.status === 'complete' && winner && (
        <div style={{ ...card, padding: '12px 16px', marginTop: 12, borderLeft: `3px solid ${T.green}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🏆</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{winner.label} wins</span>
          <span style={{ fontSize: 12.5, color: T.muted }}>
            — best deepeval battery ({rankOf(winner)?.deepeval_avg}) on the same dataset with the same judge, first pass only
          </span>
        </div>
      )}

      {/* PRIMARY — deepeval battery */}
      <div style={{ ...label, margin: '20px 0 8px' }}>Deepeval metrics — the primary signal (code-computed checks)</div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>metric</th>
              {cs.map((c) => (
                <th key={c.run_id} style={th}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: colorOf(c) }} />{c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(METRIC_LABELS).map((k, ri) => {
              const vals = cs.map((c) => arena.detail?.[c.run_id || '']?.metrics?.[k] ?? null)
              if (vals.every((v) => v == null)) return null
              const best = Math.max(...vals.map((v) => v ?? -1))
              return (
                <tr key={k} style={{ background: ri % 2 ? T.well : 'transparent' }}>
                  <td style={{ padding: '6px 14px', fontSize: 12.5, color: T.text3, whiteSpace: 'nowrap' }}>{METRIC_LABELS[k]}</td>
                  {vals.map((v, i) => (
                    <td key={i} style={{ padding: '5px 8px', textAlign: 'center', fontFamily: T.mono, fontWeight: v === best && v != null ? 800 : 600, fontSize: 12.5, color: score100Color(v) }}>
                      {v ?? '—'}{v === best && v != null && vals.filter((x) => x != null).length > 1 ? ' ●' : ''}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr style={{ borderTop: `1px solid ${T.border2}` }}>
              <td style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: T.text }}>Deepeval average</td>
              {cs.map((c) => {
                const rk = rankOf(c)
                return (
                  <td key={c.run_id} style={{ padding: '7px 8px', textAlign: 'center', fontFamily: T.mono, fontWeight: 800, fontSize: 15, color: score100Color(rk?.deepeval_avg ?? null) }}>
                    {rk?.deepeval_avg ?? '—'}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Latency — per-turn LLM completion time (avg / p50 / p99) */}
      <div style={{ ...label, margin: '20px 0 8px' }}>Latency — LLM turn time on the same conversations</div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>&nbsp;</th>
              {cs.map((c) => (
                <th key={c.run_id} style={th}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: colorOf(c) }} />{c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([['avg_ms', 'Average'], ['p50_ms', 'p50 (median)'], ['p99_ms', 'p99 (worst)'],
               ['tokens_avg', 'Tokens / turn'], ['long_turn_pct', 'Yapping (long turns)']] as const).map(([k, lbl], ri) => {
              const vals = cs.map((c) => {
                const lat = arena.detail?.[c.run_id || '']?.latency
                if (!lat) return null
                if (k === 'tokens_avg' && lat.tokens_avg == null) {
                  // older runs: fall back to the stored per-turn detail
                  const toks = lat.detail.flatMap((d) => d.turns.map((t) => t.tokens)).filter((t): t is number => t != null)
                  return toks.length ? Math.round((toks.reduce((a, b) => a + b, 0) / toks.length) * 10) / 10 : null
                }
                return lat[k] ?? null
              })
              const best = Math.min(...vals.map((v) => v ?? Infinity))
              return (
                <tr key={k} style={{ background: ri % 2 ? T.well : 'transparent' }}>
                  <td style={{ padding: '6px 14px', fontSize: 12.5, color: T.text3 }}>{lbl}</td>
                  {vals.map((v, i) => (
                    <td key={i} style={{ padding: '5px 8px', textAlign: 'center', fontFamily: T.mono, fontWeight: v === best && v != null ? 800 : 600, fontSize: 12.5, color: v == null ? T.fainter : v === best ? T.green : T.text2 }}>
                      {v != null ? (k === 'tokens_avg' ? `${Math.round(v)}` : k === 'long_turn_pct' ? `${v}%` : `${Math.round(v)}ms`) : '—'}{v === best && v != null && vals.filter((x) => x != null).length > 1 ? ' ●' : ''}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr style={{ borderTop: `1px solid ${T.border2}` }}>
              <td style={{ padding: '7px 14px', fontSize: 11.5, color: T.fainter }}>per-turn detail</td>
              {cs.map((c) => {
                const has = !!arena.detail?.[c.run_id || '']?.latency?.detail?.length
                const open = latOpen === c.run_id
                return (
                  <td key={c.run_id} style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <button disabled={!has} onClick={() => setLatOpen(open ? null : (c.run_id || null))}
                      style={{ padding: '4px 12px', borderRadius: 8, fontSize: 11.5, cursor: has ? 'pointer' : 'default',
                               border: `1px solid ${open ? colorOf(c) : T.border2}`,
                               background: open ? colorOf(c) + '22' : 'transparent',
                               color: !has ? T.fainter : open ? colorOf(c) : T.muted, fontWeight: 600 }}>
                      {open ? 'Hide' : 'Detailed latency'}
                    </button>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {latOpen && (() => {
        const c = cs.find((x) => x.run_id === latOpen)
        const lat = c && arena.detail?.[latOpen]?.latency
        if (!c || !lat) return null
        const maxMs = Math.max(...lat.detail.flatMap((d) => d.turns.map((t) => t.ms)), 1)
        return (
          <div style={{ ...card, marginTop: 10, padding: 16, borderLeft: `3px solid ${colorOf(c)}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{c.label} — every turn, what happened, how long</span>
              <span style={{ fontSize: 11.5, color: T.faint }}>{lat.n_turns} agent turns across {lat.detail.length} conversations</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: 14 }}>
              {lat.detail.map((sim) => (
                <div key={sim.probe}>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: T.mono, color: T.muted, marginBottom: 6 }}>persona: {sim.probe}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {sim.turns.map((t, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fainter, width: 22, flexShrink: 0 }}>T{i + 1}</span>
                        <div style={{ width: 120, height: 8, borderRadius: 99, background: T.track, flexShrink: 0, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(4, (t.ms / maxMs) * 100)}%`, background: t.ms > maxMs * 0.75 ? T.red : t.ms > maxMs * 0.4 ? T.amber : T.green, borderRadius: 99 }} />
                        </div>
                        <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.text2, width: 58, flexShrink: 0 }}>{Math.round(t.ms)}ms</span>
                        {t.tokens != null && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fainter, width: 42, flexShrink: 0 }}>{t.tokens}tk</span>}
                        <span style={{ fontSize: 11.5, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* SECONDARY — problems */}
      <div style={{ ...label, margin: '20px 0 8px' }}>Problems — first pass, no optimization</div>
      {pids.length > 0 ? (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>problem</th>
                {cs.map((c) => (
                  <th key={c.run_id} style={th}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: colorOf(c) }} />{c.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pids.map((pid, ri) => (
                <tr key={pid} style={{ background: ri % 2 ? T.well : 'transparent' }}>
                  <td style={{ padding: '4px 14px', whiteSpace: 'nowrap', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, marginRight: 8 }}>{pid}</span>
                    <span style={{ fontSize: 12, color: T.text3 }}>{behaviourOf(pid)}</span>
                  </td>
                  {cs.map((c) => {
                    const cell = arena.detail?.[c.run_id || '']?.statuses?.[pid]
                    return (
                      <td key={c.run_id} onClick={() => cell && c.run_id && setProof({ runId: c.run_id, pid })}
                        title={cell ? `${cell.evidence || ''} — click for the conversations` : undefined}
                        style={{ padding: '3px 8px', textAlign: 'center', cursor: cell ? 'pointer' : 'default' }}>
                        <VerdictCell verdict={cell?.verdict ?? null} title={cell?.evidence} />
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${T.border2}` }}>
                <td style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: T.text }}>Solved</td>
                {cs.map((c) => {
                  const sc = solvedCount(c)
                  return (
                    <td key={c.run_id} style={{ padding: '7px 8px', textAlign: 'center', fontFamily: T.mono, fontWeight: 800, fontSize: 14, color: score100Color(sc.total ? (sc.y / sc.total) * 100 : null) }}>
                      {sc.total ? `${sc.y}/${sc.total}` : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ ...card, padding: 22, fontSize: 13, color: T.faint }}>First contestant is still being scored…</div>
      )}
    </div>
  )
}

function Stat({ label: lbl, value, big, color }: { label: string; value: number | string | null | undefined; big?: boolean; color?: string }) {
  const col = color || (typeof value === 'number' ? score100Color(value) : T.text2)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: big ? 17 : 13.5, color: value == null ? T.fainter : col }}>{value ?? '—'}</span>
      <span style={{ fontSize: 10, color: T.fainter, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{lbl}</span>
    </span>
  )
}

const inp: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, background: T.well, border: `1px solid ${T.border2}`,
  color: T.text, fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box',
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 15px', borderRadius: 10, border: `1px solid ${T.border2}`,
  background: 'transparent', color: T.muted, fontSize: 13, cursor: 'pointer',
}
const th: React.CSSProperties = {
  padding: '8px 10px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: T.muted, textAlign: 'center', borderBottom: `1px solid ${T.divider}`,
}
