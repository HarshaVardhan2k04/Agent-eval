import { Handle, Position } from 'reactflow'
import { T } from '../theme'

// Known types get fixed colors; ANY other freeform type gets a stable hashed color,
// so the graph is fully dynamic (type your own type, it still renders + colors).
const KNOWN: Record<string, string> = {
  start: T.green,
  stage: 'var(--accent)',
  branch: T.amber,
  tool: T.purple,
  end: T.red,
}

export function kindColor(kind: string): string {
  const k = (kind || 'stage').toLowerCase()
  if (KNOWN[k]) return KNOWN[k]
  // deterministic hue from the string
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 60%)`
}

export function FlowNode({ data, selected }: { data: { kind: string; name: string; description?: string }; selected: boolean }) {
  const kind = data.kind || 'stage'
  const color = kindColor(kind)
  const isTool = kind.toLowerCase() === 'tool'
  return (
    <div style={{
      minWidth: 168, maxWidth: 210, background: T.surface,
      border: `1.5px solid ${selected ? color : T.border2}`,
      borderLeft: `4px solid ${color}`, borderRadius: 12,
      padding: '10px 12px', boxShadow: selected ? `0 0 0 3px ${color}33` : '0 6px 18px -10px rgba(0,0,0,0.7)',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: color, width: 10, height: 10, border: '2px solid #14110e' }} />
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color, marginBottom: 4, textTransform: 'uppercase' }}>{kind}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.3, fontFamily: isTool ? T.mono : T.sans, wordBreak: 'break-word' }}>
        {data.name || '(unnamed)'}
      </div>
      {data.description && (
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.4, maxHeight: 44, overflow: 'hidden' }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, width: 10, height: 10, border: '2px solid #14110e' }} />
    </div>
  )
}
