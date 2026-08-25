import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, verdictMeta } from '../../theme'
import { api } from '../../api/client'
import { useForgeStore } from '../../stores/forgeStore'
import { RunStatusChip, LayerBadge, SolvedGauge, EscalationCard, VerdictCell,
  ComboGate, CoachGuidancePanel, ComboScorecard } from '../../components/forge'

type Ev = { id: number; event_type: string; event_data: Record<string, any>; created_at: string }

const TERMINAL = new Set(['llm_complete', 'finalized', 'converged_below_gate', 'stopped', 'failed'])

// Poll the forge_events cursor — the app's proven live pattern (works during AND after a run).
export function ForgeProgressPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { currentRun, fetchRun, stopRun, answerEscalation } = useForgeStore()
  const [events, setEvents] = useState<Ev[]>([])
  const lastIdRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    fetchRun(id)
    let alive = true
    const tick = async () => {
      try {
        const rows: Ev[] = await api.getForgeLog(id, lastIdRef.current)
        if (!alive || rows.length === 0) return
        lastIdRef.current = rows[rows.length - 1].id
        setEvents((prev) => [...prev, ...rows].slice(-500))
        // refresh the run row when a state-changing event lands
        if (rows.some((r) => ['version_recorded', 'run_complete', 'escalation_raised', 'run_start'].includes(r.event_type))) {
          fetchRun(id)
        }
      } catch { /* transient */ }
    }
    tick()
    const iv = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(iv) }
  }, [id, fetchRun])

  // Scroll the LOG's own container, not the page. scrollIntoView() moved the whole
  // document, which yanked the page out from under anyone typing in the guidance box.
  useEffect(() => {
    const end = logEndRef.current
    if (!end) return
    let el: HTMLElement | null = end.parentElement
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
    if (el && el !== document.body && el !== document.documentElement) {
      el.scrollTop = el.scrollHeight
    }
  }, [events.length])

  // derive live state from the event stream
  const live = useMemo(() => {
    let target: string | null = null
    let layer: string | null = null
    let tier: string | null = null
    let lastStatuses: Record<string, { verdict: string }> = {}
    let prevStatuses: Record<string, { verdict: string }> = {}
    for (const e of events) {
      const d = e.event_data
      if (e.event_type === 'iteration_start') { target = d.targeted_problem; tier = 'candidate' }
      if (e.event_type === 'version_recorded') {
        layer = d.layer_for_fix || layer
        tier = d.status === 'baseline' ? 'baseline' : d.status
        if (d.statuses) { prevStatuses = lastStatuses; lastStatuses = d.statuses }
      }
    }
    const deltas: { pid: string; from: string | null; to: string }[] = []
    for (const [pid, s] of Object.entries(lastStatuses)) {
      const from = prevStatuses[pid]?.verdict ?? null
      if (from !== s.verdict) deltas.push({ pid, from, to: s.verdict })
    }
    return { target, layer, tier, deltas, statuses: lastStatuses }
  }, [events])

  const run = currentRun && currentRun.id === id ? currentRun : null
  const isLive = run ? !TERMINAL.has(run.status) && run.status !== 'awaiting_human' : true
  const openEsc = (run?.escalations || []).filter((e) => e.status === 'open')
  const denom = run?.denominator_snapshot_json?.length ?? null
  const gate = Number(run?.scoring_json?.gate_pct ?? 95)

  if (!run) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>

  return (
    <div>
      <button onClick={() => (run.arena_id ? nav(`/forge/arena/${run.arena_id}`) : nav('/forge'))}
        style={{ background: 'none', border: 'none', color: T.faint, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
        {run.arena_id ? '← Back to arena' : '← Back to runs'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>{run.name || run.id}</h1>
        <RunStatusChip status={run.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {isLive && (
            <button onClick={() => stopRun(run.id)}
              style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${T.red}55`, background: T.red + '1c', color: T.red, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Stop
            </button>
          )}
          <button onClick={() => nav(`/forge/${run.id}/sims`)}
            style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 13, cursor: 'pointer' }}>
            Simulations →
          </button>
          {TERMINAL.has(run.status) && (
            <button onClick={() => nav(`/forge/${run.id}/results`)}
              style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: T.accentGrad, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              View results →
            </button>
          )}
          {(run.status === 'awaiting_human' || run.status === 'llm_complete' || run.status === 'converged_below_gate') && (
            <button onClick={() => nav(`/forge/${run.id}/review`)}
              style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: T.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Human review →
            </button>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: T.muted, margin: '6px 0 0' }}>
        v{run.current_version} · {run.mode} · {run.solved_pct != null ? `${run.solved_pct}% of ${denom ?? '—'} problems solved` : 'baseline running'} · gate {gate}%
      </p>

      {run.status === 'awaiting_human' && ((run as any).combos_json?.blocked || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <ComboGate runId={run.id}
            blocked={(run as any).combos_json.blocked}
            message={(run as any).combos_json.gate_message}
            onResolved={() => window.location.reload()} />
        </div>
      )}

      {((run as any).combos_json?.results || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <ComboScorecard results={(run as any).combos_json.results}
            overall={run.solved_pct ?? null} running={isLive}
            allocation={(run as any).combos_json.allocation} />
        </div>
      )}

      {run.status === 'failed' && (
        <div style={{ marginTop: 14, padding: '11px 14px', borderRadius: 10, background: T.red + '14', border: `1px solid ${T.red}44` }}>
          <div style={{ fontSize: 11.5, color: T.red, fontWeight: 700, marginBottom: 3 }}>Why it failed</div>
          <div style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text2, wordBreak: 'break-word' }}>
            {run.error_message || 'no error captured'}
          </div>
        </div>
      )}

      {/* escalations strip (park-and-continue) */}
      {openEsc.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ ...label, color: T.purple, marginBottom: 10 }}>
            The coach parked {openEsc.length} question{openEsc.length > 1 ? 's' : ''} — answer to unblock those problems
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {openEsc.map((e) => (
              <EscalationCard key={e.id} esc={e} onAnswer={(a) => answerEscalation(run.id, e.id, a)} />
            ))}
          </div>
        </div>
      )}

      <div className="prog-grid" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, marginTop: 20, alignItems: 'start' }}>
        {/* LEFT stack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CoachGuidancePanel runId={run.id} live={isLive} />
          <div style={{ ...card, padding: 16 }}>
            <div style={{ ...label, marginBottom: 10 }}>Current focus</div>
            {live.target ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.mono, fontSize: 14, color: T.text, fontWeight: 700 }}>{live.target}</span>
                <LayerBadge layer={live.layer} />
                {live.tier && <span style={{ fontSize: 11, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{live.tier}</span>}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: T.faint }}>Baseline — full pipeline before any coaching.</div>
            )}
          </div>

          <div style={{ ...card, padding: 16 }}>
            <SolvedGauge solvedPct={run.solved_pct} denominator={denom} gatePct={gate} />
          </div>

          <div style={{ ...card, padding: 16 }}>
            <div style={{ ...label, marginBottom: 10 }}>Matrix deltas</div>
            {live.deltas.length === 0 ? (
              <div style={{ fontSize: 12.5, color: T.faint }}>No verdict changes yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {live.deltas.slice(0, 12).map((d) => (
                  <div key={d.pid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ fontFamily: T.mono, color: T.text3, width: 40 }}>{d.pid}</span>
                    <VerdictCell verdict={d.from} />
                    <span style={{ color: T.fainter }}>→</span>
                    <VerdictCell verdict={d.to} />
                    <span style={{ color: verdictMeta[d.to]?.color || T.faint, fontSize: 11.5 }}>{verdictMeta[d.to]?.label}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => nav(`/forge/${run.id}/matrix`)}
              style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
              Open matrix →
            </button>
          </div>
        </div>

        {/* RIGHT — terminal log */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderBottom: `1px solid ${T.divider}` }}>
            {[T.red, T.amber, T.green].map((c, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 99, background: c + '66' }} />)}
            <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 6, fontFamily: T.mono }}>forge · {run.id}</span>
            {isLive && <span style={{ marginLeft: 'auto', fontSize: 11, color: T.blue }}>live</span>}
          </div>
          <div style={{ background: T.well, padding: '12px 15px', height: 460, overflowY: 'auto', fontFamily: T.mono, fontSize: 12, lineHeight: 1.7 }}>
            {events.length === 0 && <div style={{ color: T.fainter }}>Waiting for the engine…</div>}
            {events.map((e) => <LogLine key={e.id} ev={e} />)}
            {isLive && events.length > 0 && (
              <div style={{ color: T.purple, marginTop: 4 }}>
                <span className="pulse-dot" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: T.purple, marginRight: 8 }} />
                working…
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function LogLine({ ev }: { ev: Ev }) {
  const d = ev.event_data
  let color: string = T.text3
  let text = ev.event_type
  switch (ev.event_type) {
    case 'run_start':
      color = T.blue; text = `run started · ${d.n_problems} applicable problems in the gate`; break
    case 'probes_ready':
      color = T.blue; text = `dataset ready · ${d.n} probe(s) (${d.source})`; break
    case 'iteration_start':
      color = 'var(--accent)'; text = `iteration ${d.attempt} → targeting ${d.targeted_problem}`; break
    case 'version_recorded':
      if (d.status === 'baseline') { color = T.blue; text = `v0 baseline · solved ${d.solved_pct}% · composite ${d.composite ?? '—'}` }
      else if (d.status === 'accepted') { color = T.green; text = `v${d.version} ACCEPTED · ${d.targeted_problem} → Y (${d.layer_for_fix}) · solved ${d.solved_pct}%` }
      else { color = T.amber; text = `v${d.version} reverted · ${d.reason}${d.regressed?.length ? ` (broke ${d.regressed.join(', ')})` : ''}` }
      break
    case 'escalation_raised':
      color = T.purple; text = `escalated to you: ${String(d.question || '').slice(0, 80)}`; break
    case 'sim_recorded':
      color = T.faint
      text = `conversation saved · ${d.problem_id || d.probe || '?'}${d.idx != null ? ` #${Number(d.idx) + 1}` : ''} · ${d.n_turns ?? '?'} turns${d.ended ? ' · ended' : ''}`
      break
    case 'progress': {
      const phase = d.phase === 'matrix' ? 'problem checks' : d.phase === 'deep_confirm' ? 'deep-confirm'
        : d.phase === 'conversations' ? 'conversations' : d.phase === 'confirm_convos' ? 'confirm conversations' : d.phase === 'judging' ? 'judging'
        : d.phase === 'stress' ? 'stress sims' : d.phase === 'deepeval' ? 'deepeval' : d.phase
      const what = d.problem_id ? ` · ${d.problem_id}${d.verdict ? ` → ${d.verdict}` : ''}` : d.probe ? ` · ${d.probe}` : ''
      color = d.verdict === 'N' ? T.amber : T.faint
      text = `${phase} ${d.done}/${d.total}${what}`
      break
    }
    case 'iteration_note':
      color = T.faint; text = `note: ${d.note}`; break
    case 'run_complete':
      color = d.status === 'llm_complete' ? T.green : T.amber2
      // a halted run has no score yet — "null% solved" reads like a bug, not a pause
      text = d.status === 'needs_human_combo'
        ? 'halted — waiting on your ruling for the invalid combo(s)'
        : `run complete · ${d.status}${d.solved_pct != null ? ` · ${d.solved_pct}% solved` : ''}`
      break
    default:
      color = T.fainter
  }
  return <div style={{ color }}>{text}</div>
}
