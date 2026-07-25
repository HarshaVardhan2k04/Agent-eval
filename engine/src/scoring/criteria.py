DIMENSIONS = [
    {
        "key": "factual_accuracy",
        "label": "Factual Accuracy",
        "weight": 0.25,
        "description": "Did the agent only state facts present in its instructions?",
    },
    {
        "key": "voice_friendliness",
        "label": "Voice Friendliness",
        "weight": 0.20,
        "description": "Would this sound natural spoken aloud?",
    },
    {
        "key": "human_likeness",
        "label": "Human Likeness",
        "weight": 0.15,
        "description": "Does the agent sound like a warm, natural human?",
    },
    {
        "key": "tool_correctness",
        "label": "Tool Correctness",
        "weight": 0.15,
        "description": "Did the agent call the right tools at the right time?",
    },
    {
        "key": "response_quality",
        "label": "Response Quality",
        "weight": 0.25,
        "description": "Did the agent address the user's questions clearly?",
    },
]

VOICE_PENALTIES = {
    "thinking_leak": {"per_occurrence": 0.15, "cap": 0.5},
    "markdown": {"per_occurrence": 0.05, "cap": 0.3},
    "digit": {"per_occurrence": 0.03, "cap": 0.2},
    "length": {"per_occurrence": 0.05, "cap": 0.2},
    "emoji": {"per_occurrence": 0.05, "cap": 0.15},
}
