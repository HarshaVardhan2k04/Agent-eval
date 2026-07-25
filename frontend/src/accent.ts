import { useEffect, useState } from 'react'

// The 6 presets from the design, plus a free hex input — the whole app recolors live.
export const ACCENT_PRESETS: [string, string][] = [
  ['Coral', '#e5643c'],
  ['Rose', '#ee5a86'],
  ['Violet', '#8b7bff'],
  ['Sky', '#4c9bf0'],
  ['Gold', '#e0a63c'],
  ['Teal', '#22b3a3'],
]

const KEY = 'agent-eval-accent-v2' // bumped so the old persisted default doesn't override the new one
const DEFAULT = '#4c9bf0'

export function hexToRgb(hex: string): string {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return '229,100,60'
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',')
}

export function lighten(hex: string, amt: number): string {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return hex
  let r = parseInt(h.slice(0, 2), 16)
  let g = parseInt(h.slice(2, 4), 16)
  let b = parseInt(h.slice(4, 6), 16)
  r = Math.round(r + (255 - r) * amt)
  g = Math.round(g + (255 - g) * amt)
  b = Math.round(b + (255 - b) * amt)
  return '#' + [r, g, b].map((x) => ('0' + x.toString(16)).slice(-2)).join('')
}

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s)

/** Write the four accent CSS variables on :root so every `var(--accent*)` recolors instantly. */
export function applyAccent(hex: string) {
  const acc = isHex(hex) ? hex.toLowerCase() : DEFAULT
  const hi = lighten(acc, 0.16)
  const root = document.documentElement.style
  root.setProperty('--accent', acc)
  root.setProperty('--accent-hi', hi)
  root.setProperty('--accent-rgb', hexToRgb(acc))
  root.setProperty('--accent-hi-rgb', hexToRgb(hi))
  try { localStorage.setItem(KEY, acc) } catch { /* ignore */ }
}

export function loadAccent(): string {
  try { return localStorage.getItem(KEY) || DEFAULT } catch { return DEFAULT }
}

/** Hook: current accent + setter that recolors the app and persists. */
export function useAccent(): [string, (hex: string) => void] {
  const [accent, setAccent] = useState<string>(loadAccent)
  useEffect(() => { applyAccent(accent) }, [accent])
  return [accent, setAccent]
}
