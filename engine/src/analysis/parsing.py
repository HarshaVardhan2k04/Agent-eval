"""Parse the production transcript + editable_config into judge-ready pieces.

Transcript is a single line with inline Agent:/User:/Supervisor: labels (no
per-turn timestamps). editable_config may arrive as a dict or a JSON string.
"""
from __future__ import annotations

import json
import re

ROLE_RE = re.compile(r"\b(Agent|User|Supervisor):\s*")


def parse_turns(transcript: str) -> list[dict]:
    """Split the label-prefixed transcript string into ordered role/text turns."""
    if not transcript:
        return []
    parts = ROLE_RE.split(transcript)
    turns: list[dict] = []
    i = 1
    while i < len(parts):
        role = parts[i]
        text = parts[i + 1] if i + 1 < len(parts) else ""
        text = text.strip()
        if text:
            turns.append({"role": role, "text": text})
        i += 2
    return turns


def user_word_count(turns: list[dict]) -> int:
    return sum(len(t["text"].split()) for t in turns if t["role"] == "User")


def coerce_config(editable_config) -> dict:
    if isinstance(editable_config, str):
        try:
            parsed = json.loads(editable_config)
        except (json.JSONDecodeError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return editable_config if isinstance(editable_config, dict) else {}


# Keys that mean "this sub-object is a direction branch" rather than a stage.
_DIRECTION_KEYS = {"inbound", "outbound", "follow_up", "followup"}
# Sibling keys that appear alongside stages but are NOT stages (from real agent_db data).
_NON_STAGE_KEYS = {
    "flow_principles", "flowprinciples", "principles", "principle", "core_principle",
    "control_rule", "branching", "type", "agent_name", "campaign_scope", "name",
}


def _find_conversation_flow(config: dict):
    """Locate the conversation-flow object wherever it lives (dict OR list)."""
    gp = config.get("guiding_prompt") or {}
    for container in (gp, config):
        if not isinstance(container, dict):
            continue
        for key in ("conversation_flow", "conversationFlow", "flow", "stages", "conversation_stages"):
            val = container.get(key)
            if isinstance(val, (dict, list)) and val:
                return val
    return {}


def _stages_from(obj) -> list[dict]:
    """Turn a stage container (dict of stages OR list of stages) into [{stage, guidance}]."""
    stages: list[dict] = []
    if isinstance(obj, dict):
        for name, guidance in obj.items():
            if str(name).replace("-", "_").lower() in _NON_STAGE_KEYS:
                continue
            stages.append({"stage": str(name), "guidance": _stage_guidance(guidance)})
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if isinstance(item, dict):
                name = item.get("stage") or item.get("name") or item.get("id") or f"stage_{i + 1}"
                stages.append({"stage": str(name), "guidance": _stage_guidance(item)})
            else:
                stages.append({"stage": f"stage_{i + 1}", "guidance": str(item)})
    return stages


def _stage_guidance(guidance) -> str:
    if isinstance(guidance, (str, int, float, bool)):
        return str(guidance)
    if isinstance(guidance, dict):
        for k in ("description", "goal", "instruction", "text", "guidance"):
            if isinstance(guidance.get(k), str):
                return guidance[k]
        import json as _json
        return _json.dumps(guidance, ensure_ascii=False)[:300]
    if isinstance(guidance, list):
        return " ".join(str(x) for x in guidance)[:300]
    return str(guidance)


def flow_stages(config: dict, direction: str) -> list[dict]:
    """Ordered [{stage, guidance}] intended for this call.

    Structure-agnostic — the conversation flow may be:
      (A) keyed by direction: {inbound:{...}, outbound:{...}, follow_up:{...}}
      (B) a flat map of lead / status stages: {stage_1:..., stage_2:...}
      (C) a list of stages: ["greeting", {stage:"close", ...}]
    We never require a particular shape; if we can't find stages we return [] and
    the judge scores conversation management generally.
    """
    cf = _find_conversation_flow(config)
    if not cf:
        return []

    # (C) top-level list of stages.
    if isinstance(cf, list):
        return _stages_from(cf)

    norm = (direction or "").replace("-", "_").lower()
    branch = None

    # (A) direction-keyed: pick this direction's sub-object (normalizing follow-up spellings).
    for k, v in cf.items():
        if isinstance(v, (dict, list)) and k.replace("-", "_").lower() == norm:
            branch = v
            break

    if branch is None:
        top_keys = {k.replace("-", "_").lower() for k in cf}
        if top_keys & _DIRECTION_KEYS:
            # It IS direction-keyed but this direction is absent → no stages to compare.
            return []
        # (B) flat stage map → use the whole object as the stage list.
        branch = cf

    return _stages_from(branch)


def behavioral_guidelines(config: dict) -> list[str]:
    ad = config.get("agent_details") or {}
    g = ad.get("behavioral_guidelines") or []
    return g if isinstance(g, list) else [str(g)]


def knowledge_base_facts(config: dict, limit: int = 20) -> list[str]:
    """Extract discrete KB facts the agent's speech should stay consistent with.

    Looks in agent_details.knowledge_base (string / list / dict — shape varies).
    Returns [] when there's no KB to check against (factual grounding then n/a).
    """
    ad = config.get("agent_details") or {}
    kb = ad.get("knowledge_base") or ad.get("knowledgeBase") or config.get("knowledge_base")
    facts: list[str] = []
    if isinstance(kb, str) and kb.strip():
        parts = [p.strip() for p in kb.splitlines() if p.strip()]
        if len(parts) <= 1:  # one blob -> split into sentences
            parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", kb) if p.strip()]
        facts = [p for p in parts if len(p) > 8]
    elif isinstance(kb, list):
        for item in kb:
            if isinstance(item, str) and item.strip():
                facts.append(item.strip())
            elif isinstance(item, dict):
                facts.append(_stage_guidance(item))
    elif isinstance(kb, dict):
        for k, v in kb.items():
            facts.append(f"{k}: {_stage_guidance(v)}")
    return [f for f in facts if f][:limit]


def transcript_as_lines(turns: list[dict]) -> str:
    """Re-render turns one-per-line for the judge (clearer than the packed string)."""
    return "\n".join(f"{t['role']}: {t['text']}" for t in turns)
