// Shared Forge UI primitives — status chips, layer badges, verdict cells, gauges,
// escalation cards, merged-preview panel. All built from the T tokens; no new deps.
import { useEffect, useRef, useState } from 'react'
import { T, card, label, forgeStatusMeta, verdictMeta } from '../theme'
import { ScoreRing } from './analysis'
import { api } from '../api/client'
import type { ForgeEscalation } from '../stores/forgeStore'

const LIVE_STATUSES = new Set(['collecting', 'optimizing', 'awaiting_human'])

export function RunStatusChip({ status, label }: { status: string; label?: string }) {
  // label overrides the wording while keeping the status color/pulse — the arena
  // says "Testing", not "Optimizing" (nothing is being optimized there).
  const m = forgeStatusMeta(status)
  const live = LIVE_STATUSES.has(status)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 99,
      background: m.color + '26', color: m.color, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span className={live ? 'pulse-dot' : undefined}
        style={{ width: 7, height: 7, borderRadius: 99, background: m.color, flexShrink: 0 }} />
      {label || m.label}
    </span>
  )
}

export const LAYER_COLORS: Record<string, string> = {
  universal: '#ec5a54',   // red — highest blast radius (every agent)
  vertical: '#b8860b',    // dark yellow — one domain
  campaign: '#f2c94c',    // yellow — one client only
  addon: T.faint, standalone: T.muted,
}

export function LayerBadge({ layer }: { layer: string | null | undefined }) {
  if (!layer) return null
  const col = LAYER_COLORS[layer] || T.faint
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      background: col + '22', color: col, fontSize: 10.5, fontWeight: 700, fontFamily: T.mono,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{layer}</span>
  )
}

export function VerdictCell({ verdict, title }: { verdict: string | null | undefined; title?: string }) {
  const m = verdict ? verdictMeta[verdict] : null
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 26, height: 22, borderRadius: 6, fontFamily: T.mono, fontSize: 12, fontWeight: 700,
      background: m ? m.color + '22' : T.well, color: m ? m.color : T.fainter,
    }}>{verdict || '·'}</span>
  )
}

export function SolvedGauge({ solvedPct, denominator, gatePct = 95 }: { solvedPct: number | null; denominator: number | null; gatePct?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <ScoreRing value={solvedPct} size={64} />
      <div>
        <div style={label}>Problems solved</div>
        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>
          {denominator != null ? `${denominator} applicable · snapshot at launch` : '—'}
        </div>
        <div style={{ fontSize: 11.5, color: (solvedPct ?? 0) >= gatePct ? T.green : T.faint, marginTop: 2 }}>
          gate {gatePct}% {(solvedPct ?? 0) >= gatePct ? '· reached' : ''}
        </div>
      </div>
    </div>
  )
}

