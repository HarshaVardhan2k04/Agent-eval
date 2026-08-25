import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { T } from '../theme'
import { ThemePicker } from './ThemePicker'
import {
  IconHistory, IconPlus, IconAnalyze, IconBoard, IconStt, IconFlow,
  IconJudge, IconChevron, IconRag, IconSwords,
} from './icons'

type Item = { to: string; label: string; icon: (p: { s?: number }) => ReactNode; end?: boolean }
type Group = { heading: string; items: Item[] }

const GROUPS: Group[] = [
  {
    heading: 'Forge',
    items: [
      { to: '/forge', label: 'Runs', icon: IconJudge, end: true },
      { to: '/forge/new', label: 'New Run', icon: IconPlus },
      { to: '/forge/matrix', label: 'Problem Matrix', icon: IconBoard },
      { to: '/forge/arena', label: 'LLM Arena', icon: IconSwords },
    ],
  },
  {
    heading: 'Old Eval',
    items: [
      { to: '/', label: 'History', icon: IconHistory, end: true },
      { to: '/new', label: 'New Eval', icon: IconPlus },
    ],
  },
  {
    heading: 'Call Analysis',
    items: [
      { to: '/analyze', label: 'Analyze Calls', icon: IconAnalyze },
      { to: '/scoreboard', label: 'Scoreboard', icon: IconBoard },
    ],
  },
  {
    heading: 'Test STT',
    items: [{ to: '/stt', label: 'Accuracy', icon: IconStt }],
  },
  {
    heading: 'RAG Testing',
    items: [{ to: '/rag', label: 'Retrieval eval', icon: IconRag }],
  },
  {
    heading: 'Flow Builder',
    items: [{ to: '/flow', label: 'Flows', icon: IconFlow }],
  },
  {
    heading: 'Settings',
    items: [
      { to: '/llm', label: 'Judge model', icon: IconJudge },
    ],
  },
]

const KEY_COLLAPSED = 'agent-eval-sidebar-collapsed'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY_COLLAPSED) === '1' } catch { return false }
  })
  const navigate = useNavigate()

  useEffect(() => {
    try { localStorage.setItem(KEY_COLLAPSED, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  const W = collapsed ? 68 : 236

  const itemStyle = (active: boolean): React.CSSProperties => ({
    position: 'relative', display: 'flex', alignItems: 'center', gap: 11,
    padding: collapsed ? '10px 0' : '9px 12px', justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: 10, textDecoration: 'none', cursor: 'pointer',
    color: active ? T.text : T.muted, background: active ? T.chip : 'transparent',
    fontSize: 13.5, fontWeight: active ? 600 : 500, transition: 'background .12s, color .12s',
  })

  return (
    <aside style={{
      width: W, minWidth: W, height: '100vh', position: 'sticky', top: 0,
      background: T.surface, borderRight: `1px solid ${T.divider}`,
      display: 'flex', flexDirection: 'column', transition: 'width .16s ease', zIndex: 30,
    }}>
      {/* Logo + collapse */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 60, padding: collapsed ? 0 : '0 16px', justifyContent: collapsed ? 'center' : 'space-between', borderBottom: `1px solid ${T.divider}` }}>
        <div onClick={() => navigate('/')} role="button" tabIndex={0} aria-label="Agent Eval — home"
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
          <img src="/agent-eval-logo.png" alt="Agent Eval" style={{ height: collapsed ? 26 : 30, width: 'auto', display: 'block' }} />
        </div>
        {!collapsed && (
          <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse"
            style={{ background: 'none', border: 'none', color: T.faint, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <IconChevron s={18} />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '12px 10px' : '14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {collapsed && (
          <button onClick={() => setCollapsed(false)} aria-label="Expand sidebar" title="Expand"
            style={{ background: 'none', border: 'none', color: T.faint, cursor: 'pointer', padding: 6, display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
            <IconChevron s={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        {GROUPS.map((g) => (
          <div key={g.heading} style={{ marginBottom: 8 }}>
            {!collapsed && (
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.fainter, padding: '8px 12px 5px' }}>
                {g.heading}
              </div>
            )}
            {collapsed && <div style={{ height: 1, background: T.divider, margin: '8px 8px' }} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {g.items.map((it) => {
                const Icon = it.icon
                return (
                  <NavLink key={it.to} to={it.to} end={it.end} title={collapsed ? it.label : undefined}
                    style={({ isActive }) => itemStyle(isActive)}>
                    {({ isActive }) => (
                      <>
                        {isActive && <span style={{ position: 'absolute', left: collapsed ? 4 : -12, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 3, background: 'var(--accent)' }} />}
                        <span style={{ color: isActive ? 'var(--accent)' : T.muted, display: 'flex' }}><Icon s={18} /></span>
                        {!collapsed && <span>{it.label}</span>}
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: theme + account */}
      <div style={{ borderTop: `1px solid ${T.divider}`, padding: collapsed ? '12px 10px' : '12px', display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: 9 }}>
        <ThemePicker collapsed={collapsed} />
        <div title="Account" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: 'linear-gradient(135deg,#3a332a,#272019)', border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: T.text2 }}>JD</div>
      </div>
    </aside>
  )
}
