import { useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { EvalListPage } from './pages/EvalListPage'
import { EvalSetupPage } from './pages/EvalSetupPage'
import { EvalProgressPage } from './pages/EvalProgressPage'
import { ResultsDashboard } from './pages/ResultsDashboard'
import { PromptHistoryPage } from './pages/PromptHistoryPage'
import { VoiceReportPage } from './pages/VoiceReportPage'
import { T } from './theme'
import { ACCENT_PRESETS, useAccent } from './accent'

function ThemePicker() {
  const [accent, setAccent] = useAccent()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(accent)

  const choose = (hex: string) => {
    setAccent(hex)
    setText(hex)
  }
  const onInput = (v: string) => {
    setText(v)
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccent(v.toLowerCase())
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Accent color" aria-label="Change accent color"
        style={{
          width: 38, height: 38, borderRadius: 10, border: `1px solid ${T.border2}`,
          background: T.surface2, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ width: 15, height: 15, borderRadius: 5, background: 'var(--accent)', boxShadow: '0 0 0 3px rgba(var(--accent-rgb),0.18)' }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div
            style={{
              position: 'absolute', top: 46, right: 0, zIndex: 70, width: 236,
              background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 15,
              padding: 16, boxShadow: '0 20px 44px rgba(0,0,0,0.55)', animation: 'slide-in .18s ease both',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.muted, marginBottom: 11 }}>
              Accent color
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
              {ACCENT_PRESETS.map(([name, hex]) => (
                <button
                  key={hex} onClick={() => choose(hex)} title={name} aria-label={name}
                  style={{
                    width: '100%', aspectRatio: '1', borderRadius: 9, cursor: 'pointer',
                    background: hex,
                    border: `2px solid ${accent.toLowerCase() === hex ? T.text : 'transparent'}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '9px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}` }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--accent)', flexShrink: 0 }} />
              <input
                value={text} onChange={(e) => onInput(e.target.value)} spellCheck={false} maxLength={7}
                placeholder="#e5643c"
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: T.text, fontFamily: T.mono, fontSize: 13.5, outline: 'none', textTransform: 'lowercase' }}
              />
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

function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onHome = pathname === '/'
  const onNew = pathname === '/new'

  const link = (active: boolean): React.CSSProperties => ({
    padding: '8px 13px', borderRadius: 10, border: 'none',
    background: active ? T.chip : 'transparent', color: active ? T.text : T.muted,
    fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
  })

  return (
    <nav
      style={{
        position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', gap: 26,
        height: 60, padding: '0 24px', background: 'rgba(20,17,14,0.8)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        borderBottom: `1px solid ${T.divider}`,
      }}
    >
      <div onClick={() => navigate('/')} role="button" tabIndex={0} aria-label="Agent Eval — home"
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
        <img src="/agent-eval-logo.png" alt="Agent Eval" style={{ height: 32, width: 'auto', display: 'block' }} />
      </div>

      <div className="nav-links" style={{ display: 'flex', gap: 2 }}>
        <button onClick={() => navigate('/')} style={link(onHome)}>History</button>
        <button onClick={() => navigate('/new')} style={link(onNew)}>New Eval</button>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <ThemePicker />
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3a332a,#272019)', border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: T.text2 }}>JD</div>
      </div>
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', color: T.text }}>
        <Nav />
        <main style={{ maxWidth: 1180, margin: '0 auto', padding: '38px 24px 90px' }}>
          <Routes>
            <Route path="/" element={<EvalListPage />} />
            <Route path="/new" element={<EvalSetupPage />} />
            <Route path="/eval/:id/progress" element={<EvalProgressPage />} />
            <Route path="/eval/:id/results" element={<ResultsDashboard />} />
            <Route path="/eval/:id/prompts" element={<PromptHistoryPage />} />
            <Route path="/eval/:id/voice" element={<VoiceReportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
