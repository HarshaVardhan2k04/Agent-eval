import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { useEvalStore } from '../stores/evalStore'
import { api } from '../api/client'
import { T, scoreColor, backBtn } from '../theme'

export function PromptHistoryPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { promptVersions, fetchPromptVersions } = useEvalStore()
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [rerunning, setRerunning] = useState(false)

  useEffect(() => {
    if (id) fetchPromptVersions(id)
  }, [id])

  const handleSelectVersion = (version: number) => {
    setSelectedVersion(version)
  }

  const handleRerun = async (version: number) => {
    if (!id) return
    setRerunning(true)
    try {
      const result = await api.rerunFromVersion(id, version)
      window.location.href = `/eval/${result.eval_id}/progress`
    } catch (err) {
      console.error(err)
    } finally {
      setRerunning(false)
    }
  }

  const sorted = [...promptVersions].sort((a, b) => a.version - b.version)
  const selected =
    selectedVersion !== null ? sorted.find((p) => p.version === selectedVersion) ?? null : null
  const prevVersion =
    selected && selected.version > 0
      ? sorted.find((p) => p.version === selected.version - 1) ?? null
      : null
  const selEdits = selected?.edits_json ?? []

  // Derive a friendly marker by comparing this version's score to the previous one's.
  function markFor(version: number): { label: string; c: string; bg: string } {
    if (version === 0) {
      return { label: 'Baseline', c: T.muted, bg: 'rgba(169,159,142,0.16)' }
    }
    const curr = sorted.find((p) => p.version === version)
    const prev = sorted.find((p) => p.version === version - 1)
    const cs = curr?.score ?? null
    const ps = prev?.score ?? null
    if (cs !== null && ps !== null && cs < ps) {
      return { label: '↩ tried', c: T.amber, bg: 'rgba(240,168,60,0.16)' }
    }
    return { label: '↑ accepted', c: T.green, bg: 'rgba(76,201,138,0.16)' }
  }

  const fmtScore = (s: number | null | undefined) =>
    s != null ? `${(s * 100).toFixed(0)}%` : '—'

  const opColor = (op: string): string =>
    op === 'append' || op === 'prepend'
      ? T.green
      : op === 'replace'
      ? T.amber
      : op === 'rewrite'
      ? T.blue
      : T.muted

  const opBg = (op: string): string =>
    op === 'append' || op === 'prepend'
      ? 'rgba(76,201,138,0.16)'
      : op === 'replace'
      ? 'rgba(240,168,60,0.16)'
      : op === 'rewrite'
      ? 'rgba(91,157,255,0.16)'
      : 'rgba(169,159,142,0.16)'

  return (
    <div className="page-enter" style={{ padding: 24 }}>
      <button onClick={() => id && navigate(`/eval/${id}/results`)} style={backBtn}>
        ← Back to results
      </button>
      <h1
        style={{
          margin: 0,
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: T.text,
        }}
      >
        How the prompt evolved
      </h1>
      <p
        style={{
          margin: '8px 0 0',
          color: T.muted,
          fontSize: 14.5,
          maxWidth: 620,
          lineHeight: 1.5,
        }}
      >
        Each version is one attempt by the coach. We only kept the ones that scored higher — here's
        the story from your first prompt to the best one.
      </p>

      <div
        className="hist-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '288px 1fr',
          gap: 18,
          marginTop: 24,
        }}
      >
        {/* LEFT — version list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((pv) => {
            const sel = selectedVersion === pv.version
            const mk = markFor(pv.version)
            return (
              <div
                key={pv.version}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectVersion(pv.version)}
                style={{
                  padding: '14px 16px',
                  borderRadius: 13,
                  cursor: 'pointer',
                  transition: 'border-color .15s, background .15s',
                  border: `1px solid ${sel ? 'rgba(var(--accent-hi-rgb),0.5)' : T.border}`,
                  background: sel ? T.rowHover : T.surface,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '1px 7px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      background: T.chip,
                      color: T.muted,
                    }}
                  >
                    v{pv.version}
                  </span>
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontWeight: 600,
                      fontSize: 14,
                      color: T.text,
                    }}
                  >
                    v{pv.version}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontFamily: T.mono,
                      fontWeight: 600,
                      fontSize: 14,
                      color: scoreColor(pv.score),
                    }}
                  >
                    {fmtScore(pv.score)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      flexShrink: 0,
                      background: mk.bg,
                      color: mk.c,
                    }}
                  >
                    {mk.label}
                  </span>
                  <span style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.4 }}>
                    {pv.changes_summary}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* RIGHT — detail card */}
        {selected ? (
          <div
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 16,
              overflow: 'hidden',
              alignSelf: 'start',
            }}
          >
            {/* header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '16px 20px',
                borderBottom: `1px solid ${T.divider}`,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>
                  Version {selected.version}
                </div>
                <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>
                  Scored {fmtScore(selected.score)}
                </div>
              </div>
              <button
                onClick={() => handleRerun(selected.version)}
                disabled={rerunning}
                style={{
                  padding: '9px 15px',
                  borderRadius: 10,
                  border: '1px solid rgba(var(--accent-hi-rgb),0.4)',
                  background: 'rgba(var(--accent-rgb),0.1)',
                  color: T.accentHi,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: rerunning ? 'default' : 'pointer',
                  opacity: rerunning ? 0.6 : 1,
                }}
              >
                {rerunning ? 'Starting…' : '↻ Re-run from this version'}
              </button>
            </div>

            {/* What changed */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.divider}` }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: T.muted,
                  marginBottom: 9,
                }}
              >
                What changed
              </div>
              <div style={{ fontSize: 13.5, color: T.text3, lineHeight: 1.6 }}>
                {selected.changes_summary || 'No summary for this version.'}
              </div>
            </div>

            {/* Diff */}
            {selected.version > 0 && prevVersion ? (
              <div
                className="diff-grid"
                style={{
                  fontFamily: T.mono,
                  fontSize: 12,
                }}
              >
                <ReactDiffViewer
                  oldValue={prevVersion.prompt_text}
                  newValue={selected.prompt_text}
                  splitView={true}
                  useDarkTheme={true}
                  leftTitle={`v${prevVersion.version} (previous)`}
                  rightTitle={`v${selected.version} (selected)`}
                />
              </div>
            ) : (
              <div style={{ padding: '0 0 4px' }}>
                <div
                  style={{
                    padding: '9px 16px',
                    fontFamily: T.mono,
                    fontSize: 11.5,
                    color: T.faint,
                    background: T.well,
                    borderBottom: `1px solid ${T.borderFaint}`,
                  }}
                >
                  v{selected.version} (baseline prompt)
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '10px 16px',
                    background: T.well,
                    color: T.text3,
                    fontFamily: T.mono,
                    fontSize: 12,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 420,
                    overflow: 'auto',
                  }}
                >
                  {selected.prompt_text}
                </pre>
              </div>
            )}

            {/* Patches */}
            {selEdits.length > 0 && (
              <div style={{ padding: '16px 20px', borderTop: `1px solid ${T.divider}` }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: T.muted,
                    marginBottom: 11,
                  }}
                >
                  The coach's exact edits
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selEdits.map((e, i) => {
                    const op = String(e.op || '')
                    const text =
                      op === 'append' || op === 'prepend'
                        ? String(e.text || '')
                        : op === 'replace'
                        ? `"${String(e.find || '')}" → "${String(e.replace || '')}"`
                        : op === 'rewrite'
                        ? 'Full prompt rewrite'
                        : JSON.stringify(e)
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 12,
                          padding: '11px 14px',
                          borderRadius: 10,
                          background: T.well,
                          border: `1px solid ${T.borderFaint}`,
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            padding: '3px 9px',
                            borderRadius: 6,
                            fontFamily: T.mono,
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: '0.03em',
                            height: 'fit-content',
                            textTransform: 'uppercase',
                            background: opBg(op),
                            color: opColor(op),
                          }}
                        >
                          {op}
                        </span>
                        <span
                          style={{
                            fontFamily: T.mono,
                            fontSize: 12.5,
                            color: T.text3,
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {text}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 260,
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 16,
              color: T.faint,
              fontSize: 14,
            }}
          >
            Select a version to view details
          </div>
        )}
      </div>
    </div>
  )
}
