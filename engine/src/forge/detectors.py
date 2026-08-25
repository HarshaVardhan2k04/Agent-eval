"""Problem-matrix detector library (the CHEAP per-candidate tier).

Ported from agent-server-dev/prompt_lab/regression.py: scripted lead lines drive the
prompt-under-test, then a matcher checks the agent turns for a behaviour. best-of-3
majority -> Y (>=2 pass), N (>=2 fail), else ~ (partial). Each detector is keyed by a
global problem_id (p2, p3, ...).

Two detector kinds:
  - RULE detectors: fast regex/heuristic on the agent turns — for domain-agnostic
    universal behaviours (repetition, formatting, digits, drift, ends-via-tool, ...).
  - LLM-JUDGE detectors: a generic rubric question asked of the judge model — for
    semantic behaviours (objection handling, identity, empathy, ...) that need meaning,
    so they generalize across verticals without hardcoding domain facts.

The prompt-under-test system prompt is supplied by the runner (merged markdown for layered,
blob for standalone), already wrapped with the LEAD-INFORMATION preamble.
"""
from __future__ import annotations

import re

from src.config import DEFAULT_AGENT_TEMPERATURE, DEFAULT_JUDGE_TEMPERATURE

from src.tools.definitions import TOOL_DEFINITIONS
from src.tools import parser as tparse

# The REAL production end_call schema (byte-faithful mirror) — a hand-written
# variant used to be passed here, so detector runs tested a tool that does not
# exist in production and no other tool could ever fire.
END_CALL_TOOL = [TOOL_DEFINITIONS["end_call"]]

# --- shared matchers -------------------------------------------------------
NON_LATIN = re.compile(r"[^\x00-\x7f]")                 # any non-ASCII letter block (drift proxy)
FORMATTING = re.compile(r"[—–]|\*|\[|\]|\(|\)|`|#|•")   # TTS-unsafe formatting chars
DIGIT = re.compile(r"\d")
ACK = re.compile(r"^\s*(okay|ok|sure|yes|right|alright|got it|understood|certainly|"
                 r"haan|s[aā]re|alag[aā])\b", re.I)


# warm_transfer_call ends the evaluated conversation too: the call hands off to a
# human and the supervisor leg is verified outside this system.
TERMINAL_TOOLS = ("end_call", "voicemail_detected", "warm_transfer_call")


async def _agent_turn(llm, system_prompt, convo, tools_on, tool_sim=None):
    """One agent turn. With tools_on the agent gets the SAME schema list production
    would offer (via the run's ToolSimulator when available), non-terminal calls are
    executed and fed back as role:"tool" exactly like production, and every call is
    recorded with its result. Returns (kind, text, msg, calls)."""
    msgs = [{"role": "system", "content": system_prompt}]
    for r, c in convo:
        if r == "A":
            msgs.append({"role": "assistant", "content": c})
        elif r == "L":
            msgs.append({"role": "user", "content": c})
    tools = None
    if tools_on:
        tools = (tool_sim.get_schemas() if tool_sim else None) or END_CALL_TOOL
    msg = await llm.chat(msgs, tools=tools, temperature=DEFAULT_AGENT_TEMPERATURE, max_tokens=100)
    calls = []
    rounds = 0
    while tools_on and (msg.tool_calls or []) and rounds < 3:
        rounds += 1
        terminal = None
        for tc in msg.tool_calls:
            name = tc.function.name
            args = tc.function.arguments or "{}"
            result = None
            if tool_sim:
                try:
                    result = await tool_sim.execute(name, args)
                except Exception as e:
                    result = f"tool_error: {str(e)[:60]}"
            calls.append({"name": name, "args": args, "result": result})
            if name in TERMINAL_TOOLS:
                import json as _json
                try:
                    m = _json.loads(args).get("message", "") or ""
                except Exception:
                    m = ""
                terminal = m
            else:
                msgs.append({"role": "assistant", "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": name, "arguments": args}}]})
                msgs.append({"role": "tool", "tool_call_id": tc.id, "content": str(result or "")})
        if terminal is not None:
            return ("END", terminal, msg, calls)          # production deletes the room here
        msg = await llm.chat(msgs, tools=tools, temperature=DEFAULT_AGENT_TEMPERATURE, max_tokens=100)
    return ("SAY", (msg.content or "").strip(), msg, calls)


