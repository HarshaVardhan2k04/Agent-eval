"""STT accuracy metrics — WER, CER, word-level diff, and a per-language verdict.

For Indic languages (Hindi/Telugu) word boundaries are unreliable and code-switching
is common, so CER is the primary signal there; English leans on WER.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

import jiwer

# Good/needs-work thresholds per language. Keyed by the metric that matters most.
# (Kept in code, not env — these are product judgments, tune as data comes in.)
VERDICT_THRESHOLDS = {
    "en": {"metric": "wer", "good": 0.15, "ok": 0.30},
    "hi": {"metric": "cer", "good": 0.15, "ok": 0.30},
    "te": {"metric": "cer", "good": 0.15, "ok": 0.30},
    "default": {"metric": "wer", "good": 0.15, "ok": 0.30},
}

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+", re.UNICODE)


def normalize(text: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace — fair comparison basis."""
    t = (text or "").lower()
    t = _PUNCT.sub(" ", t)
    t = _WS.sub(" ", t).strip()
    return t


def word_diff(reference: str, hypothesis: str) -> list[dict]:
    """Word-level alignment ops for highlighting: equal / sub / del / ins."""
    ref_w = normalize(reference).split()
    hyp_w = normalize(hypothesis).split()
    ops: list[dict] = []
    sm = SequenceMatcher(a=ref_w, b=hyp_w, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            ops.append({"type": "equal", "ref": ref_w[i1:i2], "hyp": hyp_w[j1:j2]})
        elif tag == "replace":
            ops.append({"type": "sub", "ref": ref_w[i1:i2], "hyp": hyp_w[j1:j2]})
        elif tag == "delete":
            ops.append({"type": "del", "ref": ref_w[i1:i2], "hyp": []})
        elif tag == "insert":
            ops.append({"type": "ins", "ref": [], "hyp": hyp_w[j1:j2]})
    return ops


def score(reference: str, hypothesis: str, language: str = "en") -> dict:
    """Compute WER, CER, match %, diff ops, and a verdict for one comparison."""
    ref_n = normalize(reference)
    hyp_n = normalize(hypothesis)

    if not ref_n:
        # No reference to score against.
        th = VERDICT_THRESHOLDS.get(language, VERDICT_THRESHOLDS["default"])
        return {
            "wer": None, "cer": None, "match_pct": None,
            "verdict": "unknown", "primary_metric": th["metric"],
            "diff": word_diff(reference, hypothesis),
            "ref_words": 0, "hyp_words": len(hyp_n.split()),
        }

    wer = float(jiwer.wer(ref_n, hyp_n))
    cer = float(jiwer.cer(ref_n, hyp_n))
    diff = word_diff(reference, hypothesis)

    th = VERDICT_THRESHOLDS.get(language, VERDICT_THRESHOLDS["default"])
    primary = wer if th["metric"] == "wer" else cer
    if primary <= th["good"]:
        verdict = "good"
    elif primary <= th["ok"]:
        verdict = "fair"
    else:
        verdict = "poor"

    return {
        "wer": round(wer, 4),
        "cer": round(cer, 4),
        "match_pct": round(max(0.0, 1.0 - primary) * 100, 1),
        "verdict": verdict,
        "primary_metric": th["metric"],
        "diff": diff,
        "ref_words": len(ref_n.split()),
        "hyp_words": len(hyp_n.split()),
    }
