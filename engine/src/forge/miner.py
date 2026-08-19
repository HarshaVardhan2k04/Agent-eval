"""Mine imported REAL call transcripts into reusable Forge personas/probes.

Two stages, PII-first:
  1. scrub_pii() — deterministic regex scrub of phone numbers, emails, and long digit
     runs BEFORE the text is ever sent to the LLM or stored. Probes are replayed hundreds
     of times, so raw customer PII must never persist (Fix 7).
  2. mine_personas() — an LLM pass that reads the (scrubbed) transcripts and returns a set
     of distinct caller PERSONAS (concern, mood, language mix, category) capturing the real
     range of leads, plus representative probe utterances — with an explicit instruction to
     use NO real names/numbers.

Transcripts only (recordings are dropped — prompt optimization is text-only).
"""
from __future__ import annotations

import re

_PHONE = re.compile(r"(?<!\w)(\+?\d[\d\s\-().]{7,}\d)(?!\w)")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_LONGNUM = re.compile(r"\b\d{6,}\b")  # aadhaar/order/account-like runs


def scrub_pii(text: str) -> str:
    if not text:
        return ""
    text = _EMAIL.sub("<email>", text)
    text = _PHONE.sub("<number>", text)
    text = _LONGNUM.sub("<number>", text)
    return text


MINE_SYS = (
    "You extract reusable test PERSONAS from real (already anonymized) call transcripts of a "
    "voice agent. Output realistic caller personas that capture the RANGE of real leads — their "
    "concerns, mood, objections, and language mix (e.g. code-switching). NEVER include any real "
    "name, phone number, email, or address; if you see one, generalize it. "
    'Reply as JSON: {"personas": [{"id": "kebab-id", "persona": "2-3 sentence second-person '
    'description the lead-simulator will role-play", "category": "positive|negative|objection|'
    'confused|rushed|vulnerable", "sample_utterances": ["...", "..."]}]}'
)


async def mine_personas(llm, transcripts, *, vertical=None, max_personas=25):
    """transcripts: list of raw transcript strings. Returns scrubbed persona dicts."""
    scrubbed = [scrub_pii(t) for t in (transcripts or []) if t and t.strip()]
    if not scrubbed:
        return {"personas": [], "note": "no transcripts to mine"}

    # Keep the prompt bounded — sample up to ~40 transcripts, truncate each.
    sample = scrubbed[:40]
    joined = "\n\n---\n\n".join(t[:2000] for t in sample)
    vert = f" The vertical/domain is: {vertical}." if vertical else ""
    prompt = (
        f"Produce up to {max_personas} DISTINCT personas covering the real range of these "
        f"{len(sample)} transcripts.{vert}\n\nTRANSCRIPTS:\n{joined}"
    )
    try:
        data = await llm.chat_json(
            [{"role": "system", "content": MINE_SYS}, {"role": "user", "content": prompt}],
            temperature=0.2, max_tokens=4000, enable_thinking=False,
        )
    except Exception as e:
        return {"personas": [], "note": f"mine_error: {str(e)[:120]}"}

    personas = data.get("personas") if isinstance(data, dict) else None
    out = []
    for i, p in enumerate(personas or []):
        if not isinstance(p, dict):
            continue
        # belt-and-suspenders: scrub the model's output too
        out.append({
            "id": str(p.get("id") or f"real-{i+1}")[:60],
            "persona": scrub_pii(str(p.get("persona") or ""))[:800],
            "category": str(p.get("category") or "unknown")[:30],
            "sample_utterances": [scrub_pii(str(u))[:200] for u in (p.get("sample_utterances") or [])][:6],
            "source": "real",
            "pii_scrubbed": True,
        })
    return {"personas": out[:max_personas], "n_transcripts": len(scrubbed)}