def _turn_leaks(text, tool_sim):
    offered = [t["function"]["name"] for t in (tool_sim.get_schemas() if tool_sim else [])]
    return tparse.find_leaks(text, offered or None)


async def _drive(llm, system_prompt, greeting, lead_lines, tools_on=False, tool_sim=None):
    """Drive a scripted conversation; return (convo, ended_index, meta).
    meta maps convo index -> {latency_ms, tokens} for each real agent completion."""
    convo = [("A", greeting or "")]
    ended = None
    meta = {"tool_calls": [], "tool_leaks": []}  # string keys: tool record; int keys: per-turn metrics
    for i, ll in enumerate(lead_lines):
        convo.append(("L", ll))
        kind, text, msg, calls = await _agent_turn(llm, system_prompt, convo, tools_on, tool_sim)
        idx = len(convo)
        meta[idx] = {"latency_ms": getattr(msg, "latency_ms", None),
                     "ttft_ms": getattr(msg, "ttft_ms", None),
                     "tokens": getattr(msg, "completion_tokens", None)}
        for c in calls:   # name + args + RESULT (the result used to be dropped)
            meta["tool_calls"].append({**c, "turn": idx})
        for lk in _turn_leaks(text, tool_sim):   # tool SPOKEN, never executed
            meta.setdefault("tool_leaks", []).append({**lk, "turn": idx})
        if kind == "END":
            ended = i + 1
            convo.append(("END", text))
            break
        convo.append(("A", text))
    return convo, ended, meta


def _agent_texts(convo):
    return [c for r, c in convo if r == "A"][1:]  # skip the greeting


def _all_agent_text(convo):
    return " ".join(c for r, c in convo if r in ("A", "END"))


# ==========================================================================
# RUN-THEN-GRADE split: SCENARIOS generate the conversation, CHECKERS /
# RUBRICS grade a STORED transcript. run_detector() remains the fused
# one-shot wrapper (drive+grade) for verify and ad-hoc callers.
# ==========================================================================

# Scripted scenarios for rule-checked problems: {pid: (lead_lines, tools_on)}
RULE_SCENARIOS = {
    "p1": (["not interested", "no really, I said not interested"], False),
    "p2": (["I had enquired about this", "I'm looking to go ahead", "what is the price"], False),
    "p3": (["hmm", "ok", "hmm", "ok", "tell me"], False),
    "p12": (["oh wow, a free offer, how incredibly generous of you!"], False),
    "p15": (["what are the sizes and the rate?"], False),
    "p20": (["not interested, remove me from your list"], True),
    "p21": (["nice weather today", "did you eat lunch", "tell me a joke", "what's your name"], True),
    "p22": (["I already sorted this with your colleague", "yeah all done", "okay", "alright thank you"], True),
    "p23": (["what are the details, and the options, and how does it work?"], True),
    "p24": (["not interested", "no really, goodbye"], True),
    "p29": (["hi, tell me about it", "what is the price range", "and the timeline?"], False),
    "p30": (["give me the price range and the options please"], False),
}


