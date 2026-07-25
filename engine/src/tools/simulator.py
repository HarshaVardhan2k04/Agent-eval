import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from src.tools.definitions import TOOL_DEFINITIONS


MOCK_RESPONSES = {
    "end_call": "Call ended successfully.",
    "voicemail_detected": "Voicemail detected, call ended.",
    "warm_transfer_call": "Please hold while I connect you to our team.",
    "switch_agent": "Successfully switched. Introduce yourself as the new agent.",
    "send_whatsapp_template": "Sent brochure on WhatsApp. Tell the user to check their WhatsApp.",
    "handle_call_screening": "Call screening handled. Wait silently for user response.",
    "irrelevant_interruption": "Handled irrelevant interruption.",
}


def _compute_date(expression):
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    expr = expression.lower().strip()

    if "tomorrow" in expr:
        target = now + timedelta(days=1)
    elif "day after tomorrow" in expr:
        target = now + timedelta(days=2)
    elif "next" in expr:
        days_map = {
            "monday": 0, "tuesday": 1, "wednesday": 2,
            "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
        }
        for day_name, day_num in days_map.items():
            if day_name in expr:
                days_ahead = day_num - now.weekday()
                if days_ahead <= 0:
                    days_ahead += 7
                target = now + timedelta(days=days_ahead)
                break
        else:
            target = now + timedelta(days=1)
    else:
        target = now

    return target.strftime("%A, %B %d, %Y")


class ToolSimulator:
    def __init__(self, enabled_tools, rag_client=None):
        self.enabled_tools = enabled_tools or []
        self.rag_client = rag_client

    def get_schemas(self):
        return [
            TOOL_DEFINITIONS[t]
            for t in self.enabled_tools
            if t in TOOL_DEFINITIONS
        ]

    async def execute(self, tool_name, arguments):
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})

        if tool_name == "search_knowledge_base" and self.rag_client:
            results = await self.rag_client.search(args.get("query", ""))
            if results:
                return self.rag_client.format_results(results)
            return "No relevant information found in the knowledge base."

        if tool_name == "date_calculator":
            return _compute_date(args.get("expression", ""))

        return MOCK_RESPONSES.get(tool_name, f"Tool '{tool_name}' executed successfully.")
