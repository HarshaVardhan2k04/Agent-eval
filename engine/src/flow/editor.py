"""FlowEditor — a helper Gemma that edits an existing flow graph via operations.

Instead of regenerating the whole graph (which a small model tends to mangle), the
model emits a list of ops that we apply DETERMINISTICALLY to the current graph.
This is the MCP-style capability: add/update/delete nodes, add/delete/relabel edges,
merge branches — precise, and it never touches nodes the instruction didn't mention.
"""
from __future__ import annotations

from src.config import DEFAULT_JUDGE_MAX_TOKENS
from src.llm.client import LLMClient

SYSTEM = """You edit a phone-agent conversation-flow graph by emitting a list of OPERATIONS. \
Output ONLY JSON of the form {"ops":[...]}. NEVER rewrite the whole graph — emit only the ops \
needed for the instruction. Node "type" is a FREEFORM string (start, stage, branch, tool, end, \
or any custom word the user wants). Reference existing nodes by their exact id.

Allowed ops:
- {"op":"add_node","id":"<optional>","type":"stage","name":"...","description":"..."}
- {"op":"update_node","id":"<existing>","type":"...","name":"...","description":"..."}
- {"op":"delete_node","id":"<existing>"}      (also removes its edges)
- {"op":"add_edge","from":"<id>","to":"<id>","label":"Yes"}
- {"op":"delete_edge","from":"<id>","to":"<id>"}
- {"op":"update_edge","from":"<id>","to":"<id>","label":"No"}
For a new node you may supply an id or omit it (one will be assigned). Labels are the branch \
conditions (e.g. Yes / No / "angry customer")."""

USER = """CURRENT FLOW
NODES:
{nodes_block}
EDGES:
{edges_block}

INSTRUCTION: {instruction}

Return {{"ops":[...]}} with only the operations needed."""

_VALID_OPS = {"add_node", "update_node", "delete_node", "add_edge", "delete_edge", "update_edge"}


def _fmt_graph(graph: dict) -> tuple[str, str]:
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    nblock = "\n".join(
        f'- id={n.get("id")} type={n.get("type")} name="{str(n.get("name",""))[:60]}"'
        for n in nodes
    ) or "(none)"
    eblock = "\n".join(
        f'- {e.get("from")} -> {e.get("to")}' + (f'  [{e["label"]}]' if e.get("label") else "")
        for e in edges
    ) or "(none)"
    return nblock, eblock


def _new_id(existing: set) -> str:
    i = 1
    while f"gen_{i}" in existing:
        i += 1
    nid = f"gen_{i}"
    existing.add(nid)
    return nid


def _position_new_node(node_id: str, nodes_by_id: dict, edges: list) -> dict:
    """Place a new node to the right of a predecessor, else past the current max-x."""
    for e in edges:
        if e.get("to") == node_id and e.get("from") in nodes_by_id:
            p = nodes_by_id[e["from"]].get("position") or {"x": 0, "y": 0}
            return {"x": p.get("x", 0) + 260, "y": p.get("y", 0) + 40}
    max_x = max((n.get("position", {}).get("x", 0) for n in nodes_by_id.values()), default=-260)
    return {"x": max_x + 260, "y": 0}


def apply_ops(graph: dict, ops: list) -> tuple[dict, list]:
    """Apply ops to a copy of the graph. Returns (new_graph, applied_summaries)."""
    nodes = [dict(n) for n in (graph.get("nodes") or [])]
    edges = [dict(e) for e in (graph.get("edges") or [])]
    by_id = {n["id"]: n for n in nodes if n.get("id")}
    ids = set(by_id.keys())
    applied: list[str] = []

    def edge_exists(f, t):
        return any(e.get("from") == f and e.get("to") == t for e in edges)

    for op in ops:
        if not isinstance(op, dict):
            continue
        kind = op.get("op")
        if kind not in _VALID_OPS:
            continue

        if kind == "add_node":
            nid = str(op.get("id") or "").strip() or _new_id(ids)
            if nid in by_id:  # id clash → treat as update
                node = by_id[nid]
            else:
                node = {"id": nid, "type": "stage", "name": "", "description": "", "params": {}}
                nodes.append(node)
                by_id[nid] = node
                ids.add(nid)
            if op.get("type"):
                node["type"] = str(op["type"])[:40]
            if op.get("name") is not None:
                node["name"] = str(op["name"])[:120]
            if op.get("description") is not None:
                node["description"] = str(op["description"])[:400]
            node["position"] = _position_new_node(nid, by_id, edges)
            applied.append(f"added {node['type']} '{node['name'] or nid}'")

        elif kind == "update_node":
            node = by_id.get(str(op.get("id")))
            if not node:
                continue
            if op.get("type"):
                node["type"] = str(op["type"])[:40]
            if op.get("name") is not None:
                node["name"] = str(op["name"])[:120]
            if op.get("description") is not None:
                node["description"] = str(op["description"])[:400]
            applied.append(f"updated '{node.get('name') or node['id']}'")

        elif kind == "delete_node":
            nid = str(op.get("id"))
            if nid not in by_id:
                continue
            nodes[:] = [n for n in nodes if n.get("id") != nid]
            edges[:] = [e for e in edges if e.get("from") != nid and e.get("to") != nid]
            by_id.pop(nid, None)
            ids.discard(nid)
            applied.append(f"deleted node {nid}")

        elif kind == "add_edge":
            f, t = str(op.get("from")), str(op.get("to"))
            if f in by_id and t in by_id and not edge_exists(f, t):
                edges.append({"from": f, "to": t, "label": str(op.get("label", ""))[:40]})
                applied.append(f"connected {f} -> {t}" + (f" [{op['label']}]" if op.get("label") else ""))

        elif kind == "delete_edge":
            f, t = str(op.get("from")), str(op.get("to"))
            before = len(edges)
            edges[:] = [e for e in edges if not (e.get("from") == f and e.get("to") == t)]
            if len(edges) < before:
                applied.append(f"removed edge {f} -> {t}")

        elif kind == "update_edge":
            f, t = str(op.get("from")), str(op.get("to"))
            for e in edges:
                if e.get("from") == f and e.get("to") == t:
                    e["label"] = str(op.get("label", ""))[:40]
                    applied.append(f"relabelled {f} -> {t} = '{e['label']}'")
                    break

    return {"nodes": nodes, "edges": edges}, applied


class FlowEditor:
    def __init__(self, client: LLMClient | None = None):
        self.client = client or LLMClient()

    async def edit(self, graph: dict, instruction: str) -> dict:
        nblock, eblock = _fmt_graph(graph)
        prompt = USER.format(nodes_block=nblock, edges_block=eblock, instruction=instruction[:1500])
        raw = await self.client.chat_json(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=DEFAULT_JUDGE_MAX_TOKENS,
            enable_thinking=False,
        )
        ops = raw.get("ops") if isinstance(raw, dict) else None
        ops = ops if isinstance(ops, list) else []
        new_graph, applied = apply_ops(graph, ops)
        return {"nodes": new_graph["nodes"], "edges": new_graph["edges"], "applied": applied}
