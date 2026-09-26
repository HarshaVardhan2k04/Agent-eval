"""Call Analysis endpoint: score one call (backend orchestrates batches)."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.analysis.evaluator import CallEvaluator

router = APIRouter(prefix="/api/analysis")

_evaluator = CallEvaluator()


class ScoreCallRequest(BaseModel):
    call_id: str | None = None
    transcript: str
    call_direction: str = "outbound"
    editable_config: dict | str | None = None
    available_tools: list[str] | None = None
    tool_events: list[dict] | None = None


@router.post("/score")
async def score_call(req: ScoreCallRequest):
    try:
        result = await _evaluator.evaluate(req.model_dump())
    except Exception as e:
        raise HTTPException(502, f"Scoring failed: {e}")
    result["call_id"] = req.call_id
    return result


# --------------------------------------------------------------- RAG query mining
class ExtractQueriesRequest(BaseModel):
    transcript: str
    mode: str = "llm"          # "llm" (code-mixed safe) | "rules" (no model call)
    max_queries: int = 25


_QUERY_SYS = (
    "You are mining a voice-call transcript for questions the CUSTOMER asked that a "
    "knowledge base would answer — prices, availability, specifications, timings, "
    "location, policies, documents, offers, eligibility.\n"
    "Rules:\n"
    "- ONLY questions the customer (User) actually asked. Never invent one.\n"
    "- Speech is code-mixed (English/Hindi/Telugu). A question need not have a '?'.\n"
    "- SKIP greetings and acknowledgements ('haan', 'ok', 'accha') entirely.\n"
    "- Rewrite each into a clean standalone search query, keeping the customer's meaning "
    "and any specifics they named. Resolve pronouns from context.\n"
    "- Label each one with `kind`:\n"
    '    "kb_question"  = a document could answer it (price, size, location, specs, '
    "timings, policy, documents, offers, eligibility, availability).\n"
    '    "call_action"  = a request about the CALL itself, which no knowledge base can '
    "answer (book/arrange a site visit, call me back later, transfer me, negotiate with "
    "someone, send it on WhatsApp).\n"
    "  Getting this label right matters: scoring a call_action against the knowledge base "
    "punishes retrieval for missing an answer that could not exist.\n"
    'Reply as JSON: {"queries":[{"query":"<standalone query>","said":"<the customer\'s '
    'original words>","kind":"kb_question|call_action"}]}. Empty list if the customer '
    "asked nothing at all."
)


@router.post("/extract-rag-queries")
async def extract_rag_queries(req: ExtractQueriesRequest):
    """Turn a production transcript into the customer questions worth asking the KB.

    Rule mode is free but literal; llm mode handles the code-mixed speech these calls
    are actually in, and rewrites a fragment into a searchable standalone query. Both
    return `said` (the original words) so nothing is attributed to the customer that
    they did not say.
    """
    from src.analysis.parsing import parse_turns

    turns = parse_turns(req.transcript or "")
    user_turns = [t["text"] for t in turns if t["role"] == "User"]
    if not user_turns:
        return {"queries": [], "n_turns": len(turns), "n_user_turns": 0, "mode": req.mode}

    if req.mode == "verbatim":
        # Production's RAGEnricher searches with the raw text of every user turn
        # (agent.py on_user_turn_completed -> enrich). Replaying anything rewritten
        # would measure a pipeline that does not exist. So: no rewriting, no merging,
        # no dropping — only a LABEL per turn so the scores can be read correctly.
        kinds = await _label_turns(user_turns)
        out = [{"query": t, "said": t, "kind": k} for t, k in zip(user_turns, kinds)]
        return {"queries": out[: req.max_queries], "n_turns": len(turns),
                "n_user_turns": len(user_turns), "mode": "verbatim",
                "n_kb": sum(1 for q in out if q["kind"] == "kb_question"),
                "n_call_action": sum(1 for q in out if q["kind"] == "call_action"),
                "n_chit_chat": sum(1 for q in out if q["kind"] == "chit_chat")}

    if req.mode == "rules":
        out = [{"query": t, "said": t, "kind": "kb_question"}
               for t in user_turns if _looks_like_question(t)]
        return {"queries": out[: req.max_queries], "n_turns": len(turns),
                "n_user_turns": len(user_turns), "mode": "rules"}

    from src.config import DEFAULT_JUDGE_TEMPERATURE
    from src.llm.client import LLMClient

    # The FULL conversation goes in — telephony STT splits one spoken question across
    # several turns ("What is the SFT price for. Uh. 500." / "Square— 500 square yards
    # villa?") and leaves references dangling ("the same for the 550"). Only the agent's
    # replies in between make those resolvable, so the model needs them as context even
    # though it may only extract from User turns.
    convo = "\n".join(f"{i + 1}. {t['role']}: {t['text']}" for i, t in enumerate(turns))
    try:
        data = await LLMClient().chat_json(
            [{"role": "system", "content": _QUERY_SYS},
             {"role": "user", "content": f"TRANSCRIPT:\n{convo}"}],
            temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=1600, enable_thinking=True,
        )
        items = data.get("queries") if isinstance(data, dict) else None
        queries, seen, dropped = [], set(), {"unattributed": 0, "duplicate": 0}
        for q in (items or []):
            text = str(q.get("query", "")).strip()
            said = str(q.get("said", "")).strip()
            if not text:
                continue
            # No `said` means nothing in the transcript backs this query — the model
            # invented it. Drop it: a fabricated question would be scored against the
            # knowledge base as though a customer had asked it.
            if not said:
                dropped["unattributed"] += 1
                continue
            # The same question arrives two or three times as the caller repeats and
            # rephrases; scoring it twice double-weights it in the aggregate.
            key = _norm_q(text)
            if key in seen:
                dropped["duplicate"] += 1
                continue
            seen.add(key)
            queries.append({
                "query": text, "said": said,
                # anything not explicitly labelled a call action is treated as a KB question
                "kind": ("call_action" if str(q.get("kind", "")).strip().lower() == "call_action"
                         else "kb_question"),
            })
    except Exception as e:  # never lose the call — fall back to the rule pass
        queries = [{"query": t, "said": t, "kind": "kb_question"}
                   for t in user_turns if _looks_like_question(t)]
        return {"queries": queries[: req.max_queries], "n_turns": len(turns),
                "n_user_turns": len(user_turns), "mode": "rules_fallback",
                "warning": f"llm extraction failed: {str(e)[:120]}"}

    kept = queries[: req.max_queries]
    return {"queries": kept, "n_turns": len(turns), "n_user_turns": len(user_turns),
            "mode": "llm", "dropped": dropped,
            "n_kb": sum(1 for q in kept if q["kind"] == "kb_question"),
            "n_call_action": sum(1 for q in kept if q["kind"] == "call_action")}


_Q_WORDS = (
    "what", "how", "how much", "where", "when", "why", "which", "who", "can ", "do you",
    "does ", "is there", "are there", "tell me", "price", "cost", "rate", "available",
    "timing", "address", "location", "documents", "offer", "discount", "eligib",
    # code-mixed question markers heard on these calls
    "kitna", "kitne", "kaha", "kab", "kaise", "kya", "enni", "enta", "ekkada", "eppudu", "ela",
)


_LABEL_SYS = (
    "Label each numbered customer turn from a voice call. Reply with one label per turn, "
    "in order, as JSON: {\"labels\":[\"kb_question\", ...]}.\n"
    '  "kb_question" = asks something a company document could answer (price, size, '
    "location, availability, timings, policy, documents, offers) — INCLUDING a fragment "
    'that continues such a question ("550 square yards?", "Two BHK.").\n'
    '  "call_action" = about the call itself (book a visit, call me back, transfer me, '
    "send on WhatsApp, give me a number).\n"
    '  "chit_chat"   = everything else: greetings, acknowledgements ("haan", "ok"), '
    "apologies, repetitions, confirmations, silence fillers.\n"
    "Return exactly as many labels as there are turns."
)


async def _label_turns(user_turns):
    """Label every user turn without rewriting it. One call for the whole call."""
    from src.config import DEFAULT_JUDGE_TEMPERATURE
    from src.llm.client import LLMClient

    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(user_turns))
    try:
        data = await LLMClient().chat_json(
            [{"role": "system", "content": _LABEL_SYS},
             {"role": "user", "content": f"TURNS:\n{numbered}"}],
            temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=1200, enable_thinking=False,
        )
        labels = [str(x).strip().lower() for x in (data.get("labels") or [])]
    except Exception:
        labels = []
    ok = {"kb_question", "call_action", "chit_chat"}
    # a short/duplicate reply the labeller skipped falls back to the rule guess, so the
    # list always lines up with the turns one-for-one
    out = []
    for i, t in enumerate(user_turns):
        lab = labels[i] if i < len(labels) and labels[i] in ok else None
        out.append(lab or ("kb_question" if _looks_like_question(t) else "chit_chat"))
    return out


def _norm_q(text):
    """Loose key for duplicate detection: case, punctuation and filler words differ
    between two askings of the same question."""
    t = re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower())
    drop = {"the", "a", "an", "is", "are", "do", "does", "you", "your", "me", "i",
            "may", "know", "can", "please", "what", "of", "for", "in", "any", "this"}
    return " ".join(sorted(w for w in t.split() if w and w not in drop))


def _looks_like_question(text):
    t = (text or "").strip().lower()
    if len(t.split()) < 3:          # "haan", "ok bhai" — never a KB query
        return False
    return "?" in t or any(w in t for w in _Q_WORDS)
