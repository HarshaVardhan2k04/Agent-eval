import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, label, btnPrimary, backBtn } from '../../theme'
import { api } from '../../api/client'
import { usePersisted, clearPersisted } from '../../usePersisted'
import { MergedPreviewPanel } from '../../components/forge'

type LayerRow = { id: string; prompt_type: string; friendly_name: string }
type VerticalRow = { key: string; label: string; dbConfigured: boolean }

// JSON array OR whitespace/comma separated — the shared Call-Analysis parse.
function parseIds(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  try {
    const arr = JSON.parse(t)
    if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean)
  } catch { /* fall through */ }
  return t.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

function parsePersonas(text: string): { personas: { id: string; persona: string; category?: string }[]; error: string | null } {
  const t = text.trim()
  if (!t) return { personas: [], error: null }
  try {
    const arr = JSON.parse(t)
    if (!Array.isArray(arr)) return { personas: [], error: 'must be a JSON array' }
    const personas = []
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]
      if (!p || typeof p !== 'object' || !p.persona) return { personas: [], error: `item ${i + 1} needs a "persona" field` }
      personas.push({ id: String(p.id || `p${i + 1}`), persona: String(p.persona), category: p.category ? String(p.category) : undefined })
    }
    return { personas, error: null }
  } catch (e) {
    return { personas: [], error: 'invalid JSON' }
  }
}

const MOOD_COUNT = 6 // sims = personas × moods × repeats (engine grid)

