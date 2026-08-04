import { useEffect, useMemo, useState } from 'react'
import { T, card, label } from '../theme'
import { api } from '../api/client'

// --- Shared STT result types (batch + import) ------------------------------
export type DiffOp = { type: 'equal' | 'sub' | 'del' | 'ins'; ref: string[]; hyp: string[] }
export type SttMetrics = {
  wer: number | null; cer: number | null; match_pct: number | null
  verdict?: string; primary_metric?: string; diff?: DiffOp[]
  detected_language?: string | null; duration_ms?: number
}
export type SttResult = {
  id: number
  filename: string | null
  reference_text: string | null
  hypothesis_text: string | null
  metrics_json: SttMetrics
  source_type?: string
  vertical?: string | null
  external_call_id?: string | null
  gcs_path?: string | null
  duration_ms?: number | null
  language?: string | null
  gated_reason?: string | null
  noise_label?: string | null
  noise_level?: string | null
}

// A noise-test row: the clean baseline row has no noise_label; every mixed row does.
export function isNoiseRow(r: SttResult): boolean {
  return r.source_type === 'noise'
}
export function isNoisyMix(r: SttResult): boolean {
  return isNoiseRow(r) && !!r.noise_label
}

// --- Metric helpers --------------------------------------------------------
// The engine returns WER/CER as fractions (0..1); we display them as percents.
export function rate(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(1) + '%'
}
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${v}%`
}
const werPct = (m: SttMetrics) => (m.wer == null ? null : m.wer * 100)
const cerPct = (m: SttMetrics) => (m.cer == null ? null : m.cer * 100)

// Threshold colours (percent scale) — WER >20 fail / >12 warn; CER >10 / >6.
export function werColor(p: number | null): string {
  return p == null ? T.faint : p > 20 ? T.red : p > 12 ? T.amber : T.green
}
export function cerColor(p: number | null): string {
  return p == null ? T.faint : p > 10 ? T.red : p > 6 ? T.amber : T.green
}

type Verdict = { color: string; label: string }
export function verdictOf(m: SttMetrics): Verdict {
  const w = werPct(m)
  const c = cerPct(m)
  if (w == null && c == null) return { color: T.faint, label: 'No reference' }
  if ((w != null && w > 20) || (c != null && c > 10)) return { color: T.red, label: 'Poor' }
  if (w === 0 && c === 0) return { color: T.green, label: 'Perfect' }
  return { color: T.green, label: 'Good' }
}

// --- Word-by-word diff (reused from the single-file flow) -------------------
export function DiffView({ diff }: { diff: DiffOp[] }) {
  const refSpan = (op: DiffOp, w: string, i: number) => {
    const st: React.CSSProperties = { padding: '1px 5px', borderRadius: 5 }
    if (op.type === 'sub') Object.assign(st, { background: 'rgba(236,90,84,0.18)', color: T.red, borderBottom: '2px solid rgba(236,90,84,0.7)' })
    if (op.type === 'del') Object.assign(st, { background: 'rgba(240,168,60,0.18)', color: T.amber, borderBottom: '2px solid rgba(240,168,60,0.7)' })
    return <span key={i} style={st}>{w} </span>
  }
  const hypSpan = (op: DiffOp, w: string, i: number) => {
    const st: React.CSSProperties = { padding: '1px 5px', borderRadius: 5 }
    if (op.type === 'sub') Object.assign(st, { background: 'rgba(236,90,84,0.18)', color: T.red, borderBottom: '2px solid rgba(236,90,84,0.7)' })
    if (op.type === 'ins') Object.assign(st, { background: 'rgba(91,157,255,0.18)', color: T.blue, borderBottom: '2px solid rgba(91,157,255,0.7)' })
    return <span key={i} style={st}>{w} </span>
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 11.5, color: T.faint, flexWrap: 'wrap' }}>
        <span><span style={{ color: T.red }}>■</span> heard wrong</span>
        <span><span style={{ color: T.amber }}>■</span> missed</span>
        <span><span style={{ color: T.blue }}>■</span> invented</span>
      </div>
      <div className="diff-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.border}` }}>
        <div style={{ padding: 14, borderRight: `1px solid ${T.border}`, background: T.well }}>
          <div style={{ ...label, marginBottom: 8 }}>Reference (human)</div>
          <div style={{ fontSize: 14, lineHeight: 1.9, color: T.text2, fontFamily: T.mono }}>
            {diff.map((op, oi) => op.ref.map((w, wi) => refSpan(op, w, oi * 1000 + wi)))}
          </div>
        </div>
        <div style={{ padding: 14, background: T.well }}>
          <div style={{ ...label, marginBottom: 8 }}>STT output</div>
          <div style={{ fontSize: 14, lineHeight: 1.9, color: T.text2, fontFamily: T.mono }}>
            {diff.map((op, oi) => op.hyp.map((w, wi) => hypSpan(op, w, oi * 1000 + wi)))}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Summary tiles ----------------------------------------------------------
