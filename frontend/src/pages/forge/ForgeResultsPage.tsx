import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, backBtn } from '../../theme'
import { useForgeStore } from '../../stores/forgeStore'
import { api } from '../../api/client'
import { ScoreRing, MetricBar, SECTION_LABELS, METRIC_LABELS } from '../../components/analysis'
import { RunStatusChip, SolvedGauge, VerdictCell, LayerBadge, ProofPanel,
  ComboScorecard } from '../../components/forge'

type StatusEntry = { verdict: string | null; passes?: number; votes?: number; evidence?: string; source?: string; sim_uids?: string[]; fails?: { sim_uid: string | null; reason?: string; failing_turn?: number | null }[] }

export function ForgeResultsPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { currentRun, fetchRun, problems, fetchProblems } = useForgeStore()
  const [proofPid, setProofPid] = useState<string | null>(null)
  type ToolReport = { n_sims: number; convos_with_tools: number; convos_with_leaks: number
    offered: string[]; tools: { name: string; fired: number; unknown: number; leaked: number; sims: string[] }[] }
  const [toolReport, setToolReport] = useState<ToolReport | null>(null)
  useEffect(() => { if (id) api.forgeToolReport(id).then(setToolReport).catch(() => {}) }, [id])
  const [promptOpen, setPromptOpen] = useState(false)

  useEffect(() => { if (id) fetchRun(id); fetchProblems() }, [id, fetchRun, fetchProblems])

  const run = currentRun && currentRun.id === id ? currentRun : null
  // a LIVE run has no results yet — its home is the progress page
  useEffect(() => {
    if (run && ['optimizing', 'collecting'].includes(run.status)) nav(`/forge/${run.id}/progress`, { replace: true })
  }, [run, nav])
  if (!run) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>
  if (['optimizing', 'collecting'].includes(run.status)) return <div style={{ color: T.faint, padding: 20 }}>Run is live — opening progress…</div>

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

      {((run as any).combos_json?.results || []).length > 0 && (
        <div style={{ marginTop: 22 }}>
          <ComboScorecard results={(run as any).combos_json.results}
            overall={run.solved_pct ?? null} gatePct={gate}
            allocation={(run as any).combos_json.allocation} />
        </div>
      )}

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
              {['optimizing', 'collecting', 'stopped', 'human_review'].includes(run.status) && `Status: ${run.status}.`}
              {run.status === 'failed' && (
                <div style={{ padding: '9px 12px', borderRadius: 9, background: T.red + '14', border: `1px solid ${T.red}44` }}>
                  <div style={{ fontSize: 11.5, color: T.red, fontWeight: 700, marginBottom: 3 }}>Why it failed</div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text2, wordBreak: 'break-word' }}>
                    {run.error_message || 'no error captured — check the progress log'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* sections */}
      {scored?.section_scores_json && (
        <>
          <div style={{ ...label, margin: '26px 0 12px' }}>How the agent did (judged sections · median across scored conversations)</div>
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

      {/* TOOL CHECKS — per tool, in the exact situation that tool exists for */}
      {(() => {
        const raw = ([...run.versions].reverse().find((v) => v.tool_checks_json)?.tool_checks_json
          || null) as (Record<string, { verdict: string; called: number; spoken_only: number; not_called: number; n: number }>
            & { _fixes?: { tool: string; from: string; to: string; summary?: string }[] }) | null
        if (!raw) return null
        const { _fixes: fixes, ...checks } = raw
        if (!Object.keys(checks).length) return null
        const meta = (v: string) => v === 'called' ? { c: T.green, t: '✓ calls it' }
          : v === 'spoken_only' ? { c: T.red, t: '⚠ says the name, never calls' }
          : v === 'partial' ? { c: T.amber, t: '~ only on some phrasings' }
          : { c: T.red, t: '✗ never calls it' }
        return (
          <>
            <div style={{ ...label, margin: '26px 0 10px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span>Tool checks — does it call each tool when the situation demands it?</span>
              <button onClick={() => nav(`/forge/${run.id}/sims?kind=toolcheck`)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0, textTransform: 'none', letterSpacing: 0 }}>
                view the check conversations →
              </button>
            </div>
            <div style={{ ...card, overflow: 'hidden' }}>
              {Object.entries(checks).sort((a, b) => a[0].localeCompare(b[0])).map(([tool, r], i) => {
                const m = meta(r.verdict)
                return (
                  <div key={tool} className="ev-row" onClick={() => nav(`/forge/${run.id}/sims?kind=toolcheck`)}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 200px 120px', gap: 10, alignItems: 'center',
                             padding: '8px 14px', cursor: 'pointer', background: i % 2 ? T.well : 'transparent',
                             borderTop: i ? `1px solid ${T.divider}` : 'none' }}>
                    <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text2 }}>{tool}</span>
                    <span style={{ fontSize: 12.5, color: m.c, fontWeight: 600 }}>{m.t}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fainter }}>
                      {r.called}/{r.n} phrasings
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}

      {/* fixes the coach applied and VERIFIED (tool re-checked and now firing) */}
      {(() => {
        const raw = [...run.versions].reverse().find((v) => v.tool_checks_json)?.tool_checks_json as
          { _fixes?: { tool: string; from: string; to: string; summary?: string }[] } | null
        const fixes = raw?._fixes
        if (!fixes?.length) return null
        return (
          <div style={{ ...card, marginTop: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.green, marginBottom: 8 }}>
              Coach fixed {fixes.length} tool{fixes.length > 1 ? 's' : ''} — each verified by re-running its checks
            </div>
            {fixes.map((f) => (
              <div key={f.tool} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>{f.tool}</span>
                <span style={{ fontSize: 11.5, color: T.red }}>{f.from}</span>
                <span style={{ fontSize: 11.5, color: T.fainter }}>→</span>
                <span style={{ fontSize: 11.5, color: T.green }}>{f.to}</span>
                {f.summary && <span style={{ fontSize: 11.5, color: T.muted }}>· {f.summary}</span>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* TOOL CALLING — did the model actually CALL its tools, or just talk about them? */}
      {toolReport && (toolReport.tools.length > 0 || toolReport.offered.length > 0) && (
        <>
          <div style={{ ...label, margin: '26px 0 10px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span>Tool calling — what the model actually did with its tools</span>
            <span style={{ fontSize: 11.5, color: T.fainter, textTransform: 'none', letterSpacing: 0 }}>
              {toolReport.convos_with_tools}/{toolReport.n_sims} conversations used a tool
              {toolReport.convos_with_leaks > 0 && (
                <span style={{ color: T.red }}> · {toolReport.convos_with_leaks} spoke a tool name instead of calling it</span>
              )}
            </span>
          </div>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px minmax(140px,0.6fr)', gap: 10, padding: '8px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
              <span>Tool</span><span>Called</span><span>Unknown</span><span>Spoken only</span><span>Verdict</span>
            </div>
            {toolReport.tools.map((t, i) => {
              const total = t.fired + t.unknown + t.leaked
              const pct = total ? Math.round((100 * t.fired) / total) : 0
              return (
                <div key={t.name} className="ev-row" onClick={() => nav(`/forge/${run.id}/sims`)}
                  title="Open the conversations"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px minmax(140px,0.6fr)', gap: 10, alignItems: 'center', padding: '7px 14px', cursor: 'pointer', background: i % 2 ? T.well : 'transparent', borderTop: `1px solid ${T.divider}` }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text2 }}>{t.name}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: t.fired ? T.green : T.fainter }}>{t.fired}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: t.unknown ? T.amber : T.fainter }}>{t.unknown}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: t.leaked ? T.red : T.fainter }}>{t.leaked}</span>
                  <span style={{ fontSize: 12, color: pct === 100 ? T.green : pct > 0 ? T.amber : T.red }}>
                    {pct}% executed{t.leaked ? ` · ${t.leaked} never ran` : ''}
                  </span>
                </div>
              )
            })}
            {toolReport.offered.filter((n) => !toolReport.tools.some((t) => t.name === n)).map((n) => (
              <div key={n} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px minmax(140px,0.6fr)', gap: 10, alignItems: 'center', padding: '7px 14px', borderTop: `1px solid ${T.divider}`, opacity: 0.55 }}>
                <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.fainter }}>{n}</span>
                <span style={{ fontSize: 12, color: T.fainter }}>—</span><span /><span />
                <span style={{ fontSize: 11.5, color: T.fainter }}>offered, never used</span>
              </div>
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
              {s.votes ? `${s.passes}/${s.votes}` : (s.source === 'prompt_text' ? 'prompt' : 'metric')}
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
