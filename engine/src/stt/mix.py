"""Noise mixing for STT robustness testing.

Overlay a background-noise clip onto a clean recording so we can test whether the
STT still transcribes correctly under traffic / babble / office noise. Noise is
looped/trimmed to the speech length and scaled to a target signal-to-noise ratio
(SNR) so the "intensity" is predictable regardless of how loud the noise file is.

Preset noise files live in engine/assets/noise/*.{mp3,wav}; users can also upload
a one-off custom noise clip. Everything runs on ffmpeg (decode) + numpy (mix),
already on the box — no heavy audio deps.
"""
from __future__ import annotations

import io
import re
import wave
from pathlib import Path

import numpy as np

from src.stt.audio import decode_to_pcm16

# Where preset noise clips live. Anything dropped here shows up as a checkbox.
NOISE_DIR = Path(__file__).resolve().parents[2] / "assets" / "noise"
_AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}

# Intensity -> target SNR in dB (lower dB = louder noise relative to speech).
# 15 dB is clearly audible but speech stays dominant; 3 dB is harsh.
LEVELS = {"light": 15.0, "medium": 8.0, "heavy": 3.0}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def list_presets() -> list[dict]:
    """Preset noise environments found on disk: [{key, label, filename}]."""
    if not NOISE_DIR.is_dir():
        return []
    out = []
    for p in sorted(NOISE_DIR.iterdir()):
        if p.suffix.lower() in _AUDIO_EXTS and p.is_file():
            key = _slug(p.stem)
            label = key.replace("_", " ").title()
            out.append({"key": key, "label": label, "filename": p.name})
    return out


def _preset_path(key: str) -> Path | None:
    for p in list_presets():
        if p["key"] == key:
            return NOISE_DIR / p["filename"]
    return None


def _pcm_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def _float_to_wav(sig: np.ndarray, sample_rate: int) -> bytes:
    """Wrap a mono float32 [-1,1] signal into a 16-bit PCM WAV container."""
    ints = np.clip(sig, -1.0, 1.0)
    ints = (ints * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(ints.tobytes())
    return buf.getvalue()


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2))) if x.size else 0.0


def _fit_length(noise: np.ndarray, n: int) -> np.ndarray:
    """Loop (tile) or trim the noise so it's exactly n samples long."""
    if noise.size == 0:
        return np.zeros(n, dtype=np.float32)
    if noise.size < n:
        reps = int(np.ceil(n / noise.size))
        noise = np.tile(noise, reps)
    return noise[:n]


async def mix_noise(
    speech_bytes: bytes,
    noise_bytes: bytes,
    level: str = "medium",
    sample_rate: int = 16000,
) -> bytes:
    """Overlay `noise_bytes` onto `speech_bytes` at the given intensity.

    Returns a 16-bit PCM WAV (valid audio for both transcription and playback).
    The noise is scaled so the mix sits at the level's target SNR, measured
    against the speech's RMS, then the sum is peak-limited to avoid clipping.
    """
    target_snr_db = LEVELS.get(level, LEVELS["medium"])

    speech = _pcm_to_float(await decode_to_pcm16(speech_bytes, sample_rate))
    noise = _pcm_to_float(await decode_to_pcm16(noise_bytes, sample_rate))
    if speech.size == 0:
        raise RuntimeError("recording decoded to no audio")

    noise = _fit_length(noise, speech.size)

    s_rms, n_rms = _rms(speech), _rms(noise)
    if n_rms > 0 and s_rms > 0:
        # gain so that 20*log10(s_rms / (gain*n_rms)) == target_snr_db
        gain = s_rms / (n_rms * (10.0 ** (target_snr_db / 20.0)))
    else:
        gain = 0.0

    mixed = speech + gain * noise

    # Peak-limit (only if we'd clip) so loud mixes don't distort.
    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    if peak > 1.0:
        mixed = mixed / peak

    return _float_to_wav(mixed, sample_rate)


async def mix_with_preset(speech_bytes: bytes, preset_key: str, level: str = "medium",
                          sample_rate: int = 16000) -> bytes:
    path = _preset_path(preset_key)
    if path is None:
        raise RuntimeError(f"unknown noise preset '{preset_key}'")
    return await mix_noise(speech_bytes, path.read_bytes(), level, sample_rate)