# Alternate phrasings per problem. Repeat runs use DIFFERENT wordings of the same
# situation instead of the identical script — a prompt that only survives one exact
# phrasing isn't actually fixed, and identical repeats can't reveal that.
SCENARIO_VARIANTS = {
    # rule-checked
    "p1": [["not interested thanks", "I told you, I'm not interested"],
           ["please don't call me about this", "no means no, remove me"]],
    "p2": [["I filled the form last week", "I want to move ahead", "what does it cost"],
           ["yes I enquired earlier", "I'm ready to proceed", "give me the pricing"]],
    "p3": [["ok", "hmm", "go on", "and", "yes"],
           ["achha", "hmm", "okay", "hmm", "continue"]],
    "p12": [["wow, what a fantastic once-in-a-lifetime deal, how lucky am I"],
            ["oh brilliant, a free offer, you must be doing charity work"]],
    "p15": [["what's the carpet area and the per square foot rate?"],
            ["how big is it and how much does it cost?"]],
    "p20": [["stop calling me, take my number off your list"],
            ["I'm not interested at all, please remove me"]],
    "p21": [["did you watch the match yesterday", "what's your favourite food",
             "tell me something funny", "are you a robot"]],
    "p22": [["your colleague already helped me", "it's all done", "yep", "thanks, bye"],
            ["I already booked with someone else", "all sorted", "ok", "thank you"]],
    "p23": [["tell me everything — sizes, price, amenities, possession, loans"],
            ["I have many questions, can you walk me through all of it?"]],
    "p24": [["not interested", "please stop, goodbye"],
            ["no thanks", "I said no, bye"]],
    "p29": [["hello, what is this about", "what's the price", "when is possession"],
            ["hi, go ahead", "and the cost?", "how soon can I move in?"]],
    "p30": [["give me all the details and options please"],
            ["list out everything you have"]],
    # judge-checked
    "p6": [["hi, I want to know more about the project", "sure, go on"],
           ["saw your ad, tell me about it", "okay continue"]],
    "p7": [["hi", "yes go ahead"], ["hello?", "okay tell me"]],
    "p11": [["that's way over my budget, why should I even consider it?"],
            ["honestly this seems overpriced, convince me"]],
    "p13": [["sorry, who is this, which company?"], ["where are you calling from exactly?"]],
    "p19": [["I lost my mother last week, I really can't talk about this now"],
            ["there's been a death in the family, this is a bad time"]],
    "p25": [["hello, who's this?"], ["yes? speaking."]],
    "p26": [["why would this be free, what's the catch?", "sounds fishy to me"],
            ["how do you make money then?", "there must be a hidden cost"]],
    "p27": [["yes I'm interested", "sure let's do it", "go ahead and set it up"],
            ["okay I want to see it", "yes please arrange it"]],
    "p31": [["it's been a rough week honestly"], ["I'm quite stressed these days"]],
}


def _agent_entries(convo):
    """[(convo_idx, text)] for agent turns, greeting excluded."""
    return [(i, c) for i, (r, c) in enumerate(convo) if r == "A"][1:]


# CHECKERS grade a stored conversation: (convo, ended) -> (ok, reason, failing_turn)
# failing_turn is the convo index of the offending turn (None = whole-conversation).
def _ck_repetition(convo, ended):
    entries = _agent_entries(convo)
    texts = [c for _, c in entries]
    if len(texts) != len(set(texts)):
        dup = next(t for t in texts if texts.count(t) > 1)
        idx = [i for i, c in entries if c == dup][-1]
        return False, "verbatim turn repeat", idx
    seen = {}
    for i, turn in entries:
        for sent in re.split(r"[.!?]+", turn):
            norm = " ".join(sent.lower().split())
            if len(norm.split()) < 5:
                continue
            if norm in seen and seen[norm] != i:
                return False, f'repeated line: "{sent.strip()[:50]}"', i
            seen[norm] = i
    return True, "no repeat", None


def _ck_over_ack(convo, ended):
    entries = _agent_entries(convo)
    def opens_with_ack(x):
        x2 = re.sub(r"^\s*this is [^.!?]{0,60}[.!?]\s*", "", x, flags=re.I)
        return bool(ACK.match(x2))
    ack_idx = [i for i, c in entries if opens_with_ack(c)]
    ok = len(ack_idx) <= len(entries) // 2
    return ok, f"{len(ack_idx)}/{len(entries)} ack-openers", (None if ok else ack_idx[0])


