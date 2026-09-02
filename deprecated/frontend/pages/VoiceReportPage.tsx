import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEvalStore } from '../stores/evalStore'
import { T, backBtn } from '../theme'

type VoiceItem = { turn?: number; pattern?: string; matched_text?: string; length?: number; max_allowed?: number }
type VoiceAnalysis = {
  thinking_leaks?: VoiceItem[]
  markdown_issues?: VoiceItem[]
  digit_issues?: VoiceItem[]
  length_issues?: VoiceItem[]
  emoji_issues?: VoiceItem[]
}

type IssueRow = { scenario: string; type: string; turn: number | string; match: string; color: string }

export function VoiceReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { scenarioResults, fetchResults } = useEvalStore()

  useEffect(() => {
    if (id) fetchResults(id)
  }, [id])

  const voiceData = useMemo(() => {
    return scenarioResults.map((r) => {
      const va = r.voice_analysis_json as VoiceAnalysis | null
      return {
        name: r.scenario_name,
        thinking_leaks: va?.thinking_leaks?.length || 0,
        markdown: va?.markdown_issues?.length || 0,
        digits: va?.digit_issues?.length || 0,
        length: va?.length_issues?.length || 0,
        emoji: va?.emoji_issues?.length || 0,
      }
    })
  }, [scenarioResults])

  const totals = useMemo(() => {
    return voiceData.reduce(
      (acc, d) => ({
        thinking_leaks: acc.thinking_leaks + d.thinking_leaks,
        markdown: acc.markdown + d.markdown,
        digits: acc.digits + d.digits,
        length: acc.length + d.length,
        emoji: acc.emoji + d.emoji,
      }),
      { thinking_leaks: 0, markdown: 0, digits: 0, length: 0, emoji: 0 }
    )
  }, [voiceData])

  // 5 stat cards — colored by count (green if clean, else intent color)
  const stats = useMemo(() => {
    const base = [
      { label: 'Thinking leaks', count: totals.thinking_leaks, color: T.red, help: 'Internal reasoning spoken aloud' },
      { label: 'Markdown issues', count: totals.markdown, color: T.amber, help: 'Symbols like ** or # read literally' },
      { label: 'Digit issues', count: totals.digits, color: T.amber, help: 'Raw numbers not spoken as words' },
      { label: 'Length issues', count: totals.length, color: T.blue, help: 'Replies too long for a call' },
      { label: 'Emoji issues', count: totals.emoji, color: T.purple, help: 'Emoji that can’t be spoken' },
    ]
    return base.map((s) => ({ ...s, color: s.count === 0 ? T.green : s.color }))
  }, [totals])

  // Bar chart — one bar per scenario = sum of the 5 arrays' lengths
  const bars = useMemo(() => {
    return voiceData.map((d) => ({
      label: d.name.length > 14 ? d.name.slice(0, 14) + '…' : d.name,
      count: d.thinking_leaks + d.markdown + d.digits + d.length + d.emoji,
    }))
  }, [voiceData])
  const maxBar = useMemo(() => Math.max(1, ...bars.map((b) => b.count)), [bars])

  // Flattened issue rows
  const issues = useMemo<IssueRow[]>(() => {
    const rows: IssueRow[] = []
    for (const r of scenarioResults) {
      const va = r.voice_analysis_json as VoiceAnalysis | null
      if (!va) continue
      const push = (arr: VoiceItem[] | undefined, type: string, color: string, matchOf: (it: VoiceItem) => string) => {
        for (const it of arr || []) {
          rows.push({ scenario: r.scenario_name, type, turn: it.turn ?? '—', match: matchOf(it), color })
        }
      }
      push(va.thinking_leaks, 'Thinking leak', T.red, (it) => it.matched_text || '')
      push(va.markdown_issues, 'Markdown', T.amber, (it) => it.matched_text || '')
      push(va.digit_issues, 'Digit', T.amber, (it) => it.matched_text || '')
      push(va.length_issues, 'Length', T.blue, (it) => `${it.length} chars > ${it.max_allowed}`)
      push(va.emoji_issues, 'Emoji', T.purple, (it) => it.matched_text || '')
    }
    return rows
  }, [scenarioResults])

  const gridCols = '1.4fr 1fr 0.7fr 2fr'

  return (
    <div className="page-enter">
      <button onClick={() => navigate(`/eval/${id}/results`)} style={backBtn}>
        ← Back to results
      </button>

      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', color: T.text }}>
        Voice quality report
      </h1>
      <p style={{ margin: '8px 0 0', color: T.muted, fontSize: 14.5, maxWidth: 640, lineHeight: 1.5 }}>
        Text that reads fine can sound wrong out loud. We scan every reply for things a voice would trip on — leaked
        thinking, symbols, raw digits — so your agent sounds human.
      </p>

      {/* Stat cards */}
      <div className="voice-cards stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 24 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: s.color, fontFamily: T.mono, lineHeight: 1 }}>{s.count}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 8 }}>{s.label}</div>
            <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.45, marginTop: 4 }}>{s.help}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {bars.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: '22px 24px', marginTop: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Issues per scenario</div>
          <div style={{ fontSize: 12.5, color: T.faint, marginTop: 2, marginBottom: 20 }}>
            Lower is better — most scenarios are already clean.
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, height: 150, paddingLeft: 8 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ fontFamily: T.mono, fontSize: 12, color: T.muted }}>{b.count}</div>
                <div
                  style={{
                    width: '100%',
                    maxWidth: 46,
                    height: `${Math.max(6, Math.round((b.count / maxBar) * 100))}%`,
                    borderRadius: '8px 8px 0 0',
                    background: T.accentGrad,
                  }}
                />
                <div style={{ fontSize: 11.5, color: T.faint, textAlign: 'center', lineHeight: 1.3, height: 28 }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issue table / all-clear */}
      {issues.length === 0 ? (
        <div
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 16,
            padding: '28px 24px',
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 99,
              background: `${T.green}22`,
              color: T.green,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.green }}>No voice issues</div>
            <div style={{ fontSize: 13.5, color: T.text3, marginTop: 3 }}>Your agent sounds clean.</div>
          </div>
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: 'hidden', marginTop: 18 }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.divider}`, fontSize: 16, fontWeight: 600, color: T.text }}>
            Every issue we found{' '}
            <span style={{ fontSize: 13, color: T.faint, fontWeight: 400 }}>· {issues.length} total</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              gap: 0,
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: T.muted,
              padding: '11px 20px',
              borderBottom: `1px solid ${T.borderFaint}`,
            }}
          >
            <span>Scenario</span>
            <span>Issue</span>
            <span>Turn</span>
            <span>Matched text</span>
          </div>
          {issues.map((it, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 12,
                alignItems: 'center',
                padding: '13px 20px',
                borderBottom: `1px solid ${T.borderFaint}`,
              }}
            >
              <span style={{ fontSize: 13.5, color: T.text2 }}>{it.scenario}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifySelf: 'start',
                  padding: '3px 10px',
                  borderRadius: 99,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: `${it.color}22`,
                  color: it.color,
                }}
              >
                {it.type}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 13, color: T.muted }}>{it.turn}</span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 12.5,
                  color: T.text3,
                  background: T.well,
                  padding: '4px 9px',
                  borderRadius: 7,
                  justifySelf: 'start',
                }}
              >
                {it.match}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
