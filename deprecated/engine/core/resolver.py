from collections import defaultdict

from src.config import (
    DEFAULT_RESOLVER_TEMPERATURE,
    DEFAULT_RESOLVER_MAX_TOKENS,
    DEFAULT_COACH_PATCH_MAX_TOKENS,
)
from src.llm.prompts import (
    RESOLVER_PROMPT_TEMPLATE,
    RESOLVER_PATCH_TEMPLATE,
    RESOLVER_FOCUSED_MODE,
    RESOLVER_SURGICAL_MODE,
)


class Resolver:
    def __init__(self, llm_client):
        self.llm = llm_client
        self._previous_changes = []

    async def improve(self, current_prompt, judged_results, attempt, revert_history=None, surgical=False):
        """Propose an improved prompt.

        current_prompt   : the champion (best-so-far) prompt to build on.
        judged_results   : the champion's judged scenario results (its current failures).
        attempt          : attempt number, for logging in the prompt.
        revert_history   : list of ALL reverted attempts in the current streak (cleared on accept),
                           each a dict (attempt, changes, score_before, score_after, regressed, reason).
                           Lets the coach avoid every dead end it has already hit, not just the last.
        surgical         : when True, instruct the coach to make the smallest possible change.

        Returns (improved_prompt, changes_summary, regression_diagnosis, fix_strategy).
        """
        failure_analysis = self._build_failure_analysis(judged_results)

        previous = ""
        if self._previous_changes:
            previous = (
                "ACCEPTED CHANGES SO FAR (already working — do not revert these):\n"
                + "\n".join(f"- {c}" for c in self._previous_changes)
            )

        mode_instruction = RESOLVER_SURGICAL_MODE if surgical else RESOLVER_FOCUSED_MODE
        revert_feedback = self._build_revert_feedback(revert_history) if revert_history else ""

        # --- Pass 1: cheap patch attempt (thinking ON, small output) ---
        patch_prompt = RESOLVER_PATCH_TEMPLATE.format(
            current_prompt=current_prompt,
            iteration=attempt,
            failure_analysis=failure_analysis,
            mode_instruction=mode_instruction,
            revert_feedback=revert_feedback,
            previous_changes=previous,
        )

        try:
            data = await self.llm.chat_json(
                [{"role": "user", "content": patch_prompt}],
                temperature=DEFAULT_RESOLVER_TEMPERATURE,
                max_tokens=DEFAULT_COACH_PATCH_MAX_TOKENS,
                enable_thinking=True,
            )
        except ValueError:
            return current_prompt, "Coach failed to produce a valid patch", "", "", []

        changes = data.get("changes_summary", "No changes described")
        diagnosis = data.get("regression_diagnosis", "")
        strategy = data.get("fix_strategy", "")
        needs_rewrite = bool(data.get("needs_full_rewrite"))

        if not needs_rewrite:
            edits = data.get("edits") or []
            improved, applied = self._apply_edits(current_prompt, edits)
            if applied > 0:
                return improved, changes, diagnosis, strategy, edits
            # Patch produced nothing applicable (e.g. a "replace" whose text wasn't
            # found) — fall through to a full rewrite rather than a no-op.

        # --- Pass 2 (escalation only): full rewrite, thinking OFF for output room ---
        return await self._full_rewrite(
            current_prompt, failure_analysis, attempt,
            mode_instruction, revert_feedback, previous,
            fallback=(changes, diagnosis, strategy),
        )

    async def _full_rewrite(self, current_prompt, failure_analysis, attempt,
                            mode_instruction, revert_feedback, previous, fallback):
        prompt = RESOLVER_PROMPT_TEMPLATE.format(
            current_prompt=current_prompt,
            iteration=attempt,
            failure_analysis=failure_analysis,
            mode_instruction=mode_instruction,
            revert_feedback=revert_feedback,
            previous_changes=previous,
        )
        fb_changes, fb_diag, fb_strat = fallback
        try:
            data = await self.llm.chat_json(
                [{"role": "user", "content": prompt}],
                temperature=DEFAULT_RESOLVER_TEMPERATURE,
                max_tokens=DEFAULT_RESOLVER_MAX_TOKENS,
                enable_thinking=False,
            )
            improved = data.get("improved_prompt", current_prompt)
            changes = data.get("changes_summary") or fb_changes or "Full rewrite"
            diagnosis = data.get("regression_diagnosis") or fb_diag or ""
            strategy = data.get("fix_strategy") or fb_strat or ""
            return improved, changes, diagnosis, strategy, [{"op": "rewrite"}]
        except ValueError:
            return current_prompt, "Resolver failed to produce valid output", "", "", []

    def _apply_edits(self, prompt, edits):
        """Apply the coach's patch to the prompt. Returns (new_prompt, num_applied)."""
        applied = 0
        for e in edits:
            op = str(e.get("op", "")).lower()
            if op == "append":
                text = e.get("text", "")
                if text:
                    prompt = prompt.rstrip() + "\n" + text
                    applied += 1
            elif op == "prepend":
                text = e.get("text", "")
                if text:
                    prompt = text + "\n" + prompt.lstrip()
                    applied += 1
            elif op == "replace":
                find = e.get("find", "")
                replace = e.get("replace", "")
                if find and find in prompt:
                    prompt = prompt.replace(find, replace, 1)
                    applied += 1
        return prompt, applied

    def record_accepted(self, changes):
        """Call only when a challenger is promoted to champion, so the coach knows
        which changes are load-bearing and must not be reverted."""
        self._previous_changes.append(changes)

    def _build_revert_feedback(self, history):
        n = len(history)
        plural = "ATTEMPT" if n == 1 else "ATTEMPTS"
        lines = [
            f"PREVIOUS {plural} IN THIS STREAK ({n}) WERE ALL REVERTED — do not repeat any of these dead ends.",
        ]
        for i, ctx in enumerate(history, 1):
            label = ctx.get("attempt", i)
            lines.append(f"\nReverted attempt {label} (reason: {ctx.get('reason', 'no_improvement')}):")
            lines.append(f"  - Change tried: {str(ctx.get('changes', 'N/A'))[:220]}")
            lines.append(
                f"  - Score moved {ctx.get('score_before', 0):.4f} -> {ctx.get('score_after', 0):.4f}"
            )
            regressed = ctx.get("regressed") or []
            if regressed:
                broke = ", ".join(
                    f"{r.get('scenario')}({r.get('before', 0):.2f}->{r.get('after', 0):.2f})"
                    f"{' CRITICAL' if r.get('critical') else ''}"
                    for r in regressed[:8]
                )
                lines.append(f"  - Broke previously-passing cases: {broke}")
            else:
                lines.append("  - Did not raise the overall score.")
        lines.append(
            "\nLearn from the WHOLE streak above: each of those edits broke those specific cases. "
            "Find the common reason they failed, AVOID all of those approaches, and propose a genuinely "
            "different, surgical fix for the open failures that leaves every listed case intact. "
            "If the open issue seems impossible to fix without breaking a listed case, say so in fix_strategy."
        )
        return "\n".join(lines)

    def _build_failure_analysis(self, results):
        parts = []

        by_dimension = defaultdict(list)
        for r in results:
            for issue in r.get("scores", {}).get("issues", []):
                by_dimension[issue.get("dimension", "unknown")].append({
                    "scenario": r["scenario_name"],
                    "description": issue.get("description", ""),
                    "severity": issue.get("severity", "medium"),
                })

        total_thinking_leaks = sum(
            len(r.get("voice_analysis", {}).get("thinking_leaks", [])) for r in results
        )
        total_markdown = sum(
            len(r.get("voice_analysis", {}).get("markdown_issues", [])) for r in results
        )
        total_digits = sum(
            len(r.get("voice_analysis", {}).get("digit_issues", [])) for r in results
        )
        total_length = sum(
            len(r.get("voice_analysis", {}).get("length_issues", [])) for r in results
        )

        parts.append("VOICE QUALITY ISSUES:")
        parts.append(f"- Thinking tag leaks: {total_thinking_leaks} across all scenarios")
        parts.append(f"- Markdown formatting detected: {total_markdown} instances")
        parts.append(f"- Numeric digits (should be words): {total_digits} instances")
        parts.append(f"- Overly long responses: {total_length} instances")

        for dim, issues in by_dimension.items():
            parts.append(f"\n{dim.upper()} ISSUES ({len(issues)} total):")
            severity_order = {"high": 0, "medium": 1, "low": 2}
            sorted_issues = sorted(issues, key=lambda x: severity_order.get(x["severity"], 1))
            for issue in sorted_issues[:5]:
                parts.append(
                    f"  [{issue['severity']}] {issue['scenario']}: {issue['description']}"
                )

        failing = sorted(
            [r for r in results if r.get("composite_score", 0) < 0.85],
            key=lambda r: r.get("composite_score", 0),
        )
        parts.append(f"\nFAILING SCENARIOS ({len(failing)}/{len(results)}):")
        for r in failing:
            parts.append(
                f"  - {r['scenario_name']}: score={r.get('composite_score', 0):.2f}"
            )

        parts.append("\n\nACTUAL CONVERSATION TRANSCRIPTS FROM WORST FAILURES:")
        parts.append("(Study these carefully — they show exactly where the agent gets stuck)")
        for r in failing[:10]:
            parts.append(f"\n{'='*60}")
            parts.append(f"SCENARIO: {r['scenario_name']} (score: {r.get('composite_score', 0):.2f})")
            parts.append(f"JUDGE SUMMARY: {r.get('scores', {}).get('summary', 'N/A')}")
            transcript = r.get("transcript", [])
            if transcript:
                parts.append("TRANSCRIPT:")
                for msg in transcript:
                    role = msg.get("role", "unknown").upper()
                    content = msg.get("content", "")
                    if len(content) > 500:
                        content = content[:500] + "... [truncated]"
                    parts.append(f"  {role}: {content}")
            else:
                response = r.get("response", "")
                if response:
                    if len(response) > 500:
                        response = response[:500] + "... [truncated]"
                    parts.append(f"AGENT RESPONSE: {response}")

        return "\n".join(parts)
