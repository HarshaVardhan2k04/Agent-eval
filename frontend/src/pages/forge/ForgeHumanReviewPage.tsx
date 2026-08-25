import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { T, card, label, btnPrimary, backBtn } from '../../theme'
import { api } from '../../api/client'
import { useForgeStore } from '../../stores/forgeStore'
import { ScoreRing } from '../../components/analysis'
import { RunStatusChip, SolvedGauge, LayerBadge, VerdictCell , SizeHint } from '../../components/forge'

type ChatMsg = { role: 'user' | 'agent'; content: string }

const HANDOFF_STATES = new Set(['awaiting_human', 'llm_complete', 'converged_below_gate', 'human_review', 'finalized', 'stopped'])

export function ForgeHumanReviewPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { currentRun, fetchRun, problems, fetchProblems } = useForgeStore()
  const [notes, setNotes] = useState('')
  const [editedPrompt, setEditedPrompt] = useState('')
  const [resolved, setResolved] = useState<Record<string, boolean>>({})
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const seeded = useRef(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (id) fetchRun(id); fetchProblems() }, [id, fetchRun, fetchProblems])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.length])

  const run = currentRun && currentRun.id === id ? currentRun : null

  // latest prompt (accepted preferred) — what the chat drives and the reviewer edits
  const latest = useMemo(() => run
    ? [...run.versions].reverse().find((v) => v.merged_markdown) || null
    : null, [run])
  const currentPromptText = useMemo(() => {
    if (!latest) {
      const snap = run?.original_prompt_snapshot
      if (snap?.blob) return typeof snap.blob === 'string' ? snap.blob : JSON.stringify(snap.blob, null, 2)
      if (snap?.layers) return JSON.stringify(snap.layers, null, 2)
      return ''
    }
    return latest.merged_markdown || ''
  }, [latest, run])
  const originalText = useMemo(() => {
    // Compare LIKE with LIKE: the original side is v0's MERGED MARKDOWN — the same
    // representation as the current side. Diffing raw layer JSON against rendered
    // markdown marks every line as changed and means nothing.
    const v0 = run ? run.versions.find((v) => v.version === 0 && v.merged_markdown) : null
    if (v0?.merged_markdown) return v0.merged_markdown
    const snap = run?.original_prompt_snapshot
    if (!snap) return ''
    if (snap.blob) return typeof snap.blob === 'string' ? snap.blob : JSON.stringify(snap.blob, null, 2)
    return JSON.stringify(snap.layers || {}, null, 2)
  }, [run])

  // seed local state from the saved review once
  useEffect(() => {
    if (!run || seeded.current) return
    seeded.current = true
    const r = (run.review || {}) as { reviewer_notes?: string; edited_prompt?: string; resolved?: Record<string, boolean>; chat_log?: ChatMsg[] }
    setNotes(r.reviewer_notes || '')
    setEditedPrompt(r.edited_prompt || currentPromptText)
    setResolved(r.resolved || {})
    setChat(Array.isArray(r.chat_log) ? r.chat_log : [])
  }, [run, currentPromptText])

  if (!run) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>

  if (!HANDOFF_STATES.has(run.status)) {
    return (
      <div>
        <button onClick={() => nav(`/forge/${run.id}/progress`)} style={backBtn}>← Back to progress</button>
        <div style={{ ...card, padding: 40, textAlign: 'center', color: T.muted, fontSize: 14 }}>
          This run hasn't reached human handoff — it's still <b>{run.status}</b>.
        </div>
      </div>
    )
  }

  const statuses = ([...run.versions].reverse().find((v) => v.statuses_json)?.statuses_json) || {}
  const behaviourOf = (pid: string) => problems.find((p) => p.id === pid)?.behaviour || pid
  const solvedPids = Object.entries(statuses).filter(([, s]) => s.verdict === 'Y').map(([p]) => p)
  const openPids = Object.entries(statuses).filter(([, s]) => s.verdict !== 'Y').map(([p]) => p)
  const acceptedVersions = run.versions.filter((v) => v.status === 'accepted')
  const revertedVersions = run.versions.filter((v) => v.status === 'reverted')
  const denom = run.denominator_snapshot_json?.length ?? null
  const gate = Number(run.scoring_json?.gate_pct ?? 95)
  const finalized = run.status === 'finalized'

  const save = async (patch: Record<string, unknown>, alsoFinalize = false) => {
    setSaving(true)
    try {
      await api.saveForgeReview(run.id, { ...patch, ...(alsoFinalize ? { finalize: true } : {}) })
      if (alsoFinalize) fetchRun(run.id)
    } finally { setSaving(false) }
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatBusy) return
    setChatBusy(true)
    setChatInput('')
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next)
    try {
      const res = await api.forgeChat(run.id, {
        system_prompt: editedPrompt || currentPromptText,
        greeting: latest?.greeting || undefined,
        history: next.slice(0, -1),
        message: msg,
      })
      const withReply: ChatMsg[] = [...next, { role: 'agent', content: res.reply }]
      setChat(withReply)
      save({ chat_log: withReply })
    } catch {
      setChat([...next, { role: 'agent', content: '(engine unreachable)' }])
    } finally { setChatBusy(false) }
  }

  const doExport = async () => {
    const payload = await api.exportForgeRun(run.id)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forge-${run.id}-export.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doEvaluate = async () => {
    if (evaluating) return
    setEvaluating(true)
    try {
      await save({ edited_prompt: editedPrompt, reviewer_notes: notes })
      const res = await api.forgeEvaluate(run.id)
      if (res.eval_run_id) nav(`/forge/${res.eval_run_id}/progress`)
    } finally { setEvaluating(false) }
  }

  return (
    <div>
      <button onClick={() => nav(`/forge/${run.id}/results`)} style={backBtn}>← Back to results</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>Human review</h1>
        <RunStatusChip status={run.status} />
        <span style={{ fontSize: 13, color: T.muted }}>
          The LLM got it to ~{run.final_composite ?? '—'} · {run.solved_pct ?? '—'}% solved. You finish it.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 22, alignItems: 'start' }}>
        {/* LEFT canvas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* gauges */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ ...card, padding: 16, flex: 1, minWidth: 230 }}>
              <SolvedGauge solvedPct={run.solved_pct} denominator={denom} gatePct={gate} />
            </div>
            <div style={{ ...card, padding: 16, display: 'flex', alignItems: 'center', gap: 14, minWidth: 200 }}>
              <ScoreRing value={run.final_composite} size={64} />
              <div>
                <div style={label}>Composite</div>
                <div style={{ fontSize: 12, color: T.faint, marginTop: 3 }}>deepeval median</div>
              </div>
            </div>
          </div>

          {/* original vs current */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '11px 16px', borderBottom: `1px solid ${T.divider}`, ...label }}>Original (as given) vs current (LLM-complete)</div>
            <div style={{ maxHeight: 420, overflow: 'auto', fontSize: 12 }}>
              {originalText === currentPromptText ? (
                <div style={{ padding: '26px 20px', fontSize: 13, color: T.faint }}>
                  No surviving changes — every coach edit was reverted, so the current prompt IS the original.
                </div>
              ) : (
                <ReactDiffViewer oldValue={originalText} newValue={currentPromptText} splitView useDarkTheme
                  leftTitle="Original" rightTitle="Current" />
              )}
            </div>
          </div>

          {/* solved / left */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ ...card, padding: 16, minWidth: 0 }}>
              <div style={{ ...label, marginBottom: 10, color: T.green }}>Solved ({solvedPids.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {solvedPids.map((pid) => (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.text3 }}>
                    <VerdictCell verdict="Y" /><span style={{ fontFamily: T.mono, color: T.faint }}>{pid}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{behaviourOf(pid)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ ...card, padding: 16, minWidth: 0 }}>
              <div style={{ ...label, marginBottom: 10, color: T.amber }}>Left for you ({openPids.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {openPids.map((pid) => (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.text3 }}>
                    <VerdictCell verdict={statuses[pid]?.verdict} />
                    <span style={{ fontFamily: T.mono, color: T.faint }}>{pid}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{behaviourOf(pid)}</span>
                    <input type="checkbox" checked={!!resolved[pid]} disabled={finalized}
                      title="Mark resolved by hand"
                      onChange={(e) => {
                        const next = { ...resolved, [pid]: e.target.checked }
                        setResolved(next)
                        save({ resolved: next })
                      }} />
                  </div>
                ))}
                {openPids.length === 0 && <div style={{ fontSize: 12.5, color: T.green }}>Nothing left open.</div>}
              </div>
            </div>
          </div>

          {/* edits + how */}
          <div style={{ ...card, padding: 16 }}>
            <div style={{ ...label, marginBottom: 12 }}>What the coach changed — and how each problem fell</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {acceptedVersions.map((v) => (
                <div key={v.version} style={{ background: T.well, borderRadius: 10, padding: '11px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.text2 }}>v{v.version}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 12, color: 'var(--accent)' }}>{v.targeted_problem}</span>
                    <LayerBadge layer={v.layer_for_fix} />
                  </div>
                  <div style={{ fontSize: 12.5, color: T.text3, marginTop: 6, lineHeight: 1.55 }}>{v.changes_summary}</div>
                  {v.how_solved && <div style={{ fontSize: 12, color: T.green, marginTop: 5, lineHeight: 1.5 }}>lever: {v.how_solved}</div>}
                </div>
              ))}
              {acceptedVersions.length === 0 && <div style={{ fontSize: 12.5, color: T.faint }}>No accepted changes — the baseline is the champion.</div>}
              {revertedVersions.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.amber, marginTop: 4 }}>
                    Tried & reverted — the re-test said these didn't actually fix it
                  </div>
                  {revertedVersions.map((v) => (
                    <div key={v.version} style={{ background: T.well, borderRadius: 10, padding: '11px 13px', borderLeft: `3px solid ${T.amber}`, opacity: 0.85 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.text2 }}>v{v.version}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.amber }}>{v.targeted_problem}</span>
                        <LayerBadge layer={v.layer_for_fix} />
                        <span style={{ fontSize: 10.5, color: T.amber, textTransform: 'uppercase', letterSpacing: '0.04em' }}>reverted</span>
                      </div>
                      {v.diagnosis && <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>diagnosis: {v.diagnosis}</div>}
                      <div style={{ fontSize: 12.5, color: T.text3, marginTop: 5, lineHeight: 1.55 }}>{v.changes_summary}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* reviewer edit box */}
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={label}>Your prompt edit</span>
              <span style={{ fontSize: 11.5, color: T.faint }}>
                {run.mode === 'layered' ? 'paste the campaign-layer JSON you want tested' : 'edit the blob directly'} · saved with re-run / finalize
              </span>
            </div>
            <textarea value={editedPrompt} onChange={(e) => setEditedPrompt(e.target.value)} rows={10} disabled={finalized}
              onBlur={() => save({ edited_prompt: editedPrompt })}
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 11, background: T.well, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 12, fontFamily: T.mono, lineHeight: 1.55, outline: 'none', resize: 'vertical' }} />
            <SizeHint text={editedPrompt} label="your edit" warnTokens={8000} />
          </div>

          {/* live chat */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '11px 16px', borderBottom: `1px solid ${T.divider}`, ...label }}>
              Chat with the candidate agent
            </div>
            <div style={{ padding: 16, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chat.length === 0 && <div style={{ fontSize: 12.5, color: T.faint }}>Probe it live — you're the lead now.</div>}
              {chat.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'agent' ? 'flex-start' : 'flex-end' }}>
                  <div style={{ maxWidth: '78%', background: m.role === 'agent' ? T.surface2 : T.chip, border: `1px solid ${T.border}`, borderRadius: 12, padding: '9px 13px' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: m.role === 'agent' ? 'var(--accent)' : T.blue, marginBottom: 3 }}>
                      {m.role === 'agent' ? 'Agent' : 'You'}
                    </div>
                    <div style={{ fontSize: 13.5, color: T.text2, lineHeight: 1.5 }}>{m.content}</div>
                  </div>
                </div>
              ))}
              {chatBusy && <div style={{ fontSize: 12, color: T.purple }}>agent is typing…</div>}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: `1px solid ${T.divider}` }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }}
                placeholder="Say something as the lead…" disabled={finalized}
                style={{ flex: 1, padding: '10px 13px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, outline: 'none' }} />
              <button onClick={sendChat} disabled={chatBusy || finalized || !chatInput.trim()}
                style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: T.accentGrad, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: chatBusy || finalized || !chatInput.trim() ? 0.5 : 1 }}>
                Send
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT rail */}
        <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ ...label, marginBottom: 10 }}>Reviewer notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} disabled={finalized}
              onBlur={() => save({ reviewer_notes: notes })}
              placeholder="What you found, what you fixed…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 12.5, lineHeight: 1.55, outline: 'none', resize: 'vertical' }} />
          </div>
          <button onClick={doEvaluate} disabled={evaluating || finalized}
            style={{ padding: '11px 16px', borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', opacity: evaluating || finalized ? 0.6 : 1 }}>
            {evaluating ? 'Dispatching…' : '↻ Re-run the datasets on my edit'}
          </button>
          <button onClick={doExport}
            style={{ padding: '11px 16px', borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            ⬇ Export (markdown + layer JSONs)
          </button>
          {confirmFinalize ? (
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontSize: 13, color: T.text2, marginBottom: 10 }}>Finalize this run?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setConfirmFinalize(false); save({ reviewer_notes: notes, edited_prompt: editedPrompt }, true) }}
                  style={{ ...btnPrimary, flex: 1, padding: '9px 0' }} disabled={saving}>Yes, finalize</button>
                <button onClick={() => setConfirmFinalize(false)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: `1px solid ${T.border2}`, background: 'transparent', color: T.muted, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmFinalize(true)} disabled={finalized}
              style={{ ...btnPrimary, opacity: finalized ? 0.5 : 1 }}>
              {finalized ? '✓ Finalized' : 'Finalize run'}
            </button>
          )}
          <div style={{ fontSize: 11, color: T.fainter, lineHeight: 1.55 }}>
            Export never writes production. The human step is mandatory — Gemma judges itself, so the last mile is yours.
          </div>
        </div>
      </div>
    </div>
  )
}
