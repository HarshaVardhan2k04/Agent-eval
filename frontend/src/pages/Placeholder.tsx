import { T } from '../theme'

// Themed "under construction" screen for modules not yet built (P2–P5).
// Each unbuilt route renders this with its own title/tagline so the shell feels whole.
export function Placeholder({ title, tagline, phase }: { title: string; tagline: string; phase?: string }) {
  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text, fontFamily: T.sans }}>{title}</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>{tagline}</p>

      <div style={{
        marginTop: 30, background: T.surface, border: `1px dashed ${T.border2}`, borderRadius: T.rCard,
        padding: '54px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        <div style={{ width: 54, height: 54, borderRadius: 15, background: T.accentSoft, border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: T.accentGrad, boxShadow: T.accentGlow }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text2 }}>Coming together next</div>
        <div style={{ fontSize: 13.5, color: T.faint, maxWidth: 420, lineHeight: 1.5 }}>
          This module is being built now. {phase && <span style={{ color: T.muted, fontFamily: T.mono }}>({phase})</span>}
        </div>
      </div>
    </div>
  )
}
