import { useEffect, useMemo, useState } from 'react'
import { T, card, btnPrimary, label } from '../theme'
import { api } from '../api/client'
import { score100Color } from '../components/analysis'
import { usePersisted } from '../usePersisted'

type Chunk = { content?: string; text?: string; score?: number; collection?: string; section?: string }
type MetricResult = { score_100?: number | null; reason?: string; verdicts?: { verdict: string; reason: string }[]; error?: string }
type RagTest = {
  id: string; name: string | null; collection: string; query: string
  gold_answer: string | null; answer: string | null
  search_params: Record<string, unknown>
  retrieval_json: Chunk[]
  metrics_json: Record<string, MetricResult>
  created_at?: string
}

const RAG_LABELS: Record<string, string> = {
  contextual_relevancy: 'Contextual Relevancy',
  faithfulness: 'Faithfulness',
  answer_relevancy: 'Answer Relevancy',
  contextual_precision: 'Contextual Precision',
  contextual_recall: 'Contextual Recall',
}
const RAG_DEFS: Record<string, string> = {
  contextual_relevancy: 'Of everything the retriever returned, how much is actually relevant to the question? Low = noisy retrieval.',
  faithfulness: 'Does the answer stick to the retrieved chunks, or hallucinate? 100 = fully grounded, 0 = made up.',
  answer_relevancy: 'Does the answer actually address the question, without rambling or dodging?',
  contextual_precision: 'Are the RELEVANT chunks ranked above the irrelevant ones? (reranker / ranking quality). Needs a gold answer.',
  contextual_recall: 'Did retrieval fetch everything the gold answer needs? (embedding-model coverage). Needs a gold answer.',
}
const ORDER = ['contextual_relevancy', 'contextual_precision', 'contextual_recall', 'faithfulness', 'answer_relevancy']
// What each metric needs before it can run — shown on the locked card.
const UNLOCK: Record<string, string> = {
  faithfulness: 'Needs an answer — set Answer to “Generate” or paste your RAG answer',
  answer_relevancy: 'Needs an answer — set Answer to “Generate” or paste your RAG answer',
  contextual_precision: 'Needs a gold answer — fill “Gold answer” above',
  contextual_recall: 'Needs a gold answer — fill “Gold answer” above',
}