export function EscalationCard({ esc, onAnswer }: { esc: ForgeEscalation; onAnswer: (answer: string) => Promise<void> }) {
  const [picked, setPicked] = useState<string>('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const answered = esc.status === 'answered'
  const submit = async () => {
    const ans = (custom.trim() || picked).trim()
    if (!ans || busy) return
    setBusy(true)
    try { await onAnswer(ans) } finally { setBusy(false) }
  }
  return (
    <div style={{ ...card, padding: 16, borderLeft: `3px solid ${answered ? T.faint : T.purple}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {esc.problem_id && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>{esc.problem_id}</span>}
        <span style={{ fontSize: 11, color: answered ? T.faint : T.purple, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {answered ? 'Answered' : 'Coach needs a ruling'}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: T.text, fontWeight: 500, lineHeight: 1.5 }}>{esc.question}</div>
      {esc.rationale && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{esc.rationale}</div>}
      {answered ? (
        <div style={{ marginTop: 10, fontSize: 13, color: T.text3 }}>→ <b style={{ color: T.text2 }}>{esc.answer}</b></div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {(esc.options || []).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {esc.options.map((o) => (
                <button key={o} onClick={() => { setPicked(o); setCustom('') }}
                  style={{
                    padding: '6px 13px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer',
                    border: `1px solid ${picked === o ? 'var(--accent)' : T.border2}`,
                    background: picked === o ? T.accentSoft : T.surface2,
                    color: picked === o ? T.text : T.muted, fontWeight: picked === o ? 600 : 500,
                  }}>{o}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder="…or type a custom answer"
              style={{ flex: 1, padding: '8px 11px', borderRadius: 9, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13, outline: 'none' }} />
            <button onClick={submit} disabled={busy || (!picked && !custom.trim())}
              style={{
                padding: '8px 16px', borderRadius: 9, border: 'none', background: T.purple, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy || (!picked && !custom.trim()) ? 0.5 : 1,
              }}>{busy ? '…' : 'Answer'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MergedPreviewPanel({ markdown, greeting, flowStage, loading, error }: {
  markdown: string | null; greeting: string | null; flowStage: string | null; loading?: boolean; error?: string | null
}) {
  // live count of whatever the user highlights inside the preview — selection is a
  // document-level event, so listen globally but only count text inside our pane.
  const preRef = useRef<HTMLPreElement>(null)
  const [selChars, setSelChars] = useState(0)
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || !preRef.current
          || !preRef.current.contains(sel.anchorNode) || !preRef.current.contains(sel.focusNode)) {
        setSelChars(0)
        return
      }
      setSelChars(sel.toString().length)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${T.divider}`, flexWrap: 'wrap' }}>
        <span style={label}>Merged preview</span>
        {loading && <span style={{ fontSize: 11.5, color: T.blue }}>merging…</span>}
        {greeting && (
          <span title={greeting} style={{ fontSize: 11.5, color: T.green, background: T.green + '18', borderRadius: 99, padding: '3px 10px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            greeting: “{greeting}”
          </span>
        )}
        {flowStage && (
          <span style={{ fontSize: 11.5, color: 'var(--accent)', background: T.accentSoft, borderRadius: 99, padding: '3px 10px' }}>
            stage: {flowStage}
          </span>
        )}
        {markdown && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.faint, fontFamily: T.mono, display: 'inline-flex', gap: 10 }}>
            {selChars > 0 && (
              <span style={{ color: 'var(--accent)' }} title="the highlighted text">
                selected {selChars.toLocaleString()} chars ≈ {estimateTokens(document.getSelection()?.toString() || '').toLocaleString()} tokens
              </span>
            )}
            <span>{markdown.length.toLocaleString()} chars</span>
            <span title="estimated — ~4 chars/token latin, ~2.2 non-latin">
              ≈ {estimateTokens(markdown).toLocaleString()} tokens
            </span>
          </span>
        )}
      </div>
      {error ? (
        <div style={{ padding: 16, fontSize: 13, color: T.amber }}>{error}</div>
      ) : markdown ? (
        <pre ref={preRef} style={{ margin: 0, padding: 16, maxHeight: 380, overflow: 'auto', background: T.well, fontSize: 11.5, lineHeight: 1.55, color: T.text3, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
          {markdown}
        </pre>
      ) : (
        <div style={{ padding: 20, fontSize: 13, color: T.faint }}>Pick / paste layers to see exactly what the voice agent will receive.</div>
      )}
    </div>
  )
}

// Size of a pasted prompt/dataset: characters plus an estimated token count.
// Estimate, not a tokenizer: ~4 chars/token for latin text, ~2.2 for non-latin
// (Devanagari/Telugu run far more tokens per character on Gemma's vocab).
export function estimateTokens(text: string) {
  if (!text) return 0
  const nonLatin = (text.match(/[^\x00-\x7F]/g) || []).length
  const latin = text.length - nonLatin
  return Math.round(latin / 4 + nonLatin / 2.2)
}

export function SizeHint({ text, label: lbl, warnTokens }: { text: string; label?: string; warnTokens?: number }) {
  const chars = text?.length || 0
  const toks = estimateTokens(text || '')
  const hot = warnTokens != null && toks > warnTokens
  if (!chars) return <div style={{ fontSize: 11.5, color: T.fainter, marginTop: 6 }}>{lbl ? `${lbl} · ` : ''}empty</div>
  return (
    <div style={{ fontSize: 11.5, color: hot ? T.amber : T.faint, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <span>{lbl ? `${lbl} · ` : ''}{chars.toLocaleString()} chars</span>
      <span title="estimated — ~4 chars/token latin, ~2.2 non-latin">≈ {toks.toLocaleString()} tokens</span>
      {hot && <span>large prompt — first call pays a full prefill</span>}
    </div>
  )
}

// ---- run-then-grade proof components --------------------------------------

export type SimRow = {
  id: number; sim_uid: string; version: number; kind: string
  problem_id: string | null; probe: string | null; idx: number | null
  ended: boolean | null; verdict: string | null; reason: string | null
  failing_turn: number | null; created_at: string; n_turns?: number; n_tools?: number
  transcript_json?: { role: string; content: string; latency_ms?: number | null; tokens?: number | null }[]
  tool_calls_json?: { name: string; args?: string; result?: string; turn?: number }[] | null
  tool_leaks_json?: { name: string; source?: string; snippet?: string; turn?: number }[] | null
  tool_summary_json?: { offered?: string[]; fired?: string[]; unknown?: string[]; leaked?: string[]
                        expected?: string[]; missed?: string[]; score?: number | null } | null
  n_leaks?: number
  check_verdict?: string | null   // toolcheck sims: called | spoken_only | not_called
}

// Footer strip under a conversation: which tools the model actually CALLED.
// Click to expand each call's arguments and what the tool returned.
export function ToolCallsStrip({ calls, leaks, summary }: {
  calls?: SimRow['tool_calls_json']; leaks?: SimRow['tool_leaks_json']; summary?: SimRow['tool_summary_json']
}) {
  const [open, setOpen] = useState(false)
  const list = calls || []
  const leakList = leaks || []
  const missed = summary?.missed || []
  if (!list.length && !leakList.length && !missed.length) {
    return (
      <div style={{ marginTop: 12, fontSize: 11.5, color: T.fainter, borderTop: `1px solid ${T.divider}`, paddingTop: 9 }}>
        No tools called in this conversation
      </div>
    )
  }
  const counts = list.reduce<Record<string, number>>((m, c) => ({ ...m, [c.name]: (m[c.name] || 0) + 1 }), {})
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${T.divider}`, paddingTop: 9 }}>
      <div onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', cursor: 'pointer' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
          Tools called ({list.length})
        </span>
        {Object.entries(counts).map(([name, n]) => (
          <span key={name} style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, fontFamily: T.mono,
                                    background: 'var(--accent)22', color: 'var(--accent)', border: `1px solid var(--accent)44` }}>
            {name}{n > 1 ? ` ×${n}` : ''}
          </span>
        ))}
        {leakList.map((l, i) => (
          <span key={`lk${i}`} title="spoken as text — never executed"
            style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, fontFamily: T.mono,
                     background: T.red + '22', color: T.red, border: `1px solid ${T.red}55` }}>
            {l.name} · spoken only
          </span>
        ))}
        {missed.map((m) => (
          <span key={`ms${m}`} title="expected for this scenario but never called"
            style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, fontFamily: T.mono,
                     background: T.amber + '22', color: T.amber, border: `1px solid ${T.amber}55` }}>
            {m} · missed
          </span>
        ))}
        {summary?.score != null && (
          <span style={{ fontSize: 11, fontFamily: T.mono, color: summary.score >= 90 ? T.green : summary.score > 0 ? T.amber : T.red }}>
            {summary.score}% executed
          </span>
        )}
        <span style={{ fontSize: 11, color: T.fainter }}>{open ? '▾ hide details' : '▸ show arguments & results'}</span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9 }}>
          {list.map((c, i) => {
            const bad = String(c.result || '').startsWith('Unknown function')
            return (
              <div key={i} style={{ padding: '8px 11px', borderRadius: 9, background: T.well,
                                    borderLeft: `3px solid ${bad ? T.red : T.green}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: bad ? T.red : T.text2 }}>{c.name}</span>
                  {c.turn != null && <span style={{ fontSize: 10.5, color: T.fainter }}>turn {c.turn}</span>}
                  {bad && <span style={{ fontSize: 10.5, color: T.red }}>unknown / unavailable tool</span>}
                </div>
                {c.args && c.args !== '{}' && (
                  <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, marginTop: 4, wordBreak: 'break-word' }}>
                    args: {c.args}
                  </div>
                )}
                {c.result && (
                  <div style={{ fontSize: 11.5, color: bad ? T.red : T.text3, marginTop: 4, wordBreak: 'break-word' }}>
                    → {c.result}
                  </div>
                )}
              </div>
            )
          })}
          {leakList.map((l, i) => (
            <div key={`ld${i}`} style={{ padding: '8px 11px', borderRadius: 9, background: T.red + '10',
                                         borderLeft: `3px solid ${T.red}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.red }}>{l.name}</span>
                {l.turn != null && <span style={{ fontSize: 10.5, color: T.fainter }}>turn {l.turn}</span>}
                <span style={{ fontSize: 10.5, color: T.red }}>
                  spoken as text ({l.source}) — the tool never ran
                </span>
              </div>
              {l.snippet && (
                <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, marginTop: 4, wordBreak: 'break-word' }}>
                  “{l.snippet}”
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Full conversation as chat bubbles. failingTurn (transcript index) gets the red
// highlight — the exact turn the check tripped on.
export function SimTranscript({ transcript, failingTurn }: {
  transcript: { role: string; content: string; latency_ms?: number | null; tokens?: number | null }[]
  failingTurn?: number | null
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {transcript.map((t, i) => {
        const isAgent = t.role === 'agent' || t.role === 'agent_end'
        const failing = failingTurn != null && i === failingTurn
        if (!(t.content || '').trim() && t.role !== 'agent_end') return null
        return (
          <div key={i} style={{ display: 'flex', justifyContent: isAgent ? 'flex-start' : 'flex-end' }}>
            <div style={{
              maxWidth: '78%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.55,
              background: failing ? T.red + '18' : isAgent ? T.well : T.chip,
              border: `1px solid ${failing ? T.red : 'transparent'}`,
              borderLeft: failing ? `3px solid ${T.red}` : isAgent ? `3px solid var(--accent)` : undefined,
              color: T.text2,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: failing ? T.red : T.fainter, marginBottom: 3, display: 'flex', gap: 8 }}>
                <span>{t.role === 'agent_end' ? 'agent · ended call' : isAgent ? 'agent' : 'customer'}</span>
                {failing && <span>← failed here</span>}
                {t.latency_ms != null && <span style={{ fontFamily: T.mono, textTransform: 'none' }}>{Math.round(t.latency_ms)}ms{t.tokens != null ? ` · ${t.tokens}tok` : ''}</span>}
              </div>
              {t.content || (t.role === 'agent_end' ? '(hung up silently)' : '')}
            </div>
          </div>
        )
      })}
      {transcript.length === 0 && <div style={{ color: T.fainter, fontSize: 12.5 }}>empty conversation</div>}
    </div>
  )
}

// Slide-over drawer: the PROOF for one problem's verdict — reason banner on top,
// failing conversations first, the offending turn highlighted.
export type SimRef = { sim_uid: string | null; reason?: string; failing_turn?: number | null }

export function ProofPanel({ runId, problemId, behaviour, verdictInfo, onClose }: {
  runId: string; problemId: string; behaviour: string
  verdictInfo?: { verdict?: string | null; evidence?: string; passes?: number; votes?: number
                  sim_uids?: string[]; fails?: SimRef[]; source?: string } | null
  onClose: () => void
}) {
  const [sims, setSims] = useState<SimRow[]>([])
  const [active, setActive] = useState<SimRow | null>(null)
  const [loading, setLoading] = useState(true)
  // dataset-mode verdicts link their exact conversations; the failing turn for a
  // given conversation comes from the verdict's fails list, not the sim row.
  const failOf = (uid: string | null | undefined) =>
    (verdictInfo?.fails || []).find((f) => f.sim_uid === uid)

  useEffect(() => {
    let dead = false
    setLoading(true)
    const refUids = Array.from(new Set([
      ...((verdictInfo?.fails || []).map((f) => f.sim_uid).filter(Boolean) as string[]),
      ...((verdictInfo?.sim_uids || []) as string[]),
    ]))
    const useRefs = refUids.length > 0
    const load = useRefs
      ? Promise.all(refUids.map((u) => api.getForgeSim(u).catch(() => null)))
          .then((rows) => (rows.filter(Boolean) as SimRow[]))
      : api.listForgeSims(runId, { problem_id: problemId })
    load.then((rows: SimRow[]) => {
      if (dead) return
      const isFail = (r: SimRow) => r.verdict === 'fail' || !!failOf(r.sim_uid)
      const sorted = [...rows].sort((a, b) => (isFail(a) ? 0 : 1) - (isFail(b) ? 0 : 1) || a.id - b.id)
      setSims(sorted)
      if (sorted[0]) {
        if (useRefs) setActive(sorted[0])
        else api.getForgeSim(sorted[0].sim_uid).then((full: SimRow) => { if (!dead) setActive(full) })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, problemId])

  const pick = (s: SimRow) => api.getForgeSim(s.sim_uid).then(setActive)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 60 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(640px, 94vw)', zIndex: 61,
        background: T.surface, borderLeft: `1px solid ${T.border2}`, display: 'flex', flexDirection: 'column',
        boxShadow: '-12px 0 40px #0006',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.divider}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <VerdictCell verdict={verdictInfo?.verdict} />
          <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.faint }}>{problemId}</span>
          <span style={{ fontSize: 13.5, fontWeight: 650, color: T.text, flex: 1, minWidth: 0 }}>{behaviour}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.faint, fontSize: 17, cursor: 'pointer' }}>✕</button>
        </div>
        {/* reason banner */}
        <div style={{ padding: '10px 18px', background: (verdictInfo?.verdict === 'Y' ? T.green : T.red) + '14', borderBottom: `1px solid ${T.divider}`, fontSize: 12.5, color: T.text2 }}>
          <b style={{ color: verdictInfo?.verdict === 'Y' ? T.green : T.red }}>
            {verdictInfo?.source === 'prompt_text'
              ? 'Judged from the prompt text — no conversation needed'
              : verdictInfo?.passes != null ? `${verdictInfo.passes}/${verdictInfo.votes} conversations passed` : 'verdict'}
          </b>
          {(active?.reason || failOf(active?.sim_uid)?.reason) && (
            <span style={{ color: T.muted }}> — {active?.reason || failOf(active?.sim_uid)?.reason}</span>
          )}
        </div>
        {/* sim picker */}
        <div style={{ padding: '10px 18px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${T.divider}` }}>
          {sims.map((s, i) => (
            <button key={s.sim_uid} onClick={() => pick(s)}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11.5, fontFamily: T.mono, cursor: 'pointer',
                       border: `1px solid ${active?.sim_uid === s.sim_uid ? 'var(--accent)' : T.border2}`,
                       background: active?.sim_uid === s.sim_uid ? 'var(--accent)' : 'transparent',
                       color: active?.sim_uid === s.sim_uid ? '#fff' : (s.verdict === 'fail' || failOf(s.sim_uid)) ? T.red : s.verdict === 'pass' ? T.green : T.muted }}>
              #{i + 1} {(s.verdict === 'fail' || failOf(s.sim_uid)) ? '✕' : s.verdict === 'pass' ? '✓' : '·'} {s.kind === 'deep_confirm' ? 'confirm' : s.kind}
            </button>
          ))}
          {!loading && sims.length === 0 && (
            <span style={{ fontSize: 12.5, color: T.fainter }}>
              No stored conversations for this problem — the run predates the simulation archive, or it was judged from the prompt text.
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {verdictInfo?.source === 'prompt_text' ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted, marginBottom: 8 }}>
                What the judge found in the prompt
              </div>
              <div style={{ padding: '12px 14px', borderRadius: 10, background: T.well,
                            borderLeft: `3px solid ${verdictInfo?.verdict === 'Y' ? T.green : T.red}`,
                            fontSize: 13, lineHeight: 1.6, color: T.text2 }}>
                {(verdictInfo.fails?.[0]?.reason || verdictInfo.evidence || 'no reason recorded')
                  .replace(/^\d+\/\d+\s*/, '')}
              </div>
              <div style={{ fontSize: 11.5, color: T.fainter, marginTop: 10, lineHeight: 1.55 }}>
                This problem is checked by reading the prompt itself (rule bloat, dangling flow
                references, layer leaks) — it never runs a conversation, so there is nothing to replay here.
              </div>
            </div>
          ) : active?.transcript_json
            ? (<>
                <SimTranscript transcript={active.transcript_json}
                  failingTurn={active.failing_turn ?? failOf(active.sim_uid)?.failing_turn} />
                <ToolCallsStrip calls={active.tool_calls_json} leaks={active.tool_leaks_json}
                  summary={active.tool_summary_json} />
              </>)
            : loading ? <div style={{ color: T.faint, fontSize: 13 }}>Loading…</div> : null}
        </div>
      </div>
    </>
  )
}

