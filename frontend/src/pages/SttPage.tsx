import { useEffect, useMemo, useRef, useState } from 'react'
import { T, card, btnPrimary, btnSecondary, label } from '../theme'
import { api } from '../api/client'
import { usePersisted } from '../usePersisted'
import { DiffView, SttResultsView, rate, pct, type DiffOp, type SttResult } from '../components/sttResults'

// The picked File can't go in sessionStorage — cache it in-module so it survives
// in-app navigation (a hard refresh still needs a re-pick; browser sandbox rule).
let sttFileCache: File | null = null
let sttBatchFileCache: File[] = []
// Add-noise mode: the one clean recording + any custom noise files the user picks.
let sttNoiseFileCache: File | null = null
let sttNoiseCustomCache: File[] = []

type Metrics = {
  wer: number | null; cer: number | null; match_pct: number | null
  verdict: string; primary_metric?: string; diff?: DiffOp[]
  detected_language?: string | null; duration_ms?: number
}
type Result = {
  id: number; filename: string | null; reference_text: string
  hypothesis_text: string; metrics_json: Metrics
}
type Summary = {
  count: number; scored_count: number; avg_wer: number | null
  avg_cer: number | null; avg_match_pct: number | null
  verdicts: { good: number; fair: number; poor: number }
}
type Vertical = { key: string; label: string; configured: boolean }

const LANGS: [string, string][] = [
  ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'], ['auto', 'Auto-detect'],
]
const MODES: [Mode, string][] = [
  ['single', 'Single file'], ['batch', 'Batch'], ['import', 'Import from calls'], ['noise', 'Add noise'],
]
type Mode = 'single' | 'batch' | 'import' | 'noise'

type NoisePreset = { key: string; label: string; filename: string }
const NOISE_LEVELS: [string, string][] = [['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']]

