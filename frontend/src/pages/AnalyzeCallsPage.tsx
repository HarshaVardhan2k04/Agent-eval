import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, btnPrimary, label } from '../theme'
import { api } from '../api/client'
import { TOOL_GROUPS, CORE_TOOLS } from '../data/tools'

type Flow = { id: string; name: string; direction: string; definition: { nodes: { id: string; type: string; name: string }[] } }

const DIRECTIONS: [string, string, string][] = [
  ['inbound', 'Inbound', 'They called us'],
  ['outbound', 'Outbound', 'We called them'],
  ['follow_up', 'Follow-up', 'A repeat / callback'],
]

// --- Draft persistence -----------------------------------------------------
// The form should survive leaving this page (e.g. hop to Flow Builder to add a
// flow, come back). Selections go to sessionStorage so they also survive a hard
// refresh. Uploaded File objects can't be serialized to storage, so they live in
// a module-level cache that survives in-app navigation but not a full reload
// (browsers won't let JS re-hydrate a File without the user re-picking it).
const DRAFT_KEY = 'analyze-calls-draft'
type Draft = {
  direction: string; flowId: string; tools: string[]; showPaste: boolean; pasteText: string
  source: 'upload' | 'import'; vertical: string; callIdsText: string
}
let fileCache: File[] = []

type Vertical = { key: string; label: string; dbConfigured: boolean; gcsConfigured: boolean }

// Parse a paste of call IDs: JSON array, or newline/comma/space separated.
function parseIds(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  try {
    const j = JSON.parse(t)
    if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean)
  } catch { /* not JSON — fall through */ }
  return t.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

function loadDraft(): Partial<Draft> {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') } catch { return {} }
}
function saveDraft(d: Draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* storage full / disabled */ }
}
function clearDraft() {
  fileCache = []
  try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

// Accept a JSON array / object / JSONL of transcripts (advanced fallback).
function parseCalls(text: string): any[] | null {
  const t = text.trim()
  if (!t) return null
  let data: any
  try { data = JSON.parse(t) } catch {
    try { data = t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) } catch { return null }
  }
  const records = Array.isArray(data) ? data : (data && typeof data === 'object'
    ? Object.entries(data).map(([k, v]: [string, any]) => ({ call_id: v?.call_id || k, ...v })) : [])
  const calls = records.filter((r) => r && typeof r.transcript === 'string' && r.transcript.trim())
  return calls.length ? calls : null
}

