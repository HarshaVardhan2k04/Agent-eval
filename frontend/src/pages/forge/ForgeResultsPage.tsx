import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, card, label, backBtn } from '../../theme'
import { useForgeStore } from '../../stores/forgeStore'
import type { UnsolvedReason } from '../../stores/forgeStore'
import { api } from '../../api/client'
import { ScoreRing, MetricBar, SECTION_LABELS, METRIC_LABELS } from '../../components/analysis'
import { RunDuration, RunStatusChip, SolvedGauge, VerdictCell, LayerBadge, ProofPanel,
  ComboScorecard, isVerifyRun } from '../../components/forge'

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
  const verify = isVerifyRun(run)
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
            {run.mode} · {run.dataset_kind} dataset · {verify ? 'verification — prompt measured as written' : run.arena_id ? 'arena run — single pass' : `v${run.current_version}`}
            {/* which judge produced these numbers — scores from two judges don't compare */}
            {(() => {
              const j = run.scoring_json?.judge as { model?: string } | undefined
              return j?.model ? <> · judged by <span style={{ fontFamily: T.mono, color: T.text3 }}>{j.model}</span></> : null
            })()}
            {run.completed_at && <> · <RunDuration createdAt={run.created_at} completedAt={run.completed_at} label="took" /></>}
          </p>
        </div>
        <RunStatusChip status={run.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderLink onClick={() => nav(`/forge/${run.id}/sims`)}>Simulations →</HeaderLink>
          <HeaderLink onClick={() => nav(`/forge/${run.id}/matrix`)}>Matrix →</HeaderLink>
          {run.arena_id
            ? <HeaderLink onClick={() => setPromptOpen((v) => !v)}>{promptOpen ? 'Hide prompt' : 'Prompt used'}</HeaderLink>
            : <HeaderLink onClick={() => nav(`/forge/${run.id}/versions`)}>Versions →</HeaderLink>}
          {verify ? (
            <button onClick={() => { seedSetupFromRun(run); nav('/forge/new') }}
              style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: T.accentGrad, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Optimize this prompt →
            </button>
          ) : (
            <button onClick={() => nav(`/forge/${run.id}/review`)}
              style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: T.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Continue to human review →
            </button>
          )}
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
              {run.status === 'verified' && (
                `${Object.keys(run.unsolved_json || {}).length} problem(s) found in this prompt as written. `
                + 'Nothing was edited — every verdict below is about the prompt you supplied. '
                + 'Click any row for the conversation that proves it.'
              )}
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

      {/* WHY THE GAP — a run that stops below the gate accounts for it problem by problem */}
      <StressPanel stress={scored?.stress_json ?? [...run.versions].reverse().find((v) => v.stress_json)?.stress_json} />

      <UnsolvedPanel unsolved={run.unsolved_json} verify={verify} behaviourOf={(pid) =>
        problems.find((p) => p.id === pid)?.behaviour || pid} />

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


// ── WHY EACH PROBLEM IS NOT SOLVED ──────────────────────────────────────────
// The point of a run is a prompt with the matrix solved. When it stops short, the
// gap has to be accountable per problem — and each category maps to a DIFFERENT
// action, which is why they are grouped rather than listed flat.
const CAT_META: Record<string, { label: string; hint: string; color: string }> = {
  regression: { label: 'Fixing it broke something else', hint: 'Genuinely in tension with another problem. The coach now retries these as a pair; a human may need to settle the trade-off.', color: T.amber },
  refuted: { label: 'The fix did not survive verification', hint: 'The edit passed the screen but the adversarial verifier refuted it — masked, not fixed.', color: T.amber },
  retry_budget: { label: 'Out of attempts', hint: 'Retired after its attempt budget so the run could reach other problems. Raise max_attempts_per_problem to push harder.', color: T.amber2 },
  iteration_budget: { label: 'Never attempted — out of iterations', hint: 'The run hit max_iterations first. This is a compute knob, not a hard limit: raise it and these get worked.', color: T.blue },
  needs_you: { label: 'Waiting on your decision', hint: 'The coach escalated rather than guess — usually a shared-layer edit.', color: T.purple },
  not_exercised: { label: 'Your dataset never tested it', hint: 'No conversation created the situation, so nothing can be concluded. Fix the DATASET, not the prompt — add a persona that provokes this.', color: T.blue },
  unknown: { label: 'No usable verdict', hint: 'The judge could not be read on these conversations.', color: T.fainter },
  no_detector: { label: 'No scripted detector', hint: 'Verdict comes only from at-scale stress signals; the coach cannot iterate on it directly.', color: T.fainter },
  in_progress: { label: 'Still failing', hint: 'Attempted but not yet solved when the run ended.', color: T.amber2 },
  // verify-only runs: no fix was ever attempted, so none of the coach categories apply.
  found: { label: 'Found in the prompt as written', hint: 'The detector caught this in the prompt you supplied. Nothing was edited — fix it yourself, or run the same prompt again with Optimize.', color: T.red },
}
const CAT_ORDER = ['found', 'regression', 'refuted', 'in_progress', 'retry_budget', 'iteration_budget',
  'needs_you', 'not_exercised', 'unknown', 'no_detector']

// The five habits measured in CODE across every agent turn of the stress battery.
// A verdict says "present at scale"; these say how often, which is what you act on.
const STRESS_ROWS: { key: string; label: string; suffix: string; warn: (v: number) => boolean; hint: string }[] = [
  { key: 'pct_digits', label: 'Turns with raw digits or unit abbreviations', suffix: '%', warn: (v) => v > 3,
    hint: 'TTS reads "1250 sqft" wrong. Spell it: "twelve fifty square feet".' },
  { key: 'pct_formatting', label: 'Turns with formatting characters', suffix: '%', warn: (v) => v > 3,
    hint: 'Bullets, asterisks and dashes get spoken aloud or swallowed.' },
  { key: 'pct_bot_words', label: 'Turns with bot giveaway words', suffix: '%', warn: (v) => v > 5,
    hint: '"As an AI", "I can assist you with", "certainly!" — a human never says these on a call.' },
  { key: 'pct_over_2_sentences', label: 'Turns longer than two sentences', suffix: '%', warn: (v) => v > 40,
    hint: 'On a phone call, a third sentence is where the lead stops listening.' },
  { key: 'pct_repeat_loops', label: 'Calls where the agent repeated itself verbatim', suffix: '%', warn: (v) => v > 8,
    hint: 'A verbatim repeat is the signature of a deadlock the agent cannot get out of.' },
  { key: 'avg_agent_words', label: 'Average words per agent turn', suffix: '', warn: (v) => v > 45,
    hint: 'Above ~45 words the turn is a monologue, not a conversation.' },
]

function StressPanel({ stress }: { stress?: Record<string, number> | null }) {
  if (!stress || typeof stress.n_agent_turns !== 'number') return null
  return (
    <>
      <div style={{ ...label, margin: '26px 0 10px' }}>
        Habits at scale — measured in code across {stress.n_agent_turns} agent turns from {stress.n_sims} free-play calls
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        {STRESS_ROWS.map((r, i) => {
          const v = stress[r.key]
          if (typeof v !== 'number') return null
          const bad = r.warn(v)
          return (
            <div key={r.key} style={{
              display: 'grid', gridTemplateColumns: '1fr 78px', gap: 12, alignItems: 'baseline',
              padding: '10px 16px', background: i % 2 ? T.well : 'transparent',
              borderTop: i ? `1px solid ${T.divider}` : undefined,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: bad ? T.text : T.text3, fontWeight: bad ? 600 : 400 }}>{r.label}</div>
                {bad && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3, lineHeight: 1.5 }}>{r.hint}</div>}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, textAlign: 'right',
                            color: bad ? T.red : T.green }}>
                {v}{r.suffix}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// "Optimize this prompt" must not mean "go paste it again". Seed the setup form's
// persisted draft with the exact prompt and dataset this verification ran on, so the
// optimize run is the same experiment with the coach switched on.
function seedSetupFromRun(run: { original_prompt_snapshot: unknown; name: string | null; mode: string;
  direction: string | null; lead_status: string | null; versions: { version: number; merged_markdown: string | null }[] }) {
  const put = (k: string, v: unknown) => {
    try { sessionStorage.setItem(`ae:${k}`, JSON.stringify(v)) } catch { /* full/disabled */ }
  }
  const snap = run.original_prompt_snapshot as { blob?: unknown } | null
  const blob = typeof snap?.blob === 'string' && snap.blob.trim()
    ? snap.blob
    : (run.versions.find((v) => v.version === 0)?.merged_markdown || '')
  if (run.mode === 'standalone' && blob) put('forge:standaloneBlob', blob)
  put('forge:objective', 'optimize')
  put('forge:mode', run.mode)
  if (run.direction) put('forge:direction', run.direction)
  if (run.lead_status) put('forge:leadStatus', run.lead_status)
  put('forge:name', `${run.name || 'verified prompt'} · optimize`)
}

function UnsolvedPanel({ unsolved, behaviourOf, verify }: {
  unsolved: Record<string, UnsolvedReason> | null | undefined
  behaviourOf: (pid: string) => string
  verify?: boolean
}) {
  const rows = Object.entries(unsolved || {})
  if (rows.length === 0) return null
  const byCat = new Map<string, [string, UnsolvedReason][]>()
  for (const r of rows) byCat.set(r[1].category, [...(byCat.get(r[1].category) || []), r])
  const cats = CAT_ORDER.filter((c) => byCat.has(c))
    .concat([...byCat.keys()].filter((c) => !CAT_ORDER.includes(c)))

  return (
    <>
      <div style={{ ...label, margin: '26px 0 10px' }}>
        {verify
          ? `${rows.length} problem${rows.length > 1 ? 's' : ''} found — grouped by what it would take to settle each one`
          : `Why ${rows.length} problem${rows.length > 1 ? 's are' : ' is'} not solved — grouped by what would fix it`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cats.map((cat) => {
          const m = CAT_META[cat] || { label: cat, hint: '', color: T.fainter }
          const items = (byCat.get(cat) || []).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
          return (
            <div key={cat} style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: 4, background: m.color, flexShrink: 0 }} />
              <div style={{ padding: '13px 16px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 650, color: T.text }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: m.color, fontWeight: 600 }}>{items.length}</span>
                </div>
                <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>{m.hint}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
                  {items.map(([pid, r]) => (
                    <div key={pid} style={{ display: 'flex', gap: 9, alignItems: 'baseline', fontSize: 12.5 }}>
                      <span style={{ fontFamily: T.mono, color: T.text3, width: 34, flexShrink: 0 }}>{pid}</span>
                      <span style={{ color: T.text2, flexShrink: 0, maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {behaviourOf(pid)}
                      </span>
                      <span style={{ color: T.faint, minWidth: 0 }}>{r.why}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
