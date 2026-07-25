from datetime import datetime
from zoneinfo import ZoneInfo


class ContextBuilder:
    def build(self, base_prompt, context_data):
        parts = []

        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        parts.append(
            "**IMPORTANT: CURRENT DATE AND TIME REFERENCE**\n"
            f"Today's date and time is: {now.strftime('%A, %B %d, %Y, %I:%M %p IST')}.\n"
            "Use this as a reference for all date and time related calculations during the call. "
            "All time references by the lead/customer should be interpreted relative to this timestamp."
        )

        lead = context_data.get("lead", {})
        lead_parts = []
        if lead.get("lead_name"):
            lead_parts.append(f"Customer Name: {lead['lead_name']}")
        if lead.get("lead_status"):
            lead_parts.append(f"Lead Status: {lead['lead_status']}")
        if context_data.get("direction"):
            lead_parts.append(f"Call Direction: {context_data['direction']}")
        if lead_parts:
            parts.append("**LEAD INFORMATION:**\n" + "\n".join(lead_parts))

        if lead.get("extracted_data"):
            items = []
            for k, v in lead["extracted_data"].items():
                if v and v != "N/A":
                    items.append(f"- {k}: {v}")
            if items:
                parts.append("**LEAD DETAILS:**\n" + "\n".join(items))

        if context_data.get("followup_reason"):
            parts.append(
                "**FOLLOW-UP CALL CONTEXT:**\n"
                f"Reason for follow-up: {context_data['followup_reason']}"
            )

        if lead.get("lead_summary"):
            parts.append(f"**LEAD SUMMARY:**\n{lead['lead_summary']}")

        if lead.get("call_notes"):
            parts.append(f"**CALL NOTES (Past Interactions):**\n{lead['call_notes']}")

        if lead.get("whatsapp_notes"):
            parts.append(f"**WHATSAPP CONVERSATION SUMMARY:**\n{lead['whatsapp_notes']}")

        context_block = "\n\n".join(parts)
        return context_block + "\n\n" + base_prompt
