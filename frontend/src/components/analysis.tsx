import { useState } from 'react'
import { T, card, label } from '../theme'

export const SECTION_LABELS: Record<string, string> = {
  greeting_intro: 'Greeting & intro',
  empathy: 'Empathy',
  information_push_goal: 'Information & goal progression',
  conversation_management_flow: 'Conversation management / flow',
  call_closing: 'Call closing',
  tool_calling: 'Tool-calling',
}
export const METRIC_LABELS: Record<string, string> = {
  customer_retention_frustration: 'Retention / calm',
  repetition: 'Avoids repetition',
  instruction_flow_following: 'Follows instructions & flow',
  tool_calling: 'Tool-calling',
  human_likeness: 'Human-likeness',
  faithfulness: 'Faithfulness',
  answer_relevancy: 'Answered the question',
  self_consistency: 'Self-consistency',
}

// Plain-language definitions shown on the `?` hover. Higher = better for all.
export const DEFINITIONS: Record<string, string> = {
  // sections
  greeting_intro: 'Warm open — did the agent greet the customer and identify itself and the company?',
  empathy: "Did the agent read and respond to the customer's emotion?",
  information_push_goal: 'Did the agent move toward the goal smoothly — not pushy, not passive?',
  conversation_management_flow: 'Did the agent follow the intended conversation flow / stages?',
  call_closing: 'Did the agent end the call properly — confirm next steps, warm close?',
  tool_calling: 'Did the agent use the right tools at the right moments (judged at call level)?',
  // metrics
  customer_retention_frustration: 'Did the customer stay engaged and calm, or get frustrated? 100 = calm/retained.',
  repetition: 'Did the agent avoid needlessly repeating itself? 100 = no repetition.',
  instruction_flow_following: 'Did the agent follow its instructions and the intended flow?',
  human_likeness: 'Did the agent sound natural and human, not robotic?',
  faithfulness:
    "Did the agent stick to the facts in its knowledge base, or did it HALLUCINATE? " +
    "We extract the agent's factual claims and check each against the KB — " +
    '100 = no hallucinations, 0 = everything it asserted contradicts the KB. ' +
    'Shows “—” when no knowledge base is attached (nothing to check against).',
  answer_relevancy:
    "Did the agent actually answer the customer's questions, or dodge/ramble/go off-topic? " +
    '100 = directly on-point. Needs no knowledge base — just the transcript.',
  self_consistency:
    'Did the agent contradict ITSELF during the call (e.g. “open Sunday” then “closed Sunday”, ' +
    'or two different prices)? 100 = fully consistent. Needs no knowledge base — the call is its ' +
    'own ground truth. A form of hallucination the agent commits against itself.',
}

// Small `?` with a hover tooltip explaining a metric/section.
export function InfoDot({ term }: { term: string }) {
  const [open, setOpen] = useState(false)
  const def = DEFINITIONS[term]
  if (!def) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span style={{
        width: 14, height: 14, borderRadius: 99, border: `1px solid ${T.border2}`, color: T.faint,
        fontSize: 9.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'help', flexShrink: 0,
      }}>?</span>
      {open && (
        <span style={{
          position: 'absolute', bottom: '150%', left: '50%', transform: 'translateX(-50%)', zIndex: 50,
          width: 240, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 10,
          padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: T.text3, fontWeight: 400,
          boxShadow: '0 12px 30px -10px rgba(0,0,0,0.8)', textTransform: 'none', letterSpacing: 0,
        }}>{def}</span>
      )}
    </span>
  )
}

export function score100Color(v: number | null | undefined): string {
  const s = v ?? 0
  if (v == null) return T.faint
  if (s >= 85) return T.green
  if (s >= 70) return T.amber
  if (s >= 50) return T.amber2
  return T.red
}

export function ScoreRing({ value, size = 58 }: { value: number | null; size?: number }) {
  const v = value ?? 0
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  const col = score100Color(value)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.track} strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={5}
        strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset .6s ease' }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
        style={{ fill: col, fontSize: size * 0.28, fontWeight: 700, fontFamily: T.mono }}>
        {value == null ? '—' : Math.round(v)}
      </text>
    </svg>
  )
}

