# Simulates the production tool layer (engage-voice-agents/core/call_tools/*).
# The MECHANISM matches production exactly: native OpenAI tools param in, native
# tool_calls out (vLLM --tool-call-parser gemma4 parses server-side), results fed
# back as role:"tool" messages. This module supplies the same schemas, the same
# argument-repair behaviour (LiveKit parse_function_arguments), and the same
# return-string shapes the real tools produce, so a simulated agent behaves like
# the deployed one.
import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta

from src.tools.definitions import CORE_TOOLS, TOOL_DEFINITIONS

# Exact return strings of the production tools (call_management.py etc.).
MOCK_RESPONSES = {
    "end_call": "Call ended successfully",
    "voicemail_detected": "Voicemail detected, call ended",
    "warm_transfer_call": "Please hold while I connect you to our team.",
    "switch_agent": "Successfully switched. Introduce yourself as the new agent.",
    "send_whatsapp_template": "Sent brochure on WhatsApp. Tell the user to check their WhatsApp.",
    "handle_call_screening": "Call screening handled. Wait silently for user response.",
}

_IST = ZoneInfo("Asia/Kolkata")
_WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}
_MONTHS = {"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
           "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}
_ORDINALS = {"first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4}
_TEMPLATE_TOKEN_RE = re.compile(r"<\|[^|]*\|?>")


def parse_arguments(raw):
    """Mirror LiveKit's parse_function_arguments(): strict JSON first, then
    json_repair, then strip leaked <|...|> chat-template tokens, and unwrap
    double-encoded string arguments. Gemma intermittently needs all three."""
    if isinstance(raw, dict):
        return raw
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        from json_repair import repair_json
        cleaned = _TEMPLATE_TOKEN_RE.sub("", text)
        parsed = repair_json(cleaned, return_objects=True)
    if isinstance(parsed, str):  # double-encoded: '"{\"query\": ...}"'
        try:
            parsed = json.loads(parsed)
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}


def _compute_date(expression):
    """Port of the production date_calculator body (call_management.py:668-749),
    including its exact return-string format — the agent speaks from this string."""
    now = datetime.now(_IST)
    today = now.date()
    today_str = today.strftime("%A, %B %d, %Y")
    expr = (expression or "").lower().strip()
    target = None

    if expr == "today":
        target = today
    elif "day after tomorrow" in expr:
        target = today + timedelta(days=2)
    elif expr == "tomorrow":
        target = today + timedelta(days=1)
    else:
        m = re.search(r"(?:in|after)\s+(\d+)\s+days?", expr)
        if m:
            target = today + timedelta(days=int(m.group(1)))
        if target is None:
            m = re.search(r"(?:in|after)\s+(\d+)\s+weeks?", expr)
            if m:
                target = today + timedelta(weeks=int(m.group(1)))
        if target is None:
            m = re.search(r"(?:in|after)\s+(\d+)\s+months?", expr)
            if m:
                target = today + relativedelta(months=int(m.group(1)))
        if target is None and ("end of this month" in expr or "end of the month" in expr or expr == "end of month"):
            next_month_first = today.replace(day=1) + relativedelta(months=1)
            target = next_month_first - timedelta(days=1)
        # an ORDINAL weekday phrase ("second saturday of next month") must not be
        # swallowed by the plain next-month branch — that returned a wrong weekday.
        _has_ordinal_wd = bool(re.search(
            r"(first|second|third|fourth|fifth|last)\s+"
            r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)", expr))
        if target is None and "next month" in expr and not _has_ordinal_wd:
            target = today + relativedelta(months=1)
        if target is None and expr == "next week":
            target = today + timedelta(weeks=1)
        if target is None and "weekend" in expr:
            wd = today.weekday()
            this_sat_offset = 0 if wd >= 5 else (5 - wd)
            if "next" in expr:
                offset = 6 if wd == 6 else (7 if wd == 5 else this_sat_offset + 7)
            else:
                offset = this_sat_offset
            target = today + timedelta(days=offset)
        if target is None:
            m = re.search(
                r"(first|second|third|fourth|fifth|last)\s+"
                r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:of|in)\s+"
                r"(january|february|march|april|may|june|july|august|september|october|november|december"
                r"|next month|this month)(?:\s+(\d{4}))?",
                expr)
            if m:
                ordinal, day_name, month_tok, year_str = m.groups()
                wd = _WEEKDAYS[day_name]
                if month_tok == "next month":
                    ref = today + relativedelta(months=1)
                    month_num, year = ref.month, ref.year
                elif month_tok == "this month":
                    month_num, year = today.month, today.year
                else:
                    month_num = _MONTHS[month_tok]
                    year = int(year_str) if year_str else today.year
                def _nth(y, mo):
                    first = today.replace(year=y, month=mo, day=1)
                    if ordinal == "last":
                        last = first + relativedelta(months=1) - timedelta(days=1)
                        return last - timedelta(days=(last.weekday() - wd) % 7)
                    cand = first + timedelta(days=(wd - first.weekday()) % 7 + 7 * _ORDINALS[ordinal])
                    return cand if cand.month == mo else None
                target = _nth(year, month_num)
                if target is None:
                    return (f"today is '{today_str}' so '{expression}' does not exist — "
                            f"there is no {ordinal} {day_name} in that month. "
                            "Please ask the user for a different day.")
                if not year_str and month_tok not in ("next month", "this month") and target < today:
                    target = _nth(year + 1, month_num)

        # Bare-weekday fallback ONLY when the phrase isn't month-anchored — guessing
        # "nearest saturday" for "second saturday of september" returns a confidently
        # wrong date and sends the model into a tool-retry loop (production bug, fixed there too).
        if target is None and " of " not in expr and not any(mn in expr for mn in _MONTHS):
            for day_name, weekday_num in _WEEKDAYS.items():
                if day_name in expr:
                    days_until = (weekday_num - today.weekday()) % 7
                    if "next" in expr and days_until == 0:
                        days_until = 7
                    target = today + timedelta(days=days_until)
                    break

    if target is None:
        return (
            f"today is '{today_str}' so '{expression}' could not be resolved — "
            "please ask the user to clarify the exact day or timeframe."
        )
    resolved_str = target.strftime("%A, %B %d, %Y")
    return f"today is '{today_str}' so {expression} will be '{resolved_str}'"


class ToolSimulator:
    # Production gates on metadata STRINGS, which don't all equal the function name
    # (orchestrator.py: "warm_transfer" -> warm_transfer_call). Feeding a real
    # campaign's available_tools straight in used to silently drop those tools.
    ALIASES = {"warm_transfer": "warm_transfer_call", "transfer": "warm_transfer_call",
               "whatsapp": "send_whatsapp_template", "rag": "search_knowledge_base",
               "knowledge_base": "search_knowledge_base", "geolocation": "get_location_details",
               "location": "get_location_details"}

    def __init__(self, enabled_tools, rag_client=None):
        # Production orchestrator semantics: the 4 core tools are ALWAYS on;
        # everything else is gated on the campaign's available_tools list.
        resolved, unknown = [], []
        for t in (enabled_tools or []):
            name = self.ALIASES.get(t, t)
            if name in TOOL_DEFINITIONS:
                resolved.append(name)
            else:
                unknown.append(t)
        if unknown:
            import logging
            logging.getLogger(__name__).warning(
                "ToolSimulator: no schema for %s — these tools will NOT be offered to the model",
                ", ".join(sorted(set(unknown))))
        gated = [t for t in resolved if t not in CORE_TOOLS]
        self.enabled_tools = CORE_TOOLS + gated
        self.rag_client = rag_client
        self._irrelevant_count = 0

    def reset_conversation(self):
        """Per-call state (mirrors fresh session userdata per production call)."""
        self._irrelevant_count = 0

    def get_schemas(self):
        return [TOOL_DEFINITIONS[t] for t in self.enabled_tools if t in TOOL_DEFINITIONS]

    async def execute(self, tool_name, arguments):
        # Unknown/disabled tool → same feedback the production ToolError gives the
        # model (generation.py:615-621), so it can self-correct next turn.
        if tool_name not in self.enabled_tools:
            return (f"Unknown function: {tool_name} - available tools: "
                    f"{', '.join(self.enabled_tools)}")

        args = parse_arguments(arguments)

        if tool_name == "search_knowledge_base":
            if self.rag_client:
                results = await self.rag_client.search(args.get("query", ""))
                if results:
                    return self.rag_client.format_results(results)
                return "No relevant information found in the knowledge base."
            return "Knowledge base not available for this session."

        if tool_name == "date_calculator":
            return _compute_date(args.get("expression", ""))

        # warm_transfer_call is TERMINAL here: the call leaves the agent for a human,
        # and the supervisor leg is verified outside this system. Nothing after it is
        # the agent-under-test's behaviour, so the evaluated conversation stops.
        if tool_name == "irrelevant_interruption":
            self._irrelevant_count += 1
            return f"Handled irrelevant interruption (count={self._irrelevant_count})"

        if tool_name == "web_search":
            q = args.get("query", "")
            return (f"Web search results for '{q}':\n"
                    "1. [simulated] No live web access in evaluation — treat as a brief factual snippet.\n"
                    "Keep your spoken answer brief.")

        if tool_name == "get_location_details":
            src = args.get("source", "the area")
            dest = args.get("destination")
            nearby = args.get("nearby_type")
            if dest:
                return (f"The distance from {src} to {dest} is approximately 12.4 km, "
                        "about 30 minutes by road in normal traffic.")
            if nearby:
                return (f"Places near {src} ({nearby}): 1. Sunrise {nearby.title()} (750 m) "
                        f"2. City {nearby.title()} (1.8 km) 3. Metro {nearby.title()} (2.4 km)")
            return "Please provide either a destination (distance) or a nearby_type (nearby search)."

        return MOCK_RESPONSES.get(tool_name, f"Tool '{tool_name}' executed successfully.")
