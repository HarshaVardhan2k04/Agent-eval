"""Faithful Python port of agent-server-dev/src/services/promptMerger.js.

Reproduces the PRODUCTION layered-prompt merge so Forge optimizes exactly the prompt
the live voice agent sees. Invariants held byte-for-byte with the Node original:
  - layer order universal -> vertical -> campaign -> triggered add-ons
  - arrays CONCATENATE (accumulate, no dedupe), objects deep-merge, scalars later-wins
  - keys prefixed "_" are metadata, never merged
  - override_keys delete a dot-path from the accumulator BEFORE that layer merges
  - greeting_message is direction-picked and DELETED (system speaks it; LLM never greets)
  - conversational_flow is sliced to ONE stage by lead_status and DELETED from the object
  - renderMarkdown is key-agnostic (titleize->heading, arrays->bullets, scalars->paragraphs)

A golden-fixture parity test (test_merge_parity) checks this against the production
merged-preview.md so drift is caught.
"""
from __future__ import annotations

import copy
import re


LAYER_ORDER = ["universal", "vertical", "campaign"]


def _is_plain_object(x) -> bool:
    return isinstance(x, dict)


def _clone(x):
    if isinstance(x, (dict, list)):
        return copy.deepcopy(x)
    return x


def deep_merge(target: dict, source) -> dict:
    """Merge `source` into `target` in place (mirrors deepMerge)."""
    if not _is_plain_object(source):
        return target
    for key in list(source.keys()):
        if key.startswith("_"):  # metadata — never merged
            continue
        sv = source[key]
        if sv is None:
            # JS treats `undefined` as skip; JSON has no undefined, so a null value
            # would pass through. Match JS: only skip genuine "no value". Keep null
            # as a real scalar override so explicit nulls behave predictably.
            if key not in target:
                target[key] = None
            else:
                target[key] = None
            continue
        if key not in target:
            target[key] = _clone(sv)
            continue
        tv = target[key]
        if isinstance(tv, list) and isinstance(sv, list):
            target[key] = tv + _clone(sv)  # accumulate
        elif _is_plain_object(tv) and _is_plain_object(sv):
            deep_merge(tv, sv)  # recurse
        elif (
            not isinstance(tv, (list, dict))
            and not isinstance(sv, (list, dict))
        ):
            target[key] = sv  # both scalars -> override
        else:
            target[key] = _clone(sv)  # type mismatch -> later wins
    return target


def merge_prompts(layers) -> dict:
    out: dict = {}
    for layer in layers or []:
        if _is_plain_object(layer):
            deep_merge(out, layer)
    return out


def delete_path(obj: dict, path: str) -> None:
    parts = [p for p in str(path).split(".") if p]
    if not parts:
        return
    cur = obj
    for p in parts[:-1]:
        if not _is_plain_object(cur.get(p)):
            return
        cur = cur[p]
    cur.pop(parts[-1], None)


def merge_layers(specs) -> dict:
    """Override-aware merge; specs ordered low->high: [{prompt, override_keys}]."""
    out: dict = {}
    for spec in specs or []:
        if not spec or not _is_plain_object(spec.get("prompt")):
            continue
        for path in spec.get("override_keys") or []:
            delete_path(out, path)
        deep_merge(out, spec["prompt"])
    return out


def select_addons(addon_layer, active_names):
    if not _is_plain_object(addon_layer):
        return []
    out = []
    for name in active_names or []:
        v = addon_layer.get(name)
        if _is_plain_object(v):
            out.append(v)
    return out


# ---- markdown render (key-agnostic) --------------------------------------

def _titleize(k: str) -> str:
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), k.replace("_", " "))


def _heading(depth: int) -> str:
    return "#" * min(max(depth, 1), 6)


def _emit_value(value, depth: int, lines: list) -> None:
    if isinstance(value, list):
        for item in value:
            if _is_plain_object(item):
                _walk(item, depth, lines)
            else:
                lines.append(f"- {item}")
    elif _is_plain_object(value):
        _walk(value, depth, lines)
    else:
        lines.append(str(value))


def _walk(obj: dict, depth: int, lines: list) -> None:
    for key in obj.keys():
        if key.startswith("_"):
            continue
        lines.append("")
        lines.append(f"{_heading(depth)} {_titleize(key)}")
        _emit_value(obj[key], depth + 1, lines)


def render_markdown(merged: dict, start_depth: int = 1) -> str:
    lines: list = []
    _walk(merged or {}, start_depth, lines)
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def extract_greeting(merged: dict, call_direction):
    g = merged.get("greeting_message") if merged else None
    if g is None:
        return None
    merged.pop("greeting_message", None)
    if isinstance(g, str):
        return g
    if _is_plain_object(g):
        inbound = g.get("inbound") or g.get("inbound_greeting_message")
        outbound = g.get("outbound") or g.get("outbound_greeting_message")
        followup = (
            g.get("followup") or g.get("follow_up")
            or g.get("follow_up_greeting_message") or g.get("followup_greeting_message")
        )
        if call_direction == "inbound":
            return inbound or outbound
        if call_direction == "followup":
            return followup or outbound
        return outbound or inbound
    return None


