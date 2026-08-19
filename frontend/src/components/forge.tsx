// Shared Forge UI primitives — status chips, layer badges, verdict cells, gauges,
// escalation cards, merged-preview panel. All built from the T tokens; no new deps.
import { useEffect, useState } from 'react'
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
        {markdown && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.faint, fontFamily: T.mono }}>{markdown.length.toLocaleString()} chars</span>}
      </div>
      {error ? (
        <div style={{ padding: 16, fontSize: 13, color: T.amber }}>{error}</div>
      ) : markdown ? (
        <pre style={{ margin: 0, padding: 16, maxHeight: 380, overflow: 'auto', background: T.well, fontSize: 11.5, lineHeight: 1.55, color: T.text3, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
          {markdown}
        </pre>
      ) : (
        <div style={{ padding: 20, fontSize: 13, color: T.faint }}>Pick / paste layers to see exactly what the voice agent will receive.</div>
      )}
    </div>
  )
}

// ---- run-then-grade proof components --------------------------------------

export type SimRow = {
  id: number; sim_uid: string; version: number; kind: string
  problem_id: string | null; probe: string | null; idx: number | null
  ended: boolean | null; verdict: string | null; reason: string | null
  failing_turn: number | null; created_at: string; n_turns?: number
  transcript_json?: { role: string; content: string; latency_ms?: number | null; tokens?: number | null }[]
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
                  sim_uids?: string[]; fails?: SimRef[] } | null
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
            {verdictInfo?.passes != null ? `${verdictInfo.passes}/${verdictInfo.votes} conversations passed` : 'verdict'}
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
          {active?.transcript_json
            ? <SimTranscript transcript={active.transcript_json}
                failingTurn={active.failing_turn ?? failOf(active.sim_uid)?.failing_turn} />
            : loading ? <div style={{ color: T.faint, fontSize: 13 }}>Loading…</div> : null}
        </div>
      </div>
    </>
  )
}
