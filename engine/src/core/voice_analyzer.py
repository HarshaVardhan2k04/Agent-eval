import re
from dataclasses import dataclass, field


@dataclass
class VoiceIssue:
    turn: int
    pattern: str
    matched_text: str


@dataclass
class LengthIssue:
    turn: int
    length: int
    max_allowed: int


@dataclass
class VoiceAnalysis:
    thinking_leaks: list[VoiceIssue] = field(default_factory=list)
    markdown_issues: list[VoiceIssue] = field(default_factory=list)
    digit_issues: list[VoiceIssue] = field(default_factory=list)
    emoji_issues: list[VoiceIssue] = field(default_factory=list)
    length_issues: list[LengthIssue] = field(default_factory=list)
    avg_response_length: float = 0.0

    @property
    def thinking_leak_count(self):
        return len(self.thinking_leaks)

    @property
    def thinking_leak_frequency(self):
        total = self.thinking_leak_count + len(self.markdown_issues)
        return total

    def to_dict(self):
        return {
            "thinking_leaks": [
                {"turn": i.turn, "pattern": i.pattern, "matched_text": i.matched_text}
                for i in self.thinking_leaks
            ],
            "markdown_issues": [
                {"turn": i.turn, "pattern": i.pattern, "matched_text": i.matched_text}
                for i in self.markdown_issues
            ],
            "digit_issues": [
                {"turn": i.turn, "pattern": i.pattern, "matched_text": i.matched_text}
                for i in self.digit_issues
            ],
            "emoji_issues": [
                {"turn": i.turn, "pattern": i.pattern, "matched_text": i.matched_text}
                for i in self.emoji_issues
            ],
            "length_issues": [
                {"turn": i.turn, "length": i.length, "max_allowed": i.max_allowed}
                for i in self.length_issues
            ],
            "avg_response_length": self.avg_response_length,
        }


THINKING_LEAK_PATTERNS = [
    re.compile(r"<\s*think\s*>.*?</\s*think\s*>", re.DOTALL | re.IGNORECASE),
    re.compile(r"<\s*thought[^>]*>", re.IGNORECASE),
    re.compile(r"</\s*thought\s*>", re.IGNORECASE),
    re.compile(r"<\s*response[^>]*>", re.IGNORECASE),
    re.compile(r"</\s*response\s*>", re.IGNORECASE),
    re.compile(r"<\|channel\|>", re.IGNORECASE),
    re.compile(r"<channel\|>"),
    re.compile(r"^thought\n", re.MULTILINE),
    re.compile(r"^response\n", re.MULTILINE),
    re.compile(r"Thinking Process:", re.IGNORECASE),
    re.compile(r"\*\*Analyze the user", re.IGNORECASE),
    # Generic XML-like tags that shouldn't appear in voice output
    re.compile(r"<(?!br|em|strong)[a-z_]+[^>]*>", re.IGNORECASE),
]

MARKDOWN_PATTERNS = [
    re.compile(r"\*\*[^*]+\*\*"),
    re.compile(r"(?<!\*)\*(?!\*)[^*]+\*(?!\*)"),
    re.compile(r"^\s*[-*]\s+", re.MULTILINE),
    re.compile(r"^\s*\d+\.\s+", re.MULTILINE),
    re.compile(r"```"),
    re.compile(r"#{1,6}\s"),
    re.compile(r"\[.*?\]\(.*?\)"),
]

DIGIT_PATTERN = re.compile(r"\b\d{2,}\b")

EMOJI_PATTERN = re.compile(
    r"[\U0001f600-\U0001f64f\U0001f300-\U0001f5ff"
    r"\U0001f680-\U0001f6ff\U0001f1e0-\U0001f1ff"
    r"☀-⛿✀-➿]"
)


class VoiceAnalyzer:
    def __init__(self, default_max_length=300):
        self.default_max_length = default_max_length

    def analyze(self, agent_texts, max_lengths=None):
        analysis = VoiceAnalysis()

        if not agent_texts:
            return analysis

        for i, text in enumerate(agent_texts):
            max_len = (
                max_lengths[i] if max_lengths and i < len(max_lengths) else self.default_max_length
            )

            for pattern in THINKING_LEAK_PATTERNS:
                for match in pattern.finditer(text):
                    analysis.thinking_leaks.append(
                        VoiceIssue(turn=i, pattern=pattern.pattern, matched_text=match.group()[:100])
                    )

            for pattern in MARKDOWN_PATTERNS:
                for match in pattern.finditer(text):
                    analysis.markdown_issues.append(
                        VoiceIssue(turn=i, pattern=pattern.pattern, matched_text=match.group()[:100])
                    )

            for match in DIGIT_PATTERN.finditer(text):
                analysis.digit_issues.append(
                    VoiceIssue(turn=i, pattern=DIGIT_PATTERN.pattern, matched_text=match.group())
                )

            for match in EMOJI_PATTERN.finditer(text):
                analysis.emoji_issues.append(
                    VoiceIssue(turn=i, pattern="emoji", matched_text=match.group())
                )

            if max_len and len(text) > max_len:
                analysis.length_issues.append(
                    LengthIssue(turn=i, length=len(text), max_allowed=max_len)
                )

        total_len = sum(len(t) for t in agent_texts)
        analysis.avg_response_length = total_len / len(agent_texts)

        return analysis