// ---- direction x lead_status coverage ------------------------------------------------

export type Combo = {
  key: string; direction: string; lead_status: string | null
  servable?: boolean; gap?: string | null; detail?: string | null; resolution?: string | null
}
export type ComboResult = {
  key: string; solved_pct: number | null; composite: number | null
  passed: boolean; n_sims: number
}

const DIR_COLOR: Record<string, string> = {
  outbound: '#5ba3e0', inbound: '#5fc48f', followup: '#c79bf2',
}

export function ComboChip({ combo }: { combo: string }) {
  const [dir, stage] = combo.split('·')
  const col = DIR_COLOR[dir] || T.faint
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6,
      background: col + '1f', color: col, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {dir}{stage ? <span style={{ opacity: 0.65 }}>· {stage}</span> : null}
    </span>
  )
}

/** Per-combo scorecard + the pooled overall. Every combo must pass the gate — one weak
 *  stage cannot be averaged away by the strong ones, so failures are listed first. */
export function ComboScorecard({ results, overall, gatePct = 95, allocation, running, onPick }: {
  results: ComboResult[]; overall: number | null; gatePct?: number
  allocation?: { per_combo: number; total: number; dropped: number; capped: boolean; cap: number } | null
  running?: boolean
  onPick?: (key: string) => void
}) {
  if (!results?.length) return null
  const failing = results.filter((r) => !r.passed)
  const sorted = [...results].sort((a, b) => (a.passed === b.passed ? 0 : a.passed ? 1 : -1))
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={label}>
          Coverage · {results.length}{running && allocation ? ` of ${Math.round(allocation.total / Math.max(allocation.per_combo, 1))}` : ''} combos
        </div>
        <div style={{ fontSize: 12, color: failing.length ? T.red : T.green, fontWeight: 600 }}>
          {/* mid-run this is a running tally, not a verdict — say so, or a run that has
              only scored its first combo reads as if it already failed */}
          {failing.length
            ? `${failing.length} combo${failing.length > 1 ? 's' : ''} below gate${running ? ' so far' : ''}`
            : running ? `${results.length} scored so far` : 'every combo passed'}
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 14 }}>
        The gate requires <b>every</b> combo to reach {gatePct}% independently.
        {allocation?.capped ? ` Capped at ${allocation.cap} conversations — ${allocation.per_combo} personas per combo, ${allocation.dropped} dropped.` : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', marginBottom: 10,
        background: T.surface2, borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, minWidth: 70 }}>OVERALL</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: overall == null ? T.faint : (failing.length ? T.red : T.green) }}>
          {overall == null ? '—' : `${overall}%`}
        </div>
        <div style={{ fontSize: 11, color: T.faint }}>
          pooled — a problem counts solved only if it never occurred in any combo
        </div>
      </div>

      {sorted.map((r) => (
        <div key={r.key} onClick={() => onPick?.(r.key)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
            borderLeft: `3px solid ${r.passed ? T.green : T.red}`, borderRadius: 6,
            marginBottom: 5, background: T.surface2 + '80', cursor: onPick ? 'pointer' : 'default',
          }}>
          <div style={{ minWidth: 160 }}><ComboChip combo={r.key} /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: r.passed ? T.green : T.red, minWidth: 58 }}>
            {r.solved_pct == null ? '—' : `${r.solved_pct}%`}
          </div>
          <div style={{ fontSize: 12, color: T.faint, minWidth: 90 }}>
            {r.composite == null ? '' : `composite ${r.composite}`}
          </div>
          <div style={{ fontSize: 11, color: T.faint }}>{r.n_sims} conversations</div>
        </div>
      ))}
    </div>
  )
}

