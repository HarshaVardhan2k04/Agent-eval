"""Per-tool capability checks.

The problem matrix asks "does the agent behave well?"; these ask a narrower,
mechanical question: **when the situation unambiguously demands tool X, does the
model actually CALL it?** Each check drives a short scripted conversation designed
so a correct agent has no reasonable alternative to firing that tool, then reads the
recorded calls/leaks.

Three outcomes per tool:
  called       - the tool fired (production would have executed it)
  spoken_only  - the model typed the tool name instead of calling it (nothing ran)
  not_called   - neither; the model answered without the tool

Two phrasings per tool: a prompt that only survives one exact wording isn't fixed.
"""
from __future__ import annotations

# {tool: [ (lead_lines, note), ... ]}
TOOL_CHECKS = {
    "end_call": [
        (["not interested, remove me from your list"], "hard no"),
        (["stop calling me please", "I said stop, goodbye"], "repeated no"),
    ],
    "voicemail_detected": [
        (["Hi, you've reached the voicemail of Rahul Sharma. Please leave a message after the beep."],
         "carrier voicemail"),
        (["The person you are calling is not available. Record your message after the tone. Beep."],
         "answering machine"),
    ],
    "handle_call_screening": [
        (["Please state your name and the reason for your call."], "screening gatekeeper"),
        (["See if this person is available. Who is calling?"], "ios screening"),
    ],
    "date_calculator": [
        (["can we schedule the visit next friday?"], "next weekday"),
        (["how about the second saturday of september?"], "ordinal weekday"),
    ],
    "search_knowledge_base": [
        (["what is the exact maintenance charge per square foot, and the RERA registration number?"],
         "specific fact not in prompt"),
        (["can you tell me the exact list of amenities and the club membership fee?"], "detail lookup"),
    ],
    "web_search": [
        (["what is today's gold rate per gram in Hyderabad?"], "live external fact"),
        (["what is the current home loan interest rate at SBI today?"], "current rate"),
    ],
    "send_whatsapp_template": [
        (["can you send me the brochure on whatsapp?"], "brochure request"),
        (["please share the location and details on my whatsapp"], "share on whatsapp"),
    ],
    "warm_transfer_call": [
        (["I want to speak to a human manager right now"], "asks for human"),
        (["put me through to a real person, I don't want to talk to a bot"], "escalation"),
    ],
    "switch_agent": [
        (["I actually want to talk to the loan specialist, not you"], "asks another agent"),
        (["can you connect me to the service department instead?"], "department switch"),
    ],
    "get_location_details": [
        (["I live in Nizampet, how far is your project from there?"], "distance question"),
        (["is there a good school near your project?"], "nearby question"),
    ],
    "irrelevant_interruption": [
        (["tell me a joke", "sing me a song", "what's your favourite colour", "do you support India in cricket"],
         "sustained off-topic"),
    ],
}

CALLED = "called"
SPOKEN_ONLY = "spoken_only"
NOT_CALLED = "not_called"


def checks_for(enabled_tools):
    """[(tool, variant_idx, lead_lines, note)] for the tools this run actually offers."""
    out = []
    for tool in (enabled_tools or []):
        for i, (lines, note) in enumerate(TOOL_CHECKS.get(tool, [])):
            out.append((tool, i, lines, note))
    return out


def verdict(tool, calls, leaks):
    """Outcome of ONE check conversation."""
    if any(c.get("name") == tool for c in (calls or [])):
        return CALLED
    if any(l.get("name") == tool for l in (leaks or [])):
        return SPOKEN_ONLY
    return NOT_CALLED


def roll_up(results):
    """[(tool, verdict)] -> {tool: {verdict, called, spoken_only, not_called, n}}.

    A tool passes only if it fired in EVERY phrasing — a tool that works on one
    wording and not the other is not reliable in production.
    """
    by_tool = {}
    for tool, v in results:
        t = by_tool.setdefault(tool, {"called": 0, "spoken_only": 0, "not_called": 0, "n": 0})
        t[v] += 1
        t["n"] += 1
    for tool, t in by_tool.items():
        if t["called"] == t["n"]:
            t["verdict"] = CALLED
        elif t["spoken_only"]:
            t["verdict"] = SPOKEN_ONLY
        elif t["called"]:
            t["verdict"] = "partial"
        else:
            t["verdict"] = NOT_CALLED
    return by_tool