def _ck_lang_drift(convo, ended):
    entries = _agent_entries(convo)
    bad = [i for i, c in entries if NON_LATIN.search(c)]
    ok = not bad
    return ok, ("no drift" if ok else f"{len(bad)} non-English turns on an English lead"), (bad[0] if bad else None)


def _ck_formatting(convo, ended):
    # scan EVERY agent turn — one leaked em-dash anywhere in the call is a TTS defect,
    # and in dataset mode the offending turn can be any of them.
    for i, t in _agent_entries(convo):
        bad = FORMATTING.search(t or "")
        if bad:
            return False, f"has {bad.group()!r}", i
    return True, "clean — no TTS-unsafe characters", None


def _ck_numbers(convo, ended):
    entries = _agent_entries(convo)
    bad = [i for i, c in entries if DIGIT.search(c)]
    ok = not bad
    return ok, ("no digits" if ok else "has digits"), (bad[0] if bad else None)


def _ck_sarcasm(convo, ended):
    entries = _agent_entries(convo)
    i, t = entries[0] if entries else (None, "")
    ok = not re.search(r"generous|charity|haha|indeed|lucky you", t, re.I)
    return ok, t[:70], (None if ok else i)


def _ck_persistence(convo, ended):
    entries = _agent_entries(convo)
    if len(entries) < 2:
        return False, "too few turns", None
    (i0, a0), (il, al) = entries[0], entries[-1]
    reframe = bool(re.search(r"free|no cost|just|quick|brief|moment|worth|finished|walk through|"
                             r"change (your|their) mind|see it|a minute", a0, re.I))
    release = bool(re.search(r"thank|take care|time|good day|reach out|no problem|whenever|understand",
                             al, re.I))
    fail_at = None if (reframe and release) else (i0 if not reframe else il)
    return reframe and release, f"reframe={reframe} release={release}", fail_at


def _ck_should_end(convo, ended):
    return ended is not None, (f"ended@{ended}" if ended is not None else "did NOT end"), None


def _ck_stay_open(convo, ended):
    end_idx = next((i for i, (r, _) in enumerate(convo) if r == "END"), None)
    return ended is None, ("stayed open" if ended is None else f"cut off@{ended}"), end_idx


def _ck_warm_ending(convo, ended):
    msg = convo[-1][1] if convo and convo[-1][0] == "END" else ""
    ok = ended is not None and bool(re.search(r"thank|take care|good day|reach out|welcome|anytime|bye", msg, re.I))
    return ok, (msg or "no warm end")[:50], (len(convo) - 1 if not ok and convo else None)


RULE_CHECKERS = {
    "p1": _ck_persistence, "p2": _ck_over_ack, "p3": _ck_repetition,
    "p12": _ck_sarcasm, "p15": _ck_numbers,
    "p20": _ck_should_end, "p21": _ck_should_end, "p22": _ck_should_end,
    "p23": _ck_stay_open, "p24": _ck_warm_ending,
    "p29": _ck_lang_drift, "p30": _ck_formatting,
}

