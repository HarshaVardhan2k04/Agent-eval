import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, updateEdge, useNodesState, useEdgesState,
  MarkerType, type Node, type Edge, type Connection,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { T, btnPrimary, btnSecondary, label } from '../theme'
import { api } from '../api/client'
import { FlowNode, kindColor } from '../components/FlowNode'

type OurNode = { id: string; type: string; name: string; description?: string; params?: Record<string, unknown>; position?: { x: number; y: number } }
type OurEdge = { from: string; to: string; label?: string }
type Graph = { nodes: OurNode[]; edges: OurEdge[] }

// Quick-add palette. These are just presets — you can retype any node to any type.
const QUICK_KINDS = ['start', 'stage', 'branch', 'tool', 'end', 'custom']

const EDGE_STYLE = { stroke: 'rgba(245,235,220,0.3)', strokeWidth: 1.7 }
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: 'rgba(245,235,220,0.45)' }

function toRF(g: Graph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (g.nodes || []).map((n) => ({
    id: n.id,
    type: 'agent', // single RF type → data.kind carries the freeform type
    position: n.position || { x: 0, y: 0 },
    data: { kind: n.type || 'stage', name: n.name || '', description: n.description || '' },
  }))
  const edges: Edge[] = (g.edges || []).map((e, i) => ({
    id: `e-${e.from}-${e.to}-${i}`,
    source: e.from, target: e.to,
    label: e.label || undefined,
    updatable: true,
    markerEnd: EDGE_MARKER, style: EDGE_STYLE,
    labelStyle: { fill: T.amber, fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: T.well }, labelBgPadding: [5, 3] as [number, number], labelBgBorderRadius: 5,
  }))
  return { nodes, edges }
}

function fromRF(nodes: Node[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as { kind: string }).kind || 'stage',
      name: (n.data as { name: string }).name || '',
      description: (n.data as { description?: string }).description || '',
      position: n.position,
    })),
    edges: edges.map((e) => ({ from: e.source, to: e.target, label: (e.label as string) || '' })),
  }
}

