"""STT provider interface.

Every provider normalizes to the same contract: given PCM16 mono audio at a known
sample rate, return a TranscriptResult. Format decoding (mp3/wav/m4a -> PCM16) is
shared upstream (audio.py), so a provider only implements transcription. This is
what makes providers swappable — the caller never knows which one it got.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Token:
    text: str
    speaker: str | None = None
    language: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None


@dataclass
class TranscriptResult:
    text: str
    tokens: list[Token] = field(default_factory=list)
    language: str | None = None
    provider: str = ""
    model: str = ""
    raw: dict | None = None


class STTProvider(ABC):
    """Base class for a speech-to-text provider."""

    name: str = "base"
    # The PCM sample rate this provider is driven at. Audio is decoded to this.
    sample_rate: int = 16000

    @abstractmethod
    async def transcribe(
        self,
        pcm16: bytes,
        *,
        language_hints: list[str] | None = None,
        diarize: bool = False,
    ) -> TranscriptResult:
        """Transcribe PCM16 mono audio (at self.sample_rate) to text (realtime path)."""
        raise NotImplementedError

    async def transcribe_file(
        self,
        audio: bytes,
        *,
        language_hints: list[str] | None = None,
        diarize: bool = False,
    ) -> TranscriptResult:
        """Transcribe a whole recording (any container the provider accepts).

        This is the path for pre-recorded files. The default falls back to
        decoding + the realtime path, so a provider works even without a native
        batch API; providers with an async file API (e.g. Soniox) override this
        for a faster, more robust upload-and-poll flow. Kept here — not at the
        call site — so the STT layer stays swappable.
        """
        from src.stt.audio import decode_to_pcm16
        pcm = await decode_to_pcm16(audio, self.sample_rate)
        return await self.transcribe(pcm, language_hints=language_hints, diarize=diarize)
