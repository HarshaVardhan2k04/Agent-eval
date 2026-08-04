"""STT test endpoints: list providers, transcribe+score one clip, mix noise."""
from __future__ import annotations

import base64

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src import config
from src.stt.registry import available as stt_available
from src.stt.service import transcribe_and_score, transcribe_to_turns
from src.stt import mix as noise_mix

router = APIRouter(prefix="/api/stt")


@router.get("/providers")
async def providers():
    return {"providers": stt_available(), "default": config.STT_PROVIDER}


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    reference: str = Form(""),
    language: str = Form("en"),
    provider: str | None = Form(None),
    diarize: bool = Form(False),
):
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Empty audio file")
    try:
        result = await transcribe_and_score(
            data, reference, language=language, provider_name=provider, diarize=diarize
        )
    except ValueError as e:  # unknown provider
        raise HTTPException(400, str(e))
    except Exception as e:  # decode / transport / provider failure
        raise HTTPException(502, f"STT failed: {e}")
    result["filename"] = audio.filename
    return result


@router.get("/noises")
async def noises():
    """Preset noise environments available for mixing (from engine/assets/noise/)."""
    return {"noises": noise_mix.list_presets(), "levels": list(noise_mix.LEVELS.keys())}


@router.post("/noise-transcribe")
async def noise_transcribe(
    audio: UploadFile = File(...),
    reference: str = Form(""),
    language: str = Form("auto"),
    level: str = Form("medium"),
    noise_preset: str | None = Form(None),
    noise: UploadFile | None = File(None),
    provider: str | None = Form(None),
):
    """Mix a noise environment into the recording, then transcribe+score the result.

    Noise source is either a preset key (`noise_preset`) or an uploaded custom
    clip (`noise`). Returns the score result plus the merged audio (base64 WAV)
    so the caller can offer playback. Output length always equals the recording.
    """
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Empty audio file")
    try:
        if noise is not None:
            noise_bytes = await noise.read()
            if not noise_bytes:
                raise HTTPException(400, "Empty noise file")
            merged = await noise_mix.mix_noise(data, noise_bytes, level=level)
            noise_label = noise.filename or "custom"
        elif noise_preset:
            merged = await noise_mix.mix_with_preset(data, noise_preset, level=level)
            noise_label = noise_preset
        else:
            raise HTTPException(400, "provide a noise_preset or a noise file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Noise mixing failed: {e}")

    try:
        result = await transcribe_and_score(
            merged, reference, language=language, provider_name=provider,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"STT failed: {e}")

    result["filename"] = audio.filename
    result["noise"] = noise_label
    result["level"] = level
    result["merged_audio_b64"] = base64.b64encode(merged).decode("ascii")
    return result


@router.post("/turns")
async def turns(audio: UploadFile = File(...), language: str = Form("auto"), provider: str | None = Form(None)):
    """Transcribe a recording into Agent/User-labelled turns (for Call Analysis)."""
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Empty audio file")
    try:
        result = await transcribe_to_turns(data, language=language, provider_name=provider)
    except Exception as e:
        raise HTTPException(502, f"Transcription failed: {e}")
    result["filename"] = audio.filename
    return result