export function ForgeSetupPage() {
  const nav = useNavigate()

  // drafts survive navigation (usePersisted, ae:forge:*)
  const [mode, setMode] = usePersisted<'standalone' | 'layered'>('forge:mode', 'standalone')
  const [name, setName] = usePersisted('forge:name', '')
  const [blob, setBlob] = usePersisted('forge:standaloneBlob', '')
  const [universalId, setUniversalId] = usePersisted('forge:layerUniversalId', '')
  const [verticalId, setVerticalId] = usePersisted('forge:layerVerticalId', '')
  const [campaignText, setCampaignText] = usePersisted('forge:campaignText', '')
  const [direction, setDirection] = usePersisted('forge:direction', 'outbound')
  const [leadStatus, setLeadStatus] = usePersisted('forge:leadStatus', 'fresh')
  const [datasetKind, setDatasetKind] = usePersisted<'real' | 'authored'>('forge:datasetKind', 'authored')
  const [realVertical, setRealVertical] = usePersisted('forge:realVertical', '')
  const [callIdsText, setCallIdsText] = usePersisted('forge:realCallIds', '')
  const [personasText, setPersonasText] = usePersisted('forge:personasText', '')
  const [bestOfN, setBestOfN] = usePersisted('forge:scoreBestOfN', 3)
  const [votes, setVotes] = usePersisted('forge:scoreVotes', 3)
  const [confirmVotes, setConfirmVotes] = usePersisted('forge:scoreConfirm', 50)
  const [maxIter, setMaxIter] = usePersisted('forge:scoreMaxIter', 12)
  const [gatePct, setGatePct] = usePersisted('forge:scoreGate', 95)
  const [stressTarget, setStressTarget] = usePersisted('forge:scoreStress', 120)

  // transient
  const [universals, setUniversals] = useState<LayerRow[]>([])
  const [verticalRows, setVerticalRows] = useState<LayerRow[]>([])
  const [layersConfigured, setLayersConfigured] = useState(true)
  const [dbName, setDbName] = useState('')
  const [verticals, setVerticals] = useState<VerticalRow[]>([])
  const [savedDatasets, setSavedDatasets] = useState<{ id: string; name: string; n: number }[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [preview, setPreview] = useState<{ markdown: string | null; greeting: string | null; flow_stage: string | null }>({ markdown: null, greeting: null, flow_stage: null })
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const layerCache = useRef<Record<string, Record<string, unknown>>>({})

  useEffect(() => {
    if (mode !== 'layered') return
    api.listForgeLayers('universal').then((r) => { setUniversals(r.rows); setLayersConfigured(r.configured); setDbName(r.db_name) }).catch(() => setLayersConfigured(false))
    api.listForgeLayers('vertical').then((r) => setVerticalRows(r.rows)).catch(() => {})
  }, [mode])

  useEffect(() => {
    if (datasetKind !== 'real') return
    api.analysisVerticals().then(setVerticals).catch(() => {})
  }, [datasetKind])

  useEffect(() => {
    if (datasetKind !== 'authored') return
    api.listForgeDatasets().then(setSavedDatasets).catch(() => {})
  }, [datasetKind])

  const loadDataset = async (id: string) => {
    setDatasetId(id)
    if (!id) return
    try {
      const d = await api.getForgeDataset(id)
      setPersonasText(JSON.stringify(d.personas_json, null, 1))
    } catch { setDatasetId('') }
  }

  // campaign JSON validity
  let campaignJson: Record<string, unknown> | null = null
  let campaignError: string | null = null
  if (campaignText.trim()) {
    try {
      const p = JSON.parse(campaignText)
      if (p && typeof p === 'object' && !Array.isArray(p)) campaignJson = p
      else campaignError = 'must be a JSON object'
    } catch { campaignError = 'invalid JSON' }
  }

  // debounced merged preview (layered)
  const refreshPreview = useCallback(async () => {
    if (mode !== 'layered' || !campaignJson) { setPreview({ markdown: null, greeting: null, flow_stage: null }); return }
    setPreviewLoading(true); setPreviewError(null)
    try {
      const layers: Record<string, unknown> = { campaign: { prompt: campaignJson, override_keys: [] } }
      for (const [lt, id] of [['universal', universalId], ['vertical', verticalId]] as const) {
        if (!id) continue
        if (!layerCache.current[id]) layerCache.current[id] = await api.getForgeLayer(id)
        const row = layerCache.current[id] as { prompt?: unknown; override_keys?: unknown }
        layers[lt] = { prompt: row.prompt, override_keys: row.override_keys || [] }
      }
      const res = await api.forgeMergePreview({ layers, direction, lead_status: leadStatus })
      setPreview({ markdown: res.markdown, greeting: res.greeting, flow_stage: res.flow_stage })
      if (res.flow_error) setPreviewError(`flow: ${res.flow_error.reason} — ${res.flow_error.message || ''}`)
    } catch (e) {
      setPreviewError('merge failed (check campaign JSON / engine)')
    } finally {
      setPreviewLoading(false)
    }
  }, [mode, campaignText, universalId, verticalId, direction, leadStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(refreshPreview, 450)
    return () => clearTimeout(t)
  }, [refreshPreview])

  const callIds = parseIds(callIdsText)
  const { personas, error: personasError } = parsePersonas(personasText)
  const simEstimate = Math.min(personas.length * MOOD_COUNT * Math.ceil(stressTarget / Math.max(1, personas.length * MOOD_COUNT)), stressTarget)

  // readiness checklist
  const checks: { label: string; ok: boolean }[] = [
    mode === 'standalone'
      ? { label: 'Prompt provided', ok: blob.trim().length > 20 }
      : { label: 'Campaign layer valid', ok: !!campaignJson && !campaignError },
    ...(mode === 'layered' ? [{ label: 'Universal + vertical imported', ok: !!universalId && !!verticalId }] : []),
    datasetKind === 'real'
      ? { label: `Call IDs (${callIds.length})`, ok: callIds.length > 0 && !!realVertical }
      : { label: `Personas valid (${personas.length})`, ok: personas.length > 0 && !personasError },
  ]
  const ready = checks.every((c) => c.ok)

  const launch = async () => {
    if (!ready || launching) return
    setLaunching(true); setLaunchError(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || null, mode, direction, lead_status: leadStatus,
        dataset_kind: datasetKind,
        scoring: { best_of_n: bestOfN, votes, confirm_votes: confirmVotes, max_iterations: maxIter, gate_pct: gatePct, stress_target: stressTarget },
      }
      if (mode === 'standalone') body.standalone_prompt = blob
      else body.layers = {
        ...(universalId ? { universal: { source: 'agent_db', id: universalId } } : {}),
        ...(verticalId ? { vertical: { source: 'agent_db', id: verticalId } } : {}),
        campaign: { source: 'pasted', prompt: campaignJson },
      }
      if (datasetKind === 'real') { body.vertical = realVertical; body.call_ids = callIds }
      else if (datasetId) body.dataset_id = datasetId
      else body.personas = personas
      const res = await api.createForgeRun(body)
      clearPersisted('forge:mode', 'forge:name', 'forge:standaloneBlob', 'forge:layerUniversalId',
        'forge:layerVerticalId', 'forge:campaignText', 'forge:direction', 'forge:leadStatus',
        'forge:datasetKind', 'forge:realVertical', 'forge:realCallIds', 'forge:personasText')
      nav(`/forge/${res.run_id}/progress`)
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'launch failed')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div>
      <button onClick={() => nav('/forge')} style={backBtn}>← Back to runs</button>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>New run</h1>
      <p style={{ fontSize: 14, color: T.muted, margin: '7px 0 0' }}>
        Pick the prompt shape, give it a dataset, and Forge iterates until the judge can't improve it.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, marginTop: 22, alignItems: 'start' }}>
        {/* LEFT — form stack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* name + mode */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Run name (optional)"
                style={{ flex: 1, minWidth: 200, padding: '10px 13px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 14, outline: 'none' }} />
              <Seg options={[['standalone', 'Standalone'], ['layered', 'Layered']]} value={mode} onChange={(v) => setMode(v as 'standalone' | 'layered')} />
            </div>
          </div>

          {mode === 'standalone' ? (
            <div style={{ ...card, padding: 18 }}>
              <div style={{ ...label, marginBottom: 10 }}>Prompt (editable_config blob)</div>
              <textarea value={blob} onChange={(e) => setBlob(e.target.value)} rows={12}
                placeholder="Paste the agent's system prompt / editable_config…"
                style={wellArea} />
              <div style={{ fontSize: 11.5, color: T.faint, marginTop: 6 }}>{blob.length.toLocaleString()} chars</div>
            </div>
          ) : (
            <>
              {/* universal + vertical import */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {([['Universal (import)', universals, universalId, setUniversalId],
                   ['Vertical (import)', verticalRows, verticalId, setVerticalId]] as const).map(([title, rows, sel, setSel]) => (
                  <div key={title} style={{ ...card, padding: 16 }}>
                    <div style={{ ...label, marginBottom: 9 }}>{title}</div>
                    {!layersConfigured && <div style={{ fontSize: 12, color: T.amber }}>agent_db not reachable</div>}
                    {rows.length === 0 && layersConfigured && <div style={{ fontSize: 12.5, color: T.faint }}>No rows in {dbName || 'agent_db_dev'}.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {rows.map((r) => (
                        <div key={r.id} role="radio" aria-checked={sel === r.id} onClick={() => setSel(sel === r.id ? '' : r.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, cursor: 'pointer',
                            border: `1px solid ${sel === r.id ? 'var(--accent)' : T.border}`,
                            background: sel === r.id ? T.accentSoft : T.surface2,
                          }}>
                          <span style={{ width: 8, height: 8, borderRadius: 99, background: sel === r.id ? 'var(--accent)' : T.border2, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: sel === r.id ? T.text : T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.friendly_name || r.id}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: T.mono, color: T.fainter }}>{r.id}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: T.fainter, marginTop: 8, lineHeight: 1.5 }}>
                      Imported read-only from {dbName || 'agent_db_dev'} · snapshot-pinned at launch.
                    </div>
                  </div>
                ))}
              </div>

              {/* campaign paste */}
              <div style={{ ...card, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={label}>Campaign (paste / author)</span>
                  {campaignText.trim() && (
                    <span style={{ fontSize: 11.5, color: campaignError ? T.red : T.green }}>
                      {campaignError ? `✕ ${campaignError}` : '✓ valid campaign layer'}
                    </span>
                  )}
                </div>
                <textarea value={campaignText} onChange={(e) => setCampaignText(e.target.value)} rows={10}
                  placeholder={'{\n  "rules": { "campaign_rules": ["…"] },\n  "greeting_message": { "outbound": "…" },\n  "conversational_flow": { "fresh": { "goal": "…" } }\n}'}
                  style={wellArea} />
                <div style={{ fontSize: 11, color: T.fainter, marginTop: 8 }}>
                  The only layer the coach edits directly — universal/vertical fixes are routed with your approval.
                </div>
              </div>

              {/* preview controls + merged preview */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <Seg options={[['outbound', 'Outbound'], ['inbound', 'Inbound'], ['followup', 'Follow-up']]} value={direction} onChange={setDirection} />
                <input value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} placeholder="lead_status (stage)"
                  style={{ padding: '8px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13, outline: 'none', width: 170 }} />
                <span style={{ fontSize: 11.5, color: T.faint }}>direction picks the greeting · lead_status slices the flow</span>
              </div>
              <MergedPreviewPanel markdown={preview.markdown} greeting={preview.greeting} flowStage={preview.flow_stage}
                loading={previewLoading} error={previewError} />
            </>
          )}

          {/* dataset branch */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={label}>Dataset</span>
              <Seg options={[['authored', 'Authored personas'], ['real', 'Real transcripts']]} value={datasetKind} onChange={(v) => setDatasetKind(v as 'real' | 'authored')} />
            </div>
            {datasetKind === 'real' ? (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {verticals.map((v) => (
                    <button key={v.key} disabled={!v.dbConfigured} onClick={() => setRealVertical(v.key)}
                      style={{
                        padding: '7px 14px', borderRadius: 99, fontSize: 12.5, cursor: v.dbConfigured ? 'pointer' : 'not-allowed',
                        border: `1px solid ${realVertical === v.key ? 'var(--accent)' : T.border2}`,
                        background: realVertical === v.key ? T.accentSoft : T.surface2,
                        color: !v.dbConfigured ? T.fainter : realVertical === v.key ? T.text : T.muted,
                        fontWeight: realVertical === v.key ? 600 : 500,
                      }}>
                      {v.label}{!v.dbConfigured && ' · creds not set'}
                    </button>
                  ))}
                </div>
                <textarea value={callIdsText} onChange={(e) => setCallIdsText(e.target.value)} rows={4}
                  placeholder={'Call IDs — one per line, comma-separated, or a JSON array'}
                  style={wellArea} />
                <div style={{ fontSize: 12, color: callIds.length ? T.green : T.faint, marginTop: 6 }}>
                  {callIds.length} call ID(s) parsed · transcripts only, PII scrubbed before probes are stored
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <select value={datasetId} onChange={(e) => loadDataset(e.target.value)}
                    style={{ padding: '8px 11px', borderRadius: 10, background: T.well, border: `1px solid ${datasetId ? 'var(--accent)' : T.border2}`, color: datasetId ? T.text : T.muted, fontSize: 13, outline: 'none', maxWidth: 380 }}>
                    <option value="">— pick a saved dataset, or paste below —</option>
                    {savedDatasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.n} personas)</option>)}
                  </select>
                  <span style={{ fontSize: 11.5, color: T.fainter }}>every pasted dataset is saved automatically for reuse</span>
                </div>
                <textarea value={personasText} onChange={(e) => { setPersonasText(e.target.value); setDatasetId('') }} rows={7}
                  placeholder={'[\n  { "id": "keen-buyer", "persona": "You enquired last week and are keen…", "category": "positive" },\n  { "id": "skeptic", "persona": "You are busy and skeptical…", "category": "negative" }\n]'}
                  style={wellArea} />
                <div style={{ fontSize: 12, marginTop: 6, color: personasError ? T.red : personas.length ? (simEstimate >= 100 ? T.green : T.amber) : T.faint }}>
                  {personasError ? `✕ ${personasError}`
                    : personas.length
                      ? `${personas.length} persona(s) → ~${simEstimate} sims after the ${MOOD_COUNT}-mood grid (target ${stressTarget})`
                      : 'sims = personas × moods × repeats toward the stress target'}
                </div>
              </>
            )}
          </div>

          {/* scoring config */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ ...label, marginBottom: 12 }}>Scoring</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <Num label="Best-of-N" value={bestOfN} onChange={setBestOfN} min={1} max={5} hint="deepeval rollouts per probe (median)" />
              <Num label="Screen votes" value={votes} onChange={setVotes} min={1} max={5} hint="cheap screening majority per candidate" />
              <Num label="Confirm sims" value={confirmVotes} onChange={setConfirmVotes} min={10} max={100} hint="a problem is SOLVED only after this many sims pass at ≥90%" />
              <Num label="Max iterations" value={maxIter} onChange={setMaxIter} min={1} max={60} />
              <Num label="Gate %" value={gatePct} onChange={setGatePct} min={50} max={100} hint="problems solved to reach LLM-complete" />
              <Num label="Stress sims" value={stressTarget} onChange={setStressTarget} min={6} max={500} hint="300–500 for a real run" />
            </div>
          </div>
        </div>

        {/* RIGHT — sticky checklist */}
        <div style={{ position: 'sticky', top: 20 }}>
          <div style={{ ...card, padding: 18 }}>
            <div style={{ ...label, marginBottom: 12 }}>Ready to launch?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {checks.map((c) => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: c.ok ? T.text2 : T.faint }}>
                  <span style={{ color: c.ok ? T.green : T.fainter, fontWeight: 700 }}>{c.ok ? '✓' : '○'}</span>{c.label}
                </div>
              ))}
            </div>
            <button onClick={launch} disabled={!ready || launching}
              style={{ ...btnPrimary, width: '100%', marginTop: 18, opacity: !ready || launching ? 0.5 : 1 }}>
              {launching ? 'Launching…' : 'Launch run →'}
            </button>
            {launchError && <div style={{ fontSize: 12, color: T.red, marginTop: 10, lineHeight: 1.5 }}>{launchError}</div>}
            <div style={{ fontSize: 11, color: T.fainter, marginTop: 12, lineHeight: 1.55 }}>
              v0 runs the identical full pipeline before any coaching, so the human-review before/after is honest.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Seg({ options, value, onChange }: { options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', background: T.well, borderRadius: 12, padding: 3, border: `1px solid ${T.border}` }}>
      {options.map(([v, lbl]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{
            padding: '7px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5,
            background: value === v ? T.surface2 : 'transparent',
            color: value === v ? T.text : T.muted, fontWeight: value === v ? 600 : 500,
          }}>{lbl}</button>
      ))}
    </div>
  )
}

function Num({ label: lbl, value, onChange, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string }) {
  return (
    <div title={hint}>
      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 5 }}>{lbl}</div>
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        style={{ width: 84, padding: '8px 10px', borderRadius: 9, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, fontFamily: T.mono, outline: 'none' }} />
    </div>
  )
}

const wellArea: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 11,
  background: T.well, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 12.5,
  fontFamily: T.mono, lineHeight: 1.55, outline: 'none', resize: 'vertical',
}
