import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { T, card, label, backBtn } from '../theme'
import { api } from '../api/client'
import { ScoreRing, SectionCard, MetricBar, FlowStrip, TranscriptBubbles, FaithfulnessPanel, SECTION_LABELS, METRIC_LABELS } from '../components/analysis'

type FaithVerdict = { claim: string; verdict: string; reason: string }
type FaithDetail = { claims_checked: number; contradicted: FaithVerdict[]; partial: FaithVerdict[]; not_in_kb: FaithVerdict[]; summary: string | null }
type Call = {
  id: number; call_id: string | null; direction: string | null; transcript: string
  composite_score: number | null; gated_reason: string | null
  sections_json: Record<string, { score: number | null; verdict: string; evidence: string[] }>
  metrics_json: Record<string, number | null> & { faithfulness_detail?: FaithDetail }
  flow_json: { stage: string; status: string; note: string }[]
  areas_json: string[]
}

export function CallReportPage() {
  const { batchId, callId } = useParams()
  const nav = useNavigate()
  const [call, setCall] = useState<Call | null>(null)

  useEffect(() => { if (callId) api.getCall(callId).then(setCall).catch(() => {}) }, [callId])

  if (!call) return <div style={{ color: T.muted }}>Loading…</div>

  return (
    <div>
      <button style={backBtn} onClick={() => nav(`/analyze/${batchId}`)}>← Back to batch</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ScoreRing value={call.composite_score} size={64} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 650, margin: 0, color: T.text, fontFamily: T.mono }}>{call.call_id || `Call #${call.id}`}</h1>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>{call.direction} call · overall {call.composite_score ?? '—'}/100</div>
        </div>
      </div>

      {call.gated_reason && (
        <div style={{ ...card, borderLeft: `3px solid ${T.amber}`, padding: '14px 18px', marginTop: 18, color: T.amber2, fontSize: 13.5 }}>
          This call was skipped — {call.gated_reason}. (Not enough customer speech to score fairly.)
        </div>
      )}

      {!call.gated_reason && (
        <>
          {/* Sections */}
          <div style={{ ...label, margin: '24px 0 12px' }}>How the agent did</div>
          <div className="dims-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {Object.keys(SECTION_LABELS).map((k) => (
              <SectionCard key={k} name={k} data={call.sections_json[k] || { score: null, verdict: '', evidence: [] }} />
            ))}
          </div>

          {/* Metrics */}
          <div style={{ ...label, margin: '24px 0 12px' }}>Metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {Object.keys(METRIC_LABELS).map((k) => <MetricBar key={k} name={k} value={call.metrics_json[k] ?? null} />)}
          </div>

          {/* Faithfulness — per-claim trail */}
          {call.metrics_json.faithfulness_detail && (
            <div style={{ marginTop: 24 }}>
              <FaithfulnessPanel detail={call.metrics_json.faithfulness_detail} score={call.metrics_json.faithfulness ?? null} />
            </div>
          )}

          {/* Flow */}
          {call.flow_json?.length > 0 && <div style={{ marginTop: 24 }}><FlowStrip flow={call.flow_json} /></div>}

          {/* Areas of improvement */}
          {call.areas_json?.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ ...label, marginBottom: 12 }}>Areas of improvement</div>
              <div style={{ ...card, padding: 18 }}>
                <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {call.areas_json.map((a, i) => (
                    <li key={i} style={{ fontSize: 13.5, color: T.text2, lineHeight: 1.55 }}>{a}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </>
      )}

      {/* Transcript */}
      <div style={{ ...label, margin: '26px 0 12px' }}>Transcript</div>
      <div style={{ ...card, padding: 18 }}>
        <TranscriptBubbles transcript={call.transcript} />
      </div>
    </div>
  )
}
