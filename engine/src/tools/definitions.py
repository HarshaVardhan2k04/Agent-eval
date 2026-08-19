# Byte-faithful mirrors of the production tool declarations in
# engage-voice-agents/core/call_tools/*.py. LiveKit turns each @function_tool()
# into build_legacy_openai_schema(): name = __name__, description = docstring,
# parameters = pydantic schema of the signature (RunContext excluded, Optional
# fields rendered as anyOf[type,null] with a default). Keeping the SAME text
# matters: the docstrings carry the trigger lists the model actually obeys.

# Production always-on set (orchestrator.get_tools) — everything else is gated
# on the campaign's available_tools metadata.
CORE_TOOLS = ["end_call", "voicemail_detected", "handle_call_screening", "date_calculator"]

TOOL_DEFINITIONS = {
    "end_call": {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": (
                "End the call. Use when the user wants to stop talking.\n"
                "Triggers: 'bye', 'end the call', 'hang up', 'disconnect', 'that is all', 'done'.\n"
                "Do NOT generate any text response. Just call this tool directly."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                        "default": None,
                        "description": "Short polite closing message. Example: 'Thank you for your time. Have a great day.'",
                    }
                },
            },
        },
    },
    "voicemail_detected": {
        "type": "function",
        "function": {
            "name": "voicemail_detected",
            "description": (
                "Call IMMEDIATELY when the call hits voicemail or an answering machine — very common on iOS "
                "when the user doesn't pick up.\n"
                "Trigger on: pre-recorded greetings, carrier voicemail, or a beep after a short recording.\n"
                "DO NOT call if a live human is speaking or if iOS call screening is active (use handle_call_screening instead).\n"
                "specific keywords to trigger this tool: \"voicemail\", \"answering machine\", \"mailbox not available\"\n"
                "Ends the call silently.\n"
                "To end call normally in end of the conversation or when required use end_call tool not this"
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "handle_call_screening": {
        "type": "function",
        "function": {
            "name": "handle_call_screening",
            "description": (
                "Respond to an automated call-screening system that is filtering the call before connecting "
                "to the real person.\n\n"
                "Call this tool when the FIRST thing you hear is an automated or robotic message instead of a "
                "real person, such as:\n"
                "- \"See if this person is available\"\n"
                "- \"If this person is available please\"\n"
                "- \"Please state your name and reason for calling\"\n"
                "- \"The person you are calling is screening their calls\"\n"
                "- Any automated prompt checking caller identity before connecting\n\n"
                "Do NOT use this for voicemail or answering machines — use voicemail_detected instead.\n"
                "Do NOT use this when a real human answers the call."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "screening_message": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                        "default": None,
                        "description": "One sentence: your name and company. Leave empty to auto-generate.",
                    }
                },
            },
        },
    },
    "irrelevant_interruption": {
        "type": "function",
        "function": {
            "name": "irrelevant_interruption",
            "description": (
                "Call this tool when the user says something completely unrelated to the purpose of this call. "
                "Do NOT generate any text response. Just call this tool directly with no arguments.\n\n"
                "WHEN TO CALL:\n"
                "- User talks about random unrelated topics (weather, sports, jokes, stories)\n"
                "- User says gibberish, random words, or nonsensical sentences\n"
                "- User is clearly not engaging with the conversation (singing, talking to someone else)\n"
                "- User says abusive, vulgar, or offensive language not directed at ending the call\n\n"
                "WHEN NOT TO CALL — NEVER call this tool for these:\n"
                "- Filler words or thinking sounds: \"ah\", \"um\", \"hmm\", \"uh\", \"aah\"\n"
                "- Short acknowledgements: \"yes\", \"no\", \"okay\", \"ok\", \"yeah\", \"haan\", \"nahi\", \"accha\"\n"
                "- User asks a legitimate question even if off-script (use your knowledge to answer)\n"
                "- User says \"bye\", \"not interested\", \"stop calling\" (use end_call instead)\n"
                "- User is confused but trying to engage with the topic\n"
                "- User asks to speak to a real person or manager (use transfer tools instead)\n"
                "- Silence or very short pauses"
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "date_calculator": {
        "type": "function",
        "function": {
            "name": "date_calculator",
            "description": (
                "Calculates the exact calendar date from a normalized date expression.\n"
                "ALWAYS call this tool whenever the user mentions any day, date, or timeframe — for scheduling,\n"
                "follow-ups, callbacks, site visits, or anything time-related.\n"
                "Never calculate or guess dates yourself — always use this tool.\n"
                "First normalize what the user said into the required format, then call this tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": (
                            "A normalized date expression you construct from what the user said. "
                            "You MUST convert the user's words into one of these exact formats before calling:\n"
                            "- 'today'\n"
                            "- 'tomorrow'\n"
                            "- 'after X days'  (e.g. 'after 3 days')\n"
                            "- 'after X weeks' (e.g. 'after 2 weeks')\n"
                            "- 'after X months' (e.g. 'after 2 months')\n"
                            "- 'next month'\n"
                            "- 'next week'\n"
                            "- 'end of this month' (or 'end of month')\n"
                            "- 'this weekend' or 'next weekend'\n"
                            "- 'next [weekday]' (e.g. 'next friday')\n"
                            "- 'this [weekday]' (e.g. 'this monday')\n"
                            "Examples: user says 'how about this coming Saturday' → pass 'this saturday'; "
                            "user says 'call me in a couple of days' → pass 'after 2 days'; "
                            "user says 'end of this month' → pass 'end of this month'."
                        ),
                    }
                },
                "required": ["expression"],
            },
        },
    },
    "search_knowledge_base": {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "Search the knowledge base for additional information.\n\n"
                "You already receive relevant context before each response. Only call this tool\n"
                "when that context is insufficient — for example, the user asks something specific\n"
                "that was not covered, asks a follow-up that needs more detail, or you are not\n"
                "confident in your answer.\n\n"
                "Do NOT call this for greetings, acknowledgements, or general conversation.\n"
                "You can call this multiple times with different focused queries if needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The specific question or topic to search for. Be precise — a focused query returns better results than a vague one.",
                    }
                },
                "required": ["query"],
            },
        },
    },
    "web_search": {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the LIVE web for current, real-world facts you cannot answer from the\n"
                "call context or knowledge base.\n\n"
                "Use ONLY for time-sensitive or external information that may have changed —\n"
                "today's prices, live rates, current news, weather, public addresses, or facts\n"
                "outside this campaign's scope.\n\n"
                "Do NOT use for: greetings, small talk, dates (use date_calculator), or anything\n"
                "about this campaign/product/project (use search_knowledge_base for that).\n"
                "Returns a short list of result snippets — keep your spoken answer brief."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "A specific, fully-qualified web search query. Include enough detail to point at ONE thing, "
                            "not a category — proper names and a city/state when relevant. Many projects, builders and "
                            "places share the same name across Indian states, so a bare name returns mixed, contradictory "
                            "results. Bad: 'cybercity rera number'. Good: 'Cybercity Westbrook Kokapet Hyderabad RERA registration number'. "
                            "Bad: 'gold price'. Good: 'current 22K gold rate per gram in Hyderabad today'."
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },
    "send_whatsapp_template": {
        "type": "function",
        "function": {
            "name": "send_whatsapp_template",
            "description": (
                "Send a WhatsApp message to the user. Call this tool directly, do NOT generate text.\n"
                "Triggers: user asks for brochure, location, video, or any details on WhatsApp."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "warm_transfer_call": {
        "type": "function",
        "function": {
            "name": "warm_transfer_call",
            "description": (
                "Transfer the current call to a human supervisor using a warm transfer.\n\n"
                "Use this when:\n"
                "- The caller explicitly asks to speak with a human / supervisor / manager\n"
                "- The caller is frustrated and requests escalation\n\n"
                "The caller is placed on hold while the supervisor is briefed privately.\n"
                "Once the supervisor confirms they are ready, call connect_to_caller.\n"
                "If the supervisor cannot take the call, call decline_transfer."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "switch_agent": {
        "type": "function",
        "function": {
            "name": "switch_agent",
            "description": (
                "Transfer the caller to a different agent. Use the exact agent ID from the AVAILABLE AGENTS "
                "FOR SWITCHING section in your instructions. Call this when the caller asks for a different "
                "agent or when their question matches another agent's specialty."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_agent_id": {
                        "type": "string",
                        "description": "The exact agent ID from the AVAILABLE AGENTS FOR SWITCHING list. Must match one of the listed IDs exactly.",
                    },
                    "reason": {
                        "type": "string",
                        "default": "",
                        "description": "One sentence explaining why the caller needs this agent.",
                    },
                },
                "required": ["target_agent_id"],
            },
        },
    },
    "get_location_details": {
        "type": "function",
        "function": {
            "name": "get_location_details",
            "description": (
                "Real geodata for the caller. Two modes — pick by which argument you fill:\n"
                "- DISTANCE: pass `source` + `destination` to get the distance between two places.\n"
                "- NEARBY: pass `source` + `nearby_type` to list real places (petrol pumps,\n"
                "  schools, hospitals, landmarks, etc.) near a location.\n"
                "Do NOT write the tool call as text or say the numbers before calling — call this\n"
                "tool directly and use what it returns."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": (
                            "The location to measure from or search around, as a clean, geocodable "
                            "place name — ALWAYS include the city.\n"
                            "For a distance question: the caller's area (e.g. caller says 'I live in "
                            "Nizampet' → pass 'Nizampet, Hyderabad').\n"
                            "For a 'what's nearby' question: the project's or center's area, which you "
                            "know from your instructions (e.g. pass 'Gachibowli, Hyderabad')."
                        ),
                    },
                    "destination": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                        "default": None,
                        "description": (
                            "ONLY for a distance A-to-B question. The place to measure the distance "
                            "to — pass the AREA or LOCALITY it is in, NOT the business name, and "
                            "ALWAYS include the city (the map knows localities, not shop names). "
                            "Example: for the Miyapur center → pass 'Miyapur, Hyderabad'. "
                            "For well-known city facilities (airport, railway station), do NOT ask "
                            "which one — pass the main one directly, e.g. 'Rajiv Gandhi International "
                            "Airport, Hyderabad'. Leave empty when the caller is asking what is NEARBY."
                        ),
                    },
                    "nearby_type": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                        "default": None,
                        "description": (
                            "ONLY when the caller asks what OTHER places are NEAR a location — "
                            "public places like 'petrol pump', 'school', 'college', 'hospital', "
                            "'pharmacy', 'ATM', 'bank', 'mall', 'supermarket', 'metro station', "
                            "'park', 'restaurant', 'hotel', 'cinema', 'famous place'. If the caller "
                            "asks vaguely ('anything famous nearby?'), pass 'famous place'. "
                            "NEVER use this to find OUR OWN service centers/branches/showrooms — "
                            "those are in your instructions; for 'which of our centers is nearest', "
                            "use DISTANCE mode instead (destination = each center's area). "
                            "Leave empty for a distance question."
                        ),
                    },
                },
                "required": ["source"],
            },
        },
    },
}
