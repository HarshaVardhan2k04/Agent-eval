from src.config import DEFAULT_JUDGE_TEMPERATURE, DEFAULT_JUDGE_MAX_TOKENS
from src.llm.prompts import JUDGE_SYSTEM_PROMPT, OUTCOME_JUDGE_PROMPT
from src.core.voice_analyzer import VoiceAnalyzer
from src.scoring.calculator import compute_scenario_score, compute_tool_score


class Judge:
    def __init__(self, llm_client):
        self.llm = llm_client
        self.voice_analyzer = VoiceAnalyzer()

    def _format_transcript(self, result):
        lines = []
        for t in result.get("transcript", []):
            role = "Agent" if t["role"] == "agent" else "User"
            lines.append(f"{role}: {t['content']}")
        return "\n".join(lines)

    def _extract_agent_texts(self, result):
        return [
            t["content"]
            for t in result.get("transcript", [])
            if t["role"] == "agent"
        ]

    def _get_max_lengths(self, result):
        if result.get("turns"):
            return [t.get("max_response_length") for t in result["turns"]]
        return None

    async def evaluate(self, scenario_result, system_prompt):
        transcript_text = self._format_transcript(scenario_result)
        agent_texts = self._extract_agent_texts(scenario_result)

        voice_analysis = self.voice_analyzer.analyze(
            agent_texts, self._get_max_lengths(scenario_result)
        )

        judge_prompt = self._build_judge_prompt(scenario_result, system_prompt, transcript_text)

        try:
            scores = await self.llm.chat_json(
                [
                    {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                    {"role": "user", "content": judge_prompt},
                ],
                temperature=DEFAULT_JUDGE_TEMPERATURE,
                max_tokens=DEFAULT_JUDGE_MAX_TOKENS,
                enable_thinking=True,
            )
        except ValueError:
            scores = {
                "factual_accuracy": 0.5,
                "voice_friendliness": 0.5,
                "human_likeness": 0.5,
                "tool_correctness": 0.5,
                "response_quality": 0.5,
                "issues": [],
                "summary": "Judge failed to produce valid scores",
            }

        if scenario_result.get("turns"):
            for turn in scenario_result["turns"]:
                expected = turn.get("expected_tools", [])
                actual = [tc["name"] for tc in turn.get("tool_calls", [])]
                if expected or actual:
                    scores["tool_correctness"] = compute_tool_score(expected, actual)
                    break

        if scenario_result.get("expected_outcome"):
            outcome_score = await self._judge_outcome(scenario_result, transcript_text)
            if outcome_score is not None:
                scores["response_quality"] = (
                    scores.get("response_quality", 0.5) * 0.5 + outcome_score * 0.5
                )

        composite = compute_scenario_score(scores, voice_analysis)

        return {
            "scenario_name": scenario_result["scenario_name"],
            "scenario_type": scenario_result["scenario_type"],
            "scores": scores,
            "voice_analysis": voice_analysis.to_dict(),
            "composite_score": composite,
            "transcript": scenario_result.get("transcript", []),
            "tool_calls": scenario_result.get("tool_calls", []),
            "judge_reasoning": scores.get("summary", ""),
        }

    def _build_judge_prompt(self, result, system_prompt, transcript_text):
        parts = [
            f"AGENT INSTRUCTIONS (system prompt):\n{system_prompt[:4000]}",
            f"\nTRANSCRIPT:\n{transcript_text}",
        ]

        if result.get("pass_criteria"):
            parts.append(f"\nPASS CRITERIA: {result['pass_criteria']}")
        if result.get("fail_criteria"):
            parts.append(f"FAIL CRITERIA: {result['fail_criteria']}")

        return "\n".join(parts)

    async def _judge_outcome(self, result, transcript_text):
        expected = result.get("expected_outcome", "")
        if not expected:
            return None

        prompt = OUTCOME_JUDGE_PROMPT.format(
            expected_outcome=expected,
            transcript=transcript_text,
        )

        try:
            data = await self.llm.chat_json(
                [{"role": "user", "content": prompt}],
                temperature=DEFAULT_JUDGE_TEMPERATURE,
                max_tokens=1500,
                enable_thinking=True,
            )
            return 1.0 if data.get("reached") else 0.0
        except ValueError:
            return None
