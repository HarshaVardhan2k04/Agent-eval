"""Direction x lead_status coverage for a Forge run.

A run used to be pinned to ONE (direction, lead_status) pair, so it only ever tested
one greeting and one sliced conversational_flow stage. This module expands a run to
every direction x lead_status cell that can actually occur on a real call.

Design decisions (confirmed with the user — see docs/FORGE_COMBO_MATRIX.md):
  - stages are DYNAMIC (read off the merged conversational_flow), never a hardcoded enum
  - the direction x stage grid follows the voice-agent team's rule (stages_for_direction):
    inbound = all stages, outbound = fresh only, followup = everything except fresh
  - every dataset persona is replayed in EVERY combo
  - a hard ceiling of MAX_CONVERSATIONS caps the run; personas are reduced to fit and
    the drop is reported, never silently truncated
  - a combo the prompt cannot serve HALTS the whole run and escalates to the human
"""
from __future__ import annotations

import hashlib

from src.forge import merge as fmerge

DIRECTIONS = ("outbound", "inbound", "followup")

# Which lead_status stages each direction is actually allowed to be in. This is a
# BUSINESS rule from the voice-agent team, not an inference from the prompt:
#   inbound  — anyone can call in at any point in their journey, so ALL stages.
#   outbound — a cold outbound dial is by definition a lead nobody has spoken to yet,
#              so ONLY `fresh`.
#   followup — a follow-up only exists because a previous call happened, so EVERY stage
#              EXCEPT `fresh`.
FRESH = "fresh"


def stages_for_direction(direction, stages):
    if direction == "inbound":
        return list(stages)
    if direction == "outbound":
        return [s for s in stages if str(s).strip().lower() == FRESH]
    if direction == "followup":
        return [s for s in stages if str(s).strip().lower() != FRESH]
    return list(stages)

# Hard ceiling on conversations per run (personas x combos).
MAX_CONVERSATIONS = 200


# ---- stage discovery --------------------------------------------------------

def merged_object(mode, champion):
    """The merged structured prompt, BEFORE greeting/flow are stripped."""
    if mode == "layered":
        rows = []
        for lt in ("universal", "vertical", "campaign"):
            layer = (champion.get("layers") or {}).get(lt)
            if not layer:
                continue
            oks = (champion.get("override_keys") or {}).get(lt, [])
            # a layer may be a LIST of prompt rows — production allows N rows per type
            for one in (layer if isinstance(layer, list) else [layer]):
                if one:
                    rows.append({"prompt_type": lt, "prompt": one, "override_keys": oks})
        addons = (champion.get("layers") or {}).get("addon") or []
        specs = [{"prompt": r["prompt"], "override_keys": r["override_keys"]} for r in rows]
        specs += [{"prompt": a, "override_keys": []} for a in addons]
        return fmerge.merge_layers(specs)
    blob = champion.get("blob")
    return blob if isinstance(blob, dict) else {}


def discover_stages(merged):
    """Stage keys of conversational_flow, in authored order, `_`-keys excluded."""
    flow = (merged or {}).get("conversational_flow")
    if not isinstance(flow, dict):
        return []
    return [k for k in fmerge.js_keys(flow) if not k.startswith("_")]


def _greeting_for(merged, direction):
    """Does the prompt define a greeting for this direction WITHOUT falling back?

    extract_greeting() deliberately falls back to outbound (that is production's
    behaviour). Here we need to know whether the fallback was USED, because a silent
    fallback is exactly the config gap the human must rule on.
    """
    g = (merged or {}).get("greeting_message")
    if g is None:
        return None, "no_greeting_message"
    if isinstance(g, str):
        # one greeting for every direction — legitimate, no gap
        return g, None
    if not isinstance(g, dict):
        return None, "greeting_message_not_object_or_string"
    direct = {
        "inbound": g.get("inbound") or g.get("inbound_greeting_message"),
        "outbound": g.get("outbound") or g.get("outbound_greeting_message"),
        "followup": (g.get("followup") or g.get("follow_up")
                     or g.get("follow_up_greeting_message") or g.get("followup_greeting_message")),
    }.get(direction)
    if direct:
        return direct, None
    return None, f"no_{direction}_greeting"


# ---- combo matrix -----------------------------------------------------------

def build_matrix(mode, champion, directions=DIRECTIONS, default_direction="outbound",
                 default_lead_status=None):
    """The direction x lead_status grid, with a servability verdict per combo.

    Returns {"stages": [...], "combos": [...], "blocked": [...]} where each combo is
    {direction, lead_status, key, servable, gap, detail}.
    """
    merged = merged_object(mode, champion)
    stages = discover_stages(merged)

    # A prompt with NEITHER a greeting_message NOR a conversational_flow has no
    # direction/stage structure to sweep — that is the normal shape of a standalone blob,
    # not a config gap. Sweeping it would flag every combo as unservable and halt every
    # standalone run. Test it once, as configured.
    if "greeting_message" not in (merged or {}) and not stages:
        c = {"direction": default_direction, "lead_status": default_lead_status,
             "key": (f"{default_direction}·{default_lead_status}" if default_lead_status
                     else default_direction),
             "servable": True, "gap": None, "detail": None, "unstructured": True}
        return {"stages": [], "combos": [c], "blocked": []}

    combos, blocked = [], []
    if not stages:
        # No conversational_flow at all: the prompt is stage-less. That is a single
        # implicit stage, not a gap — production renders no flow section either.
        stages = [None]

    for direction in directions:
        _, gap = _greeting_for(merged, direction)
        allowed = stages_for_direction(direction, stages) if stages != [None] else [None]
        if not allowed:
            # e.g. outbound with no `fresh` stage defined — the prompt cannot express a
            # cold dial at all. That is a real hole, so it goes to the human, not silence.
            blocked.append({
                "direction": direction, "lead_status": None, "key": direction,
                "servable": False, "gap": f"no_stage_for_{direction}",
                "detail": (f"`{direction}` is only valid for "
                           + ("the `fresh` stage" if direction == "outbound"
                              else "stages other than `fresh`")
                           + f", and this prompt defines none. Stages found: "
                           + (", ".join(str(x) for x in stages) or "none") + "."),
            })
            continue
        for stage in allowed:
            c = {
                "direction": direction,
                "lead_status": stage,
                "key": f"{direction}·{stage}" if stage else direction,
                "servable": gap is None,
                "gap": gap,
                "detail": None,
            }
            if gap == "no_greeting_message":
                c["detail"] = "The merged prompt has no greeting_message at all."
            elif gap and gap.startswith("no_"):
                c["detail"] = (f"The campaign prompt has no `{direction}` greeting. "
                               f"Production would fall back to the outbound greeting.")
            elif gap:
                c["detail"] = f"greeting_message is malformed: {gap}."
            combos.append(c)
            if not c["servable"]:
                blocked.append(c)

    return {"stages": [s for s in stages if s], "combos": combos, "blocked": blocked}