LLM_JUDGE_DETECTORS = {
    "p40": (["how much does it cost, exactly?", "and what exact percentage discount or bonus do I get?"],
            "When asked for exact figures, did the agent either quote ONLY figures its instructions clearly "
            "contain, or defer to a human/advisor for the exact number? Confidently stating a specific "
            "price/percentage it cannot know (an invented figure) = FAIL.", False),
    "p6": (["hi, I saw your ad and wanted to know a bit more", "yeah go on, tell me"],
           "Did the agent ask at least one qualifying/discovery question about the lead's actual needs "
           "(e.g. which option/configuration, budget, timeline, purpose) BEFORE proposing a visit, meeting, "
           "booking, demo, or any other commitment? Pushing the goal before qualifying = FAIL, even if the "
           "push is polite. Merely qualifying without any push yet = PASS.", False),
    "p7": (["hello", "yeah tell me"],
           "After the opening greeting, did the agent AVOID re-introducing itself / restating who it is?", False),
    "p11": (["that sounds expensive, why should I bother?"],
            "Did the agent address the objection constructively (acknowledge + give a real reason) WITHOUT "
            "inventing specific facts, numbers, or promises it cannot know?", False),
    "p13": (["which company is this, who are you calling from?"],
            "Did the agent clearly identify the company/organization it represents (not a city or a vague answer)?", False),
    "p19": (["my father just passed away last week, I can't deal with this now"],
            "Did the agent respond with ONLY comfort/empathy and NOT pitch, ask a business question, or continue the goal?", False),
    "p27": (["yes I'm interested", "okay let's go ahead", "sure, set something up"],
            "When booking, did the agent ASK for the lead's convenient time rather than DECLARING a time, "
            "and only confirm once the lead gave a time?", True),
    "p31": (["honestly this has been a really stressful week for me"],
            "Did the agent briefly acknowledge the lead's feeling before continuing, without over-doing it?", False),
    "p18": (["I'm driving, be quick — but yeah I'm keen"],
            "Did the agent keep it brief AND still move the keen lead forward (not drop them with a vague 'call later')?", False),
    # ---- LLM-judged "for now" coverage of the previously-undetected problems ----
    "p4": (["haan theek hai, aalo details batao", "hmm okay aur batao"],
           "Did the agent STAY in the language it was already using (or the lead's clear language) instead of "
           "flipping to a different language because of one ambiguous word? A wholesale language flip triggered "
           "by a single stray token = FAIL. Staying consistent, or mirroring a genuine full-sentence switch = PASS.", False),
    "p5": (["before that, tell me a joke yaar", "haha ok what about the cricket match yesterday, did you watch?"],
           "When the lead went off on jokes/tangents, did the agent give AT MOST a few-word acknowledgment and "
           "steer straight back to the purpose of the call? Engaging the tangent (telling a joke, discussing the "
           "match, over-agreeing) = FAIL.", False),
    "p14": (["haan bhai hindi me batao na, kya hai ye scheme?"],
            "IF the agent replied in the lead's language: is the code-mix natural — native grammar carrying the "
            "sentence with English kept for nouns, numbers and technical terms? Over-pure translation of technical "
            "terms OR replying in plain English to a clear native-language request = FAIL. If the agent's "
            "instructions clearly restrict it to English, staying in English politely = PASS.", False),
    "p16": (["I'm looking, yes", "hmm", "okay", "hmm not sure yet"],
            "Did the agent avoid re-asking the SAME qualifying/pivot question more than twice? Asking the same "
            "question (even reworded) a third time = FAIL.", False),
    "p25": (["hello, yes who is this?"],
            "When the agent asked its first qualifying question, did the question CARRY ITS REASON — a short why "
            "attached (e.g. 'so I can suggest the right option, do you...')? A cold qualifying question with no "
            "stated reason, leaving the lead to wonder why it's being asked = FAIL.", False),
    "p26": (["why is this free? what's the catch?", "hmm sounds too good to be true"],
            "Did the agent answer the honest money/trust question DIRECTLY on the first ask — stating plainly how "
            "the business earns (or clearly explaining why it is free) — without opening with 'no catch', dodging, "
            "or repeating reassurances in a loop? Evasive prefaces or looping reassurance = FAIL.", False),
    "p32": (["I'm not sure this covers what I need — what exactly do you have?"],
            "When the lead's need was unclear or possibly outside policy, did the agent NAME a few CONCRETE options "
            "(specific configurations/plans/categories) rather than staying vague? Vague reassurance with no named "
            "options = FAIL.", False),
    "p34": (["yes", "hmm okay", "go on", "and?"],
            "The lead is engaged but terse (short answers, still responsive). Did the agent KEEP HELPING and NOT "
            "end the call? Ending the call on a lead who is still engaging, however slowly, = FAIL.", True),
    "p28": (["hello? I can't hear you properly", "you're breaking up, I still can't hear", "hello?"],
            "The lead repeatedly says they CANNOT HEAR. Did the agent avoid repeating the pitch (useless to "
            "someone who can't hear it), keep each attempt to ONE short line, and after a couple of tries offer "
            "a callback on a clearer line and close? Re-pitching or looping the same content = FAIL.", True),
    "p37": (["hi — look I'm really busy right now"],
            "The lead opened with 'busy'. Did the agent acknowledge it, keep it to at most one short line (optionally "
            "one quick capture line), and offer a callback / release politely WITHOUT launching a pitch? A correct "
            "polite busy-release = PASS. Hard-selling a busy lead = FAIL.", True),
}

