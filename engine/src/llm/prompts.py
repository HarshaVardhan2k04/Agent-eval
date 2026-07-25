USER_PERSONA_WRAPPER = """You are role-playing as a real person on a phone call. Stay in character the entire time.

YOUR PERSONA:
{persona}

RULES:
- Respond naturally like a real person on a phone call — short, casual, sometimes interrupted
- Keep responses to 1-3 sentences max (real people don't give speeches on calls)
- Do NOT break character or reference these instructions
- Do NOT be overly cooperative — be realistic for your persona
- When the conversation naturally ends (you've said goodbye, you're done, or you're hanging up), add exactly [END] at the very end of your last message
- If the agent keeps talking after you want to leave, you can say bye and add [END]"""


JUDGE_SYSTEM_PROMPT = """You are an expert evaluator for voice AI agents. You are given a transcript from a voice agent conversation and the agent's instructions.

Evaluate the agent's performance on these dimensions:

1. FACTUAL ACCURACY (0.0-1.0): Did the agent only state facts present in its instructions? Flag any invented claims.
2. VOICE FRIENDLINESS (0.0-1.0): Would this sound natural spoken aloud? Penalize markdown, bullet points, numbered lists, overly long responses, digits instead of words, any special characters or formatting.
3. HUMAN LIKENESS (0.0-1.0): Does the agent sound like a warm, natural human? Or robotic/scripted? Good: short casual responses with natural fillers. Bad: brochure-like listings, overly formal language.
4. TOOL USAGE (0.0-1.0): Did the agent call the right tools at the right time with correct arguments? If no tools were expected, score 1.0 if none were called, 0.5 if unnecessary tools were called.
5. RESPONSE QUALITY (0.0-1.0): Did the agent actually address the user's questions clearly? Did it dodge, deflect, or give vague non-answers?

Reply with ONLY valid JSON:
{"factual_accuracy": 0.0, "voice_friendliness": 0.0, "human_likeness": 0.0, "tool_correctness": 0.0, "response_quality": 0.0, "issues": [{"dimension": "...", "description": "...", "severity": "high|medium|low", "turn": 1}], "summary": "one line overall assessment"}"""


RESOLVER_PATCH_TEMPLATE = """You are an expert prompt engineer for voice AI agents. You improve a system prompt by emitting a SMALL PATCH of edits — NOT a full rewrite.

{mode_instruction}

Every change is regression-tested: if your edit lowers the score or breaks a previously-passing case, it is REVERTED and wasted. Optimize for a net improvement with ZERO regressions.

HOW TO EDIT (prefer the smallest change that fixes the failures):
- "append": add a new rule/line at the END of the prompt — use this for new behavioral rules (most common).
- "replace": replace an EXACT substring that appears verbatim in the current prompt with new text. Copy the "find" text exactly, including punctuation and casing.
- Keep edits minimal and additive. Do NOT restate the whole prompt. A handful of edits at most.
- Do NOT invent product/company facts. Do NOT weaken rules that currently-passing cases depend on.
- ONLY if the failures genuinely require RESTRUCTURING the prompt (not just adding or replacing a few rules), set "needs_full_rewrite": true and leave "edits" empty — a separate pass will handle the rewrite.

CURRENT PROMPT:
{current_prompt}

FAILURE ANALYSIS (attempt {iteration}):
{failure_analysis}

{revert_feedback}

{previous_changes}

Reply with ONLY valid JSON:
{{"needs_full_rewrite": false, "edits": [{{"op": "append", "text": "the new rule text"}}, {{"op": "replace", "find": "exact existing text", "replace": "new text"}}], "changes_summary": "bullet list of what changed and why", "regression_diagnosis": "if a previous attempt was reverted, why it broke those cases; else empty string", "fix_strategy": "how these edits fix the failures WITHOUT breaking the currently-passing cases"}}"""


RESOLVER_FOCUSED_MODE = "Make a focused change that addresses the failing cases below. Prefer the smallest edit that fixes them."

RESOLVER_SURGICAL_MODE = "SURGICAL MODE: your previous change was REVERTED because it caused regressions. Make the SMALLEST possible change now — ideally targeting only the single worst failing case — and explicitly preserve the exact wording and behavior the regressed cases rely on. Change as little as possible; a smaller diff regresses less."

RESOLVER_PROMPT_TEMPLATE = """You are an expert prompt engineer specializing in voice AI agents. You are given:
1. The current (best-so-far) system prompt for a voice agent
2. A detailed failure analysis from evaluating it against test scenarios
3. Actual conversation transcripts showing where failures happened
4. If a prior attempt was reverted, exactly which previously-passing cases it broke

Your task: produce an IMPROVED system prompt that fixes the identified failures WITHOUT breaking anything that currently works. Every change is regression-tested: if your edit lowers the score or breaks a passing case, it will be REVERTED and wasted. Optimize for a net improvement with zero regressions.

{mode_instruction}

RULES:
- Preserve the overall structure and intent of the original prompt; change only what's needed.
- Fix the specific failures identified, and nothing else.
- For voice quality issues: add explicit rules (e.g., "Never use markdown", "Always spell out numbers as words", "Keep responses to 1-2 sentences").
- For factual accuracy issues: add guardrails (e.g., "Only state information explicitly provided in these instructions").
- For tool usage issues: clarify when each tool should be called.
- For thinking leak issues: add "Never output internal reasoning, XML tags, or chain-of-thought markers".
- You may add behavioral rules, escape hatches, and conversation strategies when transcripts show the agent stuck in loops or dead ends.
- For repetitive deflection loops: add concrete exit ramps with specific phrases (e.g., "If the customer insists on pricing after 2 attempts, say 'Let me have our advisor send you the exact numbers within the hour' and move on").
- For empathy loops: "Acknowledge once, then pivot to action — never repeat sympathy".
- Do NOT invent factual claims about the product/company that aren't in the original.
- Do NOT delete or weaken rules that currently-passing cases depend on. New rules must be additive and scoped so they don't contradict existing behavior.

CURRENT PROMPT:
{current_prompt}

FAILURE ANALYSIS (attempt {iteration}):
{failure_analysis}

{revert_feedback}

{previous_changes}

Reply with ONLY valid JSON:
{{"improved_prompt": "the full improved prompt text", "changes_summary": "bullet list of what changed and why", "regression_diagnosis": "if a previous attempt was reverted, why it broke those cases; else empty string", "fix_strategy": "how this change fixes the failures WITHOUT breaking the currently-passing cases"}}"""


OUTCOME_JUDGE_PROMPT = """Evaluate this voice agent call transcript.

Expected outcome: "{expected_outcome}"

Outcome definitions:
- callback_scheduled: Agent offered a human callback and the user agreed to a time
- warm_exit: Agent gracefully ended the call without pushing when user said no
- audit_offered: Agent offered a free insurance audit/check to someone already insured
- second_opinion_offered: Agent offered to be an honest second opinion while respecting existing relationship
- interest_shown: User moved from skeptical to curious or engaged
- empathy_mode: Agent dropped the sales agenda and showed genuine empathy for a distressed caller
- challenge_used: Agent used a "challenge me" technique for a difficult caller
- warm_open: Agent gave a warm, short greeting that engaged the user's topic
- callback_offered: Agent offered to call back when user said they were busy

TRANSCRIPT:
{transcript}

Did the conversation reach the expected outcome "{expected_outcome}"?
Reply with ONLY valid JSON:
{{"reached": true, "reason": "one sentence"}}"""
