"""Tool-call parser + verifier.

Production path: the model emits NATIVE OpenAI tool_calls because vLLM runs with
`--tool-call-parser gemma4`, which converts Gemma's own `<|tool_call>...` text into
structured calls server-side. When that conversion fails — wrong parser, a
truncated stream, or the model simply *narrating* the call — the intent shows up as
TEXT in the reply and nothing executes. In production the plugin strips that text
before TTS, so the caller hears a clean goodbye while the call never actually hangs
up. For evaluation the opposite is required: recover the leak, name it, and count it
against the model.

This module therefore does two jobs:
  1. normalize NATIVE calls (with LiveKit's argument-repair behaviour)
  2. RECOVER leaked calls from the spoken text, in the three shapes we have observed
Both are classified so the scorer and the UI can tell apart "called it correctly",
"called something that does not exist", and "said the tool name instead of calling it".
"""
from __future__ import annotations

import json
import re

from src.tools.definitions import TOOL_DEFINITIONS
from src.tools.simulator import parse_arguments

# 1) Gemma's own format, e.g.  <|tool_call>call:get_weather{city:<|"|>Hyderabad<|"|>}<tool_call|>
_XML_LEAK_RE = re.compile(
    r"<\|?tool_call\|?>\s*(?:call:)?\s*(?P<name>[a-z_][a-z0-9_]*)\s*"
    r"(?P<args>\{.*?\})?\s*<\/?\|?tool_call\|?>",
    re.IGNORECASE | re.DOTALL,
)
# 2) a JSON blob typed into the reply
_JSON_LEAK_RE = re.compile(
    r"\{[^{}]*?\"(?:name|tool|function)\"\s*:\s*\"(?P<name>[a-z_][a-z0-9_]*)\"[^{}]*?\}",
    re.IGNORECASE | re.DOTALL,
)
# 3) function-call-ish text, e.g.  end_call{"message": "bye"}  or  end_call()
_CALLISH_RE = re.compile(
    r"\b(?P<name>[a-z_][a-z0-9_]{3,})\s*(?P<args>\{[^{}]*\}|\(\s*\))",
)

VALID = "ok"
UNKNOWN_TOOL = "unknown_tool"
BAD_ARGS = "bad_args"
LEAKED = "leaked"


def known_tools():
    return set(TOOL_DEFINITIONS.keys())


def normalize_native(tool_calls):
    """SDK tool_calls -> [{name, args, args_parsed, source:'native'}]."""
    out = []
    for tc in tool_calls or []:
        fn = getattr(tc, "function", None)
        if fn is None:
            continue
        raw = fn.arguments or "{}"
        out.append({
            "name": fn.function.name if hasattr(fn, "function") else fn.name,
            "args": raw,
            "args_parsed": parse_arguments(raw),
            "source": "native",
        })
    return out


def find_leaks(text, tool_names=None):
    """Recover tool calls the model TYPED instead of calling.

    Returns [{name, args, args_parsed, source, snippet}] — source is
    'xml' | 'json' | 'callish' | 'bare' in decreasing order of confidence.
    """
    text = text or ""
    if not text.strip():
        return []
    names = set(tool_names or known_tools())
    found, seen_spans = [], []

    def _add(name, args_raw, source, span, snippet):
        if name not in names:
            return
        if any(s <= span[0] < e for s, e in seen_spans):
            return
        seen_spans.append(span)
        found.append({"name": name, "args": args_raw or "{}",
                      "args_parsed": parse_arguments(args_raw or "{}"),
                      "source": source, "snippet": snippet[:160]})

    for m in _XML_LEAK_RE.finditer(text):
        _add(m.group("name"), m.group("args"), "xml", m.span(), m.group(0))
    for m in _JSON_LEAK_RE.finditer(text):
        blob = m.group(0)
        args = ""
        try:
            obj = json.loads(blob)
            args = json.dumps(obj.get("arguments") or obj.get("args") or {})
        except Exception:
            args = ""
        _add(m.group("name"), args, "json", m.span(), blob)
    for m in _CALLISH_RE.finditer(text):
        a = m.group("args")
        _add(m.group("name"), None if a.startswith("(") else a, "callish", m.span(), m.group(0))
    # bare mention last — only for names not already recovered above
    for name in names:
        if any(f["name"] == name for f in found):
            continue
        m = re.search(rf"\b{re.escape(name)}\b", text)
        if m:
            _add(name, None, "bare", m.span(), text[max(0, m.start() - 60):m.end() + 20])
    return found


def classify(call, offered_names, execution_result=None):
    """ok | unknown_tool | bad_args | leaked."""
    if call.get("source") != "native":
        return LEAKED
    if call["name"] not in set(offered_names or []):
        return UNKNOWN_TOOL
    if str(execution_result or "").startswith("Unknown function"):
        return UNKNOWN_TOOL
    schema = (TOOL_DEFINITIONS.get(call["name"], {}).get("function", {})
              .get("parameters", {}) or {})
    required = schema.get("required") or []
    parsed = call.get("args_parsed") or {}
    if any(r not in parsed for r in required):
        return BAD_ARGS
    return VALID


def summarize(offered, calls, leaks, expected=None):
    """Per-conversation tool verdict the UI and the metric both read.

    calls: executed records [{name, args, result}]   leaks: find_leaks output
    """
    offered = sorted(set(offered or []))
    fired, unknown, bad = [], [], []
    for c in (calls or []):
        verdict = classify({**c, "source": "native", "args_parsed": parse_arguments(c.get("args") or "{}")},
                           offered, c.get("result"))
        (fired if verdict == VALID else unknown if verdict == UNKNOWN_TOOL else bad).append(c.get("name"))
    leaked = [l["name"] for l in (leaks or [])]
    attempts = len(fired) + len(unknown) + len(bad) + len(leaked)
    exp = sorted(set(expected or []))
    missed = [e for e in exp if e not in set(fired)]
    return {
        "offered": offered,
        "fired": fired, "unknown": unknown, "bad_args": bad, "leaked": leaked,
        "attempts": attempts,
        # code-computed metric: share of attempts that actually executed correctly
        "score": (round(100.0 * len(fired) / attempts, 1) if attempts else None),
        "expected": exp, "missed": missed,
        "coverage": (round(100.0 * (len(exp) - len(missed)) / len(exp), 1) if exp else None),
    }