def apply_resolutions(matrix, resolutions):
    """Fold the human's answers back in.

    resolutions: {combo_key: {"action": "content"|"fallback"|"skip", "text": str}}
      content  -> the human wrote the missing greeting; combo becomes servable and the
                  text is carried on the combo so the prompt is written PROPERLY.
      fallback -> explicitly accept production's outbound fallback; combo is servable.
      skip     -> combo is dropped from the run and does not count against the gate.
    """
    resolutions = resolutions or {}
    out, still_blocked = [], []
    for c in matrix["combos"]:
        if c["servable"]:
            out.append(c)
            continue
        r = resolutions.get(c["key"]) or {}
        action = r.get("action")
        if action == "skip":
            c["skipped"] = True
            c["resolution"] = "skip"
            continue
        if action == "fallback":
            c["servable"] = True
            c["resolution"] = "fallback"
            out.append(c)
            continue
        if action == "content" and (r.get("text") or "").strip():
            c["servable"] = True
            c["resolution"] = "content"
            c["greeting_override"] = r["text"].strip()
            out.append(c)
            continue
        still_blocked.append(c)
    return {"combos": out, "blocked": still_blocked}


# ---- persona allocation -----------------------------------------------------

def plan(n_personas, n_combos, cap=MAX_CONVERSATIONS):
    """Every persona is replayed in every combo, under a hard conversation ceiling.

    Returns {"per_combo": k, "total": k*n_combos, "dropped": n_personas-k, "capped": bool}.
    """
    n_personas = max(int(n_personas or 0), 0)
    n_combos = max(int(n_combos or 0), 0)
    if not n_personas or not n_combos:
        return {"per_combo": 0, "total": 0, "dropped": 0, "capped": False, "cap": cap}
    per_combo = min(n_personas, max(cap // n_combos, 1))
    return {
        "per_combo": per_combo,
        "total": per_combo * n_combos,
        "dropped": n_personas - per_combo,
        "capped": per_combo < n_personas,
        "cap": cap,
    }


# ---- synthesized lead context ----------------------------------------------

# Deterministic, so the same persona always gets the same name — a run is reproducible
# and a diff between two runs is never noise from a random name.
_NAME_POOL = (
    "Ravi Kumar", "Priya Sharma", "Anil Reddy", "Sneha Patel", "Vikram Nair",
    "Divya Rao", "Arjun Menon", "Kavya Iyer", "Rahul Verma", "Meera Joshi",
    "Suresh Babu", "Anjali Gupta", "Karthik Raj", "Pooja Singh", "Manoj Desai",
    "Lakshmi Prasad", "Rohit Malhotra", "Swathi Reddy", "Imran Khan", "Neha Bansal",
)

_FOLLOWUP_REASONS = {
    "fresh": "could not be reached on the first attempt",
    "contacted": "asked for pricing details on the last call",
    "interested": "asked to schedule a site visit",
    "callback": "asked us to call back at this time",
    "not_interested": "raised a budget concern; checking back once",
    "follow_up": "continuing the previous conversation",
}


def lead_profile(probe, direction, lead_status):
    """Synthesize the per-combo lead context.

    The persona itself is PII-scrubbed and carries no name, but production ALWAYS tells
    the agent the customer's name (transcript.py LEAD INFORMATION) and substitutes it
    into the greeting. Without one, Forge tests a prompt production never sends.
    An explicit `lead_name` on the probe always wins.
    """
    probe = probe or {}
    name = (probe.get("lead_name") or probe.get("name") or "").strip()
    if not name:
        seed = str(probe.get("id") or probe.get("persona") or "")
        h = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16)
        name = _NAME_POOL[h % len(_NAME_POOL)]
    out = {"name": name, "direction": direction, "lead_status": lead_status}
    if direction == "followup":
        key = str(lead_status or "").strip().lower()
        out["followup_reason"] = (probe.get("followup_reason")
                                  or _FOLLOWUP_REASONS.get(key)
                                  or "continuing the previous conversation")
    return out


def substitute_name(greeting, name):
    """Production replaces <name> in the greeting before the agent speaks it
    (telephonyDispatchService.js). Without this every sim opens with a literal '<name>'."""
    if not greeting:
        return greeting
    return greeting.replace("<name>", name or "")