# ---------------------------------------------------------------------------
# PROVEN LEVERS — what actually fixed each tool in production, handed to the
# coach verbatim so it applies a known cure instead of re-deriving one.
# The end_call lever is the team's own: explicit, self-counting triggers with an
# engagement reset, plus "speak the goodbye, THEN call the tool".
# ---------------------------------------------------------------------------
TOOL_LEVERS = {
    "end_call": (
        "Tell it WHEN to end, with explicit self-counting triggers so it neither hangs up "
        "early nor loops forever:\n"
        "- Hard no / explicit stop / second refusal -> short goodbye + end_call NOW, no more reframes.\n"
        "- Natural wind-down (only ack tokens, no new question) -> read it and close yourself, "
        "do not wait for the lead to say 'bye'.\n"
        "- Three or more off-topic turns -> warmly end.\n"
        "- BUT engagement RESETS the counter: never end while they are asking real questions, "
        "even right after a booking.\n"
        "And on the mechanism: 'Speak your short goodbye as your normal reply, THEN call end_call "
        "to hang up. Never write the tool name in what you say, never describe calling it.'"
    ),
    "voicemail_detected": (
        "Name the trigger words the model can match on: pre-recorded greeting, carrier voicemail, "
        "'leave a message', 'not available', 'mailbox', or a beep after a short recording -> call "
        "voicemail_detected IMMEDIATELY and say nothing. Contrast it explicitly with a live human "
        "and with call screening, or the model hesitates between the three."
    ),
    "handle_call_screening": (
        "Distinguish it from voicemail in one line: an automated prompt that ASKS WHO IS CALLING "
        "(state your name / see if they are available) is screening, not voicemail -> call "
        "handle_call_screening and then wait silently."
    ),
    "date_calculator": (
        "'ALWAYS call date_calculator whenever the lead mentions any day, date or timeframe — never "
        "compute or guess a date yourself.' Then give the normalisation step: convert what they said "
        "into one of the supported expressions BEFORE calling, with two or three worked examples."
    ),
    "send_whatsapp_template": (
        "State the trigger plainly: any request for the brochure, location, video, price sheet or "
        "'send it to me' -> call send_whatsapp_template directly, do NOT narrate sending it. Then tell "
        "the lead to check their WhatsApp."
    ),
    "get_location_details": (
        "'Never guess a distance or what is nearby.' Trigger on: the lead asks how far, which branch is "
        "nearest, or what is around a place — and also when they simply TELL you where they live while "
        "choosing between locations. Normalise the place name with its city before calling."
    ),
    "search_knowledge_base": (
        "Draw the line: answer from your instructions first; call search_knowledge_base only for a "
        "specific fact they asked for that your instructions do not contain. Give one example of each."
    ),
    "web_search": (
        "Reserve it for live external facts (today's rate, current news, a public address) and say so — "
        "otherwise the model either never calls it or calls it for campaign facts it already has."
    ),
    "warm_transfer_call": (
        "'You CAN transfer calls.' Trigger: the lead asks for a human, a manager, a supervisor, or is "
        "frustrated and wants escalation -> call warm_transfer_call immediately. Never say you cannot "
        "transfer, never promise a callback instead."
    ),
    "switch_agent": (
        "Point at the AVAILABLE AGENTS list and require the exact ID: when the lead asks for a different "
        "department or specialist, call switch_agent with that ID rather than answering out of scope."
    ),
    "irrelevant_interruption": (
        "Give the counter: three sustained off-topic turns -> call irrelevant_interruption. And list what "
        "does NOT count — filler sounds, short acknowledgements, confused-but-on-topic questions."
    ),
}

# what the coach is told the failure IS, per outcome
VERDICT_BEHAVIOUR = {
    SPOKEN_ONLY: ("Writes the tool name in its spoken reply instead of calling the tool — "
                  "the model believes it acted, but nothing ran (in production the call stays connected)"),
    NOT_CALLED: "Never calls the tool even when the situation plainly requires it",
    "partial": "Only calls the tool on some phrasings of the same situation — unreliable in production",
}


def as_coach_problem(tool, roll, evidence=""):
    """Shape a failing tool check like a problem-matrix row so the existing coach
    (which already takes {id, behaviour, evidence, lever}) can fix it."""
    verdict = (roll or {}).get("verdict")
    return {
        "id": f"tool:{tool}",
        "behaviour": f"{tool}: " + VERDICT_BEHAVIOUR.get(verdict, "not called reliably"),
        "evidence": evidence or f"{(roll or {}).get('called', 0)}/{(roll or {}).get('n', 0)} phrasings called it",
        "layer_for_fix": "campaign",
        "lever": TOOL_LEVERS.get(tool, ""),
    }


def failing(rollup):
    """[(tool, roll)] for every tool that isn't reliably called."""
    return [(t, r) for t, r in (rollup or {}).items() if r.get("verdict") != CALLED]
