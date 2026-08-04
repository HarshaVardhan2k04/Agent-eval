"""Deterministic importer: a structured conversation_flow -> a faithful node graph.

Real agent flows (agent_db.agents.editable_config.guiding_prompt.conversation_flow)
come in 3 shapes — direction-keyed, flat phase/stage map, and hybrid — with stage
values that may be strings, objects, or lists, at varying nesting depth, mixed with
non-stage sibling keys, in multiple languages.

A small LLM regularly drops stages on inputs this size, so structured input is
imported DETERMINISTICALLY here (every stage becomes a node, order + direction lanes
preserved). Free prose still goes through the Gemma generator. This is the path that
makes Flow Builder production-correct against the real DB.
"""
from __future__ import annotations

import json
import re

from src.analysis.parsing import _DIRECTION_KEYS, _NON_STAGE_KEYS, _stage_guidance
from src.flow.generator import _layout, NODE_TYPES

_END_WORDS = ("close", "end", "goodbye", "hangup", "hang_up", "wrap", "farewell", "disconnect")
_TOOL_WORDS = ("search", "lookup", "calculate", "whatsapp", "transfer", "knowledge_base", "web_search", "tool", "escalat")
_BRANCH_WORDS = ("branch", "decision", "qualify", "route", "check_", "_check", "condition")


def looks_like_flow(text: str):
    """If `text` is JSON that contains a conversation flow, return the parsed object."""
    t = (text or "").strip()
    if not (t.startswith("{") or t.startswith("[")):
        return None
    try:
        data = json.loads(t)
    except (json.JSONDecodeError, TypeError):
        return None
    return data if _locate_cf(data) else None


def _locate_cf(obj):
    """Find the conversation_flow object inside editable_config / guiding_prompt / itself."""
    if not isinstance(obj, dict):
        return None
    # direct
    for key in ("conversation_flow", "conversationFlow", "conversation_stages", "stages", "flow"):
        v = obj.get(key)
        if isinstance(v, (dict, list)) and v:
            return v
    # under guiding_prompt
    gp = obj.get("guiding_prompt")
    if isinstance(gp, dict):
        for key in ("conversation_flow", "conversationFlow", "stages", "flow"):
            v = gp.get(key)
            if isinstance(v, (dict, list)) and v:
                return v
    # the object may itself already BE a conversation_flow (a stage/direction map)
    if isinstance(obj, dict) and obj:
        keys = {str(k).replace("-", "_").lower() for k in obj}
        if keys & _DIRECTION_KEYS or any(re.match(r"(stage|phase|s)\d", str(k).lower()) for k in obj):
            return obj
    return None


def _infer_type(name: str, first: bool) -> str:
    n = str(name).lower()
    if any(w in n for w in _END_WORDS):
        return "end"
    if any(w in n for w in _TOOL_WORDS):
        return "tool"
    if "?" in name or any(w in n for w in _BRANCH_WORDS):
        return "branch"
    return "stage"


def _flatten_stages(container, prefix: str = "") -> list[dict]:
    """Ordered [{name, guidance, type}] from a dict/list stage container, recursing
    one level into nested stage-maps and summarizing sub-flow objects."""
    out: list[dict] = []
    items = container.items() if isinstance(container, dict) else enumerate(container)
    for key, val in items:
        name = f"{prefix}{key}" if isinstance(container, dict) else f"{prefix}step_{key + 1}"
        if isinstance(container, dict) and str(key).replace("-", "_").lower() in _NON_STAGE_KEYS:
            continue
        if isinstance(val, dict):
            # nested stage map? (its keys look like stages) -> recurse
            subkeys = [str(k).lower() for k in val]
            if any(re.match(r"(stage|phase|s|step)\d", k) or k in _DIRECTION_KEYS for k in subkeys):
                out.extend(_flatten_stages(val, prefix=f"{name}."))
            else:
                # a stage object with fields (goal/instructions/steps/...) -> one node
                out.append({"name": str(name), "guidance": _stage_guidance(val),
                            "type": _infer_type(name, False)})
        elif isinstance(val, list):
            out.append({"name": str(name), "guidance": _stage_guidance(val),
                        "type": _infer_type(name, False)})
        else:
            out.append({"name": str(name), "guidance": str(val)[:500],
                        "type": _infer_type(name, False)})
    return out


def _lanes(cf) -> list[tuple[str, list[dict]]]:
    """Split a conversation_flow into (lane_name, stages) — one lane per direction,
    plus a lane for any flat stage siblings (hybrid), or a single lane if flat."""
    if isinstance(cf, list):
        return [("flow", _flatten_stages(cf))]
    if not isinstance(cf, dict):
        return []

    lanes: list[tuple[str, list[dict]]] = []
    flat_siblings: dict = {}
    for k, v in cf.items():
        if str(k).replace("-", "_").lower() in _DIRECTION_KEYS and isinstance(v, (dict, list)) and v:
            lanes.append((str(k), _flatten_stages(v)))
        else:
            flat_siblings[k] = v

    flat_stages = _flatten_stages(flat_siblings) if flat_siblings else []
    if flat_stages:
        lanes.append(("flow" if not lanes else "shared", flat_stages))
    if not lanes:
        lanes.append(("flow", _flatten_stages(cf)))
    return lanes


def _slug(s: str, used: set) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")[:40] or "n"
    nid = base
    i = 2
    while nid in used:
        nid = f"{base}_{i}"
        i += 1
    used.add(nid)
    return nid


def import_flow(obj) -> dict:
    """Structured conversation_flow / editable_config -> {nodes, edges} graph."""
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except (json.JSONDecodeError, TypeError):
            return {"nodes": [], "edges": []}
    cf = _locate_cf(obj)
    if not cf:
        return {"nodes": [], "edges": []}

    nodes: list[dict] = []
    edges: list[dict] = []
    used: set = set()

    for lane_name, stages in _lanes(cf):
        if not stages:
            continue
        start_id = _slug(f"start_{lane_name}", used)
        nodes.append({"id": start_id, "type": "start",
                      "name": lane_name.replace("_", " ").title(), "description": "", "params": {}})
        prev = start_id
        for i, st in enumerate(stages):
            nid = _slug(st["name"], used)
            ntype = st.get("type") or _infer_type(st["name"], i == 0)
            nodes.append({"id": nid, "type": ntype, "name": st["name"],
                          "description": st["guidance"], "params": {}})
            edges.append({"from": prev, "to": nid, "label": ""})
            prev = nid

    _layout(nodes, edges)
    # keep only valid node types recognized downstream (freeform still allowed in UI,
    # but the importer only emits the known set)
    for n in nodes:
        if n["type"] not in NODE_TYPES:
            n["type"] = "stage"
    return {"nodes": nodes, "edges": edges}
