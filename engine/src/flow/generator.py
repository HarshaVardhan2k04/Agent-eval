"""FlowGenerator — a Gemma instance that turns a pasted flow (JSON / Markdown /
plain text) into an editable node-and-connection graph.

Output schema (agent-eval simplified single graph — nodes + edges only):
  nodes: [{id, type, name, description, params}]   type ∈ start|stage|branch|tool|end
  edges: [{from, to, label}]                        branches use labels (Yes/No/…)
Positions are assigned here by a simple layered layout so the canvas has a shape;
the user rearranges freely afterwards.
"""
from __future__ import annotations

from src.config import DEFAULT_JUDGE_MAX_TOKENS
from src.llm.client import LLMClient

NODE_TYPES = ("start", "stage", "branch", "tool", "end")

SYSTEM = """You convert a described phone-agent conversation flow into a clean node graph. \
Output ONLY JSON. Nodes model the stages an AI voice agent should follow. Use these node types:
- "start": the call entry point (one per flow).
- "stage": a conversation phase (greeting, discovery, educate, handle objection, closing…).
- "branch": a decision with labelled outgoing paths (e.g. "Already insured?" -> Yes / No).
- "tool": a point where the agent should call a tool (name it in "name", e.g. search_knowledge_base).
- "end": the call ends or is handed off (warm close, transfer to human).
Keep it faithful to the input; don't invent unrelated steps."""

USER = """Turn this into a node graph for a {direction} call.

INPUT FLOW:
{text}

{notes_block}
Return EXACTLY this JSON shape (ids short and unique, edges reference node ids;
give branch edges a short "label" like "Yes"/"No"; other edges may omit label):
{{
  "nodes": [
    {{"id": "start", "type": "start", "name": "", "description": ""}},
    {{"id": "s1", "type": "stage", "name": "", "description": ""}}
  ],
  "edges": [
    {{"from": "start", "to": "s1", "label": ""}}
  ]
}}"""


def _layout(nodes: list[dict], edges: list[dict]) -> None:
    """Assign x/y by BFS depth from start(s). Columns = depth, rows spread siblings."""
    adj: dict[str, list[str]] = {}
    indeg: dict[str, int] = {n["id"]: 0 for n in nodes}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])
        if e["to"] in indeg:
            indeg[e["to"]] += 1

    starts = [n["id"] for n in nodes if n["type"] == "start"] or \
             [nid for nid, d in indeg.items() if d == 0] or \
             ([nodes[0]["id"]] if nodes else [])

    depth: dict[str, int] = {}
    queue = [(s, 0) for s in starts]
    seen = set()
    while queue:
        nid, d = queue.pop(0)
        if nid in seen:
            depth[nid] = max(depth.get(nid, 0), d)
            continue
        seen.add(nid)
        depth[nid] = d
        for nxt in adj.get(nid, []):
            queue.append((nxt, d + 1))

    # place unreached nodes at the end
    maxd = max(depth.values()) if depth else 0
    for n in nodes:
        depth.setdefault(n["id"], maxd + 1)

    by_depth: dict[int, list[str]] = {}
    for nid, d in depth.items():
        by_depth.setdefault(d, []).append(nid)

    pos = {}
    for d, ids in by_depth.items():
        for row, nid in enumerate(ids):
            pos[nid] = {"x": d * 260, "y": row * 130}
    for n in nodes:
        n["position"] = pos.get(n["id"], {"x": 0, "y": 0})


def _normalize(raw: dict) -> dict:
    nodes = []
    seen_ids = set()
    for n in raw.get("nodes", []):
        nid = str(n.get("id") or "").strip()
        if not nid or nid in seen_ids:
            continue
        seen_ids.add(nid)
        ntype = n.get("type") if n.get("type") in NODE_TYPES else "stage"
        nodes.append({
            "id": nid,
            "type": ntype,
            "name": str(n.get("name", ""))[:120],
            "description": str(n.get("description", ""))[:400],
            "params": n.get("params") if isinstance(n.get("params"), dict) else {},
        })
    edges = []
    for e in raw.get("edges", []):
        f, t = str(e.get("from") or ""), str(e.get("to") or "")
        if f in seen_ids and t in seen_ids:
            edges.append({"from": f, "to": t, "label": str(e.get("label", ""))[:40]})
    _layout(nodes, edges)
    return {"nodes": nodes, "edges": edges}


class FlowGenerator:
    def __init__(self, client: LLMClient | None = None):
        self.client = client or LLMClient()

    async def generate(self, text: str, notes: str = "", direction: str = "inbound") -> dict:
        # If the input is a structured conversation_flow, import it deterministically so
        # no stage is ever dropped (a small LLM is unreliable on large structured JSON).
        # Prose / markdown still goes through Gemma.
        from src.flow.importer import looks_like_flow, import_flow
        parsed = looks_like_flow(text)
        if parsed is not None:
            graph = import_flow(parsed)
            if graph["nodes"]:
                return graph

        notes_block = f"EXTRA NOTES: {notes}\n\n" if notes.strip() else ""
        prompt = USER.format(direction=direction, text=text[:6000], notes_block=notes_block)
        # Structuring task (not deep reasoning): no-think returns the JSON directly
        # and reliably — thinking would burn the token budget before emitting.
        raw = await self.client.chat_json(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=DEFAULT_JUDGE_MAX_TOKENS,
            enable_thinking=False,
        )
        return _normalize(raw)