def select_conversational_flow(merged: dict, lead_status=None, call_direction=None) -> dict:
    flow = merged.get("conversational_flow") if merged else None
    if "conversational_flow" in (merged or {}):
        merged.pop("conversational_flow", None)

    if not _is_plain_object(flow):
        return {"section": None, "stage": None, "error": {
            "reason": "no_flow_block",
            "message": "The merged prompt has no conversational_flow block.",
            "available_stages": [], "lead_status": lead_status,
        }}

    stages = [k for k in flow.keys() if not k.startswith("_")]

    if lead_status is None or str(lead_status).strip() == "":
        return {"section": None, "stage": None, "error": {
            "reason": "missing_lead_status",
            "message": f"lead_status is missing. Available stages: {', '.join(stages)}.",
            "available_stages": stages, "lead_status": None,
        }}

    want = str(lead_status).strip().lower()
    key = next((k for k in stages if k.lower() == want), None)
    if not key:
        return {"section": None, "stage": None, "error": {
            "reason": "no_match",
            "message": f'lead_status "{lead_status}" matches no stage. Available: {", ".join(stages)}.',
            "available_stages": stages, "lead_status": lead_status,
        }}

    dir_ = str(call_direction or "outbound")
    article = "an" if re.match(r"^[aeiou]", dir_, re.I) else "a"
    stage_md = render_markdown(flow[key], 2).strip()
    section = "\n".join([
        "# Conversational Flow",
        "",
        f'This is {article} {dir_} call. The lead is currently in the "{key}" stage — follow this flow:',
        "",
        stage_md,
    ])
    return {"section": section, "stage": key, "error": None}


def assemble_prompt(rows, active_addons=None, call_direction=None, lead_status=None) -> dict:
    """Faithful assemblePrompt. Returns {merged, markdown, greeting, flowStage, flowError}.

    NOTE `merged` here is POST-deletion (greeting + conversational_flow removed), exactly
    like production. For scoring, use assemble_for_forge() which also returns a pre-deletion
    copy so the reused analysis/parsing.py can still see conversational_flow + KB.
    """
    active_addons = active_addons or []
    by_type: dict = {}
    for r in rows or []:
        if not r:
            continue
        by_type.setdefault(r["prompt_type"], []).append(r)
    specs = []
    for t in LAYER_ORDER:
        for r in by_type.get(t, []):
            specs.append({"prompt": r.get("prompt"), "override_keys": r.get("override_keys") or []})
    for a in active_addons:
        specs.append({"prompt": a, "override_keys": []})

    merged = merge_layers(specs)
    greeting = extract_greeting(merged, call_direction)
    flow = select_conversational_flow(merged, lead_status=lead_status, call_direction=call_direction)

    markdown = render_markdown(merged)
    if flow["section"]:
        markdown += "\n\n" + flow["section"] + "\n"

    return {
        "merged": merged,
        "markdown": markdown,
        "greeting": greeting,
        "flowStage": flow["stage"],
        "flowError": flow["error"],
    }


def assemble_for_forge(rows, active_addons=None, call_direction=None, lead_status=None) -> dict:
    """Forge wrapper: same as assemble_prompt but ALSO returns `merged_full` — a copy of
    the merged structured object taken BEFORE greeting/conversational_flow are stripped —
    so the reused CallEvaluator/parsing.py can extract flow stages + KB + guidelines for
    scoring, while `markdown` remains exactly what the live voice agent is given.
    """
    active_addons = active_addons or []
    by_type: dict = {}
    for r in rows or []:
        if not r:
            continue
        by_type.setdefault(r["prompt_type"], []).append(r)
    specs = []
    for t in LAYER_ORDER:
        for r in by_type.get(t, []):
            specs.append({"prompt": r.get("prompt"), "override_keys": r.get("override_keys") or []})
    for a in active_addons:
        specs.append({"prompt": a, "override_keys": []})

    merged = merge_layers(specs)
    merged_full = copy.deepcopy(merged)  # pre-deletion: still has greeting_message + conversational_flow
    greeting = extract_greeting(merged, call_direction)
    flow = select_conversational_flow(merged, lead_status=lead_status, call_direction=call_direction)
    markdown = render_markdown(merged)
    if flow["section"]:
        markdown += "\n\n" + flow["section"] + "\n"

    return {
        "merged": merged,
        "merged_full": merged_full,
        "markdown": markdown,
        "greeting": greeting,
        "flow_stage": flow["stage"],
        "flow_error": flow["error"],
    }