// Greyed-out slot for a metric the current inputs can't compute yet.
function LockedCard({ name }: { name: string }) {
  return (
    <div style={{ ...card, padding: 15, borderLeft: `3px solid ${T.border2}`, opacity: 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {RAG_LABELS[name] || name}<InfoDotLocal def={RAG_DEFS[name]} />
        </span>
        <span style={{ fontSize: 13, color: T.faint }}>🔒</span>
      </div>
      <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>{UNLOCK[name]}</div>
    </div>
  )
}

function MetricCard({ name, m }: { name: string; m: MetricResult }) {
  const [open, setOpen] = useState(false)
  const v = m?.score_100 ?? null
  const col = score100Color(v)
  return (
    <div style={{ ...card, padding: 15, borderLeft: `3px solid ${col}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {RAG_LABELS[name] || name}
          <span onMouseEnter={() => 0}><InfoDotLocal def={RAG_DEFS[name]} /></span>
        </span>
        <span style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: col }}>{v == null ? '—' : v}</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: T.track, overflow: 'hidden', margin: '9px 0' }}>
        <div style={{ height: '100%', width: `${v ?? 0}%`, background: col, borderRadius: 99, transition: 'width .5s' }} />
      </div>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{m?.error ? `error: ${m.error}` : (m?.reason || '')}</div>
      {m?.verdicts && m.verdicts.length > 0 && (
        <>
          <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: T.faint, fontSize: 11.5, cursor: 'pointer', padding: '6px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            {open ? '▾' : '▸'} {m.verdicts.length} verdicts
          </button>
          {open && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {m.verdicts.map((vd, i) => (
                <div key={i} style={{ fontSize: 11.5, color: T.text3, display: 'flex', gap: 7 }}>
                  <span style={{ color: vd.verdict === 'yes' ? T.green : vd.verdict === 'idk' ? T.amber : T.red, fontWeight: 700, flexShrink: 0 }}>{vd.verdict}</span>
                  <span style={{ lineHeight: 1.4 }}>{vd.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Small local `?` (avoids depending on the DEFINITIONS map keys).
function InfoDotLocal({ def }: { def?: string }) {
  const [open, setOpen] = useState(false)
  if (!def) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span style={{ width: 14, height: 14, borderRadius: 99, border: `1px solid ${T.border2}`, color: T.faint, fontSize: 9.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}>?</span>
      {open && (
        <span style={{ position: 'absolute', bottom: '150%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, width: 240, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: T.text3, fontWeight: 400, boxShadow: '0 12px 30px -10px rgba(0,0,0,0.8)' }}>{def}</span>
      )}
    </span>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, outline: 'none' }

export function RagTestPage() {
  // Inputs/selections/result persist across navigation; transient flags don't.
  const [ragUrl, setRagUrl] = usePersisted('rag:url', '')
  const [connecting, setConnecting] = useState(false)
  const [connErr, setConnErr] = useState<string | null>(null)
  const [collections, setCollections] = usePersisted<{ name: string; objects: number }[]>('rag:collections', [])
  const [collection, setCollection] = usePersisted('rag:collection', '')
  const [query, setQuery] = usePersisted('rag:query', '')
  const [gold, setGold] = usePersisted('rag:gold', '')
  const [searchType, setSearchType] = usePersisted('rag:searchType', 'hybrid')
  const [topK, setTopK] = usePersisted('rag:topK', 5)
  const [alpha, setAlpha] = usePersisted('rag:alpha', 0.7)
  const [rerank, setRerank] = usePersisted('rag:rerank', true)
  const [answerMode, setAnswerMode] = usePersisted('rag:answerMode', 'generate')
  const [providedAnswer, setProvidedAnswer] = usePersisted('rag:providedAnswer', '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = usePersisted<RagTest | null>('rag:result', null)
  const [history, setHistory] = useState<RagTest[]>([])

  const connect = async (url: string) => {
    if (!/^https?:\/\/.+/i.test(url)) { setConnErr('Enter a valid http(s) URL'); return }
    setConnecting(true); setConnErr(null)
    try {
      const d = await api.ragCollections(url)
      setCollections(d.collections || [])
      if (d.collections?.[0]) setCollection(d.collections[0].name)
      if (!d.collections?.length) setConnErr('Connected, but this endpoint returned no collections.')
    } catch (e) {
      setCollections([])
      setConnErr(e instanceof Error ? e.message : 'Could not reach that RAG API')
    } finally {
      setConnecting(false)
    }
  }

  useEffect(() => {
    // First visit: prefill a suggested URL (fully editable) and auto-connect.
    // Returning with a restored URL: only reconnect if we don't already have the
    // collections cached, so the page comes back instantly without a round-trip.
    if (!ragUrl) {
      api.ragDefaultUrl().then((d) => { setRagUrl(d.url || ''); if (d.url) connect(d.url) }).catch(() => {})
    } else if (!collections.length) {
      connect(ragUrl)
    }
    api.listRagTests().then(setHistory).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async () => {
    if (!collection || !query.trim()) return
    setBusy(true); setError(null); setResult(null)
    try {
      const body: Record<string, unknown> = {
        rag_url: ragUrl, collection, query, search_type: searchType, top_k: topK, alpha, rerank,
        gold_answer: gold || undefined, answer_mode: answerMode,
      }
      if (answerMode === 'provided') body.answer = providedAnswer
      const r = await api.ragEvaluate(body)
      setResult(r)
      api.listRagTests().then(setHistory).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'RAG evaluation failed')
    } finally {
      setBusy(false)
    }
  }

  const load = async (id: string) => {
    try { setResult(await api.getRagTest(id)) } catch { /* ignore */ }
  }

  const remove = async (id: string) => {
    setHistory((hs) => hs.filter((h) => h.id !== id))   // optimistic
    setResult((r) => (r && r.id === id ? null : r))
    try { await api.deleteRagTest(id) } catch { api.listRagTests().then(setHistory).catch(() => {}) }
  }

  const ranCount = useMemo(() => (result ? ORDER.filter((k) => result.metrics_json[k]).length : 0), [result])

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>RAG Testing</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>
        Query your knowledge base, then measure how good the retrieval and the answer are — relevancy, faithfulness, precision &amp; recall.
      </p>

      {/* Connect to any RAG endpoint */}
      <div style={{ ...card, padding: 18, marginTop: 20 }}>
        <div style={{ ...label, marginBottom: 8 }}>RAG API URL · point it at any endpoint</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={ragUrl} onChange={(e) => setRagUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') connect(ragUrl) }}
            placeholder="http://your-rag-host:7070" spellCheck={false}
            style={{ ...inputStyle, flex: 1, minWidth: 260, fontFamily: T.mono, fontSize: 13 }} />
          <button onClick={() => connect(ragUrl)} disabled={connecting || !ragUrl.trim()}
            style={{ ...btnPrimary, opacity: (connecting || !ragUrl.trim()) ? 0.5 : 1 }}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
          {collections.length > 0 && !connErr && (
            <span style={{ fontSize: 12.5, color: T.green, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: T.green }} />{collections.length} collections
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8 }}>
          Expects <code style={{ fontFamily: T.mono }}>GET /collections</code> and <code style={{ fontFamily: T.mono }}>POST /search</code> (query · collection · search_type · top_k · alpha · rerank · distance_threshold).
        </div>
        {connErr && <div style={{ color: T.amber2, fontSize: 12.5, marginTop: 8 }}>{connErr}</div>}
      </div>

      {/* Config — enabled once connected */}
      <div style={{ ...card, padding: 20, marginTop: 16, opacity: collections.length ? 1 : 0.5, pointerEvents: collections.length ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ ...label, marginBottom: 7 }}>Collection</div>
            <select value={collection} onChange={(e) => setCollection(e.target.value)} style={inputStyle}>
              {collections.length === 0 && <option value="">— connect first —</option>}
              {collections.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.objects})</option>)}
            </select>
          </div>
          <div style={{ width: 150 }}>
            <div style={{ ...label, marginBottom: 7 }}>Search type</div>
            <select value={searchType} onChange={(e) => setSearchType(e.target.value)} style={inputStyle}>
              <option value="hybrid">Hybrid + rerank</option><option value="keyword">Keyword (BM25)</option><option value="text">Vector</option>
            </select>
          </div>
          <div style={{ width: 90 }}>
            <div style={{ ...label, marginBottom: 7 }}>Top-K</div>
            <input type="number" min={1} max={20} value={topK} onChange={(e) => setTopK(parseInt(e.target.value) || 5)} style={inputStyle} />
          </div>
          <div style={{ width: 130 }}>
            <div style={{ ...label, marginBottom: 7 }}>Alpha {alpha}</div>
            <input type="range" min={0} max={1} step={0.1} value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: T.text2, cursor: 'pointer', paddingBottom: 8 }}>
            <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} /> Rerank
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ ...label, marginBottom: 7 }}>Question</div>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={2} placeholder="e.g. what health insurance plans do you offer?"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ ...label, marginBottom: 7 }}>Answer</div>
            <select value={answerMode} onChange={(e) => setAnswerMode(e.target.value)} style={inputStyle}>
              <option value="generate">Generate with Gemma (from the chunks)</option>
              <option value="provided">Paste my RAG system's answer</option>
              <option value="none">Retrieval only (no answer)</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ ...label, marginBottom: 7, display: 'inline-flex', gap: 6 }}>Gold answer · optional <InfoDotLocal def="A reference/ideal answer. Unlocks Contextual Precision & Recall (retrieval quality)." /></div>
            <input value={gold} onChange={(e) => setGold(e.target.value)} placeholder="the ideal answer (enables Precision + Recall)" style={inputStyle} />
          </div>
        </div>

        {answerMode === 'provided' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...label, marginBottom: 7 }}>Your RAG answer</div>
            <textarea value={providedAnswer} onChange={(e) => setProvidedAnswer(e.target.value)} rows={3} placeholder="paste the answer your RAG system produced…"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        )}

        {error && <div style={{ color: T.red, fontSize: 13, marginTop: 12 }}>{error}</div>}

        {/* Live hint: how many of the 5 metrics this config will produce. */}
        <div style={{ fontSize: 12, color: T.muted, marginTop: 14, lineHeight: 1.6 }}>
          This config computes <b style={{ color: T.text2 }}>{1 + (answerMode !== 'none' ? 2 : 0) + (gold.trim() ? 2 : 0)} of 5</b> metrics:
          {' '}Contextual Relevancy always ·
          {answerMode !== 'none' ? ' Faithfulness + Answer Relevancy (answer) ·' : ''}
          {gold.trim() ? ' Contextual Precision + Recall (gold answer)' : ''}
          {answerMode === 'none' && !gold.trim() ? ' add an answer and/or a gold answer to unlock the other 4.' : ''}
        </div>

        <button onClick={run} disabled={!collection || !query.trim() || busy || !collections.length}
          style={{ ...btnPrimary, marginTop: 12, opacity: (!collection || !query.trim() || busy || !collections.length) ? 0.5 : 1 }}>
          {busy ? 'Retrieving & scoring…' : 'Run RAG eval'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...label, marginBottom: 12 }}>
            Metrics · {ranCount} of 5 ran · {result.collection} · {String(result.search_params.search_type)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {ORDER.map((k) => result.metrics_json[k]
              ? <MetricCard key={k} name={k} m={result.metrics_json[k]} />
              : <LockedCard key={k} name={k} />)}
          </div>

          {result.answer && (
            <div style={{ marginTop: 20 }}>
              <div style={{ ...label, marginBottom: 8 }}>Answer</div>
              <div style={{ ...card, padding: 16, fontSize: 14, color: T.text2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.answer}</div>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <div style={{ ...label, marginBottom: 8 }}>Retrieved chunks · {result.retrieval_json.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.retrieval_json.map((c, i) => (
                <div key={i} style={{ ...card, padding: '11px 14px', display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 12, fontFamily: T.mono, color: 'var(--accent)', flexShrink: 0 }}>#{i + 1} · {typeof c.score === 'number' ? c.score.toFixed(3) : '—'}</span>
                  <div style={{ minWidth: 0 }}>
                    {c.collection && <span style={{ fontSize: 11, color: T.faint, fontFamily: T.mono }}>{c.collection}{c.section ? ` · ${c.section}` : ''}</span>}
                    <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.5, marginTop: 2 }}>{(c.content || c.text || '').slice(0, 400)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ ...label, marginBottom: 12 }}>Recent RAG tests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((h) => (
              <div key={h.id} className="ev-row" onClick={() => load(h.id)} style={{ ...card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.query}</div>
                  <div style={{ fontSize: 11.5, color: T.faint, fontFamily: T.mono, marginTop: 2 }}>{h.collection} · {String(h.search_params?.search_type || '')}</div>
                </div>
                {typeof h.metrics_json?.contextual_relevancy?.score_100 === 'number' && (
                  <span style={{ fontSize: 12, color: T.muted }}>rel <b style={{ color: score100Color(h.metrics_json.contextual_relevancy.score_100), fontFamily: T.mono }}>{h.metrics_json.contextual_relevancy.score_100}</b></span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); remove(h.id) }}
                  title="Delete this test" aria-label="Delete this test"
                  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border2}`, background: 'transparent', color: T.faint, cursor: 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = 'rgba(236,90,84,0.4)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = T.faint; e.currentTarget.style.borderColor = T.border2 }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
