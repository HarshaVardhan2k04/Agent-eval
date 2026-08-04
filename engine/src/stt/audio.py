"""Audio decoding — any container/codec -> PCM16 mono at a target sample rate.

Uses ffmpeg (already on the box) via a subprocess so we accept mp3/wav/m4a/ogg/etc
without pulling in heavy Python audio deps.
"""
from __future__ import annotations

import asyncio


async def decode_to_pcm16(data: bytes, sample_rate: int = 16000) -> bytes:
    """Decode arbitrary audio bytes to signed 16-bit little-endian mono PCM."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ac", "1",
        "-ar", str(sample_rate),
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(input=data)
    if proc.returncode != 0:
        msg = err.decode("utf-8", "replace")[:500] if err else "unknown ffmpeg error"
        raise RuntimeError(f"Audio decode failed: {msg}")
    if not out:
        raise RuntimeError("Audio decode produced no samples (empty or unsupported file)")
    return out


def pcm16_duration_ms(pcm: bytes, sample_rate: int = 16000) -> int:
    """Duration of mono PCM16 in ms (2 bytes/sample)."""
    return int(len(pcm) / 2 / sample_rate * 1000)
