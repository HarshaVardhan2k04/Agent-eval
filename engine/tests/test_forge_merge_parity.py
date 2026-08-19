"""Golden-file parity: our Python port (src/forge/merge.py) must produce byte-identical
output to the PRODUCTION Node merger (agent-server-dev/src/services/promptMerger.js).

This is a permanent drift guard (per design Revision 2, Fix 5). It generates the reference
by running the production merger via node on the real lab fixtures, then compares. It skips
gracefully when the production repo / node are not available (e.g. CI without that checkout).

Run: python3 -m pytest engine/tests/test_forge_merge_parity.py -q   (from repo root)
"""
import json
import os
import subprocess
import sys

import pytest

ENGINE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ENGINE)

LAB = "/home/celume/Documents/projects/engage_dev_environment/agent-server-dev/prompt_lab"

pytestmark = pytest.mark.skipif(
    not os.path.isdir(LAB) or not os.path.exists(os.path.join(LAB, "build_prompt.js")),
    reason="production agent-server-dev/prompt_lab fixtures not available",
)


def _load(f):
    with open(os.path.join(LAB, f)) as fh:
        return json.load(fh)


def _rows_and_addons():
    rows = [
        {"prompt_type": "universal", "prompt": _load("universal.json"), "override_keys": []},
        {"prompt_type": "vertical", "prompt": _load("vertical.json"), "override_keys": []},
        {"prompt_type": "campaign", "prompt": _load("campaign.json"), "override_keys": []},
    ]
    addon = _load("addon.json")
    addons = [addon[k] for k in addon if not k.startswith("_")]
    return rows, addons


@pytest.mark.parametrize("direction,status", [("outbound", "fresh"), ("inbound", "interested")])
def test_python_merge_matches_production(direction, status):
    # Reference: the REAL production merger via node.
    node = subprocess.run(["node", "build_prompt.js", direction, status], cwd=LAB,
                          capture_output=True, text=True)
    ref_path = os.path.join(LAB, f".build_{direction}_{status}.json")
    if node.returncode != 0 or not os.path.exists(ref_path):
        pytest.skip(f"node build_prompt.js unavailable: {node.stderr[:200]}")
    with open(ref_path) as fh:
        ref = json.load(fh)

    from src.forge.merge import assemble_prompt

    rows, addons = _rows_and_addons()
    res = assemble_prompt(rows, addons, call_direction=direction, lead_status=status)

    assert res["markdown"] == ref["markdown"], "merged markdown drifted from production merger"
    assert res["greeting"] == ref["greeting"]
    assert res["flowStage"] == ref["flowStage"]


def test_merge_invariants():
    """Unit-level checks of the core invariants on a tiny fixture (no node needed)."""
    from src.forge.merge import assemble_for_forge

    rows = [
        {"prompt_type": "universal", "prompt": {"rules": {"a": ["u1"]}, "greeting_message": "hi"}, "override_keys": []},
        {"prompt_type": "vertical", "prompt": {"rules": {"a": ["v1"], "b": "x"}}, "override_keys": []},
        {"prompt_type": "campaign", "prompt": {
            "rules": {"b": "y"},
            "conversational_flow": {"fresh": {"goal": "book"}, "interested": {"goal": "close"}},
        }, "override_keys": []},
    ]
    r = assemble_for_forge(rows, [], call_direction="outbound", lead_status="fresh")
    # arrays concatenate across layers
    assert r["merged"]["rules"]["a"] == ["u1", "v1"]
    # scalars: later layer (campaign) wins
    assert r["merged"]["rules"]["b"] == "y"
    # greeting extracted + stripped from the render target
    assert r["greeting"] == "hi"
    assert "greeting_message" not in r["merged"]
    # conversational_flow sliced to lead_status and stripped from merged, rendered in markdown
    assert r["flow_stage"] == "fresh"
    assert "conversational_flow" not in r["merged"]
    assert "Conversational Flow" in r["markdown"]
    assert "close" not in r["markdown"]  # the non-selected 'interested' stage must not render
    # merged_full retains structure for scoring
    assert "conversational_flow" in r["merged_full"]


def test_override_keys_replace_not_accumulate():
    from src.forge.merge import merge_layers

    out = merge_layers([
        {"prompt": {"rules": {"core": ["a", "b"]}}, "override_keys": []},
        {"prompt": {"rules": {"core": ["c"]}}, "override_keys": ["rules.core"]},
    ])
    assert out["rules"]["core"] == ["c"]  # replaced, not concatenated