function Tile({ label: l, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...card, padding: '16px 18px', flex: 1, minWidth: 130 }}>
      <div style={{ ...label, marginBottom: 8 }}>{l}</div>
      <div style={{ fontSize: 29, fontWeight: 600, fontFamily: T.mono, color: color || T.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// Compute tiles from the rows themselves so we don't depend on the exact
// summary_json shape (backend is being built concurrently).
function tilesFromResults(results: SttResult[]) {
  const scored = results.filter((r) => !r.gated_reason && r.metrics_json && r.metrics_json.wer != null)
  const n = scored.length
  const mean = (f: (m: SttMetrics) => number | null) =>
    n ? scored.reduce((s, r) => s + (f(r.metrics_json) || 0), 0) / n : null
  const passed = scored.filter((r) => {
    const w = werPct(r.metrics_json)
    const c = cerPct(r.metrics_json)
    return (w == null || w <= 12) && (c == null || c <= 6)
  }).length
  return {
    total: results.length,
    avgWer: mean((m) => m.wer),
    avgCer: mean((m) => m.cer),
    scored: n,
    passed,
    gated: results.filter((r) => r.gated_reason).length,
  }
}

const GRID = '1.6fr 0.8fr 0.7fr 0.7fr 0.9fr 1fr 20px'

function HeaderCell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.faint, textAlign: align }}>{children}</div>
}

function TableRow({ r, onClick }: { r: SttResult; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const m = r.metrics_json || ({} as SttMetrics)
  const w = werPct(m)
  const c = cerPct(m)
  const v = verdictOf(m)
  const lang = m.detected_language || r.language || '—'
  const gated = !!r.gated_reason
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer', background: hover ? T.rowHover : 'transparent', borderBottom: `1px solid ${T.divider}` }}>
      <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 13.5, color: T.text2, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
        {isNoiseRow(r) ? (
          <>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.noise_label || 'Clean'}</span>
            {!r.noise_label && (
              <span style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 99, background: T.chip, color: T.faint, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>baseline</span>
            )}
            {r.noise_level && r.noise_label && (
              <span style={{ flexShrink: 0, fontSize: 11, color: T.faint, fontFamily: T.mono }}>{r.noise_level}</span>
            )}
          </>
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.filename || r.external_call_id || `clip #${r.id}`}</span>
        )}
      </div>
      {gated ? (
        <div style={{ gridColumn: '2 / 7', fontSize: 12.5, color: T.amber, fontFamily: T.mono }}>gated — {r.gated_reason}</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: T.muted, fontFamily: T.mono }}>{lang}</div>
          <div style={{ fontSize: 13, fontFamily: T.mono, textAlign: 'right', color: werColor(w) }}>{rate(m.wer)}</div>
          <div style={{ fontSize: 13, fontFamily: T.mono, textAlign: 'right', color: cerColor(c) }}>{rate(m.cer)}</div>
          <div style={{ fontSize: 13, fontFamily: T.mono, textAlign: 'right', color: T.text3 }}>{pct(m.match_pct)}</div>
          <div>
            <span style={{ padding: '3px 10px', borderRadius: 99, background: `${v.color}22`, color: v.color, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: v.color }} />{v.label}
            </span>
          </div>
        </>
      )}
      <div style={{ color: T.faint, fontSize: 14, textAlign: 'center' }}>›</div>
    </div>
  )
}

