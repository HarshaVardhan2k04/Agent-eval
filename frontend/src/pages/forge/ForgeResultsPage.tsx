import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, backBtn } from '../../theme'
import { useForgeStore } from '../../stores/forgeStore'
import { ScoreRing, MetricBar, SECTION_LABELS, METRIC_LABELS } from '../../components/analysis'
import { RunStatusChip, SolvedGauge, VerdictCell, LayerBadge, ProofPanel } from '../../components/forge'

type StatusEntry = { verdict: string | null; passes?: number; votes?: number; evidence?: string; sim_uids?: string[]; fails?: { sim_uid: string | null; reason?: string; failing_turn?: number | null }[] }

export function ForgeResultsPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { currentRun, fetchRun, problems, fetchProblems } = useForgeStore()
  const [proofPid, setProofPid] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)

  useEffect(() => { if (id) fetchRun(id); fetchProblems() }, [id, fetchRun, fetchProblems])

  const run = currentRun && currentRun.id === id ? currentRun : null
  if (!run) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>

  // latest scored version (accepted preferred, else baseline)
  const scored = [...run.versions].reverse().find((v) => v.status === 'accepted' && v.composite != null)
    || [...run.versions].reverse().find((v) => v.composite != null)
  const statuses: Record<string, StatusEntry> =
    ([...run.versions].reverse().find((v) => v.statuses_json)?.statuses_json as Record<string, StatusEntry>) || {}
  const denom = run.denominator_snapshot_json?.length ?? null
  const gate = Number(run.scoring_json?.gate_pct ?? 95)
  const problemOf = (pid: string) => problems.find((p) => p.id === pid)
  const behaviourOf = (pid: string) => problemOf(pid)?.behaviour || pid

  // report card rows: every judged problem, failures first, then partial, then solved;
  // human-territory catalog rows greyed at the bottom.
  const rank = (v: string | null | undefined) => (v === 'N' ? 0 : v === '~' ? 1 : v === 'Y' ? 2 : 3)
  const judged = Object.entries(statuses).sort((a, b) =>
    rank(a[1].verdict) - rank(b[1].verdict) || Number(a[0].slice(1)) - Number(b[0].slice(1)))
  const humanOnly = problems.filter((p) => p.filter_territory).map((p) => p.id)

  const rowStyle = (i: number): React.CSSProperties => ({
    display: 'grid', gridTemplateColumns: '44px 44px 1fr 86px 72px minmax(180px, 0.7fr)',
    gap: 10, alignItems: 'center', padding: '7px 14px', cursor: 'pointer',
    background: i % 2 ? T.well : 'transparent', borderTop: `1px solid ${T.divider}`,
  })

  return (
    <div>
      <button onClick={() => (run.arena_id ? nav(`/forge/arena/${run.arena_id}`) : nav('/forge'))} style={backBtn}>
        {run.arena_id ? '← Back to arena' : '← Back to runs'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <ScoreRing value={run.final_composite} size={62} />
        <div>
          <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>{run.name || run.id}</h1>
          <p style={{ fontSize: 13, color: T.muted, margin: '5px 0 0' }}>
            {run.mode} · {run.dataset_kind} dataset · {run.arena_id ? 'arena run — single pass' : `v${run.current_version}`}
          </p>
        </div>
        <RunStatusChip status={run.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderLink onClick={() => nav(`/forge/${run.id}/sims`)}>Simulations →</HeaderLink>
          <HeaderLink onClick={() => nav(`/forge/${run.id}/matrix`)}>Matrix →</HeaderLink>
          {run.arena_id
            ? <HeaderLink onClick={() => setPromptOpen((v) => !v)}>{promptOpen ? 'Hide prompt' : 'Prompt used'}</HeaderLink>
            : <HeaderLink onClick={() => nav(`/forge/${run.id}/versions`)}>Versions →</HeaderLink>}
          <button onClick={() => nav(`/forge/${run.id}/review`)}
            style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: T.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Continue to human review →
          </button>
        </div>
      </div>

      {promptOpen && (() => {
        const snap = run.original_prompt_snapshot as { blob?: unknown } | null
        const text = typeof snap?.blob === 'string' && snap.blob.trim()
          ? snap.blob
          : ([...run.versions].find((v) => v.version === 0)?.merged_markdown || '(prompt not stored)')
        return (
          <div style={{ ...card, marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
              The exact prompt this model fought with
            </div>
            <pre style={{ margin: 0, padding: 16, fontFamily: T.mono, fontSize: 12, lineHeight: 1.65, color: T.text2, whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto' }}>{text}</pre>
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 14, marginTop: 22, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: 18, minWidth: 250 }}>
          <SolvedGauge solvedPct={run.solved_pct} denominator={denom} gatePct={gate} />
        </div>
        <div style={{ ...card, padding: 18, flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={label}>The honest read</div>
            <div style={{ fontSize: 13, color: T.text3, marginTop: 6, lineHeight: 1.6, maxWidth: 520 }}>
              {run.status === 'llm_complete' && `The judge cleared the ${gate}% gate — but Gemma tops out around 85–90. A human pass is still required.`}
              {run.status === 'converged_below_gate' && `The loop plateaued below the ${gate}% gate — the leftovers look like capability ceilings or need your call. Take it to human review.`}
              {run.status === 'awaiting_human' && 'The coach parked questions it can\'t answer alone — answer them in progress, or take over in human review.'}
              {run.status === 'finalized' && 'Finalized by a human reviewer.'}
              {['optimizing', 'collecting', 'stopped', 'failed', 'human_review'].includes(run.status) && `Status: ${run.status}.`}
            </div>
          </div>
        </div>
      </div>

      {/* sections */}
      {scored?.section_scores_json && (
        <>
          <div style={{ ...label, margin: '26px 0 12px' }}>How the agent did (sections · median of best-of-N)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
            {Object.keys(SECTION_LABELS).map((k) => (
              <MetricBar key={k} name={k} value={scored.section_scores_json?.[k] ?? null} />
            ))}
          </div>
        </>
      )}

      {/* deepeval metrics */}
      {scored?.metrics_json && (
        <>
          <div style={{ ...label, margin: '26px 0 12px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span>Metrics (deepeval)</span>
            <button onClick={() => nav(`/forge/${run.id}/sims?kind=deepeval`)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0, textTransform: 'none', letterSpacing: 0 }}>
              view the scored conversations →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {Object.keys(METRIC_LABELS).map((k) => (
              <MetricBar key={k} name={k} value={scored.metrics_json?.[k] ?? null} />
            ))}
          </div>
        </>
      )}

      {/* THE REPORT CARD — every judged problem, one dense row, click = proof */}
      <div style={{ ...label, margin: '26px 0 10px' }}>
        Report card — every problem, its votes, and the evidence (click a row for the conversations)
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '44px 44px 1fr 86px 72px minmax(180px, 0.7fr)', gap: 10, padding: '8px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
          <span /><span>ID</span><span>Problem</span><span>Layer</span><span>Votes</span><span>Evidence</span>
        </div>
        {judged.map(([pid, s], i) => (
          <div key={pid} className="ev-row" style={rowStyle(i)} onClick={() => setProofPid(pid)}
            title="Click to see the conversations behind this verdict">
            <VerdictCell verdict={s.verdict} />
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>{pid}</span>
            <span style={{ fontSize: 13, color: s.verdict === 'N' ? T.text : T.text3, fontWeight: s.verdict === 'N' ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {behaviourOf(pid)}
            </span>
            <LayerBadge layer={problemOf(pid)?.layer_for_fix} />
            <span style={{ fontFamily: T.mono, fontSize: 12, color: s.verdict === 'Y' ? T.green : s.verdict === 'N' ? T.red : T.amber }}>
              {s.passes != null ? `${s.passes}/${s.votes}` : '—'}
            </span>
            <span style={{ fontSize: 12, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(s.evidence || '').replace(/^\d+\/\d+\s*/, '')}
            </span>
          </div>
        ))}
        {judged.length === 0 && (
          <div style={{ padding: '30px 20px', textAlign: 'center', color: T.fainter, fontSize: 13 }}>
            No verdicts yet — the first judging pass hasn't landed.
          </div>
        )}
        {/* human-territory: never auto-judged, by design */}
        {humanOnly.map((pid) => (
          <div key={pid} style={{ ...rowStyle(1), cursor: 'default', opacity: 0.5 }}>
            <span style={{ fontSize: 12, color: T.fainter, textAlign: 'center' }}>—</span>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.fainter }}>{pid}</span>
            <span style={{ fontSize: 12.5, color: T.fainter, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{behaviourOf(pid)}</span>
            <LayerBadge layer={problemOf(pid)?.layer_for_fix} />
            <span style={{ fontSize: 11, color: T.fainter }}>human</span>
            <span style={{ fontSize: 11.5, color: T.fainter }}>filter territory — your call, never auto-judged</span>
          </div>
        ))}
      </div>

      {proofPid && (
        <ProofPanel runId={run.id} problemId={proofPid} behaviour={behaviourOf(proofPid)}
          verdictInfo={statuses[proofPid]} onClose={() => setProofPid(null)} />
      )}
    </div>
  )
}

function HeaderLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 13, cursor: 'pointer' }}>
      {children}
    </button>
  )
}
