import { useEffect, useState } from 'react'
import { T, card, btnPrimary, btnSecondary, label } from '../theme'
import { api } from '../api/client'
import { TOOL_GROUPS, CORE_TOOLS } from '../data/tools'

// Settings · Tools — which tools the agent has, so tool-calling is scored against
// the right set. Persisted to app_settings['tools'].
export function SettingsPage() {
  const [tools, setTools] = useState<string[]>(CORE_TOOLS)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      if (Array.isArray(s.tools)) setTools(s.tools)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const toggle = (n: string) => {
    setSaved(false)
    setTools((ts) => (ts.includes(n) ? ts.filter((x) => x !== n) : [...ts, n]))
  }
  const selectCore = () => { setSaved(false); setTools(CORE_TOOLS) }

  const save = async () => {
    await api.setSetting('tools', tools)
    setSaved(true)
  }

  return (
    <div>
      <h1 style={{ fontSize: 27, fontWeight: 650, margin: 0, color: T.text }}>Tools</h1>
      <p style={{ fontSize: 14.5, color: T.muted, margin: '7px 0 0' }}>
        Tell the system which tools the agent has — tool-calling is scored against this set.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button onClick={selectCore} style={btnSecondary}>Select core tools</button>
        <button onClick={save} disabled={!loaded} style={{ ...btnPrimary, opacity: loaded ? 1 : 0.5 }}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {TOOL_GROUPS.map((g) => (
          <div key={g.group} style={{ ...card, padding: 18 }}>
            <div style={{ ...label, marginBottom: 12 }}>{g.group}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.tools.map((t) => {
                const on = tools.includes(t.name)
                return (
                  <div key={t.name} onClick={() => toggle(t.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', background: on ? T.accentSoft : T.well, border: `1px solid ${on ? 'var(--accent)' : T.border}` }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: on ? 'var(--accent)' : 'transparent', border: `1.5px solid ${on ? 'var(--accent)' : T.border2}`,
                      color: '#fff', fontSize: 12, fontWeight: 700,
                    }}>{on ? '✓' : ''}</span>
                    <span style={{ fontSize: 13.5, fontFamily: T.mono, color: T.text, width: 210 }}>{t.name}</span>
                    <span style={{ fontSize: 12.5, color: T.muted }}>{t.desc}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
