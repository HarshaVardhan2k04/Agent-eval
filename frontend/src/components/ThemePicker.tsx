import { useState } from 'react'
import { T } from '../theme'
import { ACCENT_PRESETS, useAccent } from '../accent'

// Accent-color popover. Lives in the sidebar footer; recolors the whole app live.
export function ThemePicker({ collapsed }: { collapsed?: boolean }) {
  const [accent, setAccent] = useAccent()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(accent)

  const choose = (hex: string) => { setAccent(hex); setText(hex) }
  const onInput = (v: string) => {
    setText(v)
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccent(v.toLowerCase())
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)} title="Accent color" aria-label="Change accent color"
        style={{
          width: collapsed ? 40 : '100%', height: 40, borderRadius: 10,
          border: `1px solid ${T.border2}`, background: T.surface2, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? 0 : '0 12px',
        }}
      >
        <span style={{ width: 15, height: 15, borderRadius: 5, background: 'var(--accent)', boxShadow: '0 0 0 3px rgba(var(--accent-rgb),0.18)', flexShrink: 0 }} />
        {!collapsed && <span style={{ fontSize: 13, color: T.muted, fontWeight: 500 }}>Accent</span>}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{
            position: 'absolute', bottom: 48, left: 0, zIndex: 70, width: 236,
            background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 15,
            padding: 16, boxShadow: '0 20px 44px rgba(0,0,0,0.55)', animation: 'slide-in .18s ease both',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.muted, marginBottom: 11 }}>
              Accent color
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
              {ACCENT_PRESETS.map(([name, hex]) => (
                <button key={hex} onClick={() => choose(hex)} title={name} aria-label={name}
                  style={{
                    width: '100%', aspectRatio: '1', borderRadius: 9, cursor: 'pointer', background: hex,
                    border: `2px solid ${accent.toLowerCase() === hex ? T.text : 'transparent'}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '9px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}` }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--accent)', flexShrink: 0 }} />
              <input value={text} onChange={(e) => onInput(e.target.value)} spellCheck={false} maxLength={7} placeholder="#e5643c"
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: T.text, fontFamily: T.mono, fontSize: 13.5, outline: 'none', textTransform: 'lowercase' }} />
            </div>
            <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.45, marginTop: 9 }}>
              Any hex works — the whole app recolors live.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
