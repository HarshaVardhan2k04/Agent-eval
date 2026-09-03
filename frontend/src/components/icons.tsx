// Minimal stroke icon set (currentColor, 1.6 stroke). Sized via `s` prop.
import type { CSSProperties } from 'react'

type P = { s?: number; style?: CSSProperties }
const base = (s = 18): CSSProperties => ({ width: s, height: s, flexShrink: 0, display: 'block' })
const svg = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const IconHistory = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
  </svg>
)
export const IconPlus = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconAnalyze = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <path d="M4 5h11M4 10h7M4 15h9M4 20h5" /><circle cx="18" cy="17" r="3.2" /><path d="m20.5 19.5 2 2" />
  </svg>
)
export const IconBoard = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <path d="M4 20V10M9 20V4M14 20v-7M19 20v-11" />
  </svg>
)
export const IconStt = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2M21 12h.01" />
  </svg>
)
export const IconFlow = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <rect x="3" y="4" width="7" height="5" rx="1.4" /><rect x="14" y="15" width="7" height="5" rx="1.4" />
    <path d="M6.5 9v3.5A2 2 0 0 0 8.5 14.5H17.5" />
  </svg>
)
export const IconTools = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
    <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" />
  </svg>
)
export const IconJudge = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <rect x="6" y="6" width="12" height="12" rx="2.2" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    <rect x="10" y="10" width="4" height="4" rx="0.8" />
  </svg>
)
export const IconRag = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    <ellipse cx="9" cy="5" rx="6" ry="2.4" /><path d="M3 5v9c0 1.3 2.7 2.4 6 2.4" />
    <path d="M15 8.5c0 1.3-2.7 2.4-6 2.4S3 9.8 3 8.5" /><circle cx="17" cy="16" r="3.2" /><path d="m19.5 18.5 2.5 2.5" />
  </svg>
)
export const IconChevron = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}><path d="m15 6-6 6 6 6" /></svg>
)
export const IconSpinner = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style, animation: 'spin 0.9s linear infinite' }} {...svg}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
)
// Dual crossed swords — anime FIGHT! energy (LLM Arena)
export const IconSwords = ({ s, style }: P) => (
  <svg viewBox="0 0 24 24" style={{ ...base(s), ...style }} {...svg}>
    {/* blades crossing in an X */}
    <path d="M3.5 4.5 14.5 15.5" /><path d="M20.5 4.5 9.5 15.5" />
    {/* crossguards */}
    <path d="M12.9 17.1 17.1 12.9" /><path d="M6.9 12.9 11.1 17.1" />
    {/* grips + pommels */}
    <path d="M16 16l2.7 2.7" /><path d="M8 16l-2.7 2.7" />
    <path d="M19.4 19.4h.01" /><path d="M4.6 19.4h.01" />
    {/* impact spark burst */}
    <path d="M12 3.6V1.9" /><path d="m9.2 4.4-.9-1.4" /><path d="m14.8 4.4.9-1.4" />
  </svg>
)

// Saved prompts — a bookmarked page: passages kept because they worked.
export function IconBook({ s = 16 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4a2 2 0 0 1 2-2h11v18H7a2 2 0 0 0-2 2V4z" />
      <path d="M9 7h6" /><path d="M9 11h4" />
    </svg>
  )
}