PROMPT_JUDGE_DETECTORS = {
    "p10": ("Is this prompt free of RULE BLOAT? A healthy prompt has a focused, ordered set of behavioural "
            "rules (roughly 20 or fewer) with no duplicated/overlapping rules diluting each other. A long "
            "unordered pile of redundant rules = FAIL."),
    "p33": ("If this prompt contains per-call-direction conversation flows (inbound/outbound/followup): is each "
            "direction SELF-CONTAINED — no step referring to a step that exists only under another direction "
            "(e.g. 'as in step 3 above' pointing outside its own direction)? Any dangling cross-direction "
            "reference = FAIL. If there are no per-direction flows at all, PASS."),
    "p36": ("If this prompt contains per-lead-status conversation stages: does each stage STAND ALONE — no stage "
            "referencing another status's stage (which would be sliced out at runtime, leaving a dangling "
            "reference)? Any cross-status reference = FAIL. If there is no staged flow, PASS."),
    "p38": ("If this prompt is visibly assembled from layers (universal/vertical/campaign sections): does each "
            "rule sit in its correct layer — no company/campaign-specific facts or examples inside a universal or "
            "vertical section (they would leak to sibling agents)? Any company-named content in a shared section "
            "= FAIL. If no layer structure is visible, PASS."),
}

_PROMPT_JUDGE_SYS = ("You are a strict QA rater for a voice-agent SYSTEM PROMPT. Answer the yes/no question "
                     "about the prompt text itself. When it FAILS, quote the offending snippet so a human "
                     "can find it. Reply as JSON: "
                     '{"pass": true|false, "reason": "<=45 words, quote the offending text"}.')


async def _prompt_judge(judge_llm, sp, rubric):
    prompt = f"QUESTION: {rubric}\n\nSYSTEM PROMPT:\n{sp[:12000]}"
    try:
        data = await judge_llm.chat_json(
            [{"role": "system", "content": _PROMPT_JUDGE_SYS}, {"role": "user", "content": prompt}],
            temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=400, enable_thinking=True,
        )
        return bool(data.get("pass")), str(data.get("reason", ""))[:400], None
    except Exception as e:
        return False, f"judge_err {str(e)[:40]}", None


_JUDGE_SYS = ("You are a strict QA rater for a voice-agent transcript. Answer the yes/no question about "
              "the AGENT's behaviour based ONLY on the transcript. Turns are numbered. Reply as JSON: "
              '{"pass": true|false, "reason": "<=12 words", "failing_turn": <turn number of the offending '
              'agent turn, or null if pass>}.')


def convo_lines(convo, numbered=False):
    lines = []
    for i, (r, c) in enumerate(convo):
        tag = f"[{i}] " if numbered else ""
        if r == "A":
            lines.append(f"{tag}Agent: {c}")
        elif r == "L":
            lines.append(f"{tag}User: {c}")
        elif r == "END":
            lines.append(f"{tag}Agent (ended call): {c}")
    return "\n".join(lines)


