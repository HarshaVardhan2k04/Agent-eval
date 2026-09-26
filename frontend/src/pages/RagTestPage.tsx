import { useEffect, useMemo, useState } from 'react'
import { T, card, btnPrimary, btnSecondary, label } from '../theme'
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
  // ---- batch / call-mining ----
  type Mined = { query: string; said: string; kind: string }
  type BatchRow = { id: string; query: string; answer: string | null; gold_answer: string | null
                    metrics_json: Record<string, { score?: number; score_100?: number; reason?: string }
                      & { _no_context?: boolean; _error?: string }> }
  type Batch = { id: string; name: string | null; collection: string; status: string; source: string
                 source_meta: Record<string, unknown>; n_queries: number; n_done: number
                 created_at?: string
                 aggregate_json: { overall_100?: number | null; n_scored?: number; no_context?: number
                   per_metric?: Record<string, { score_100: number; n: number; weak: number
                     worst?: { id: string; query: string; score: number }[] }> }
                 queries?: BatchRow[] }
  const [mode, setMode] = usePersisted<'single' | 'batch' | 'call'>('rag:mode', 'single')
  const [batchText, setBatchText] = usePersisted('rag:batchText', '')
  const [vertical, setVertical] = usePersisted('rag:vertical', '')
  const [verticals, setVerticals] = useState<{ key: string; label: string; dbConfigured: boolean }[]>([])
  const [callId, setCallId] = usePersisted('rag:callId', '')
  const [mining, setMining] = useState(false)
  const [mined, setMined] = usePersisted<Mined[] | null>('rag:mined', null)
  const [minedMeta, setMinedMeta] = usePersisted<Record<string, unknown> | null>('rag:minedMeta', null)
  const [picked, setPicked] = usePersisted<string[]>('rag:picked', [])
  const [batch, setBatch] = usePersisted<Batch | null>('rag:batch', null)
  const [batches, setBatches] = useState<Batch[]>([])   // past batches, listed under history

  useEffect(() => { api.analysisVerticals().then(setVerticals).catch(() => {}) }, [])
  useEffect(() => { api.listRagBatches().then(setBatches).catch(() => {}) }, [])

  // poll a live batch until it settles
  useEffect(() => {
    if (!batch || batch.status !== 'running') return
    const t = setInterval(async () => {
      try {
        const b = await api.getRagBatch(batch.id) as Batch
        setBatch(b)
        if (b.status !== 'running') { clearInterval(t); api.listRagBatches().then(setBatches).catch(() => {}) }
      } catch { /* keep polling */ }
    }, 2500)
    return () => clearInterval(t)
  }, [batch, setBatch])

  async function mineCall() {
    setMining(true); setError(null); setMined(null)
    try {
      const d = await api.ragCallQueries({ vertical, call_id: callId.trim(), mode: 'llm' }) as
        { queries: Mined[]; warning?: string | null } & Record<string, unknown>
      setMined(d.queries || [])
      setMinedMeta({ n_turns: d.n_turns, n_user_turns: d.n_user_turns, agent_id: d.agent_id,
                     direction: d.direction, mode: d.mode, warning: d.warning })
      // pre-select only the knowledge-base questions; call actions stay off by default
      setPicked((d.queries || []).filter((q) => q.kind === 'kb_question').map((q) => q.query))
    } catch (e) { setError((e as Error).message || 'could not read that call') }
    setMining(false)
  }

  async function runBatch(queries: string[], source: string, source_meta: Record<string, unknown>) {
    if (!queries.length) return
    setBusy(true); setError(null)
    try {
      const started = await api.ragBatch({
        name: source === 'call' ? `call ${String(callId).slice(0, 8)}` : null,
        collection, rag_url: ragUrl, queries, answer_mode: answerMode,
        search_type: searchType, top_k: topK, alpha, rerank, source, source_meta,
      }) as { batch_id: string }
      setBatch(await api.getRagBatch(started.batch_id) as Batch)
    } catch (e) { setError((e as Error).message || 'batch failed to start') }
    setBusy(false)
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
            <div style={label}>Questions</div>
            <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: `1px solid ${T.border}` }}>
              {([['single', 'One question'], ['batch', 'Several questions'],
                 ['call', 'From a real call']] as [typeof mode, string][]).map(([v, lbl]) => (
                <button key={v} onClick={() => setMode(v)}
                  style={{ padding: '6px 13px', fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                           background: mode === v ? 'var(--accent)' : 'transparent',
                           color: mode === v ? '#fff' : T.muted }}>{lbl}</button>
              ))}
            </div>
          </div>

          {mode === 'single' && (
            <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={2}
              placeholder="e.g. what health insurance plans do you offer?"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          )}

          {mode === 'batch' && (
            <>
              <textarea value={batchText} onChange={(e) => setBatchText(e.target.value)} rows={6}
                placeholder={'one question per line —\nwhat health insurance plans do you offer?\nwhat is the waiting period for pre-existing conditions?\nhow do I claim reimbursement?'}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: T.mono, fontSize: 12.5 }} />
              <div style={{ fontSize: 11.5, color: T.faint, marginTop: 6 }}>
                {batchText.split('\n').filter((l) => l.trim()).length} questions · each is retrieved,
                answered and scored on its own, then combined into one read
              </div>
            </>
          )}

          {mode === 'call' && (
            <div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 170 }}>
                  <div style={{ ...label, marginBottom: 7 }}>Vertical</div>
                  <select value={vertical} onChange={(e) => setVertical(e.target.value)} style={inputStyle}>
                    <option value="">— pick —</option>
                    {verticals.filter((v) => v.dbConfigured).map((v) => (
                      <option key={v.key} value={v.key}>{v.label}</option>))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ ...label, marginBottom: 7 }}>Call ID</div>
                  <input value={callId} onChange={(e) => setCallId(e.target.value)} spellCheck={false}
                    placeholder="4848a532-8421-4d3f-a627-2d48a927e7c3"
                    style={{ ...inputStyle, fontFamily: T.mono, fontSize: 12.5 }} />
                </div>
                <button onClick={mineCall} disabled={!vertical || !callId.trim() || mining}
                  style={{ ...btnPrimary, opacity: (!vertical || !callId.trim() || mining) ? 0.5 : 1 }}>
                  {mining ? 'Reading call…' : 'Find the questions'}
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: T.faint, marginTop: 7 }}>
                Reads the transcript read-only and pulls out what the customer actually asked.
                Production takes the collection from per-call dispatch metadata, which the calls
                table doesn't store — so pick the collection above yourself.
              </div>

              {mined && (
                <div style={{ marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '9px 13px', borderBottom: `1px solid ${T.divider}`, display: 'flex',
                                gap: 10, alignItems: 'center', flexWrap: 'wrap', background: T.well }}>
                    <span style={{ fontSize: 12.5, color: T.text2, fontWeight: 600 }}>
                      {mined.length} found · {picked.length} selected
                    </span>
                    <span style={{ fontSize: 11.5, color: T.faint }}>
                      {String((minedMeta || {}).n_user_turns ?? '?')} customer turns ·
                      agent {String((minedMeta || {}).agent_id ?? '?')}
                    </span>
                    <button onClick={() => setPicked(mined.filter((q) => q.kind === 'kb_question').map((q) => q.query))}
                      style={{ ...btnSecondary, marginLeft: 'auto', fontSize: 11.5, padding: '4px 10px' }}>
                      only KB questions
                    </button>
                  </div>
                  {mined.map((q) => {
                    const on = picked.includes(q.query)
                    const isAction = q.kind === 'call_action'
                    return (
                      <div key={q.query} onClick={() => setPicked(on ? picked.filter((x) => x !== q.query) : [...picked, q.query])}
                        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 13px',
                                 borderTop: `1px solid ${T.divider}`, cursor: 'pointer',
                                 background: on ? 'rgba(var(--accent-rgb),0.07)' : 'transparent' }}>
                        <input type="checkbox" checked={on} readOnly style={{ accentColor: 'var(--accent)', marginTop: 3 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: T.text2 }}>{q.query}</div>
                          {q.said && q.said !== q.query && (
                            <div style={{ fontSize: 11, color: T.fainter, marginTop: 2, fontStyle: 'italic' }}>said: “{q.said}”</div>
                          )}
                        </div>
                        <span title={isAction
                            ? 'a request about the call itself — no knowledge base can answer it, so scoring it would punish retrieval unfairly'
                            : 'a document could answer this'}
                          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', padding: '2px 7px',
                                   borderRadius: 99, whiteSpace: 'nowrap',
                                   background: isAction ? T.amber + '22' : T.green + '18',
                                   color: isAction ? T.amber2 : T.green }}>
                          {isAction ? 'CALL ACTION' : 'KB'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
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

        {(() => {
          const lines = batchText.split('\n').map((l) => l.trim()).filter(Boolean)
          const n = mode === 'single' ? (query.trim() ? 1 : 0) : mode === 'batch' ? lines.length : picked.length
          const blocked = !collection || !collections.length || busy || n === 0
          const go = () => {
            if (mode === 'single') return run()
            if (mode === 'batch') return runBatch(lines, 'manual', {})
            return runBatch(picked, 'call', { vertical, call_id: callId.trim(),
              agent_id: (minedMeta || {}).agent_id ?? null, n_candidates: (mined || []).length })
          }
          return (
            <button onClick={go} disabled={blocked}
              style={{ ...btnPrimary, marginTop: 12, opacity: blocked ? 0.5 : 1 }}>
              {busy ? 'Retrieving & scoring…'
                : mode === 'single' ? 'Run RAG eval'
                : `Run ${n} question${n === 1 ? '' : 's'}`}
            </button>
          )
        })()}
      </div>

      {/* Past batches — reopen one without re-running it */}
      {!batch && batches.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...label, marginBottom: 10 }}>Past batches</div>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {batches.slice(0, 8).map((b, i) => (
              <div key={b.id} onClick={async () => setBatch(await api.getRagBatch(b.id) as Batch)}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 14px', cursor: 'pointer',
                         borderTop: i ? `1px solid ${T.divider}` : 'none', background: i % 2 ? T.well : 'transparent' }}>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700,
                               color: score100Color(b.aggregate_json?.overall_100 ?? null), width: 34 }}>
                  {b.aggregate_json?.overall_100 ?? '—'}
                </span>
                <span style={{ fontSize: 12.5, color: T.text2 }}>{b.name || `${b.n_queries} questions`}</span>
                <span style={{ fontSize: 11.5, color: T.fainter }}>{b.collection}</span>
                {b.source === 'call' && <span style={{ fontSize: 10.5, color: T.blue }}>from call</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.fainter }}>
                  {b.status === 'running' ? `${b.n_done}/${b.n_queries}` : new Date(b.created_at as unknown as string).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch results — per-question scores plus the combined read */}
      {batch && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...label, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Batch · {batch.collection}</span>
            <span style={{ fontSize: 11.5, color: batch.status === 'complete' ? T.green : batch.status === 'failed' ? T.red : T.blue }}>
              {batch.status === 'running' ? `running ${batch.n_done}/${batch.n_queries}` : batch.status}
            </span>
            {batch.source === 'call' && (
              <span style={{ fontSize: 11.5, color: T.fainter, fontFamily: T.mono }}>
                from call {String((batch.source_meta || {}).call_id || '').slice(0, 8)}
              </span>
            )}
            <button onClick={() => setBatch(null)} style={{ ...btnSecondary, marginLeft: 'auto', fontSize: 11.5, padding: '4px 10px' }}>close</button>
          </div>

          {/* combined */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 700, fontFamily: T.mono,
                              color: score100Color(batch.aggregate_json?.overall_100 ?? null) }}>
                  {batch.aggregate_json?.overall_100 ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: T.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>combined</div>
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {Object.entries(batch.aggregate_json?.per_metric || {}).map(([k, m]) => (
                  <div key={k}>
                    <div style={{ fontSize: 18, fontWeight: 650, fontFamily: T.mono, color: score100Color(m.score_100) }}>
                      {m.score_100}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted }}>{k.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 10.5, color: m.weak ? T.amber2 : T.fainter }}>
                      n={m.n}{m.weak ? ` · ${m.weak} weak` : ''}
                    </div>
                  </div>
                ))}
              </div>
              {!!batch.aggregate_json?.no_context && (
                <div style={{ marginLeft: 'auto', fontSize: 12, color: T.amber2 }}>
                  {batch.aggregate_json.no_context} question{batch.aggregate_json.no_context === 1 ? '' : 's'} retrieved nothing
                </div>
              )}
            </div>
          </div>

          {/* per question */}
          <div style={{ ...card, marginTop: 12, padding: 0, overflow: 'hidden' }}>
            {(batch.queries || []).map((q, i) => {
              const m = q.metrics_json || {}
              const failed = m._no_context || m._error
              return (
                <div key={q.id} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${T.divider}` : 'none',
                                         background: i % 2 ? T.well : 'transparent' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: T.text2, flex: 1, minWidth: 200 }}>{q.query}</span>
                    {failed ? (
                      <span style={{ fontSize: 11.5, color: T.amber2 }}>
                        {m._no_context ? 'no chunks retrieved' : String(m._error).slice(0, 60)}
                      </span>
                    ) : Object.entries(m).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                      <span key={k} title={k.replace(/_/g, ' ') + (v.reason ? ` — ${v.reason}` : '')}
                        style={{ fontSize: 11.5, fontFamily: T.mono, color: score100Color(v.score_100 ?? null) }}>
                        {k.split('_').map((w) => w[0]).join('').toUpperCase()} {v.score_100 ?? '—'}
                      </span>
                    ))}
                  </div>
                  {q.answer && (
                    <div style={{ fontSize: 11.5, color: T.faint, marginTop: 4, lineHeight: 1.5 }}>{q.answer}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {result && mode === 'single' && (
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
