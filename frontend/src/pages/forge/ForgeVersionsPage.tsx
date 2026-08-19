import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { T, card, label, backBtn } from '../../theme'
import { useForgeStore, type ForgeVersionRow } from '../../stores/forgeStore'
import { LayerBadge } from '../../components/forge'
import { score100Color } from '../../components/analysis'

export function ForgeVersionsPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { currentRun, fetchRun } = useForgeStore()
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => { if (id) fetchRun(id) }, [id, fetchRun])

  const run = currentRun && currentRun.id === id ? currentRun : null
  if (!run) return <div style={{ color: T.faint, padding: 20 }}>Loading…</div>

  const versions = run.versions
  const sel = versions.find((v) => v.version === selected) || null
  // diff base = the nearest EARLIER version that has markdown (accepted/baseline)
  const diffBase = sel
    ? [...versions].filter((v) => v.version < sel.version && v.merged_markdown).pop() || null
    : null

  const markFor = (v: ForgeVersionRow) =>
    v.status === 'baseline' ? { txt: 'Baseline', col: T.blue }
      : v.status === 'accepted' ? { txt: '↑ accepted', col: T.green }
        : { txt: '↩ reverted', col: T.amber }

  return (
    <div>
      <button onClick={() => nav(`/forge/${run.id}/results`)} style={backBtn}>← Back to results</button>
      <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>Every variation</h1>
      <p style={{ fontSize: 13.5, color: T.muted, margin: '6px 0 0' }}>Accepted and reverted — nothing is ever lost.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18, marginTop: 20, alignItems: 'start' }}>
        {/* LEFT — version list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {versions.map((v) => {
            const m = markFor(v)
            const active = selected === v.version
            return (
              <div key={v.version} role="button" onClick={() => setSelected(v.version)}
                style={{
                  ...card, padding: '11px 13px', cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : T.border}`,
                  background: active ? T.accentSoft : T.surface,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.text }}>v{v.version}</span>
                  <span style={{ fontSize: 11, color: m.col, fontWeight: 600 }}>{m.txt}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: score100Color(v.composite) }}>
                    {v.composite ?? '—'}
                  </span>
                </div>
                {(v.targeted_problem || v.layer_for_fix) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
                    {v.targeted_problem && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint }}>{v.targeted_problem}</span>}
                    <LayerBadge layer={v.layer_for_fix} />
                  </div>
                )}
                {v.changes_summary && (
                  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {v.changes_summary}
                  </div>
                )}
              </div>
            )
          })}
          {versions.length === 0 && <div style={{ color: T.faint, fontSize: 13 }}>No versions yet.</div>}
        </div>

        {/* RIGHT — detail */}
        {sel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div style={{ ...card, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Version {sel.version}</span>
                <span style={{ fontSize: 12, color: markFor(sel).col, fontWeight: 600 }}>{markFor(sel).txt}</span>
                {sel.targeted_problem && (
                  <span style={{ fontSize: 12, color: T.muted }}>
                    targeted <b style={{ fontFamily: T.mono, color: T.text2 }}>{sel.targeted_problem}</b>
                  </span>
                )}
                <LayerBadge layer={sel.layer_for_fix} />
                {sel.verify_json && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                    background: (sel.verify_json.holds ? T.green : T.red) + '22',
                    color: sel.verify_json.holds ? T.green : T.red,
                  }}>
                    verify: {sel.verify_json.holds ? 'held' : 'refuted'} · strict {sel.verify_json.strict_verdict ?? '—'} · {sel.verify_json.refutations}/{sel.verify_json.k} skeptics refuted
                  </span>
                )}
              </div>
              {sel.changes_summary && <div style={{ fontSize: 13.5, color: T.text2, marginTop: 10, lineHeight: 1.55 }}>{sel.changes_summary}</div>}
              {sel.diagnosis && (
                <div style={{ marginTop: 10, background: T.well, borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: T.text3, lineHeight: 1.55, borderLeft: `3px solid ${T.amber}` }}>
                  <b style={{ color: T.amber }}>Diagnosis / strategy:</b> {sel.diagnosis}
                </div>
              )}
              {sel.how_solved && (
                <div style={{ marginTop: 10, background: T.well, borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: T.text3, lineHeight: 1.55, borderLeft: `3px solid ${T.green}` }}>
                  <b style={{ color: T.green }}>How it was solved (the lever):</b> {sel.how_solved}
                </div>
              )}
            </div>

            {/* exact edits */}
            {sel.edits_json && sel.edits_json.length > 0 && (
              <div style={{ ...card, padding: 18 }}>
                <div style={{ ...label, marginBottom: 12 }}>The coach's exact edits</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sel.edits_json.map((e, i) => (
                    <div key={i} style={{ background: T.well, borderRadius: 10, padding: '10px 13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: e.text || e.replace ? 6 : 0 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: opColor(e.op) + '22', color: opColor(e.op) }}>
                          {e.op}
                        </span>
                        {e.path && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{e.path}</span>}
                        {e.find && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>find: “{e.find}”</span>}
                      </div>
                      {(e.text || e.replace) && (
                        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text3, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                          {e.text || e.replace}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* diff */}
            {sel.merged_markdown && diffBase?.merged_markdown ? (
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ padding: '11px 16px', borderBottom: `1px solid ${T.divider}`, ...label }}>
                  Diff vs v{diffBase.version}
                </div>
                <div style={{ maxHeight: 520, overflow: 'auto', fontSize: 12 }}>
                  <ReactDiffViewer oldValue={diffBase.merged_markdown} newValue={sel.merged_markdown}
                    splitView useDarkTheme leftTitle={`v${diffBase.version} (previous)`} rightTitle={`v${sel.version} (this)`} />
                </div>
              </div>
            ) : sel.merged_markdown ? (
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ padding: '11px 16px', borderBottom: `1px solid ${T.divider}`, ...label }}>Prompt at v{sel.version}</div>
                <pre style={{ margin: 0, padding: 16, maxHeight: 480, overflow: 'auto', background: T.well, fontSize: 11.5, lineHeight: 1.55, color: T.text3, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
                  {sel.merged_markdown}
                </pre>
              </div>
            ) : (
              <div style={{ ...card, padding: 20, fontSize: 13, color: T.faint }}>
                Reverted candidate — the full prompt isn't stored for rejected variants; the edits above are the complete change.
              </div>
            )}
          </div>
        ) : (
          <div style={{ ...card, padding: 44, textAlign: 'center', color: T.faint, fontSize: 13.5 }}>Select a version.</div>
        )}
      </div>
    </div>
  )
}

function opColor(op: string): string {
  switch ((op || '').toLowerCase()) {
    case 'append': case 'add_bullet': case 'prepend': return T.green
    case 'replace': case 'set': return T.amber
    case 'merge': case 'rewrite': return T.blue
    default: return T.faint
  }
}