/** The human gate. The prompt cannot serve these combos, so the run HALTED rather than
 *  testing a prompt production would never send. Nothing resumes until every gap is ruled on. */
export function ComboGate({ runId, blocked, message, onResolved }: {
  runId: string; blocked: Combo[]; message?: string; onResolved: () => void
}) {
  const [answers, setAnswers] = useState<Record<string, { action: string; text: string }>>(
    () => Object.fromEntries(blocked.map((b) => [b.key, { action: 'content', text: '' }])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const incomplete = blocked.filter((b) => {
    const a = answers[b.key]
    return !a || (a.action === 'content' && !a.text.trim())
  })

  async function submit() {
    setBusy(true); setErr(null)
    try {
      await api.forgeResolveCombos(runId, answers)
      onResolved()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, padding: 20, borderLeft: `3px solid ${T.amber}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>⏸</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.amber }}>RUN HALTED — invalid combos</div>
      </div>
      <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 16, lineHeight: 1.55 }}>
        {message || `${blocked.length} combo(s) cannot be served by this prompt.`} Guessing would test a
        prompt production never sends, so nothing runs until you rule on each one. Whatever you write is
        merged in for real <i>and</i> handed to the coach as a hole it must fix in the prompt itself.
      </div>

      {blocked.map((b) => {
        const a = answers[b.key] || { action: 'content', text: '' }
        const set = (patch: Partial<{ action: string; text: string }>) =>
          setAnswers((p) => ({ ...p, [b.key]: { ...a, ...patch } }))
        return (
          <div key={b.key} style={{ marginBottom: 18, padding: 14, background: T.surface2, borderRadius: 8 }}>
            <div style={{ marginBottom: 6 }}><ComboChip combo={b.key} /></div>
            <div style={{ fontSize: 12, color: T.faint, marginBottom: 11, lineHeight: 1.5 }}>{b.detail}</div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
              {[
                ['content', b.gap?.startsWith('no_stage') ? 'Write the flow stage' : 'Write the greeting'],
                ['fallback', 'Fall back to outbound'],
                ['skip', 'Skip this combo (N/A)'],
              ].map(([val, lbl]) => (
                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                  color: a.action === val ? T.text : T.muted, cursor: 'pointer' }}>
                  <input type="radio" checked={a.action === val} onChange={() => set({ action: val })} />
                  {lbl}
                </label>
              ))}
            </div>
            {a.action === 'content' ? (
              <>
                <textarea value={a.text} onChange={(e) => set({ text: e.target.value })}
                  placeholder={`e.g. Hi <name>, this is Priya calling back about the site visit we discussed…`}
                  rows={3} style={{
                    width: '100%', background: T.well, color: T.text, border: `1px solid ${T.border2}`,
                    borderRadius: 6, padding: 10, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical',
                  }} />
                <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>
                  <code>&lt;name&gt;</code> is substituted with the lead's name, exactly as production does.
                </div>
              </>
            ) : null}
          </div>
        )
      })}

      {err ? <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{err}</div> : null}
      <button disabled={busy || incomplete.length > 0} onClick={submit}
        style={{
          padding: '9px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 600,
          background: incomplete.length ? T.border2 : T.accent, color: incomplete.length ? T.faint : '#111',
          cursor: incomplete.length || busy ? 'not-allowed' : 'pointer',
        }}>
        {busy ? 'Resuming…' : incomplete.length ? `${incomplete.length} still unanswered` : 'Save & resume run'}
      </button>
    </div>
  )
}

/** Operator's standing instructions to the coach for THIS run. Editable while the run is
 *  going — the engine re-reads it before every proposal, so it lands on the next iteration. */
export function CoachGuidancePanel({ runId, live }: { runId: string; live?: boolean }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let dead = false
    api.forgeCoachGuidance(runId)
      .then((r) => { if (!dead) { setText(r.coach_guidance || ''); setSaved(r.coach_guidance || '') } })
      .catch(() => {})
    return () => { dead = true }
  }, [runId])

  const dirty = text !== saved
  async function save() {
    setState('saving')
    try {
      await api.forgeSetCoachGuidance(runId, text)
      setSaved(text); setState('saved')
    } catch { setState('error') }
  }

  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={label}>Coach guidance</div>
      <div style={{ fontSize: 11.5, color: T.faint, margin: '5px 0 10px', lineHeight: 1.5 }}>
        Anything specific you want the coach to do — style, wording, things to never say.
        {live ? ' Editable mid-run: the coach picks it up on the next iteration.' : null}
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setState('idle') }}
        rows={6} placeholder={"Never use the word 'sir'.\nKeep replies under 2 lines.\nSay 'square feet', never 'sqft'."}
        style={{
          width: '100%', background: T.surface2, color: T.text, border: `1px solid ${T.border2}`,
          borderRadius: 6, padding: 10, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical',
        }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button disabled={!dirty || state === 'saving'} onClick={save}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
            background: dirty ? T.accent : T.border2, color: dirty ? '#111' : T.faint,
            cursor: dirty ? 'pointer' : 'default',
          }}>
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <span style={{ fontSize: 11, color: state === 'error' ? T.red : T.faint }}>
          {state === 'error' ? 'save failed' : state === 'saved' && !dirty ? 'saved — applies from the next iteration' : ''}
        </span>
        <SizeHint text={text} />
      </div>
    </div>
  )
}

// ── LIVE STATUS ─────────────────────────────────────────────────────────────
// "What is happening right now", in words, so the run is readable without
// parsing the log. Every stage below maps 1:1 to something runner.py actually
// emits (a progress `phase`, iteration_start, or an iteration_note) — nothing
// here is guessed, and an unknown phase falls through to its raw name rather
// than silently showing a stale stage.
const STAGE_META: Record<string, { title: string; blurb: string; color: string }> = {
  starting: { title: 'Starting up', blurb: 'Loading the problem set and assembling the prompt under test.', color: T.blue },
  tool_checks: { title: 'Checking the tools fire', blurb: 'Each tool is dropped into a situation that should trigger it, in several phrasings — does the model actually call it, or just talk about it?', color: T.purple },
  tool_fix: { title: 'Fixing a tool that never fired', blurb: 'Coaching the prompt for that one tool, then re-running its checks. The edit is kept only if the tool now fires on every phrasing.', color: T.purple },
  conversations: { title: 'Simulating conversations', blurb: 'Role-playing leads against the prompt. Nothing is graded yet — every conversation is stored first, then judged.', color: 'var(--accent)' },
  judging: { title: 'Judging the conversations', blurb: 'The judge reads each finished conversation and rules whether the problem showed up.', color: T.amber },
  confirm_convos: { title: 'Deep-confirming the passes', blurb: 'Re-running everything that passed, many more times over. A 3/3 pass proves nothing.', color: T.amber },
  stress: { title: 'Stress testing', blurb: 'Hundreds of free-form persona × mood calls. No judge and no script — five habits are measured in code across every agent turn: yapping, bot-words, spoken digits, formatting characters, repeat loops.', color: T.purple },
  deepeval: { title: 'Scoring quality', blurb: 'Faithfulness, answer relevancy and self-consistency, measured over those same conversations.', color: T.blue },
  coaching: { title: 'Coaching the prompt', blurb: 'Rewriting one layer to fix one problem — then re-testing to see whether the fix actually held.', color: 'var(--accent)' },
  parked: { title: 'Waiting on you', blurb: 'The coach parked a question it will not answer on its own. Answer it to unblock those problems.', color: T.purple },
  done: { title: 'Finished', blurb: 'The run is over.', color: T.green },
}

// How a finished run is described. A failed run must SAY failed — "Finished" over a
// crash reads like success, and the reason strip sits right underneath.
const TERMINAL_META: Record<string, { title: string; blurb: string; color: string }> = {
  failed: { title: 'Run failed', blurb: 'The run stopped on an error before it could finish. The reason is below — anything already stored is still on the Simulations page.', color: T.red },
  stopped: { title: 'Stopped by you', blurb: 'Everything the run had already stored is kept.', color: T.amber },
  llm_complete: { title: 'LLM-complete', blurb: 'The gate was reached. A human still has to take the prompt the rest of the way.', color: T.green },
  converged_below_gate: { title: 'Converged below the gate', blurb: 'The coach ran out of moves before reaching the gate. The problems still open are in the results.', color: T.amber },
  awaiting_human: { title: 'Waiting on you', blurb: 'The run is paused on something it will not decide by itself.', color: T.purple },
  finalized: { title: 'Finalized', blurb: 'A human has signed this prompt off.', color: T.green },
}

// The visible spine of a run, in the order runner.py walks it.
const PIPELINE: [string, string][] = [
  ['tool_checks', 'Tools'],
  ['conversations', 'Conversations'],
  ['judging', 'Judging'],
  ['confirm_convos', 'Confirm'],
  ['stress', 'Stress'],
  ['deepeval', 'Metrics'],
  ['coaching', 'Coaching'],
]

type ForgeEventLike = { event_type: string; event_data: Record<string, unknown>; created_at: string }

type NowState = {
  key: string
  done: number | null
  total: number | null
  detail: string
  note: string
  target: string | null
  layer: string | null
  attempt: number | null
  combo: string | null
  since: number | null
  seen: Set<string>
}

const str = (v: unknown) => (v == null ? '' : String(v))

function deriveNow(events: ForgeEventLike[]): NowState {
  const n: NowState = { key: 'starting', done: null, total: null, detail: '', note: '',
    target: null, layer: null, attempt: null, combo: null, since: null, seen: new Set() }
  const enter = (k: string, at: string) => {
    if (n.key !== k || n.since == null) {
      n.since = new Date(at).getTime(); n.done = null; n.total = null; n.detail = ''; n.note = ''
    }
    n.key = k
    n.seen.add(k)
  }
  for (const e of events) {
    const d: Record<string, unknown> = e.event_data || {}
    switch (e.event_type) {
      case 'run_start': {
        enter('starting', e.created_at)
        const gate = d.n_problems ? `${str(d.n_problems)} problems in the gate` : ''
        n.detail = [n.detail, gate].filter(Boolean).join(' · ')
        break
      }
      case 'probes_ready': {
        enter('starting', e.created_at)
        const ds = d.n ? `${str(d.n)} persona${d.n === 1 ? '' : 's'}${d.source ? ` · ${str(d.source)}` : ''}` : ''
        n.detail = [n.detail, ds].filter(Boolean).join(' · ')
        break
      }
      case 'progress':
        enter(str(d.phase) || 'starting', e.created_at)
        n.done = typeof d.done === 'number' ? d.done : n.done
        n.total = typeof d.total === 'number' ? d.total : n.total
        n.detail = d.problem_id
          ? `${str(d.problem_id)}${d.verdict ? ` → ${str(d.verdict)}` : ''}`
          : str(d.probe)
        break
      case 'iteration_start':
        enter('coaching', e.created_at)
        n.target = str(d.targeted_problem) || null
        n.attempt = typeof d.attempt === 'number' ? d.attempt : null
        break
      case 'iteration_note': {
        const note = str(d.note)
        if (/^coaching \S+:/.test(note)) enter('tool_fix', e.created_at)
        n.note = note
        const m = note.match(/^combo (\d+\/\d+) — (\S+?):/)
        if (m) n.combo = `${m[2]} (${m[1]})`
        break
      }
      case 'version_recorded':
        n.layer = str(d.layer_for_fix) || n.layer
        break
      case 'escalation_raised':
        enter('parked', e.created_at)
        n.detail = str(d.question).slice(0, 90)
        break
      case 'run_complete':
        enter('done', e.created_at)
        n.detail = d.solved_pct != null ? `${str(d.solved_pct)}% solved` : ''
        break
    }
  }
  return n
}

function humanDur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function LiveStatusPanel({ events, runStatus, live }: {
  events: ForgeEventLike[]
  runStatus: string
  live: boolean
}) {
  const now = deriveNow(events)
  // A ticking clock so "elapsed" advances between events, not only when one lands.
  // Seeded to 0 rather than Date.now() — reading the clock during render is impure,
  // and the first interval fills it in a second later.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const iv = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [live])

  const key = live ? now.key : 'done'
  const meta = (live ? STAGE_META[key] : TERMINAL_META[runStatus])
    || STAGE_META[key]
    || { title: key.replace(/_/g, ' '), blurb: '', color: T.blue }
  const pct = now.total ? Math.min(100, Math.round((now.done || 0) / now.total * 100)) : null
  const elapsed = now.since && tick ? tick - now.since : null

  // ETA straight from the observed rate of THIS stage — no model, no fudge
  let eta: string | null = null
  if (live && pct != null && now.done && now.done >= 3 && elapsed && now.total) {
    const perItem = elapsed / now.done
    const left = (now.total - now.done) * perItem
    if (left > 1500) eta = `~${humanDur(left)} left`
  }

  const curIdx = PIPELINE.findIndex(([k]) => k === key)

  return (
    <div style={{ ...card, padding: 0, marginTop: 16, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: 4, background: meta.color, flexShrink: 0 }} />
      <div style={{ padding: '15px 18px', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {live && <span className="pulse-dot" style={{ width: 9, height: 9, borderRadius: 99, background: meta.color, flexShrink: 0 }} />}
          <span style={{ fontSize: 17, fontWeight: 650, color: T.text }}>{meta.title}</span>
          {now.attempt != null && now.attempt > 0 && (
            <span style={{ fontSize: 11.5, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              iteration {now.attempt}
            </span>
          )}
          {now.target && <LayerBadge layer={now.layer} />}
          {now.target && <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text2 }}>fixing {now.target}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: T.faint }}>
            {now.total != null && (
              <span style={{ fontFamily: T.mono, color: T.text2 }}>{now.done ?? 0} / {now.total}</span>
            )}
            {eta && <span>{eta}</span>}
            {elapsed != null && <span>{humanDur(elapsed)}</span>}
          </div>
        </div>

        <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{meta.blurb}</div>

        {pct != null && (
          <div style={{ marginTop: 11, height: 6, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 99, transition: 'width .4s ease' }} />
          </div>
        )}

        {(now.detail || now.combo || now.note) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {now.combo && <Pill text={now.combo} mono />}
            {now.detail && <Pill text={now.detail} mono />}
            {now.note && !now.detail && <Pill text={now.note.slice(0, 90)} />}
          </div>
        )}

        {/* the spine — which stages this run has already been through */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 13, flexWrap: 'wrap' }}>
          {PIPELINE.map(([k, lbl], i) => {
            const isCur = k === key
            const isPast = curIdx >= 0 ? i < curIdx : now.seen.has(k)
            const c = isCur ? meta.color : isPast ? T.text3 : T.fainter
            return (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: T.fainter, fontSize: 10 }}>›</span>}
                <span style={{
                  fontSize: 11, color: c, fontWeight: isCur ? 700 : 500,
                  padding: isCur ? '2px 8px' : '2px 0', borderRadius: 99,
                  background: isCur ? meta.color + '1f' : 'transparent',
                }}>{lbl}</span>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Pill({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 99, background: T.chip, color: T.text3,
      fontSize: 11.5, fontFamily: mono ? T.mono : undefined,
      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

// ── RUN DURATION ────────────────────────────────────────────────────────────
// Wall-clock from starting the run to the moment it handed back to a human. That
// handover is the end of the machine's job, so it is what `completed_at` marks —
// including a run halted at the combo gate, which stops and waits for a person.
export function runDuration(createdAt: string, completedAt: string | null, nowMs?: number) {
  const start = new Date(createdAt).getTime()
  if (!Number.isFinite(start)) return null
  const end = completedAt ? new Date(completedAt).getTime() : (nowMs ?? 0)
  if (!end || end < start) return null
  return end - start
}

export function fmtDuration(ms: number | null) {
  if (ms == null) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Elapsed for a live run, final duration for a finished one. */
export function RunDuration({ createdAt, completedAt, live, label = 'took' }: {
  createdAt: string; completedAt: string | null; live?: boolean; label?: string
}) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!live) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [live])
  const txt = fmtDuration(runDuration(createdAt, completedAt, now))
  if (!txt) return null
  return (
    <span style={{ fontSize: 12.5, color: T.faint, whiteSpace: 'nowrap' }}>
      {live ? 'running' : label} {txt}
    </span>
  )
}