export function FlowBuilderPage() {
  const nodeTypes = useMemo(() => ({ agent: FlowNode }), [])
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selNodeId, setSelNodeId] = useState<string | null>(null)
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [direction, setDirection] = useState('inbound')
  const [genBusy, setGenBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [instruction, setInstruction] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [lastApplied, setLastApplied] = useState<string[] | null>(null)

  const [flowName, setFlowName] = useState('')
  const [flowId, setFlowId] = useState<string | null>(null)
  const [flows, setFlows] = useState<{ id: string; name: string; direction: string }[]>([])

  // one-level-plus undo stack of graph snapshots
  const history = useRef<{ nodes: Node[]; edges: Edge[] }[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const snapshot = useCallback(() => {
    history.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) })
    if (history.current.length > 30) history.current.shift()
    setCanUndo(true)
  }, [nodes, edges])
  const undo = () => {
    const prev = history.current.pop()
    if (prev) { setNodes(prev.nodes); setEdges(prev.edges); setSelNodeId(null); setSelEdgeId(null) }
    setCanUndo(history.current.length > 0)
  }

  const refreshFlows = useCallback(() => { api.listFlows().then(setFlows).catch(() => {}) }, [])
  useEffect(() => { refreshFlows() }, [refreshFlows])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({
    ...c, updatable: true, markerEnd: EDGE_MARKER, style: EDGE_STYLE,
    labelStyle: { fill: T.amber, fontSize: 11, fontWeight: 600 }, labelBgStyle: { fill: T.well },
  }, eds)), [setEdges])

  // Re-point an edge to a different node (fix a wrong branch).
  const onEdgeUpdate = useCallback((oldEdge: Edge, newConn: Connection) =>
    setEdges((els) => updateEdge(oldEdge, newConn, els)), [setEdges])

  const generate = async () => {
    if (!text.trim()) return
    setGenBusy(true); setError(null)
    try {
      const g = await api.generateFlow({ text, notes, direction })
      snapshot()
      const rf = toRF(g)
      setNodes(rf.nodes); setEdges(rf.edges); setSelNodeId(null); setSelEdgeId(null); setLastApplied(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenBusy(false)
    }
  }

  const runHelper = async () => {
    if (!instruction.trim()) return
    setEditBusy(true); setError(null)
    try {
      const graph = fromRF(nodes, edges)
      const res = await api.editFlow(graph, instruction)
      snapshot()
      const rf = toRF({ nodes: res.nodes, edges: res.edges })
      setNodes(rf.nodes); setEdges(rf.edges)
      setLastApplied(res.applied || [])
      setInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Helper edit failed')
    } finally {
      setEditBusy(false)
    }
  }

  // --- node/edge editing ---
  const patchNode = (patch: Record<string, unknown>) => {
    if (!selNodeId) return
    setNodes((ns) => ns.map((n) => n.id === selNodeId ? { ...n, data: { ...n.data, ...patch } } : n))
  }
  const patchEdgeLabel = (lbl: string) => {
    if (!selEdgeId) return
    setEdges((es) => es.map((e) => e.id === selEdgeId ? { ...e, label: lbl || undefined } : e))
  }
  const addNode = (kind: string) => {
    snapshot()
    const id = `n_${Math.round(performance.now())}_${Math.floor(Math.random() * 999)}`
    setNodes((ns) => [...ns, {
      id, type: 'agent',
      position: { x: 140 + Math.random() * 220, y: 120 + Math.random() * 180 },
      data: { kind, name: kind === 'tool' ? 'search_knowledge_base' : kind === 'custom' ? '' : `New ${kind}`, description: '' },
    }])
    setSelNodeId(id); setSelEdgeId(null)
  }
  const deleteNode = () => {
    if (!selNodeId) return
    snapshot()
    setNodes((ns) => ns.filter((n) => n.id !== selNodeId))
    setEdges((es) => es.filter((e) => e.source !== selNodeId && e.target !== selNodeId))
    setSelNodeId(null)
  }
  const deleteEdge = () => {
    if (!selEdgeId) return
    snapshot()
    setEdges((es) => es.filter((e) => e.id !== selEdgeId))
    setSelEdgeId(null)
  }

  const save = async () => {
    const definition = fromRF(nodes, edges)
    try {
      if (flowId) await api.updateFlow(flowId, { name: flowName || 'Untitled flow', direction, definition })
      else { const f = await api.saveFlow({ name: flowName || 'Untitled flow', direction, definition }); setFlowId(f.id) }
      refreshFlows(); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
  }
  const load = async (id: string) => {
    try {
      const f = await api.getFlow(id)
      const rf = toRF(f.definition || { nodes: [], edges: [] })
      setNodes(rf.nodes); setEdges(rf.edges)
      setFlowId(f.id); setFlowName(f.name); setDirection(f.direction); setSelNodeId(null); setSelEdgeId(null)
      history.current = []; setCanUndo(false); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load flow') }
  }

  const selNode = nodes.find((n) => n.id === selNodeId)
  const selEdge = edges.find((e) => e.id === selEdgeId)

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 9, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13, outline: 'none' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 650, margin: 0, color: T.text }}>Flow Builder</h1>
          <p style={{ fontSize: 13.5, color: T.muted, margin: '5px 0 0' }}>Generate, then edit freely — drag to connect, click any edge to set its condition, retype any node to any type, or ask the AI helper.</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={undo} disabled={!canUndo} style={{ ...btnSecondary, opacity: canUndo ? 1 : 0.4 }}>↶ Undo</button>
          <input value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="Flow name"
            style={{ padding: '9px 12px', borderRadius: 10, background: T.well, border: `1px solid ${T.border2}`, color: T.text, fontSize: 13.5, outline: 'none', width: 170 }} />
          <button onClick={save} style={btnPrimary}>{flowId ? 'Update' : 'Save'} flow</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr 240px', gap: 12, height: '76vh', minHeight: 560 }}>
        {/* LEFT: generate + helper + saved */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 15, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ ...label, marginBottom: 7 }}>Paste flow · JSON / MD / text</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the stages, branches, tools…"
            style={{ ...inputStyle, height: 110, fontFamily: T.mono, fontSize: 12, lineHeight: 1.5, resize: 'none' }} />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" style={{ ...inputStyle, marginTop: 8 }} />
          <input list="flow-directions" value={direction} onChange={(e) => setDirection(e.target.value)}
            placeholder="Path label (optional) — inbound / outbound / anything" style={{ ...inputStyle, marginTop: 8 }} />
          <datalist id="flow-directions"><option value="inbound" /><option value="outbound" /><option value="follow_up" /></datalist>
          <button onClick={generate} disabled={!text.trim() || genBusy} style={{ ...btnPrimary, marginTop: 10, opacity: (!text.trim() || genBusy) ? 0.5 : 1 }}>
            {genBusy ? 'Gemma is building…' : 'Generate flow'}
          </button>
          {error && <div style={{ color: T.red, fontSize: 12, marginTop: 10 }}>{error}</div>}

          <div style={{ height: 1, background: T.divider, margin: '16px 0 12px' }} />
          <div style={{ ...label, margin: '0 0 8px' }}>Saved flows</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flows.map((f) => (
              <button key={f.id} onClick={() => load(f.id)}
                style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 9, border: `1px solid ${f.id === flowId ? 'var(--accent)' : T.border2}`, background: f.id === flowId ? T.accentSoft : 'transparent', color: T.text2, fontSize: 12.5, cursor: 'pointer' }}>
                {f.name} <span style={{ color: T.faint, fontSize: 11 }}>· {f.direction}</span>
              </button>
            ))}
            {flows.length === 0 && <div style={{ fontSize: 12, color: T.faint }}>No saved flows yet.</div>}
          </div>
        </div>

        {/* CENTER: canvas + AI command bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ flex: 1, background: T.well, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
            {nodes.length === 0 && !genBusy && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.faint, fontSize: 14, textAlign: 'center', padding: 24, pointerEvents: 'none', zIndex: 1 }}>
                Generate a flow, or add nodes from the palette. Drag between the dots to connect; click an edge to label/delete it.
              </div>
            )}
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              onEdgeUpdate={onEdgeUpdate}
              onNodeClick={(_, n) => { setSelNodeId(n.id); setSelEdgeId(null) }}
              onEdgeClick={(_, e) => { setSelEdgeId(e.id); setSelNodeId(null) }}
              onPaneClick={() => { setSelNodeId(null); setSelEdgeId(null) }}
              deleteKeyCode={['Delete', 'Backspace']}
              fitView proOptions={{ hideAttribution: true }}>
              <Background color="rgba(245,235,220,0.06)" gap={20} />
              <Controls style={{ background: T.surface2, borderRadius: 8 }} />
              <MiniMap pannable style={{ background: T.surface }} maskColor="rgba(0,0,0,0.5)"
                nodeColor={(n) => kindColor((n.data as { kind: string })?.kind || 'stage')} />
            </ReactFlow>

            {/* palette — floating top-left */}
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, background: 'rgba(30,26,22,0.85)', backdropFilter: 'blur(8px)', border: `1px solid ${T.border2}`, borderRadius: 10, padding: 5, zIndex: 5, flexWrap: 'wrap', maxWidth: 'calc(100% - 24px)' }}>
              {QUICK_KINDS.map((k) => (
                <button key={k} onClick={() => addNode(k)} title={k === 'custom' ? 'Add a node, then type your own type' : `Add ${k}`}
                  style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.border2}`, background: T.well, color: k === 'custom' ? T.text2 : T.text3, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                  + {k}
                </button>
              ))}
            </div>

            {/* applied-changes toast — top-right */}
            {lastApplied && (
              <div style={{ position: 'absolute', top: 12, right: 12, width: 260, maxHeight: '60%', overflowY: 'auto', background: 'rgba(30,26,22,0.95)', backdropFilter: 'blur(8px)', border: `1px solid rgba(155,125,255,0.35)`, borderRadius: 12, padding: '12px 14px', zIndex: 6, boxShadow: '0 12px 30px -12px rgba(0,0,0,0.8)', animation: 'slide-in .18s ease both' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.purple }}>Helper applied</span>
                  <button onClick={() => setLastApplied(null)} style={{ background: 'none', border: 'none', color: T.faint, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                </div>
                {lastApplied.length
                  ? lastApplied.map((a, i) => <div key={i} style={{ fontSize: 12, color: T.text3, lineHeight: 1.5 }}>· {a}</div>)
                  : <div style={{ fontSize: 12, color: T.muted }}>No changes were needed.</div>}
              </div>
            )}
          </div>

          {/* AI command bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px',
            background: T.surface, borderRadius: 13,
            border: `1px solid ${instruction.trim() ? 'rgba(155,125,255,0.5)' : T.border2}`,
            boxShadow: instruction.trim() ? '0 0 0 3px rgba(155,125,255,0.1)' : 'none', transition: 'border-color .15s, box-shadow .15s',
          }}>
            <span style={{ color: T.purple, fontSize: 16, flexShrink: 0 }}>✦</span>
            <input
              value={instruction} onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !editBusy && instruction.trim() && nodes.length) runHelper() }}
              placeholder={nodes.length === 0 ? 'Generate or add nodes first, then ask the AI to edit…' : 'Ask the AI to edit — e.g. "add a branch after greeting → escalate", "delete the objection node", "relabel yes to Confirmed"'}
              disabled={nodes.length === 0}
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: T.text, fontSize: 13.5, outline: 'none' }} />
            <button onClick={runHelper} disabled={!instruction.trim() || editBusy || nodes.length === 0}
              style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 9, border: 'none', background: (!instruction.trim() || editBusy || nodes.length === 0) ? T.chip : 'linear-gradient(140deg, #b39bff, #9b7dff)', color: (!instruction.trim() || editBusy || nodes.length === 0) ? T.faint : '#fff', fontWeight: 600, fontSize: 13, cursor: (!instruction.trim() || editBusy || nodes.length === 0) ? 'default' : 'pointer' }}>
              {editBusy ? 'Editing…' : 'Send'}
            </button>
          </div>
        </div>

        {/* RIGHT: inspector (edge > node > empty) */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 15, overflowY: 'auto' }}>
          {selEdge ? (
            <div>
              <div style={{ ...label, marginBottom: 10 }}>Edit connection</div>
              <div style={{ fontSize: 12, color: T.faint, fontFamily: T.mono, marginBottom: 12 }}>{selEdge.source} → {selEdge.target}</div>
              <div style={{ ...label, fontSize: 10.5, marginBottom: 5 }}>Condition / label</div>
              <input value={(selEdge.label as string) || ''} onChange={(e) => patchEdgeLabel(e.target.value)} placeholder='e.g. Yes, No, "already insured"' style={inputStyle} />
              <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8, lineHeight: 1.4 }}>Tip: drag either end of the edge on the canvas to re-point it to another node.</div>
              <button onClick={deleteEdge} style={{ ...btnSecondary, marginTop: 14, width: '100%', color: T.red, borderColor: 'rgba(236,90,84,0.3)' }}>Delete connection</button>
            </div>
          ) : selNode ? (
            <div>
              <div style={{ ...label, marginBottom: 10 }}>Edit node</div>
              <div style={{ ...label, fontSize: 10.5, marginBottom: 5 }}>Type · type anything</div>
              <input list="flow-kinds" value={(selNode.data as { kind: string }).kind} onChange={(e) => patchNode({ kind: e.target.value })} placeholder="stage / branch / tool / anything…" style={{ ...inputStyle, marginBottom: 12 }} />
              <datalist id="flow-kinds">{QUICK_KINDS.filter((k) => k !== 'custom').map((k) => <option key={k} value={k} />)}</datalist>
              <div style={{ ...label, fontSize: 10.5, marginBottom: 5 }}>Name</div>
              <input value={(selNode.data as { name: string }).name} onChange={(e) => patchNode({ name: e.target.value })} style={{ ...inputStyle, marginBottom: 12 }} />
              <div style={{ ...label, fontSize: 10.5, marginBottom: 5 }}>Description</div>
              <textarea value={(selNode.data as { description?: string }).description || ''} onChange={(e) => patchNode({ description: e.target.value })} rows={4} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
              <button onClick={deleteNode} style={{ ...btnSecondary, marginTop: 14, width: '100%', color: T.red, borderColor: 'rgba(236,90,84,0.3)' }}>Delete node</button>
            </div>
          ) : (
            <div style={{ color: T.faint, fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Select a <b style={{ color: T.text3 }}>node</b> to retype/rename it, or an <b style={{ color: T.text3 }}>edge</b> to set its Yes/No condition or delete it. Drag between node dots to connect.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
