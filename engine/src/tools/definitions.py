TOOL_DEFINITIONS = {
    "end_call": {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": "End the call. Use when the conversation has naturally concluded or the user wants to stop talking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Short polite closing message.",
                    }
                },
            },
        },
    },
    "voicemail_detected": {
        "type": "function",
        "function": {
            "name": "voicemail_detected",
            "description": "Call IMMEDIATELY when the call hits voicemail or an answering machine.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "warm_transfer_call": {
        "type": "function",
        "function": {
            "name": "warm_transfer_call",
            "description": "Transfer the current call to a human supervisor using a warm transfer.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "switch_agent": {
        "type": "function",
        "function": {
            "name": "switch_agent",
            "description": "Transfer the caller to a different agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_agent_id": {
                        "type": "string",
                        "description": "The exact agent ID to switch to.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why the switch is needed.",
                    },
                },
                "required": ["target_agent_id"],
            },
        },
    },
    "search_knowledge_base": {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "Search the knowledge base for additional information to answer the user's question.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The specific question to search for.",
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
            "description": "Send a WhatsApp message template to the user.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "date_calculator": {
        "type": "function",
        "function": {
            "name": "date_calculator",
            "description": "Calculates the exact calendar date from a normalized date expression like 'next Monday' or 'day after tomorrow'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Normalized date expression (e.g., 'next Monday', 'tomorrow').",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    "handle_call_screening": {
        "type": "function",
        "function": {
            "name": "handle_call_screening",
            "description": "Respond to an automated call-screening system (iOS/Android).",
            "parameters": {
                "type": "object",
                "properties": {
                    "screening_message": {
                        "type": "string",
                        "description": "Your name and company to identify yourself.",
                    }
                },
            },
        },
    },
    "irrelevant_interruption": {
        "type": "function",
        "function": {
            "name": "irrelevant_interruption",
            "description": "Call when the user says something completely unrelated to the conversation topic.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
}
