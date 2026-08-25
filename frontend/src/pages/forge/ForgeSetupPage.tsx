import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, card, label, btnPrimary, backBtn } from '../../theme'
import { api } from '../../api/client'
import { usePersisted, clearPersisted } from '../../usePersisted'
import { MergedPreviewPanel, SizeHint, ComboChip } from '../../components/forge'

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
  // each shared layer can be IMPORTED from agent_db or PASTED as JSON
  const [universalMode, setUniversalMode] = usePersisted<'import' | 'paste'>('forge:layerUniversalMode', 'import')
  const [verticalMode, setVerticalMode] = usePersisted<'import' | 'paste'>('forge:layerVerticalMode', 'import')
  const [universalText, setUniversalText] = usePersisted('forge:layerUniversalText', '')
  const [verticalText, setVerticalText] = usePersisted('forge:layerVerticalText', '')
  const parseLayerJson = (text: string): { obj: Record<string, unknown> | null; err: string | null } => {
    if (!text.trim()) return { obj: null, err: null }
    try {
      const o = JSON.parse(text)
      if (o && typeof o === 'object' && !Array.isArray(o)) return { obj: o, err: null }
      return { obj: null, err: 'must be a JSON object' }
    } catch { return { obj: null, err: 'invalid JSON' } }
  }
  const universalPaste = parseLayerJson(universalText)
  const verticalPaste = parseLayerJson(verticalText)
  const layerOk = (m: 'import' | 'paste', id: string, paste: { obj: unknown; err: string | null }) =>
    m === 'import' ? !!id : !!paste.obj && !paste.err
  const [campaignText, setCampaignText] = usePersisted('forge:campaignText', '')
  const [direction, setDirection] = usePersisted('forge:direction', 'outbound')
  const [leadStatus, setLeadStatus] = usePersisted('forge:leadStatus', 'fresh')
  const [coachGuidance, setCoachGuidance] = usePersisted('forge:coachGuidance', '')
  const [datasetKind, setDatasetKind] = usePersisted<'real' | 'authored'>('forge:datasetKind', 'authored')
  const [realVertical, setRealVertical] = usePersisted('forge:realVertical', '')
  const [callIdsText, setCallIdsText] = usePersisted('forge:realCallIds', '')
  const [personasText, setPersonasText] = usePersisted('forge:personasText', '')

  const [votes, setVotes] = usePersisted('forge:scoreVotes', 3)

  // agent-under-test: default = the production model; custom = any OpenAI-compatible endpoint
  const [agentCustom, setAgentCustom] = usePersisted('forge:agentCustom', false)
  const [agentCfg, setAgentCfg] = usePersisted('forge:agentCfg', { base_url: '', model: '', api_key: '' })
  const [agentTest, setAgentTest] = useState<string | null>(null)
  // Tools the agent under test is offered. Core four are always on (production
  // orchestrator loads them ungated); the rest mirror production's available_tools gates.
  const GATED_TOOLS: { name: string; desc: string }[] = [
    { name: 'warm_transfer_call', desc: 'escalate to a human supervisor' },
    { name: 'switch_agent', desc: 'hand off to another AI agent' },
    { name: 'irrelevant_interruption', desc: 'flag sustained off-topic talk' },
    { name: 'search_knowledge_base', desc: 'look a fact up in the KB' },
    { name: 'web_search', desc: 'search the live web' },
    { name: 'send_whatsapp_template', desc: 'send a WhatsApp message' },
    { name: 'get_location_details', desc: 'distance / nearby places' },
  ]
  const CORE_LOCKED = ['end_call', 'voicemail_detected', 'handle_call_screening', 'date_calculator']
  const [gatedTools, setGatedTools] = usePersisted<string[]>('forge:gatedTools',
    GATED_TOOLS.map((t) => t.name))
  const [toolChecks, setToolChecks] = usePersisted('forge:toolChecks', true)
  type SavedLlm = { id: string; name: string; base_url: string; model: string; api_key: string | null; params_json: Record<string, unknown> | null }
  const [savedLlms, setSavedLlms] = useState<SavedLlm[]>([])
  const [savedSel, setSavedSel] = usePersisted('forge:agentSavedId', '')
  const [llmName, setLlmName] = useState('')
  const [llmMsg, setLlmMsg] = useState<string | null>(null)
  useEffect(() => { api.listForgeLlms().then(setSavedLlms).catch(() => {}) }, [])
  const pickSaved = (id: string) => {
    setSavedSel(id)
    const row = savedLlms.find((x) => x.id === id)
    if (row) { setAgentCfg({ base_url: row.base_url, model: row.model, api_key: row.api_key || '' }); setLlmName(row.name); setAgentTest(null) }
  }
  const saveLlm = async () => {
    setLlmMsg(null)
    const body = { name: llmName.trim() || agentCfg.model, base_url: agentCfg.base_url.trim(),
                   model: agentCfg.model.trim(), api_key: agentCfg.api_key.trim() || undefined }
    try {
      if (savedSel) {
        await api.updateForgeLlm(savedSel, body); setLlmMsg('updated ✓')
      } else {
        const row = await api.createForgeLlm(body); setSavedSel(row.id); setLlmMsg('saved ✓')
      }
      setSavedLlms(await api.listForgeLlms())
    } catch (e) { setLlmMsg(e instanceof Error ? e.message : 'save failed') }
  }
  const removeLlm = async () => {
    if (!savedSel) return
    await api.deleteForgeLlm(savedSel).catch(() => {})
    setSavedSel(''); setLlmName(''); setSavedLlms(await api.listForgeLlms()); setLlmMsg('deleted')
  }
  const [prodLlm, setProdLlm] = useState<{ base_url?: string; model?: string }>({})
  useEffect(() => { api.llmInfo().then(setProdLlm).catch(() => {}) }, [])
  const testAgent = async () => {
    setAgentTest('testing…')
    try {
      const r = await api.testArenaLlm({ base_url: agentCfg.base_url.trim(), model: agentCfg.model.trim(),
        api_key: agentCfg.api_key.trim() || undefined })
      setAgentTest(r.ok ? `✓ replied in ${r.ms}ms` : `✕ ${r.error}`)
    } catch { setAgentTest('✕ request failed') }
  }
  const [maxIter, setMaxIter] = usePersisted('forge:scoreMaxIter.v2', 5)
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
  const [coverage, setCoverage] = useState<{ stages: string[]; combos: string[]; blocked: any[] } | null>(null)
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
      for (const [lt, m, id, paste] of [
        ['universal', universalMode, universalId, universalPaste],
        ['vertical', verticalMode, verticalId, verticalPaste],
      ] as const) {
        if (m === 'paste') {
          if (paste.obj) layers[lt] = { prompt: paste.obj, override_keys: [] }
          continue
        }
        if (!id) continue
        if (!layerCache.current[id]) layerCache.current[id] = await api.getForgeLayer(id)
        const row = layerCache.current[id] as { prompt?: unknown; override_keys?: unknown }
        layers[lt] = { prompt: row.prompt, override_keys: row.override_keys || [] }
      }
      const res = await api.forgeMergePreview({ layers, direction, lead_status: leadStatus })
      setPreview({ markdown: res.markdown, greeting: res.greeting, flow_stage: res.flow_stage })
      setCoverage((res as any).coverage || null)
      if (res.flow_error) setPreviewError(`flow: ${res.flow_error.reason} — ${res.flow_error.message || ''}`)
    } catch (e) {
      setPreviewError('merge failed (check campaign JSON / engine)')
    } finally {
      setPreviewLoading(false)
    }
  }, [mode, campaignText, universalId, verticalId, universalMode, verticalMode, universalText, verticalText, direction, leadStatus]) // eslint-disable-line react-hooks/exhaustive-deps

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
    ...(mode === 'layered' ? [{
      label: 'Universal + vertical provided',
      ok: layerOk(universalMode, universalId, universalPaste) && layerOk(verticalMode, verticalId, verticalPaste),
    }] : []),
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
        coach_guidance: coachGuidance.trim() || null,
        dataset_kind: datasetKind,
        scoring: { best_of_n: 1, votes, confirm_votes: 5, max_iterations: maxIter, gate_pct: gatePct, stress_target: stressTarget },
      }
      body.tools = [...CORE_LOCKED, ...gatedTools]
      ;(body.scoring as Record<string, unknown>).tool_checks = toolChecks
      if (agentCustom && agentCfg.base_url.trim() && agentCfg.model.trim()) {
        body.agent_llm = { base_url: agentCfg.base_url.trim(), model: agentCfg.model.trim(),
                           api_key: agentCfg.api_key.trim() || undefined }
      }
      if (mode === 'standalone') body.standalone_prompt = blob
      else body.layers = {
        ...(universalMode === 'paste'
          ? (universalPaste.obj ? { universal: { source: 'pasted', prompt: universalPaste.obj } } : {})
          : (universalId ? { universal: { source: 'agent_db', id: universalId } } : {})),
        ...(verticalMode === 'paste'
          ? (verticalPaste.obj ? { vertical: { source: 'pasted', prompt: verticalPaste.obj } } : {})
          : (verticalId ? { vertical: { source: 'agent_db', id: verticalId } } : {})),
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
              <SizeHint text={blob} warnTokens={8000} />
            </div>
          ) : (
            <>
              {/* universal + vertical import */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {([['Universal', universals, universalId, setUniversalId, universalMode, setUniversalMode, universalText, setUniversalText, universalPaste],
                   ['Vertical', verticalRows, verticalId, setVerticalId, verticalMode, setVerticalMode, verticalText, setVerticalText, verticalPaste]] as const).map(([title, rows, sel, setSel, lmode, setLmode, ltext, setLtext, lpaste]) => (
                  <div key={title} style={{ ...card, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                      <span style={label}>{title}</span>
                      <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border2}` }}>
                        {(['import', 'paste'] as const).map((m) => (
                          <button key={m} onClick={() => setLmode(m)}
                            style={{ padding: '4px 11px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                                     background: lmode === m ? 'var(--accent)' : 'transparent',
                                     color: lmode === m ? '#fff' : T.muted }}>{m}</button>
                        ))}
                      </div>
                      {lmode === 'paste' && ltext.trim() && (
                        <span style={{ fontSize: 11, color: lpaste.err ? T.red : T.green }}>
                          {lpaste.err ? `✕ ${lpaste.err}` : '✓ valid'}
                        </span>
                      )}
                    </div>
                    {lmode === 'paste' ? (
                      <>
                        <textarea value={ltext} onChange={(e) => setLtext(e.target.value)} rows={7}
                          placeholder={'{\n  "rules": { "' + title.toLowerCase() + '_rules": ["…"] }\n}'}
                          style={wellArea} />
                        <SizeHint text={ltext} label={title.toLowerCase()} />
                      </>
                    ) : (<>
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
                    </>)}
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
                <SizeHint text={campaignText} label="campaign" warnTokens={8000} />
                <div style={{ fontSize: 11, color: T.fainter, marginTop: 8 }}>
                  The only layer the coach edits directly — universal/vertical fixes are routed with your approval.
                </div>
              </div>

              {/* preview controls + merged preview */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <Seg options={[['outbound', 'Outbound'], ['inbound', 'Inbound'], ['followup', 'Follow-up']]} value={direction} onChange={setDirection} />
                <input value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} placeholder="lead_status (stage)"
                  style={{ padding: '8px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13, outline: 'none', width: 170 }} />
                <span style={{ fontSize: 11.5, color: T.faint }}>preview only — the run tests every combo below</span>
              </div>
              {coverage && (
                <div style={{ ...card, padding: 14 }}>
                  <div style={label}>Coverage this run will test</div>
                  <div style={{ fontSize: 11.5, color: T.faint, margin: '5px 0 10px', lineHeight: 1.5 }}>
                    Stages come from this campaign's own conversational_flow. Inbound covers every stage,
                    outbound only <code>fresh</code>, follow-up everything except <code>fresh</code>.
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {coverage.combos.map((k) => <ComboChip key={k} combo={k} />)}
                  </div>
                  <div style={{ fontSize: 12, color: T.text3 }}>
                    {coverage.combos.length} combos × {personas.length} personas ={' '}
                    <b style={{ color: coverage.combos.length * personas.length > 200 ? T.amber : T.text }}>
                      {Math.min(coverage.combos.length * personas.length, Math.floor(200 / Math.max(coverage.combos.length, 1)) * coverage.combos.length)} conversations
                    </b>
                    {coverage.combos.length * personas.length > 200
                      ? ` — capped at 200, so ${Math.floor(200 / coverage.combos.length)} personas per combo will run.`
                      : null}
                  </div>
                  {coverage.blocked.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11.5, color: T.amber, lineHeight: 1.5 }}>
                      ⏸ {coverage.blocked.length} combo(s) this prompt cannot serve
                      ({coverage.blocked.map((b: any) => b.key).join(', ')}). The run will halt and ask you
                      what to do before testing them.
                    </div>
                  )}
                </div>
              )}
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
              <SizeHint text={personasText} label="dataset" />
                <div style={{ fontSize: 12, marginTop: 6, color: personasError ? T.red : personas.length ? (simEstimate >= 100 ? T.green : T.amber) : T.faint }}>
                  {personasError ? `✕ ${personasError}`
                    : personas.length
                      ? `${personas.length} persona(s) → ~${simEstimate} sims after the ${MOOD_COUNT}-mood grid (target ${stressTarget})`
                      : 'sims = personas × moods × repeats toward the stress target'}
                </div>
              </>
            )}
          </div>

          {/* tools the agent has */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={label}>Tools the agent has</span>
              <span style={{ fontSize: 11.5, color: T.fainter }}>
                these are offered to the model exactly as production offers them
              </span>
              <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: T.muted, cursor: 'pointer' }}>
                <input type="checkbox" checked={toolChecks} onChange={(e) => setToolChecks(e.target.checked)} />
                run tool checks
                <span className="hint-wrap">
                  <span style={{ width: 14, height: 14, borderRadius: 99, border: `1px solid ${T.border2}`, color: T.fainter, fontSize: 9.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}>?</span>
                  <span className="hint-box">
                    For each enabled tool, two scripted conversations force the exact situation that tool exists for
                    (voicemail greeting, "send the brochure on WhatsApp", "how far from Nizampet"…) and we check whether
                    the model actually CALLED it — or only said its name.
                  </span>
                </span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
              {CORE_LOCKED.map((n) => (
                <span key={n} title="always on — production loads these ungated"
                  style={{ padding: '5px 11px', borderRadius: 99, fontSize: 11.5, fontFamily: T.mono,
                           background: T.chip, color: T.muted, border: `1px solid ${T.border2}` }}>
                  🔒 {n}
                </span>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 7 }}>
              {GATED_TOOLS.map((t) => {
                const on = gatedTools.includes(t.name)
                return (
                  <div key={t.name} onClick={() => setGatedTools(on ? gatedTools.filter((x) => x !== t.name) : [...gatedTools, t.name])}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: 10, cursor: 'pointer',
                             border: `1px solid ${on ? 'var(--accent)' : T.border}`, background: on ? T.accentSoft : T.surface2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? 'var(--accent)' : T.border2, flexShrink: 0 }} />
                    <span style={{ fontFamily: T.mono, fontSize: 12, color: on ? T.text : T.faint }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: T.fainter, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 11.5, color: T.fainter, marginTop: 9 }}>
              {CORE_LOCKED.length + gatedTools.length} tools offered
              {toolChecks && ` · ${gatedTools.length * 2 + 9} tool-check conversations`}
            </div>
          </div>

          {/* agent under test */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={label}>Agent under test</span>
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border2}` }}>
                {([[false, 'Production model'], [true, 'Custom LLM']] as [boolean, string][]).map(([v, lbl]) => (
                  <button key={lbl} onClick={() => setAgentCustom(v)}
                    style={{ padding: '5px 12px', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                             background: agentCustom === v ? 'var(--accent)' : 'transparent',
                             color: agentCustom === v ? '#fff' : T.muted }}>{lbl}</button>
                ))}
              </div>
            </div>
            {!agentCustom ? (
              <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
                The prompt is optimized against <span style={{ fontFamily: T.mono, color: T.text3 }}>{prodLlm.model || 'the production model'}</span> at{' '}
                <span style={{ fontFamily: T.mono, color: T.text3 }}>{prodLlm.base_url || '—'}</span> — the same model your real calls run on.
                Judge, customer and coach stay on the fixed judge model either way.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={savedSel} onChange={(e) => pickSaved(e.target.value)}
                    style={{ minWidth: 220, padding: '8px 10px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5 }}>
                    <option value="">— new LLM (or pick a saved one) —</option>
                    {savedLlms.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.model}</option>)}
                  </select>
                  <input value={llmName} onChange={(e) => setLlmName(e.target.value)} placeholder="name to save as"
                    style={{ width: 160, padding: '8px 11px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5 }} />
                  <button onClick={saveLlm}
                    style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {savedSel ? 'Update saved' : 'Save'}
                  </button>
                  {savedSel && (
                    <button onClick={removeLlm}
                      style={{ padding: '8px 12px', borderRadius: 9, border: `1px solid ${T.border2}`, background: 'transparent', color: T.faint, fontSize: 12, cursor: 'pointer' }}>Delete</button>
                  )}
                  {llmMsg && <span style={{ fontSize: 12, color: llmMsg.includes('fail') ? T.red : T.green }}>{llmMsg}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={agentCfg.base_url} onChange={(e) => setAgentCfg({ ...agentCfg, base_url: e.target.value })}
                    placeholder="base URL (…/v1)"
                    style={{ flex: 1, minWidth: 240, padding: '8px 11px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5, fontFamily: T.mono }} />
                  <input value={agentCfg.model} onChange={(e) => setAgentCfg({ ...agentCfg, model: e.target.value })}
                    placeholder="model id"
                    style={{ width: 220, padding: '8px 11px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5, fontFamily: T.mono }} />
                  <input value={agentCfg.api_key} onChange={(e) => setAgentCfg({ ...agentCfg, api_key: e.target.value })}
                    type="password" placeholder="API key (optional)"
                    style={{ width: 150, padding: '8px 11px', borderRadius: 9, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text2, fontSize: 12.5 }} />
                  <button onClick={testAgent}
                    style={{ padding: '8px 14px', borderRadius: 9, border: `1px solid ${T.border2}`, background: 'transparent', color: T.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Test</button>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {agentTest && <span style={{ fontSize: 12, color: agentTest.startsWith('✕') ? T.red : T.green }}>{agentTest}</span>}
                  <span style={{ fontSize: 11.5, color: T.amber }}>
                    ⚠ optimizing on a model production doesn't run means the finished prompt is tuned for THAT model, not your live agent.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* scoring config */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ ...label, marginBottom: 12 }}>Scoring</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <Num label="Tries per problem" value={votes} onChange={setVotes} min={1} max={5}
                hint="After every prompt edit, each problem's test conversation is run this many times and the majority decides pass/fail. More tries = fewer lucky/unlucky verdicts, slower loop." />
              <Num label="Max iterations" value={maxIter} onChange={setMaxIter} min={1} max={60}
                hint="How many prompt-edit attempts the coach gets before handing over to you." />
              <Num label="Gate %" value={gatePct} onChange={setGatePct} min={50} max={100}
                hint="The finish line — when this % of problems are solved, the run stops early as LLM-complete." />
              <Num label="Stress sims" value={stressTarget} onChange={setStressTarget} min={6} max={500}
                hint="Free-play conversations across your personas in different moods, hunting for problems nobody scripted." />
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

          {/* Standing instructions for the coach. Set here, still editable mid-run on the
              progress page — the engine re-reads it before every proposal. */}
          <div style={{ ...card, padding: 18, marginTop: 14 }}>
            <div style={label}>Coach guidance</div>
            <div style={{ fontSize: 11.5, color: T.faint, margin: '5px 0 10px', lineHeight: 1.5 }}>
              Anything specific you want the coach to do — style, wording, things to never say.
              You can keep editing this while the run is going.
            </div>
            <textarea value={coachGuidance} onChange={(e) => setCoachGuidance(e.target.value)}
              rows={5} placeholder={"Never use the word 'sir'.\nKeep replies under 2 lines.\nSay 'square feet', never 'sqft'."}
              style={{
                width: '100%', background: T.well, color: T.text, border: `1px solid ${T.border2}`,
                borderRadius: 8, padding: 10, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical',
              }} />
            <div style={{ marginTop: 6 }}><SizeHint text={coachGuidance} /></div>
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
    <div>
      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
        {lbl}
        {hint && (
          <span className="hint-wrap">
            <span style={{ width: 14, height: 14, borderRadius: 99, border: `1px solid ${T.border2}`, color: T.fainter, fontSize: 9.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}>?</span>
            <span className="hint-box">{hint}</span>
          </span>
        )}
      </div>
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