const verdictMeta: Record<string, { color: string; label: string }> = {
  good: { color: T.green, label: 'Good' },
  fair: { color: T.amber, label: 'Fair' },
  poor: { color: T.red, label: 'Poor' },
  unknown: { color: T.faint, label: 'No reference' },
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: T.rInput, background: T.well,
  border: `1px solid ${T.border2}`, color: T.text, fontSize: 14, outline: 'none',
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: T.well, borderRadius: 12, border: `1px solid ${T.border}` }}>
      {MODES.map(([m, lbl]) => {
        const on = m === mode
        return (
          <button key={m} onClick={() => onChange(m)}
            style={{ padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 500, background: on ? T.surface2 : 'transparent', color: on ? T.text : T.muted }}>
            {lbl}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared batch polling — fetch getSttBatch on an interval until done / all in.
// ---------------------------------------------------------------------------
function useBatchPoll(batchId: string | null, expected: number) {
  const [results, setResults] = useState<SttResult[]>([])
  const [scoring, setScoring] = useState(false)

  useEffect(() => {
    if (!batchId) { setResults([]); setScoring(false); return }
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    setScoring(true)
    const tick = async (): Promise<boolean> => {
      attempts += 1
      try {
        const b = await api.getSttBatch(batchId)
        if (!alive) return false
        const rs: SttResult[] = b.results || []
        setResults(rs)
        const finished = b.status === 'done' || (expected > 0 && rs.length >= expected)
        setScoring(!finished)
        if (finished) return false
      } catch { /* transient — keep trying */ }
      return attempts < 200
    }
    const loop = async () => { if (await tick()) timer = setTimeout(loop, 3000) }
    loop()
    return () => { alive = false; clearTimeout(timer) }
  }, [batchId, expected])

  return { results, scoring }
}

// ===========================================================================
// SINGLE-FILE MODE (unchanged behaviour)
// ===========================================================================
function MetricTile({ label: l, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...card, padding: '16px 18px', flex: 1, minWidth: 130 }}>
      <div style={{ ...label, marginBottom: 8 }}>{l}</div>
      <div style={{ fontSize: 26, fontWeight: 650, fontFamily: T.mono, color: color || T.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function ResultCard({ r }: { r: Result }) {
  const [open, setOpen] = useState(true)
  const m = r.metrics_json
  const vm = verdictMeta[m.verdict] || verdictMeta.unknown
  const isIndic = m.primary_metric === 'cer'
  return (
    <div style={{ ...card, padding: 18, borderLeft: `3px solid ${vm.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.filename || 'clip'}
          </div>
          <div style={{ fontSize: 12, color: T.faint, fontFamily: T.mono, marginTop: 2 }}>
            {m.detected_language ? `detected ${m.detected_language}` : ''}{m.duration_ms ? ` · ${(m.duration_ms / 1000).toFixed(1)}s` : ''}
          </div>
        </div>
        <span style={{ padding: '4px 11px', borderRadius: 99, background: `${vm.color}22`, color: vm.color, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: vm.color }} />{vm.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <MetricTile label="WER" value={rate(m.wer)} color={isIndic ? T.text3 : T.text} sub={isIndic ? undefined : 'primary'} />
        <MetricTile label="CER" value={rate(m.cer)} color={isIndic ? T.text : T.text3} sub={isIndic ? 'primary · Indic' : undefined} />
        <MetricTile label="Match" value={pct(m.match_pct)} color={vm.color} />
      </div>

      {open && m.diff && m.diff.length > 0 && (
        <div style={{ marginTop: 14 }}><DiffView diff={m.diff} /></div>
      )}
    </div>
  )
}

function SingleMode({ language, batchName, engineOffline, setLanguage, setBatchName }: {
  language: string; batchName: string; engineOffline: boolean
  setLanguage: (v: string) => void; setBatchName: (v: string) => void
}) {
  const [file, setFile] = useState<File | null>(sttFileCache)
  const [fileUrl, setFileUrl] = useState<string | null>(() => (sttFileCache ? URL.createObjectURL(sttFileCache) : null))
  const [reference, setReference] = usePersisted('stt:reference', '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = usePersisted<string | null>('stt:batchId', null)
  const [results, setResults] = usePersisted<Result[]>('stt:results', [])
  const [summary, setSummary] = usePersisted<Summary | null>('stt:summary', null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { sttFileCache = file }, [file])

  const pickFile = (f: File | null) => {
    setFile(f); setError(null)
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    setFileUrl(f ? URL.createObjectURL(f) : null)
  }

  const run = async () => {
    if (!file) return
    setRunning(true); setError(null)
    try {
      let bid = batchId
      if (!bid) {
        const batch = await api.createSttBatch({ name: batchName || undefined, language })
        bid = batch.id
        setBatchId(bid)
      }
      const form = new FormData()
      form.append('audio', file)
      form.append('language', language)
      form.append('reference', reference)
      const { result, summary: s } = await api.addSttResult(bid!, form)
      setResults((rs) => [...rs, result])
      setSummary(s)
      pickFile(null); setReference('')
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'STT failed')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setBatchId(null); setResults([]); setSummary(null); pickFile(null); setReference('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const overallVerdict = useMemo(() => {
    if (!summary || !summary.avg_match_pct) return null
    const v = summary.avg_match_pct >= 85 ? 'good' : summary.avg_match_pct >= 70 ? 'fair' : 'poor'
    return verdictMeta[v]
  }, [summary])

  return (
    <div>
      {/* Config + add-clip */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ ...label, marginBottom: 7 }}>Batch name · optional</div>
            <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Hindi outbound — Aug batch"
              disabled={!!batchId} style={inputStyle} />
          </div>
          <div style={{ width: 170 }}>
            <div style={{ ...label, marginBottom: 7 }}>Language</div>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!batchId} style={inputStyle}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div style={{ height: 1, background: T.divider, margin: '18px 0' }} />

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] || null) }}
          style={{
            border: `1.5px dashed ${file ? 'var(--accent)' : T.border2}`, borderRadius: 14,
            padding: file ? '18px' : '34px 18px', textAlign: 'center', cursor: 'pointer',
            background: file ? T.accentSoft : T.well, transition: 'all .15s',
          }}>
          <input ref={inputRef} type="file" accept="audio/*" hidden
            onChange={(e) => pickFile(e.target.files?.[0] || null)} />
          {file ? (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{file.name}</div>
              {fileUrl && <audio src={fileUrl} controls style={{ marginTop: 12, width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()} />}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14.5, color: T.text3, fontWeight: 500 }}>Drop an audio file or click to choose</div>
              <div style={{ fontSize: 12.5, color: T.faint, marginTop: 5 }}>mp3 · wav · m4a · ogg</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ ...label, marginBottom: 7 }}>Reference transcript · the correct (human) text</div>
          <textarea value={reference} onChange={(e) => setReference(e.target.value)} rows={4}
            placeholder="Paste what was actually said…"
            style={{ ...inputStyle, fontFamily: T.mono, lineHeight: 1.6, resize: 'vertical' }} />
        </div>

        {error && <div style={{ marginTop: 12, color: T.red, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
          <button onClick={run} disabled={!file || running || engineOffline}
            style={{ ...btnPrimary, opacity: (!file || running || engineOffline) ? 0.5 : 1, cursor: (!file || running) ? 'default' : 'pointer' }}>
            {running ? 'Transcribing…' : results.length ? 'Add & score clip' : 'Run STT'}
          </button>
          {results.length > 0 && <button onClick={reset} style={btnSecondary}>New batch</button>}
          {batchId && <span style={{ fontSize: 12, color: T.faint, fontFamily: T.mono }}>batch {batchId}</span>}
        </div>
      </div>

      {summary && summary.count > 1 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ ...label, marginBottom: 10 }}>Batch summary · {summary.count} clips</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <MetricTile label="Avg WER" value={rate(summary.avg_wer)} />
            <MetricTile label="Avg CER" value={rate(summary.avg_cer)} />
            <MetricTile label="Avg match" value={pct(summary.avg_match_pct)} color={overallVerdict?.color} />
            <div style={{ ...card, padding: '16px 18px', flex: 1, minWidth: 150 }}>
              <div style={{ ...label, marginBottom: 8 }}>Verdicts</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 13, fontFamily: T.mono }}>
                <span style={{ color: T.green }}>{summary.verdicts.good} good</span>
                <span style={{ color: T.amber }}>{summary.verdicts.fair} fair</span>
                <span style={{ color: T.red }}>{summary.verdicts.poor} poor</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...label }}>Results</div>
          {results.slice().reverse().map((r) => <ResultCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// BATCH MODE — many audio files, optional per-file references
// ===========================================================================
function BatchMode({ language, batchName, engineOffline, setLanguage, setBatchName }: {
  language: string; batchName: string; engineOffline: boolean
  setLanguage: (v: string) => void; setBatchName: (v: string) => void
}) {
  const [files, setFiles] = useState<File[]>(sttBatchFileCache)
  const [refs, setRefs] = usePersisted<Record<string, string>>('stt:batchRefs', {})
  const [showRefs, setShowRefs] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = usePersisted<string | null>('stt:batchUploadId', null)
  const [expected, setExpected] = usePersisted<number>('stt:batchExpected', 0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, scoring } = useBatchPoll(batchId, expected)

  useEffect(() => { sttBatchFileCache = files }, [files])

  const addFiles = (fl: FileList | null) => {
    if (!fl) return
    const audio = Array.from(fl).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(f.name))
    setFiles((cur) => [...cur, ...audio])
    setError(null)
  }

  const run = async () => {
    if (!files.length) return
    setRunning(true); setError(null)
    try {
      const batch = await api.createSttBatch({ name: batchName || undefined, language, mode: 'batch' })
      const form = new FormData()
      files.forEach((f) => form.append('audio', f, f.name))
      const provided: Record<string, string> = {}
      for (const f of files) { const t = (refs[f.name] || '').trim(); if (t) provided[f.name] = t }
      if (Object.keys(provided).length) form.append('references', JSON.stringify(provided))
      form.append('language', language)
      const { queued } = await api.addSttUploads(batch.id, form)
      setExpected(queued ?? files.length)
      setBatchId(batch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch upload failed')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setBatchId(null); setExpected(0); setFiles([]); setRefs({}); setShowRefs(false); sttBatchFileCache = []
    if (inputRef.current) inputRef.current.value = ''
  }

  if (batchId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: scoring ? 'rgba(91,157,255,0.14)' : 'rgba(76,201,138,0.14)', color: scoring ? T.blue : T.green }}>
            {scoring ? 'Scoring…' : 'Done'}
          </span>
          <span style={{ fontSize: 12, color: T.faint, fontFamily: T.mono }}>batch {batchId}</span>
          <button onClick={reset} style={{ ...btnSecondary, marginLeft: 'auto' }}>New batch</button>
        </div>
        <SttResultsView results={results} expected={expected} scoring={scoring} />
      </div>
    )
  }

  return (
    <div style={{ ...card, padding: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ ...label, marginBottom: 7 }}>Batch name · optional</div>
          <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Hindi outbound — Aug batch" style={inputStyle} />
        </div>
        <div style={{ width: 170 }}>
          <div style={{ ...label, marginBottom: 7 }}>Language</div>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div style={{ height: 1, background: T.divider, margin: '18px 0' }} />

      {/* Multi-file dropzone */}
      {files.length === 0 ? (
        <div onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          role="button" tabIndex={0}
          style={{ padding: '38px 24px', borderRadius: 14, border: `1.5px dashed ${T.border2}`, background: T.well, textAlign: 'center', cursor: 'pointer' }}>
          <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <div style={{ fontSize: 14.5, fontWeight: 600, color: T.text }}>Drop your audio files here</div>
          <div style={{ fontSize: 12.5, color: T.faint, marginTop: 5 }}>mp3 · wav · m4a · ogg · a whole folder is fine</div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {files.map((f, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 99, background: T.well, border: `1px solid ${T.border2}`, fontSize: 12, fontFamily: T.mono, color: T.text3 }}>
                <span style={{ color: 'var(--accent-hi)' }}>∿</span>{f.name.length > 24 ? f.name.slice(0, 22) + '…' : f.name}
                <span role="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: T.faint, marginLeft: 2 }}>×</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 15, fontSize: 12.5, color: T.faint }}>
            <span>{files.length} file{files.length === 1 ? '' : 's'} · {(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB</span>
            <button onClick={() => { setFiles([]); sttBatchFileCache = [] }} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Clear</button>
            <button onClick={() => inputRef.current?.click()} style={{ background: 'none', border: 'none', color: 'var(--accent-hi)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}>+ add more</button>
            <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          </div>
        </div>
      )}

      {/* Optional per-file references (collapsible, all optional) */}
      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowRefs((s) => !s)} style={{ background: 'none', border: 'none', color: T.faint, fontSize: 12.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            {showRefs ? 'hide references' : 'add a reference per file · optional (enables WER/CER)'}
          </button>
          {showRefs && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {files.map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12, color: T.text3, fontFamily: T.mono, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <textarea value={refs[f.name] || ''} onChange={(e) => setRefs((m) => ({ ...m, [f.name]: e.target.value }))} rows={2}
                    placeholder="Correct transcript for this file… (leave blank to skip scoring)"
                    style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 12, color: T.red, fontSize: 13 }}>{error}</div>}

      <div style={{ marginTop: 18 }}>
        <button onClick={run} disabled={!files.length || running || engineOffline}
          style={{ ...btnPrimary, opacity: (!files.length || running || engineOffline) ? 0.5 : 1, cursor: (!files.length || running) ? 'default' : 'pointer' }}>
          {running ? 'Uploading…' : `Run ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

// ===========================================================================
// IMPORT MODE — pull production calls by vertical + call IDs
// ===========================================================================
function parseCallIds(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  try {
    const j = JSON.parse(t)
    if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean)
  } catch { /* not JSON — fall through to delimiter split */ }
  return t.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

function ImportMode({ language, batchName, engineOffline, setLanguage, setBatchName }: {
  language: string; batchName: string; engineOffline: boolean
  setLanguage: (v: string) => void; setBatchName: (v: string) => void
}) {
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [vertical, setVertical] = usePersisted<string>('stt:importVertical', '')
  const [idsText, setIdsText] = usePersisted<string>('stt:importIds', '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = usePersisted<string | null>('stt:importBatchId', null)
  const [expected, setExpected] = usePersisted<number>('stt:importExpected', 0)
  const { results, scoring } = useBatchPoll(batchId, expected)

  useEffect(() => { api.sttVerticals().then(setVerticals).catch(() => setVerticals([])) }, [])

  const callIds = useMemo(() => parseCallIds(idsText), [idsText])
  const selected = verticals.find((v) => v.key === vertical)
  const canRun = !!vertical && selected?.configured !== false && callIds.length > 0

  const run = async () => {
    if (!canRun) return
    setRunning(true); setError(null)
    try {
      const batch = await api.createSttBatch({ name: batchName || undefined, language, mode: 'import', vertical })
      const { queued } = await api.importSttCalls(batch.id, { vertical, call_ids: callIds })
      setExpected(queued ?? callIds.length)
      setBatchId(batch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => { setBatchId(null); setExpected(0); setIdsText('') }

  if (batchId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: scoring ? 'rgba(91,157,255,0.14)' : 'rgba(76,201,138,0.14)', color: scoring ? T.blue : T.green }}>
            {scoring ? 'Fetching & scoring…' : 'Done'}
          </span>
          <span style={{ fontSize: 12, color: T.faint, fontFamily: T.mono }}>batch {batchId}</span>
          <button onClick={reset} style={{ ...btnSecondary, marginLeft: 'auto' }}>New import</button>
        </div>
        <SttResultsView results={results} expected={expected} scoring={scoring} />
      </div>
    )
  }

  return (
    <div style={{ ...card, padding: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ ...label, marginBottom: 7 }}>Batch name · optional</div>
          <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Prod imports — Aug audit" style={inputStyle} />
        </div>
        <div style={{ width: 170 }}>
          <div style={{ ...label, marginBottom: 7 }}>Language</div>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div style={{ height: 1, background: T.divider, margin: '18px 0' }} />

      {/* Vertical selector */}
      <div style={{ ...label, marginBottom: 10 }}>Call source · vertical</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {verticals.map((v) => {
          const on = v.key === vertical
          const disabled = v.configured === false
          return (
            <div key={v.key} role="radio" aria-checked={on} tabIndex={0}
              onClick={() => { if (!disabled) setVertical(v.key) }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 11, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border}` }}>
              <span style={{ width: 16, height: 16, borderRadius: 99, flexShrink: 0, border: `2px solid ${on ? 'var(--accent)' : T.border2}`, background: on ? 'var(--accent)' : 'transparent' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{v.label}</div>
                <div style={{ fontSize: 12, color: T.faint, fontFamily: T.mono, marginTop: 2 }}>{v.key}</div>
              </div>
              {disabled && <span style={{ fontSize: 11.5, color: T.amber, fontStyle: 'italic' }}>credentials not set</span>}
            </div>
          )
        })}
        {verticals.length === 0 && <div style={{ fontSize: 13, color: T.faint }}>No verticals available.</div>}
      </div>

      {/* Call IDs */}
      <div style={{ marginTop: 18 }}>
        <div style={{ ...label, marginBottom: 7 }}>Call IDs</div>
        <textarea value={idsText} onChange={(e) => setIdsText(e.target.value)} rows={5}
          placeholder='Paste a JSON array ["id1","id2"] or newline / comma / space-separated UUIDs'
          style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }} />
        <div style={{ fontSize: 11.5, color: callIds.length ? T.green : T.faint, marginTop: 5, fontFamily: T.mono }}>
          {callIds.length ? `${callIds.length} call ID${callIds.length === 1 ? '' : 's'} parsed` : 'no IDs yet'}
        </div>
      </div>

      {error && <div style={{ marginTop: 12, color: T.red, fontSize: 13 }}>{error}</div>}

      <div style={{ marginTop: 18 }}>
        <button onClick={run} disabled={!canRun || running || engineOffline}
          style={{ ...btnPrimary, opacity: (!canRun || running || engineOffline) ? 0.5 : 1, cursor: (!canRun || running) ? 'default' : 'pointer' }}>
          {running ? 'Starting…' : `Fetch & run ${callIds.length || ''}`}
        </button>
      </div>
    </div>
  )
}

// ===========================================================================
// ADD-NOISE MODE — one clean recording + noise presets/customs → mixed & scored
// ===========================================================================
function NoiseMode({ engineOffline }: { engineOffline: boolean }) {
  const [file, setFile] = useState<File | null>(sttNoiseFileCache)
  const [fileUrl, setFileUrl] = useState<string | null>(() => (sttNoiseFileCache ? URL.createObjectURL(sttNoiseFileCache) : null))
  const [reference, setReference] = usePersisted('stt:noiseReference', '')
  const [presets, setPresets] = useState<NoisePreset[]>([])
  const [checked, setChecked] = usePersisted<string[]>('stt:noisePresets', [])
  const [customs, setCustoms] = useState<File[]>(sttNoiseCustomCache)
  const [level, setLevel] = usePersisted<string>('stt:noiseLevel', 'medium')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = usePersisted<string | null>('stt:noiseBatchId', null)
  const [expected, setExpected] = usePersisted<number>('stt:noiseExpected', 0)
  const recRef = useRef<HTMLInputElement>(null)
  const noiseRef = useRef<HTMLInputElement>(null)
  const rawResults = useBatchPoll(batchId, expected)
  const { scoring } = rawResults
  // Show the Clean baseline row first.
  const results = useMemo(
    () => rawResults.results.slice().sort((a, b) => (a.noise_label ? 1 : 0) - (b.noise_label ? 1 : 0)),
    [rawResults.results],
  )

  useEffect(() => { sttNoiseFileCache = file }, [file])
  useEffect(() => { sttNoiseCustomCache = customs }, [customs])
  useEffect(() => {
    api.sttNoises()
      .then((r) => setPresets(r.noises || []))
      .catch(() => setPresets([]))
  }, [])

  const pickFile = (f: File | null) => {
    setFile(f); setError(null)
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    setFileUrl(f ? URL.createObjectURL(f) : null)
  }

  const addCustoms = (fl: FileList | null) => {
    if (!fl) return
    const audio = Array.from(fl).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(f.name))
    setCustoms((cur) => [...cur, ...audio])
    setError(null)
  }

  const toggle = (key: string) =>
    setChecked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const wordCount = reference.trim() ? reference.trim().split(/\s+/).length : 0
  const noiseCount = checked.length + customs.length
  const canRun = !!file && noiseCount > 0

  const run = async () => {
    if (!canRun) return
    setRunning(true); setError(null)
    try {
      const batch = await api.createSttBatch({ name: 'Noise test', language: 'auto', mode: 'noise' })
      const form = new FormData()
      form.append('recording', file!, file!.name)
      form.append('reference', reference)
      form.append('level', level)
      form.append('noise_presets', JSON.stringify(checked))
      customs.forEach((f) => form.append('noise', f, f.name))
      const { queued } = await api.runNoiseTest(batch.id, form)
      setExpected(queued ?? (1 + checked.length + customs.length))
      setBatchId(batch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noise test failed')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setBatchId(null); setExpected(0)
  }

  if (batchId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: scoring ? 'rgba(91,157,255,0.14)' : 'rgba(76,201,138,0.14)', color: scoring ? T.blue : T.green }}>
            {scoring ? 'Mixing & scoring…' : 'Done'}
          </span>
          <span style={{ fontSize: 12, color: T.faint, fontFamily: T.mono }}>batch {batchId}</span>
          <button onClick={reset} style={{ ...btnSecondary, marginLeft: 'auto' }}>New noise test</button>
        </div>
        <SttResultsView results={results} expected={expected} scoring={scoring} />
      </div>
    )
  }

  return (
    <div style={{ ...card, padding: 20 }}>
      {/* Clean recording */}
      <div style={{ ...label, marginBottom: 10 }}>Clean recording · the source clip to add noise to</div>
      <div
        onClick={() => recRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] || null) }}
        style={{
          border: `1.5px dashed ${file ? 'var(--accent)' : T.border2}`, borderRadius: 14,
          padding: file ? '18px' : '34px 18px', textAlign: 'center', cursor: 'pointer',
          background: file ? T.accentSoft : T.well, transition: 'all .15s',
        }}>
        <input ref={recRef} type="file" accept="audio/*" hidden onChange={(e) => pickFile(e.target.files?.[0] || null)} />
        {file ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{file.name}</div>
            {fileUrl && <audio src={fileUrl} controls style={{ marginTop: 12, width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()} />}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14.5, color: T.text3, fontWeight: 500 }}>Drop the clean audio or click to choose</div>
            <div style={{ fontSize: 12.5, color: T.faint, marginTop: 5 }}>mp3 · wav · m4a · ogg</div>
          </div>
        )}
      </div>

      {/* Reference transcript */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <div style={{ ...label }}>Reference transcript · the correct (human) text</div>
          <span style={{ fontSize: 11.5, color: T.faint, fontFamily: T.mono }}>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
        </div>
        <textarea value={reference} onChange={(e) => setReference(e.target.value)} rows={4}
          placeholder="Paste what was actually said… (leave blank to see transcripts only — no WER/CER)"
          style={{ ...inputStyle, fontFamily: T.mono, lineHeight: 1.6, resize: 'vertical' }} />
      </div>

      <div style={{ height: 1, background: T.divider, margin: '18px 0' }} />

      {/* Noise presets */}
      <div style={{ ...label, marginBottom: 10 }}>Noise environments</div>
      {presets.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {presets.map((p) => {
            const on = checked.includes(p.key)
            return (
              <div key={p.key} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => toggle(p.key)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 11, cursor: 'pointer', background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border}` }}>
                <span style={{ width: 15, height: 15, borderRadius: 5, flexShrink: 0, border: `2px solid ${on ? 'var(--accent)' : T.border2}`, background: on ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, lineHeight: 1 }}>{on ? '✓' : ''}</span>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: T.text2 }}>{p.label}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.faint, lineHeight: 1.6 }}>
          No preset environments yet — just drop your own noise file below.
        </div>
      )}

      {/* Custom noise files — drag & drop your own environment */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 8 }}>
          {presets.length > 0 ? 'Or drop your own noise environment:' : 'Drop your own noise environment:'}
        </div>
        <div
          onClick={() => noiseRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addCustoms(e.dataTransfer.files) }}
          style={{
            border: `1.5px dashed ${customs.length ? 'var(--accent)' : T.border2}`, borderRadius: 12,
            padding: '20px 18px', textAlign: 'center', cursor: 'pointer',
            background: customs.length ? T.accentSoft : T.well, transition: 'all .15s',
          }}>
          <input ref={noiseRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { addCustoms(e.target.files); if (noiseRef.current) noiseRef.current.value = '' }} />
          <div style={{ fontSize: 14, color: T.text3, fontWeight: 500 }}>
            <span style={{ color: 'var(--accent-hi)', marginRight: 5 }}>∿</span>Drop a noise file here, or click to choose
          </div>
          <div style={{ fontSize: 12, color: T.faint, marginTop: 5 }}>
            any mp3 · wav · m4a · ogg — traffic, café, crowd, rain, office… whatever you want to test against
          </div>
        </div>
        {customs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
            {customs.map((f, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 99, background: T.well, border: `1px solid ${T.border2}`, fontSize: 12, fontFamily: T.mono, color: T.text3 }}>
                <span style={{ color: 'var(--accent-hi)' }}>∿</span>{f.name.length > 24 ? f.name.slice(0, 22) + '…' : f.name}
                <span role="button" onClick={() => setCustoms((cur) => cur.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: T.faint, marginLeft: 2 }}>×</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: T.divider, margin: '18px 0' }} />

      {/* Intensity */}
      <div style={{ ...label, marginBottom: 10 }}>Intensity</div>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: T.well, borderRadius: 12, border: `1px solid ${T.border}` }}>
        {NOISE_LEVELS.map(([v, l]) => {
          const on = v === level
          return (
            <button key={v} onClick={() => setLevel(v)}
              style={{ padding: '8px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 500, background: on ? T.surface2 : 'transparent', color: on ? T.text : T.muted }}>
              {l}
            </button>
          )
        })}
      </div>

      {error && <div style={{ marginTop: 14, color: T.red, fontSize: 13 }}>{error}</div>}

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={run} disabled={!canRun || running || engineOffline}
          style={{ ...btnPrimary, opacity: (!canRun || running || engineOffline) ? 0.5 : 1, cursor: (!canRun || running) ? 'default' : 'pointer' }}>
          {running ? 'Starting…' : 'Run noise test'}
        </button>
        <span style={{ fontSize: 12.5, color: T.faint }}>
          {canRun ? `Clean baseline + ${noiseCount} noise${noiseCount === 1 ? '' : 's'}` : 'Pick a recording and at least one noise'}
        </span>
      </div>
    </div>
  )
}

// ===========================================================================
export function SttPage() {
  const [engineOffline, setEngineOffline] = useState(false)
  const [mode, setMode] = usePersisted<Mode>('stt:mode', 'single')
  const [language, setLanguage] = usePersisted('stt:language', 'en')
  const [batchName, setBatchName] = usePersisted('stt:batchName', '')

  useEffect(() => {
    api.sttProviders().then(() => setEngineOffline(false)).catch(() => setEngineOffline(true))
  }, [])

  const shared = { language, batchName, engineOffline, setLanguage, setBatchName }

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text, fontFamily: T.sans }}>Test STT</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>
        Upload real call audio and the correct transcript — we run speech-to-text and measure how close it got.
        STT errors corrupt everything downstream, so this is worth checking, especially for Hindi/Telugu.
      </p>

      {engineOffline && (
        <div style={{ marginTop: 20, ...card, borderLeft: `3px solid ${T.amber}`, padding: '14px 18px', color: T.amber2, fontSize: 13.5 }}>
          STT engine offline — start the engine to run transcriptions.
        </div>
      )}

      <div style={{ marginTop: 22, marginBottom: 20 }}>
        <ModeSwitch mode={mode} onChange={setMode} />
      </div>

      {mode === 'single' && <SingleMode {...shared} />}
      {mode === 'batch' && <BatchMode {...shared} />}
      {mode === 'import' && <ImportMode {...shared} />}
      {mode === 'noise' && <NoiseMode engineOffline={engineOffline} />}
    </div>
  )
}
