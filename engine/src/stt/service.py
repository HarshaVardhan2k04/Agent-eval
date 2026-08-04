"""STT orchestration: transcribe (via the resolved provider) -> score.

Uploaded recordings go through the provider's transcribe_file() (async batch API
for Soniox — the right tool for pre-recorded audio). Only live/PCM callers use the
realtime transcribe() path.
"""
from __future__ import annotations

from src.stt.metrics import score
from src.stt.registry import get_provider

# Language -> Soniox-style hints. code-switch keys let Indic + English mix.
LANG_HINTS = {
    "en": ["en"],
    "hi": ["hi", "en"],   # Hindi calls routinely code-switch to English
    "te": ["te", "en"],
    "auto": None,
}


def _duration_from_tokens(tokens) -> int | None:
    """Recording length from token timings (the async file path has no PCM)."""
    ends = [t.end_ms for t in tokens if t.end_ms is not None]
    return max(ends) if ends else None


async def transcribe_to_turns(
    audio: bytes,
    language: str = "auto",
    provider_name: str | None = None,
) -> dict:
    """Transcribe a recording into speaker-labelled turns for Call Analysis.

    Uses diarization, groups tokens by speaker, and labels them Agent/User. Role
    mapping is a heuristic (the first speaker is treated as the Agent) — good for
    most agent-led calls; the reviewer can eyeball it in the transcript.
    """
    provider = get_provider(provider_name)
    hints = LANG_HINTS.get(language, [language] if language and language != "auto" else None)
    result = await provider.transcribe_file(audio, language_hints=hints, diarize=True)

    groups: list[tuple] = []
    cur_spk, cur = None, []
    for t in result.tokens:
        spk = t.speaker
        if spk != cur_spk and cur:
            groups.append((cur_spk, "".join(cur)))  # tokens already carry word spacing
            cur = []
        cur_spk = spk
        cur.append(t.text)
    if cur:
        groups.append((cur_spk, "".join(cur)))

    first = groups[0][0] if groups else None
    turns = [{"role": "Agent" if spk == first else "User", "text": " ".join(txt.split())}
             for spk, txt in groups if txt.strip()]
    transcript = " ".join(f"{t['role']}: {t['text']}" for t in turns)
    return {
        "turns": turns, "transcript": transcript,
        "duration_ms": _duration_from_tokens(result.tokens),
        "detected_language": result.language, "provider": result.provider,
    }


async def transcribe_and_score(
    audio: bytes,
    reference: str,
    language: str = "en",
    provider_name: str | None = None,
    diarize: bool = False,
) -> dict:
    provider = get_provider(provider_name)
    hints = LANG_HINTS.get(language, [language] if language and language != "auto" else None)

    result = await provider.transcribe_file(audio, language_hints=hints, diarize=diarize)
    metrics = score(reference, result.text, language)

    return {
        "hypothesis": result.text,
        "reference": reference,
        "language": language,
        "detected_language": result.language,
        "provider": result.provider,
        "model": result.model,
        "duration_ms": _duration_from_tokens(result.tokens),
        **metrics,
    }