export function AnalyzeCallsPage() {
  const nav = useNavigate()
  const draft = useRef<Partial<Draft> | undefined>(undefined)
  if (!draft.current) draft.current = loadDraft()
  const d0 = draft.current
  const [direction, setDirection] = useState(d0.direction || 'inbound')
  const [files, setFiles] = useState<File[]>(fileCache)
  const [flows, setFlows] = useState<Flow[]>([])
  const [flowId, setFlowId] = useState<string>(d0.flowId || '')
  const [tools, setTools] = useState<string[]>(d0.tools || CORE_TOOLS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(d0.showPaste || false)
  const [pasteText, setPasteText] = useState(d0.pasteText || '')
  const [source, setSource] = useState<'upload' | 'import'>(d0.source || 'upload')
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [vertical, setVertical] = useState(d0.vertical || '')
  const [callIdsText, setCallIdsText] = useState(d0.callIdsText || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { api.listFlows().then(setFlows).catch(() => {}) }, [])
  useEffect(() => { api.analysisVerticals().then(setVerticals).catch(() => {}) }, [])
  // Persist the form so it survives navigation / refresh (see DRAFT_KEY above).
  useEffect(() => { fileCache = files }, [files])
  useEffect(() => { saveDraft({ direction, flowId, tools, showPaste, pasteText, source, vertical, callIdsText }) },
    [direction, flowId, tools, showPaste, pasteText, source, vertical, callIdsText])

  const selectedFlow = flows.find((f) => f.id === flowId)
  const stages = useMemo(
    () => (selectedFlow?.definition?.nodes || []).filter((n) => n.type !== 'start').map((n) => ({ name: n.name || n.id, type: n.type })),
    [selectedFlow]
  )
  const pasted = useMemo(() => parseCalls(pasteText), [pasteText])
  const callIds = useMemo(() => parseIds(callIdsText), [callIdsText])
  const recordingCount = files.length
  const usingPaste = showPaste && !!pasted
  const importReady = source === 'import' && !!vertical && callIds.length > 0
  const uploadReady = source === 'upload' && (recordingCount > 0 || usingPaste)
  const canAnalyze = (importReady || uploadReady) && !!flowId

  const addFiles = (fl: FileList | null) => {
    if (!fl) return
    const audio = Array.from(fl).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(f.name))
    setFiles((cur) => [...cur, ...audio])
    setError(null)
  }
  const toggleTool = (n: string) => setTools((ts) => (ts.includes(n) ? ts.filter((x) => x !== n) : [...ts, n]))

  const analyze = async () => {
    if (!canAnalyze) return
    setBusy(true); setError(null)
    try {
      const batchName = selectedFlow ? `${selectedFlow.name} · ${direction}` : `${direction} calls`
      const batch = await api.createCallBatch({ name: batchName, direction, flow_id: flowId, tools })
      if (source === 'import') {
        await api.importAnalysisCalls(batch.id, { vertical, call_ids: callIds })
      } else if (usingPaste && pasted) {
        await api.addCalls(batch.id, pasted)
      } else {
        const form = new FormData()
        files.forEach((f) => form.append('recordings', f, f.name))
        await api.addRecordings(batch.id, form)
      }
      clearDraft() // consumed into a batch — start fresh next time
      nav(`/analyze/${batch.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start analysis')
      setBusy(false)
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '11px 13px', borderRadius: T.rInput, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 14, outline: 'none' }
  const cardHead = (title: string, sub: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${T.divider}` }}>
      <div><div style={{ fontSize: 15.5, fontWeight: 600, color: T.text }}>{title}</div><div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>{sub}</div></div>
      {right}
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em', color: T.text }}>Analyze real calls</h1>
        <p style={{ margin: '8px 0 0', color: T.muted, fontSize: 15, maxWidth: 620, lineHeight: 1.5 }}>
          Drop in a batch of call recordings. We transcribe them, judge them against the flow you saved, and tell you exactly where the agent slipped.
        </p>
      </div>

      <div className="an-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 18, alignItems: 'start' }}>
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 0. Where the calls come from */}
          <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: T.well, borderRadius: 12, border: `1px solid ${T.border}`, width: 'fit-content' }}>
            {([['upload', 'Upload recordings'], ['import', 'Import from calls']] as const).map(([v, lbl]) => {
              const on = source === v
              return (
                <button key={v} onClick={() => setSource(v)}
                  style={{ padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 500, background: on ? T.surface2 : 'transparent', color: on ? T.text : T.muted }}>
                  {lbl}
                </button>
              )
            })}
          </div>

          {/* 1a. Import from production calls */}
          {source === 'import' && (
            <div style={{ ...card, overflow: 'hidden' }}>
              {cardHead('Import from calls', 'pull real calls from a production DB — we score their transcripts',
                <div style={{ fontSize: 12, fontFamily: T.mono, color: callIds.length ? T.green : T.faint, padding: '5px 10px', borderRadius: 99, background: callIds.length ? 'rgba(76,201,138,0.12)' : T.well, border: `1px solid ${T.border}` }}>
                  {callIds.length ? `${callIds.length} ids` : 'no ids'}
                </div>)}
              <div style={{ padding: '16px 20px 18px' }}>
                <div style={{ ...label, fontSize: 11, marginBottom: 9 }}>Which vertical?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {verticals.map((v) => {
                    const on = v.key === vertical
                    const disabled = !v.dbConfigured
                    return (
                      <button key={v.key} disabled={disabled} onClick={() => setVertical(v.key)}
                        title={disabled ? 'Database credentials not set for this vertical' : undefined}
                        style={{ padding: '9px 14px', borderRadius: 11, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border2}`, color: disabled ? T.faint : (on ? T.text : T.text2), opacity: disabled ? 0.6 : 1 }}>
                        {v.label}{disabled ? ' · creds not set' : ''}
                      </button>
                    )
                  })}
                  {verticals.length === 0 && <div style={{ fontSize: 13, color: T.faint }}>No verticals available.</div>}
                </div>
                <div style={{ ...label, fontSize: 11, margin: '16px 0 9px' }}>Call IDs</div>
                <textarea value={callIdsText} onChange={(e) => setCallIdsText(e.target.value)} rows={5}
                  placeholder={'Paste call IDs — JSON array, or one per line / comma-separated\ne.g. a13411d2-ee3f-46ed-90ee-a94a6f8b6636'}
                  style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} />
                <div style={{ fontSize: 11.5, color: callIds.length ? T.green : T.faint, marginTop: 6, fontFamily: T.mono }}>
                  {callIds.length ? `${callIds.length} call id${callIds.length === 1 ? '' : 's'} parsed` : 'we fetch each call’s transcript from the DB and judge it against your flow'}
                </div>
              </div>
            </div>
          )}

          {/* 1. Recordings (upload mode) */}
          {source === 'upload' && (
          <div style={{ ...card, overflow: 'hidden' }}>
            {cardHead('Call recordings', 'mp3 or wav — we run them through speech-to-text for you',
              <div style={{ fontSize: 12, fontFamily: T.mono, color: recordingCount ? T.green : T.faint, padding: '5px 10px', borderRadius: 99, background: recordingCount ? 'rgba(76,201,138,0.12)' : T.well, border: `1px solid ${T.border}` }}>
                {recordingCount ? `${recordingCount} loaded` : 'empty'}
              </div>)}
            {recordingCount === 0 ? (
              <div style={{ padding: 18 }}>
                <div onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
                  role="button" tabIndex={0} style={{ padding: '38px 24px', borderRadius: 14, border: `1px dashed ${T.border2}`, background: T.well, textAlign: 'center', cursor: 'pointer' }}>
                  <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
                  <div style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 13, background: T.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--accent-hi)' }}>↑</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: T.text }}>Drop your call recordings here</div>
                  <div style={{ fontSize: 12.5, color: T.faint, marginTop: 5 }}>mp3 or wav · a whole folder is fine · we handle the transcription</div>
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 11, background: T.well, border: `1px solid ${T.border}` }}>
                  <span style={{ width: 18, height: 18, borderRadius: 99, background: T.chip, color: T.muted, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>i</span>
                  <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
                    Checking transcription accuracy is a separate job — that lives in <span onClick={() => nav('/stt')} role="button" style={{ color: 'var(--accent-hi)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Test STT</span>.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px 20px 18px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {files.map((f, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 99, background: T.well, border: `1px solid ${T.border2}`, fontSize: 12, fontFamily: T.mono, color: T.text3 }}>
                      <span style={{ color: 'var(--accent-hi)' }}>∿</span>{f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 15, fontSize: 12.5, color: T.faint }}>
                  <span>{recordingCount} recording{recordingCount === 1 ? '' : 's'} · {(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB</span>
                  <button onClick={() => setFiles([])} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Clear batch</button>
                  <button onClick={() => inputRef.current?.click()} style={{ background: 'none', border: 'none', color: 'var(--accent-hi)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}>+ add more</button>
                  <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
                </div>
              </div>
            )}
            {/* paste-transcripts fallback (no audio) */}
            <div style={{ padding: '0 20px 16px' }}>
              <button onClick={() => setShowPaste((s) => !s)} style={{ background: 'none', border: 'none', color: T.faint, fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                {showPaste ? 'hide' : 'no audio? paste transcripts instead'}
              </button>
              {showPaste && (
                <div style={{ marginTop: 10 }}>
                  <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5}
                    placeholder='[{"call_id":"…","transcript":"Agent: … User: …"}]'
                    style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} />
                  <div style={{ fontSize: 11.5, color: pasted ? T.green : T.faint, marginTop: 5, fontFamily: T.mono }}>{pasted ? `${pasted.length} transcripts` : 'JSON array / object / JSONL'}</div>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 2. Flow */}
          <div style={{ ...card, overflow: 'hidden' }}>
            {cardHead('Which flow should it have followed?', "Pick a flow you saved in Flow Builder — that's what we judge against",
              <button onClick={() => nav('/flow')} style={{ padding: '7px 12px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Open Flow Builder →</button>)}
            <div style={{ padding: '16px 20px 18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {flows.map((f) => {
                  const on = f.id === flowId
                  return (
                    <div key={f.id} onClick={() => setFlowId(f.id)} role="radio" aria-checked={on} tabIndex={0}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 11, cursor: 'pointer', background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border}` }}>
                      <span style={{ width: 16, height: 16, borderRadius: 99, flexShrink: 0, border: `2px solid ${on ? 'var(--accent)' : T.border2}`, background: on ? 'var(--accent)' : 'transparent', boxShadow: on ? '0 0 0 3px rgba(var(--accent-rgb),0.15)' : 'none' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{f.name}</div>
                        <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>{f.direction} · {(f.definition?.nodes || []).length} nodes</div>
                      </div>
                    </div>
                  )
                })}
                {flows.length === 0 && <div style={{ fontSize: 13, color: T.faint }}>No saved flows yet — <span onClick={() => nav('/flow')} role="button" style={{ color: 'var(--accent-hi)', cursor: 'pointer', textDecoration: 'underline' }}>build one</span> first.</div>}
              </div>
              {selectedFlow && stages.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...label, fontSize: 11, marginBottom: 9 }}>Stages we'll check for · {direction}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {stages.map((s, i) => (
                      <span key={i} style={{ padding: '5px 11px', borderRadius: 99, fontSize: 12, background: T.well, border: `1px solid ${T.border2}`, color: T.text3 }}>{s.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Tools */}
          <div style={{ ...card, padding: '16px 20px 18px' }}>
            <div style={{ ...label, marginBottom: 12 }}>Tools the agent has · scored against this set</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {TOOL_GROUPS.map((g) => (
                <div key={g.group}>
                  <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 7 }}>{g.group}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {g.tools.map((t) => {
                      const on = tools.includes(t.name)
                      return (
                        <button key={t.name} onClick={() => toggleTool(t.name)} title={t.desc}
                          style={{ padding: '7px 12px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer', fontFamily: T.mono, border: `1px solid ${on ? 'var(--accent)' : T.border2}`, background: on ? T.accentSoft : 'transparent', color: on ? T.text : T.muted }}>
                          {on ? '✓ ' : ''}{t.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Direction */}
          <div style={{ ...card, padding: '20px 22px' }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: T.text }}>What kind of calls are these?</div>
            <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>Each direction has its own expected path, so we judge them differently.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {DIRECTIONS.map(([v, lbl, sub]) => {
                const on = direction === v
                return (
                  <button key={v} onClick={() => setDirection(v)}
                    style={{ flex: '1 1 120px', textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border2}`, color: T.text }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{lbl}</div>
                    <div style={{ fontSize: 12, color: on ? T.text3 : T.faint, marginTop: 2 }}>{sub}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — ready panel */}
        <div style={{ position: 'sticky', top: 12 }}>
          <div style={{ ...card, padding: '20px 22px' }}>
            <div style={{ ...label }}>Ready to analyze?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, margin: '15px 0' }}>
              {[
                source === 'import'
                  ? [importReady, vertical ? `${callIds.length} ids · ${verticals.find((v) => v.key === vertical)?.label || vertical}` : 'Pick a vertical + paste call IDs']
                  : [recordingCount > 0 || usingPaste, usingPaste ? `${pasted?.length} transcripts` : recordingCount ? `${recordingCount} recordings` : 'Add recordings'],
                [!!flowId, flowId ? `Flow: ${selectedFlow?.name}` : 'Pick a flow'],
                [tools.length > 0, `${tools.length} tools selected`],
              ].map(([ok, txt], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: ok ? 'rgba(76,201,138,0.15)' : T.chip, color: ok ? T.green : T.faint }}>{ok ? '✓' : '○'}</span>
                  <span style={{ color: ok ? T.text2 : T.faint }}>{txt as string}</span>
                </div>
              ))}
            </div>
            <button onClick={analyze} disabled={!canAnalyze || busy}
              style={{ ...btnPrimary, width: '100%', opacity: (!canAnalyze || busy) ? 0.5 : 1, cursor: (!canAnalyze || busy) ? 'default' : 'pointer' }}>
              {busy ? 'Starting…' : `Analyze ${source === 'import' ? (callIds.length || '') : usingPaste ? pasted?.length : recordingCount || ''} →`}
            </button>
            {error && <div style={{ color: T.red, fontSize: 12.5, marginTop: 11 }}>{error}</div>}
            <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.5, marginTop: 11 }}>
              {source === 'import'
                ? 'We fetch each call’s transcript from the DB and judge it against your flow. Results land in the Scoreboard.'
                : 'Recordings are transcribed then scored. You can leave the page — it keeps going in the background.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