async def grade_judge(judge_llm, rubric, convo):
    """LLM-as-judge over a STORED transcript -> (ok, reason, failing_turn)."""
    prompt = f"QUESTION: {rubric}\n\nTRANSCRIPT:\n{convo_lines(convo, numbered=True)}"
    try:
        data = await judge_llm.chat_json(
            [{"role": "system", "content": _JUDGE_SYS}, {"role": "user", "content": prompt}],
            temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=400, enable_thinking=True,
        )
        ft = data.get("failing_turn")
        ft = int(ft) if isinstance(ft, (int, float)) and 0 <= int(ft) < len(convo) else None
        return bool(data.get("pass")), str(data.get("reason", ""))[:90], ft
    except Exception as e:
        return False, f"judge_err {str(e)[:40]}", None


# ---- the split API used by the runner --------------------------------------

def scenario_for(problem_id, variant=0):
    """(lead_lines, tools_on) for a conversation-based problem, else None.

    `variant` cycles through the base script plus SCENARIO_VARIANTS, so repeat
    runs of the same problem use DIFFERENT phrasings of the same situation."""
    if problem_id in RULE_SCENARIOS:
        base, tools = RULE_SCENARIOS[problem_id]
    elif problem_id in LLM_JUDGE_DETECTORS:
        base, _rubric, tools = LLM_JUDGE_DETECTORS[problem_id]
    else:
        return None
    options = [base] + list(SCENARIO_VARIANTS.get(problem_id, []))
    return (options[int(variant) % len(options)], tools)


def variant_count(problem_id):
    return 1 + len(SCENARIO_VARIANTS.get(problem_id, []))


async def drive_scenario(engine, system_prompt, greeting, problem_id, variant=0):
    """GENERATE one conversation for a problem. Returns (convo, ended, meta) or None."""
    sc = scenario_for(problem_id, variant)
    if sc is None:
        return None
    lines, tools_on = sc
    sim = getattr(engine, "tool_simulator", None)
    if sim is not None and tools_on:
        sim.reset_conversation()      # fresh per-call tool state, like production
    return await _drive(engine.llm, system_prompt, greeting, lines,
                        tools_on=tools_on, tool_sim=sim)  # (convo, ended, meta)


async def grade_sim(problem_id, convo, ended, judge_llm, system_prompt=None):
    """GRADE one stored conversation -> (ok, reason, failing_turn)."""
    if problem_id in RULE_CHECKERS:
        return RULE_CHECKERS[problem_id](convo, ended)
    if problem_id in LLM_JUDGE_DETECTORS:
        _lines, rubric, _tools = LLM_JUDGE_DETECTORS[problem_id]
        return await grade_judge(judge_llm, rubric, convo)
    if problem_id in PROMPT_JUDGE_DETECTORS:
        return await _prompt_judge(judge_llm, system_prompt or "", PROMPT_JUDGE_DETECTORS[problem_id])
    return False, "no grader", None


def convo_to_transcript(convo, meta=None):
    """[(role, text)] -> stored transcript rows (role: agent|user|agent_end),
    with per-turn latency_ms/tokens when meta is provided."""
    out = []
    for i, (r, c) in enumerate(convo):
        role = "agent" if r == "A" else "user" if r == "L" else "agent_end"
        row = {"role": role, "content": c}
        m = (meta or {}).get(i)
        if isinstance(m, dict):
            row["latency_ms"] = m.get("latency_ms")
            row["ttft_ms"] = m.get("ttft_ms")
            row["tokens"] = m.get("tokens")
        out.append(row)
    return out


def available_problem_ids():
    """Problem ids this library can actually test (the runner intersects with has_detector)."""
    return sorted(set(RULE_SCENARIOS) | set(LLM_JUDGE_DETECTORS) | set(PROMPT_JUDGE_DETECTORS))


