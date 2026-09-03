import { useEffect, useState } from 'react'
import { T, card, label } from '../../theme'
import { api } from '../../api/client'
import { useForgeStore } from '../../stores/forgeStore'
import { SizeHint } from '../../components/forge'

// The library the coach learns from. A saved prompt on its own is just storage —
// the value is the LINK: highlighting the passage that fixes p2 and attaching it to
// p2, which puts a worked example in front of the coach instead of one line of advice.
type SavedPrompt = {
  id: string; name: string; kind: string; vertical: string | null
  notes: string | null; problem_ids: string[]; body_text?: string | null
  created_at: string
}

export function ForgeSavedPromptsPage() {
  const { problems, fetchProblems } = useForgeStore()
  const [rows, setRows] = useState<SavedPrompt[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [body, setBody] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', body_text: '', vertical: '', notes: '' })
  const [linkPid, setLinkPid] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = () => api.listSavedPrompts().then(setRows).catch((e) => setErr(String(e)))
  useEffect(() => { load(); fetchProblems() }, [fetchProblems])

  const open = async (id: string) => {
    setOpenId(openId === id ? null : id)
    if (!body[id]) {
      const full = await api.getSavedPrompt(id)
      setBody((b) => ({ ...b, [id]: full.body_text || JSON.stringify(full.body_json ?? {}, null, 2) }))
    }
  }

  const create = async () => {
    if (!draft.name.trim() || !draft.body_text.trim()) return
    setBusy(true); setErr(null)
    try {
      await api.createSavedPrompt({
        name: draft.name.trim(), kind: 'fragment', body_text: draft.body_text,
        vertical: draft.vertical.trim() || null, notes: draft.notes.trim() || null,
      })
      setDraft({ name: '', body_text: '', vertical: '', notes: '' })
      setCreating(false)
      await load()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  // The excerpt is what the coach actually reads. Default to the user's current
  // selection inside the body box — the whole prompt is useless to it.
  const link = async (sp: SavedPrompt) => {
    if (!linkPid) return
    const sel = (window.getSelection()?.toString() || '').trim()
    const excerpt = sel || body[sp.id] || ''
    if (!excerpt.trim()) { setErr('nothing to link — highlight the passage that fixes this problem'); return }
    setBusy(true); setErr(null)
    try {
      await api.linkSavedPrompt(sp.id, linkPid, {
        excerpt, kind: 'good_example',
        title: sel ? `excerpt from ${sp.name}` : sp.name,
      })
      setLinkPid('')
      await Promise.all([load(), fetchProblems()])
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const unlink = async (sp: SavedPrompt, pid: string) => {
    setBusy(true)
    try { await api.unlinkSavedPrompt(sp.id, pid); await Promise.all([load(), fetchProblems()]) }
    finally { setBusy(false) }
  }

  const behaviourOf = (pid: string) => problems.find((p) => p.id === pid)?.behaviour || pid

  return (
    <div className="page-enter">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ fontSize: 25, fontWeight: 650, margin: 0, color: T.text }}>Saved prompts</h1>
          <p style={{ fontSize: 13, color: T.muted, margin: '6px 0 0', maxWidth: 640, lineHeight: 1.6 }}>
            Prompt passages worth keeping. Link one to a problem and the coach gets a{' '}
            <strong style={{ color: T.text3 }}>worked example</strong> instead of one line of advice —
            it imitates a passage far more reliably than it follows a rule.
          </p>
        </div>
        <button onClick={() => setCreating((v) => !v)}
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
          {creating ? 'Cancel' : '+ Save a prompt'}
        </button>
      </div>

      {err && (
        <div style={{ ...card, marginTop: 14, padding: '10px 14px', border: `1px solid ${T.red}44`, background: T.red + '12', color: T.red, fontSize: 12.5 }}>{err}</div>
      )}

      {creating && (
        <div style={{ ...card, marginTop: 16, padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <input placeholder="name — e.g. 'Auro v7 answer-first opening'" value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...inp, flex: 2, minWidth: 260 }} />
            <input placeholder="vertical (optional)" value={draft.vertical}
              onChange={(e) => setDraft({ ...draft, vertical: e.target.value })} style={{ ...inp, flex: 1, minWidth: 140 }} />
          </div>
          <textarea value={draft.body_text} onChange={(e) => setDraft({ ...draft, body_text: e.target.value })}
            placeholder="Paste the prompt — or just the passage that does the work. Shorter is better: the coach reads this."
            style={{ ...inp, width: '100%', minHeight: 150, fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, resize: 'vertical' }} />
          <SizeHint text={draft.body_text} />
          <input placeholder="notes — what this fixed, and how you know (optional)" value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={{ ...inp, width: '100%', marginTop: 10 }} />
          <button onClick={create} disabled={busy || !draft.name.trim() || !draft.body_text.trim()}
            style={{ marginTop: 12, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: draft.name.trim() && draft.body_text.trim() ? 1 : 0.5 }}>
            Save
          </button>
        </div>
      )}

      {!rows.length && !creating && (
        <div style={{ ...card, marginTop: 18, padding: 26, textAlign: 'center', color: T.faint, fontSize: 13 }}>
          Nothing saved yet. Save a passage that fixed something, then link it to the problem it fixed.
        </div>
      )}

      <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
        {rows.map((sp) => (
          <div key={sp.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div onClick={() => open(sp.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{sp.name}</span>
              {sp.vertical && (
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 99, background: T.chip, color: T.muted }}>{sp.vertical}</span>
              )}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(sp.problem_ids || []).map((pid) => (
                  <span key={pid} title={behaviourOf(pid)}
                    style={{ fontSize: 10.5, fontFamily: T.mono, padding: '2px 8px', borderRadius: 99, background: T.green + '1e', color: T.green, border: `1px solid ${T.green}44` }}>
                    {pid}
                  </span>
                ))}
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.fainter }}>
                {openId === sp.id ? 'hide' : 'open'}
              </span>
            </div>

            {openId === sp.id && (
              <div style={{ borderTop: `1px solid ${T.divider}`, padding: 16 }}>
                {sp.notes && <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>{sp.notes}</div>}
                <pre style={{ margin: 0, padding: 12, background: T.well, borderRadius: 9, maxHeight: 300, overflow: 'auto', fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.6, color: T.text3, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
                  {body[sp.id] ?? 'loading…'}
                </pre>
                <SizeHint text={body[sp.id] || ''} />

                <div style={{ marginTop: 14, padding: 12, borderRadius: 9, background: T.well, border: `1px solid ${T.border}` }}>
                  <div style={{ ...label, marginBottom: 8 }}>Link to a problem</div>
                  <div style={{ fontSize: 11.5, color: T.fainter, marginBottom: 9, lineHeight: 1.55 }}>
                    <strong style={{ color: T.muted }}>Highlight the passage above</strong> that fixes the problem,
                    then pick it below. Only the highlighted excerpt is sent to the coach — a whole prompt tells it nothing.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select value={linkPid} onChange={(e) => setLinkPid(e.target.value)} style={{ ...inp, flex: 1, minWidth: 300 }}>
                      <option value="">— pick the problem this passage fixes —</option>
                      {problems.map((p) => (
                        <option key={p.id} value={p.id}>{p.id} · {p.behaviour}</option>
                      ))}
                    </select>
                    <button onClick={() => link(sp)} disabled={!linkPid || busy}
                      style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: linkPid ? 'var(--accent)' : T.chip, color: linkPid ? '#fff' : T.faint, fontSize: 12.5, fontWeight: 600, cursor: linkPid ? 'pointer' : 'default' }}>
                      Link selection
                    </button>
                  </div>
                  {(sp.problem_ids || []).length > 0 && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 5 }}>
                      {sp.problem_ids.map((pid) => (
                        <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: T.muted }}>
                          <span style={{ fontFamily: T.mono, color: T.green }}>{pid}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{behaviourOf(pid)}</span>
                          <button onClick={() => unlink(sp, pid)}
                            style={{ marginLeft: 'auto', padding: '2px 9px', borderRadius: 7, border: `1px solid ${T.border2}`, background: 'transparent', color: T.faint, fontSize: 10.5, cursor: 'pointer' }}>
                            unlink
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// same input styling the other Forge pages use
const inp: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, background: T.well, border: `1px solid ${T.border2}`,
  color: T.text, fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box',
}
