"""Judge prompt for Call Analysis. Scores one call on 6 sections + 5 metrics,
grades flow adherence stage-by-stage, and lists concrete improvements.

The judge is Gemma with thinking ON (reasons before emitting the JSON verdict).
"""

CALL_ANALYSIS_SYSTEM = """You are a meticulous QA analyst for voice AI phone agents \
(insurance / sales calls, often mixing English, Hindi and Telugu). You grade how well \
the AGENT handled a real call. Be fair but exacting, and always ground scores in the \
transcript. Translate jargon into plain language. Reply with ONLY a JSON object — no prose."""

# Filled with: direction, flow_block, guidelines_block, tools_block, transcript
CALL_ANALYSIS_USER = """Grade this {direction} call.

## Behavioral guidelines the agent was told to follow
{guidelines_block}

## Intended conversation flow for a {direction} call (ordered stages)
{flow_block}

## Tools available to the agent, and which ones actually fired
{tools_block}

## Transcript (Agent / User / Supervisor)
{transcript}

## Your job
Score each of these 0–100 (100 = excellent). For every SECTION give a one-line plain-language
verdict and 1–3 short evidence quotes copied from the transcript.

SECTIONS:
- greeting_intro — warm open + did the agent identify itself/company?
- empathy — did it read and respond to the customer's emotion?
- information_push_goal — moved toward the goal smoothly (not pushy, not passive)?
- conversation_management_flow — followed the intended stage flow above?
- call_closing — ended properly (confirm next steps, warm close)?
- tool_calling — used the right tools at the right moment (judge at call level)?

METRICS (single 0–100 number each):
- customer_retention_frustration — did the customer stay engaged vs get frustrated? (100 = calm/retained)
- repetition — did the agent avoid repeating itself? (100 = no needless repetition)
- instruction_flow_following — followed guidelines + flow overall?
- tool_calling — tool usage quality overall?
- human_likeness — natural, human-sounding, not robotic?

FLOW ADHERENCE: for each intended stage, mark "hit" | "partial" | "missed" with a short note.

AREAS_OF_IMPROVEMENT: 2–5 concrete, prioritized fixes (most impactful first).

Return EXACTLY this JSON shape:
{{
  "sections": {{
    "greeting_intro": {{"score": 0, "verdict": "", "evidence": []}},
    "empathy": {{"score": 0, "verdict": "", "evidence": []}},
    "information_push_goal": {{"score": 0, "verdict": "", "evidence": []}},
    "conversation_management_flow": {{"score": 0, "verdict": "", "evidence": []}},
    "call_closing": {{"score": 0, "verdict": "", "evidence": []}},
    "tool_calling": {{"score": 0, "verdict": "", "evidence": []}}
  }},
  "metrics": {{
    "customer_retention_frustration": 0,
    "repetition": 0,
    "instruction_flow_following": 0,
    "tool_calling": 0,
    "human_likeness": 0
  }},
  "flow_adherence": [{{"stage": "", "status": "hit", "note": ""}}],
  "areas_of_improvement": [""]
}}"""