export function SectionCard({ name, data }: { name: string; data: { score: number | null; verdict: string; evidence: string[] } }) {
  const col = score100Color(data.score)
  return (
    <div style={{ ...card, padding: 16, borderLeft: `3px solid ${col}` }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <ScoreRing value={data.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            {SECTION_LABELS[name] || name}<InfoDot term={name} />
          </div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>{data.verdict || '—'}</div>
        </div>
      </div>
      {data.evidence && data.evidence.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.evidence.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: T.text3, fontFamily: T.mono, background: T.well, borderRadius: 8, padding: '7px 10px', borderLeft: `2px solid ${T.border2}` }}>
              “{e}”
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MetricBar({ name, value }: { name: string; value: number | null }) {
  const col = score100Color(value)
  return (
    <div style={{ ...card, padding: '13px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: T.text2, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {METRIC_LABELS[name] || name}<InfoDot term={name} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: col }}>{value == null ? '—' : value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: T.track, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value ?? 0}%`, background: col, borderRadius: 99, transition: 'width .5s ease' }} />
      </div>
    </div>
  )
}

type FaithVerdict = { claim: string; verdict: string; reason: string }
type FaithDetail = { claims_checked?: number; contradicted?: FaithVerdict[]; partial?: FaithVerdict[]; not_in_kb?: FaithVerdict[]; summary?: string | null }

// Per-claim faithfulness trail — shows exactly which agent claims hallucinated.
export function FaithfulnessPanel({ detail, score }: { detail?: FaithDetail; score: number | null }) {
  // Nothing to show if the agent made no checkable factual claims.
  if (!detail || (detail.claims_checked || 0) === 0) return null
  const contradicted = detail.contradicted || []
  const partial = detail.partial || []
  const notInKb = detail.not_in_kb || []
  const flagged = contradicted.length + partial.length
  const row = (v: FaithVerdict, i: number, color: string, tag: string) => (
    <div key={tag + i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: T.well, borderRadius: 9, borderLeft: `3px solid ${color}` }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color, flexShrink: 0, width: 74, letterSpacing: '0.03em', paddingTop: 1 }}>{tag}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.text2, fontWeight: 500 }}>“{v.claim}”</div>
        {v.reason && <div style={{ fontSize: 12, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>{v.reason}</div>}
      </div>
    </div>
  )
  return (
    <div>
      <div style={{ ...label, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Faithfulness check
        <span style={{ fontFamily: T.mono, color: score100Color(score), fontSize: 13 }}>{score == null ? '—' : `${score}/100`}</span>
        <span style={{ fontSize: 11.5, color: T.faint, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {detail.claims_checked || 0} claims checked · {flagged} flagged
        </span>
      </div>
      <div style={{ ...card, padding: 16 }}>
        {flagged === 0 && notInKb.length === 0 && (
          <div style={{ fontSize: 13, color: T.green }}>✓ No hallucinations — every checkable claim matched the knowledge base.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contradicted.map((v, i) => row(v, i, T.red, 'Hallucination'))}
          {partial.map((v, i) => row(v, i, T.amber, 'Partly off'))}
          {notInKb.length > 0 && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ fontSize: 12, color: T.faint, cursor: 'pointer' }}>{notInKb.length} claim(s) not covered by the KB (not penalized)</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {notInKb.map((v, i) => row(v, i, T.faint, 'Unverified'))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

const flowColor: Record<string, string> = { hit: T.green, partial: T.amber, missed: T.red }

export function FlowStrip({ flow }: { flow: { stage: string; status: string; note: string }[] }) {
  if (!flow || flow.length === 0) return null
  return (
    <div>
      <div style={{ ...label, marginBottom: 10 }}>Flow adherence</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {flow.map((f, i) => {
          const col = flowColor[f.status] || T.faint
          return (
            <div key={i} title={f.note} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 99, padding: '7px 13px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: col }} />
              <span style={{ fontSize: 12.5, color: T.text3 }}>{f.stage}</span>
              <span style={{ fontSize: 11, color: col, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>{f.status}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TranscriptBubbles({ transcript }: { transcript: string }) {
  const turns: { role: string; text: string }[] = []
  const re = /\b(Agent|User|Supervisor):\s*/g
  const parts = transcript.split(re)
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i + 1] || '').trim()
    if (text) turns.push({ role: parts[i], text })
  }
  const roleColor: Record<string, string> = { Agent: 'var(--accent)', User: T.blue, Supervisor: T.purple }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {turns.map((t, i) => {
        const isAgent = t.role === 'Agent'
        return (
          <div key={i} style={{ display: 'flex', justifyContent: isAgent ? 'flex-start' : 'flex-end' }}>
            <div style={{ maxWidth: '78%', background: isAgent ? T.surface : T.chip, border: `1px solid ${T.border}`, borderRadius: 12, padding: '9px 13px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: roleColor[t.role] || T.muted, marginBottom: 3 }}>{t.role}</div>
              <div style={{ fontSize: 13.5, color: T.text2, lineHeight: 1.5 }}>{t.text}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