// --- Detail drill-in --------------------------------------------------------
function MetricCard({ label: l, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ ...card, padding: '18px 20px', flex: 1, minWidth: 150, borderLeft: `3px solid ${color}` }}>
      <div style={{ ...label, marginBottom: 10 }}>{l}</div>
      <div style={{ fontSize: 36, fontWeight: 600, fontFamily: T.mono, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function Detail({ results, index, onBack, onSelect }: {
  results: SttResult[]; index: number; onBack: () => void; onSelect: (i: number) => void
}) {
  const r = results[index]
  const m = r.metrics_json || ({} as SttMetrics)
  const v = verdictOf(m)
  const w = werPct(m)
  const c = cerPct(m)
  const isImport = r.source_type === 'import' || !!r.external_call_id
  const noRef = !r.gated_reason && w == null && c == null // upload with no reference supplied
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  // Fetch a signed URL for imported calls' source audio (uploads return null).
  useEffect(() => {
    let alive = true
    setAudioUrl(null)
    if (isImport) {
      api.sttResultAudioUrl(r.id).then((res) => { if (alive) setAudioUrl(res?.url || null) }).catch(() => {})
    }
    return () => { alive = false }
  }, [r.id, isImport])

  const prev = () => onSelect(index - 1)
  const next = () => onSelect(index + 1)

  return (
    <div>
      {/* Breadcrumb + prev/next */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 13.5, cursor: 'pointer', padding: 0 }}>← All files</button>
        <span style={{ fontSize: 12.5, color: T.faint }}>File {index + 1} of {results.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={prev} disabled={index === 0}
            style={{ padding: '6px 12px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: index === 0 ? T.fainter : T.text3, fontSize: 14, cursor: index === 0 ? 'default' : 'pointer' }}>‹</button>
          <button onClick={next} disabled={index === results.length - 1}
            style={{ padding: '6px 12px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: index === results.length - 1 ? T.fainter : T.text3, fontSize: 14, cursor: index === results.length - 1 ? 'default' : 'pointer' }}>›</button>
        </div>
      </div>

      <div style={{ fontSize: 17, fontWeight: 600, color: T.text, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 10 }}>
        {isNoiseRow(r) ? (r.noise_label || 'Clean') : (r.filename || r.external_call_id || `clip #${r.id}`)}
        {isNoiseRow(r) && !r.noise_label && (
          <span style={{ padding: '3px 9px', borderRadius: 99, background: T.chip, color: T.faint, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>baseline</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.faint, fontFamily: T.mono, marginTop: 3 }}>
        {isImport && r.vertical ? `${r.vertical} · ` : ''}
        {isNoisyMix(r) && r.noise_level ? `intensity ${r.noise_level} · ` : ''}
        {m.detected_language ? `detected ${m.detected_language}` : ''}
        {r.duration_ms || m.duration_ms ? ` · ${(((r.duration_ms || m.duration_ms) as number) / 1000).toFixed(1)}s` : ''}
      </div>

      {/* Gated */}
      {r.gated_reason ? (
        <div style={{ ...card, borderLeft: `3px solid ${T.amber}`, padding: '14px 18px', marginTop: 16, color: T.amber2, fontSize: 13.5 }}>
          Gated — {r.gated_reason}
          {r.hypothesis_text && (
            <div style={{ marginTop: 12, fontSize: 13, color: T.text3, fontFamily: T.mono, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r.hypothesis_text}</div>
          )}
        </div>
      ) : (
        <>
          {/* Verdict banner */}
          <div style={{ ...card, background: `${v.color}14`, borderLeft: `3px solid ${v.color}`, padding: '14px 18px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: v.color }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: v.color }}>{v.label}</span>
            <span style={{ fontSize: 12.5, color: T.muted }}>
              {noRef ? 'Transcript only — no reference to score against.' : 'Scored against the reference transcript.'}
            </span>
          </div>

          {/* Metric cards / no-ref note */}
          {noRef ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>Transcript · no reference provided</div>
              <div style={{ ...card, padding: 16, fontSize: 14, color: T.text2, fontFamily: T.mono, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {r.hypothesis_text || '—'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <MetricCard label="WER" value={rate(m.wer)} color={werColor(w)} sub={m.primary_metric === 'cer' ? undefined : 'primary'} />
              <MetricCard label="CER" value={rate(m.cer)} color={cerColor(c)} sub={m.primary_metric === 'cer' ? 'primary · Indic' : undefined} />
              <MetricCard label="Match" value={pct(m.match_pct)} color={v.color} />
            </div>
          )}

          {/* Audio (imports only) */}
          {isImport && audioUrl && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>Source recording</div>
              <audio src={audioUrl} controls style={{ width: '100%', maxWidth: 520 }} />
            </div>
          )}

          {/* Merged noisy audio (noise mix rows only — the Clean row has no player) */}
          {isNoisyMix(r) && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>Noisy mix · {r.noise_label}{r.noise_level ? ` · ${r.noise_level}` : ''}</div>
              <audio src={api.sttResultMixedAudioUrl(r.id)} controls style={{ width: '100%', maxWidth: 520 }} />
            </div>
          )}

          {/* Word-by-word diff */}
          {!noRef && m.diff && m.diff.length > 0 && (
            <div style={{ marginTop: 18 }}><DiffView diff={m.diff} /></div>
          )}
        </>
      )}
    </div>
  )
}

// --- Public view: summary tiles + table, or the detail drill-in -------------
export function SttResultsView({ results, expected, scoring }: {
  results: SttResult[]; expected: number; scoring: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const t = useMemo(() => tilesFromResults(results), [results])

  if (selected != null && results[selected]) {
    return <Detail results={results} index={selected} onBack={() => setSelected(null)} onSelect={setSelected} />
  }

  const done = results.length
  const barPct = expected ? Math.round((done / expected) * 100) : (scoring ? 0 : 100)

  return (
    <div>
      {scoring && (
        <div style={{ ...card, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: T.muted, marginBottom: 8 }}>
            <span>Transcribing &amp; scoring…</span>
            <span style={{ fontFamily: T.mono }}>{done}{expected ? ` / ${expected}` : ''}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${barPct}%`, background: T.accentGrad, borderRadius: 99, transition: 'width .5s' }} />
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Tile label="Total" value={String(t.total)} sub={t.gated ? `${t.gated} gated` : `${t.scored} scored`} />
        <Tile label="Avg WER" value={rate(t.avgWer)} color={werColor(t.avgWer == null ? null : t.avgWer * 100)} />
        <Tile label="Avg CER" value={rate(t.avgCer)} color={cerColor(t.avgCer == null ? null : t.avgCer * 100)} />
        <Tile label="Passed" value={`${t.passed}${t.scored ? `/${t.scored}` : ''}`} color={t.scored && t.passed === t.scored ? T.green : t.passed ? T.amber : T.faint} />
      </div>

      {/* Results table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 14px', borderBottom: `1px solid ${T.border}` }}>
          <HeaderCell>File</HeaderCell>
          <HeaderCell>Language</HeaderCell>
          <HeaderCell align="right">WER</HeaderCell>
          <HeaderCell align="right">CER</HeaderCell>
          <HeaderCell align="right">Match</HeaderCell>
          <HeaderCell>Verdict</HeaderCell>
          <div />
        </div>
        {results.map((r, i) => <TableRow key={r.id} r={r} onClick={() => setSelected(i)} />)}
        {results.length === 0 && (
          <div style={{ padding: '22px 14px', fontSize: 13, color: T.faint }}>
            {scoring ? 'Waiting for the first result…' : 'No results.'}
          </div>
        )}
      </div>
    </div>
  )
}