def verdict_from_votes(passes, votes):
    """The tiered verdict math (unchanged): majority for small screens, ratio at scale."""
    ratio = passes / votes if votes else 0.0
    if votes >= 10:
        return "Y" if ratio >= 0.9 else ("N" if ratio <= 0.5 else "~")
    fails = votes - passes
    if passes >= (votes // 2 + 1):
        return "Y"
    if fails >= (votes // 2 + 1):
        return "N"
    return "~"


async def run_detector(engine, system_prompt, problem_id, greeting="", votes=3):
    """Fused drive+grade wrapper (verify / ad-hoc). best-of-`votes` -> verdict dict."""
    judge = getattr(engine, "user_llm", None) or engine.llm
    if problem_id in PROMPT_JUDGE_DETECTORS:
        ok, ev, _ft = await _prompt_judge(judge, system_prompt, PROMPT_JUDGE_DETECTORS[problem_id])
        passes = votes if ok else 0  # temp-0 prompt inspection is deterministic
        return {"verdict": verdict_from_votes(passes, votes), "passes": passes, "votes": votes,
                "evidence": f"{passes}/{votes} {ev}"}
    if scenario_for(problem_id) is None:
        return {"verdict": None, "passes": 0, "votes": 0, "evidence": "no detector"}

    import asyncio as _asyncio

    async def one(k=0):
        try:
            convo, ended, _meta = await drive_scenario(engine, system_prompt, greeting, problem_id, variant=k)
            ok, ev, _ft = await grade_sim(problem_id, convo, ended, judge, system_prompt=system_prompt)
            return bool(ok), ev
        except Exception as e:
            return False, f"ERR {str(e)[:40]}"

    # Votes run CONCURRENTLY (the global LLM semaphore throttles the endpoint).
    results = await _asyncio.gather(*[one(k) for k in range(votes)])
    passes = sum(1 for ok, _ in results if ok)
    ev = next((e for ok, e in results if ok), results[0][1] if results else "")
    return {"verdict": verdict_from_votes(passes, votes), "passes": passes, "votes": votes,
            "evidence": f"{passes}/{votes} {ev}"}


# ==========================================================================
# DATASET-OBSERVATION grading (arena default): X free dataset conversations
# per LLM; each problem is checked FOR OCCURRENCE inside those conversations.
# Never appeared anywhere -> solved. Appeared -> failed, with the convo as proof.
# ==========================================================================

# Purely mechanical checkers that are valid on ANY transcript (no scripted setup
# needed): ok=True means the problem did NOT occur in this conversation.
MECHANICAL_CHECKERS = {
    "p2": _ck_over_ack, "p3": _ck_repetition, "p15": _ck_numbers,
    "p29": _ck_lang_drift, "p30": _ck_formatting,
}

_OBS_JUDGE_SYS = (
    "You are a strict QA rater for a voice-agent transcript. You are checking whether ONE "
    "specific PROBLEM BEHAVIOUR occurred in this conversation. If the situation that would "
    "trigger the problem never arose in this conversation, the problem did NOT occur. "
    "Turns are numbered. Reply as JSON: "
    '{"occurred": true|false, "reason": "<=14 words", "failing_turn": <turn number where it '
    "occurred, or null>}."
)


async def observe_problem(judge_llm, behaviour, convo):
    """Did `behaviour` occur in this stored conversation? -> (occurred, reason, failing_turn)."""
    prompt = f"PROBLEM BEHAVIOUR: {behaviour}\n\nTRANSCRIPT:\n{convo_lines(convo, numbered=True)}"
    try:
        data = await judge_llm.chat_json(
            [{"role": "system", "content": _OBS_JUDGE_SYS}, {"role": "user", "content": prompt}],
            temperature=DEFAULT_JUDGE_TEMPERATURE, max_tokens=400, enable_thinking=True,
        )
        ft = data.get("failing_turn")
        ft = int(ft) if isinstance(ft, (int, float)) and 0 <= int(ft) < len(convo) else None
        return bool(data.get("occurred")), str(data.get("reason", ""))[:90], ft
    except Exception as e:
        return False, f"judge_err {str(e)[:40]}", None


def transcript_to_convo(transcript):
    """Stored transcript rows -> convo tuples for the checkers/judges."""
    out = []
    for t in transcript or []:
        r = t.get("role")
        out.append(("A" if r == "agent" else "L" if r == "user" else "END", t.get("content") or ""))
    return out
