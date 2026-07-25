// Warm-dark design tokens for Agent Eval. Import as `import { T, scoreColor } from '../theme'`.
export const T = {
  // Surfaces (warm dark → light)
  bg: '#14110e',
  surface: '#1a1613',   // primary card
  surface2: '#1e1a16',  // elevated row / nav control
  rowHover: '#221d18',
  well: '#151210',      // editors, code, log, darkest
  chip: '#272019',      // pill / chip bg
  track: '#2c261f',     // progress track, muted bg

  // Text
  text: '#f6f0e6',      // primary
  text2: '#e6ddcf',     // body
  text3: '#c9c0b1',     // body-alt
  muted: '#a99f8e',     // labels / captions
  faint: '#786f60',     // hints
  fainter: '#544c40',   // timestamps / dividers

  // Status (always pair with an icon/label — colorblind-safe)
  green: '#4cc98a',     // pass / accepted / converged
  amber: '#f0a83c',     // warn
  amber2: '#e0a63c',
  red: '#ec5a54',       // fail / reverted / critical
  blue: '#5b9dff',      // running / info
  purple: '#9b7dff',    // coach thinking

  // Borders (warm cream, low alpha)
  border: 'rgba(245,235,220,0.09)',
  border2: 'rgba(245,235,220,0.14)',
  borderFaint: 'rgba(245,235,220,0.06)',
  divider: 'rgba(245,235,220,0.08)',

  // Accent (CSS vars, live-recolorable)
  accent: 'var(--accent)',
  accentHi: 'var(--accent-hi)',
  accentGrad: 'linear-gradient(140deg, var(--accent-hi), var(--accent))',
  accentSoft: 'rgba(var(--accent-rgb),0.1)',
  accentGlow: '0 4px 16px rgba(var(--accent-rgb),0.4)',

  // Type
  sans: "'General Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",

  // Radii
  rCard: 16,
  rInput: 12,
  rPill: 99,
} as const

/** Score → color band (0..1). */
export function scoreColor(v: number | null | undefined): string {
  const s = v ?? 0
  if (s >= 0.85) return T.green
  if (s >= 0.7) return T.amber
  if (s >= 0.5) return T.amber2
  return T.red
}

/** Status → { color, label } for badges/dots. */
export function statusMeta(status: string): { color: string; label: string } {
  switch (status) {
    case 'running': return { color: T.blue, label: 'Running' }
    case 'completed': return { color: T.green, label: 'Completed' }
    case 'converged': return { color: T.green, label: 'Converged' }
    case 'threshold_met': return { color: T.green, label: 'Passed' }
    case 'stopped': return { color: T.faint, label: 'Stopped' }
    case 'failed': return { color: T.red, label: 'Failed' }
    case 'pending': return { color: T.amber, label: 'Pending' }
    default: return { color: T.faint, label: status.charAt(0).toUpperCase() + status.slice(1) }
  }
}

// Reusable style fragments
export const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
}

export const btnPrimary: React.CSSProperties = {
  padding: '12px 20px',
  borderRadius: 12,
  border: 'none',
  background: T.accentGrad,
  color: '#fff',
  fontWeight: 600,
  fontSize: 14.5,
  cursor: 'pointer',
  boxShadow: T.accentGlow,
}

export const btnSecondary: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 11,
  border: `1px solid ${T.border2}`,
  background: T.surface2,
  color: T.text2,
  fontWeight: 500,
  fontSize: 13.5,
  cursor: 'pointer',
}

export const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: T.muted,
}

export const backBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'none',
  border: 'none',
  color: T.muted,
  fontSize: 13.5,
  cursor: 'pointer',
  padding: 0,
  marginBottom: 16,
}
