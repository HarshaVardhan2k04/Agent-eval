from src.core.voice_analyzer import VoiceAnalysis


DIMENSION_WEIGHTS = {
    "factual_accuracy": 0.25,
    "voice_friendliness": 0.20,
    "human_likeness": 0.15,
    "tool_correctness": 0.15,
    "response_quality": 0.25,
}


def compute_tool_score(expected, actual):
    if not expected and not actual:
        return 1.0
    if not expected and actual:
        return 0.5
    expected_set = set(expected)
    actual_set = set(actual)
    correct = expected_set & actual_set
    if not actual_set and not expected_set:
        return 1.0
    precision = len(correct) / len(actual_set) if actual_set else 1.0
    recall = len(correct) / len(expected_set) if expected_set else 1.0
    if precision + recall == 0:
        return 0.0
    return 2 * (precision * recall) / (precision + recall)


def compute_scenario_score(judge_scores, voice_analysis: VoiceAnalysis):
    base_score = sum(
        judge_scores.get(dim, 0.5) * weight
        for dim, weight in DIMENSION_WEIGHTS.items()
    )

    penalties = 0.0
    penalties += min(len(voice_analysis.thinking_leaks) * 0.15, 0.5)
    penalties += min(len(voice_analysis.markdown_issues) * 0.05, 0.3)
    penalties += min(len(voice_analysis.digit_issues) * 0.03, 0.2)
    penalties += min(len(voice_analysis.length_issues) * 0.05, 0.2)
    penalties += min(len(voice_analysis.emoji_issues) * 0.05, 0.15)

    return round(max(0.0, base_score - penalties), 4)


def compute_iteration_score(scenario_scores):
    if not scenario_scores:
        return 0.0
    return sum(scenario_scores) / len(scenario_scores)
