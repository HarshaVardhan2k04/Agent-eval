"""Soniox STT — one implementation of the STTProvider interface.

Two paths, same normalized TranscriptResult:
- transcribe():      realtime websocket (wss://stt-rt.soniox.com/...) for live audio.
- transcribe_file(): async REST batch API (POST /v1/files -> /v1/transcriptions ->
                     poll -> GET .../transcript) for pre-recorded recordings. This is
                     faster than realtime and the right tool for uploaded files.

Nothing outside this module reads SONIOX_* config — that is what keeps the STT
layer provider-agnostic.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import websockets

from src import config
from src.stt.base import STTProvider, Token, TranscriptResult
from src.stt.audio import pcm16_duration_ms

# Special tokens Soniox emits for endpoint / finalization — not real words.
_SPECIAL = {"<end>", "<fin>"}
_CHUNK = 16000  # bytes per ws send (~0.5s of 16k mono PCM16)
_PACE = 10.0    # send this many x realtime — fast, but paced so the server keeps up
_KEEPALIVE = '{"type": "keepalive"}'  # Soniox app-level keepalive (matches prod plugin)
_POLL_INTERVAL = 2.0     # seconds between async-job status polls
_ASYNC_MAX_WAIT = 1800.0  # hard ceiling for an async job (30 min — covers long calls)


class SonioxProvider(STTProvider):
    name = "soniox"
    sample_rate = config.STT_TARGET_SAMPLE_RATE

    def __init__(self) -> None:
        self._api_key = config.SONIOX_API_KEY
        self._url = config.SONIOX_STT_URL
        self._model = config.SONIOX_MODEL
        self._api_url = config.SONIOX_API_URL.rstrip("/")
        self._async_model = config.SONIOX_ASYNC_MODEL

    async def transcribe_file(
        self,
        audio: bytes,
        *,
        language_hints: list[str] | None = None,
        diarize: bool = False,
    ) -> TranscriptResult:
        """Async batch transcription for a pre-recorded file.

        Uploads the raw file (Soniox decodes the container server-side), creates a
        transcription job, polls until it finishes, then fetches the transcript.
        No realtime pacing / keepalive to fight — the server owns the timing.
        """
        if not self._api_key:
            raise RuntimeError("SONIOX_API_KEY is not set (add it to engine/.env)")

        headers = {"Authorization": f"Bearer {self._api_key}"}
        file_id = None
        tr_id = None
        async with httpx.AsyncClient(base_url=self._api_url, headers=headers, timeout=60.0) as http:
            try:
                # 1) Upload the file.
                up = await http.post("/files", files={"file": ("audio", audio)})
                up.raise_for_status()
                file_id = up.json()["id"]

                # 2) Create the transcription job.
                body = {
                    "file_id": file_id,
                    "model": self._async_model,
                    "enable_speaker_diarization": diarize,
                    "enable_language_identification": True,
                }
                if language_hints:
                    body["language_hints"] = language_hints
                cr = await http.post("/transcriptions", json=body)
                cr.raise_for_status()
                tr_id = cr.json()["id"]

                # 3) Poll until the job leaves the queued/processing state.
                waited = 0.0
                while True:
                    st = await http.get(f"/transcriptions/{tr_id}")
                    st.raise_for_status()
                    data = st.json()
                    status = data.get("status")
                    if status == "completed":
                        break
                    if status == "error":
                        raise RuntimeError(
                            f"Soniox async job failed: {data.get('error_message') or 'unknown error'}"
                        )
                    if waited >= _ASYNC_MAX_WAIT:
                        raise RuntimeError("Soniox async job timed out")
                    await asyncio.sleep(_POLL_INTERVAL)
                    waited += _POLL_INTERVAL

                # 4) Fetch the transcript tokens.
                tx = await http.get(f"/transcriptions/{tr_id}/transcript")
                tx.raise_for_status()
                payload = tx.json()
            finally:
                # Best-effort cleanup so we don't accumulate server-side artifacts.
                for path in ([f"/transcriptions/{tr_id}"] if tr_id else []) + ([f"/files/{file_id}"] if file_id else []):
                    try:
                        await http.delete(path)
                    except Exception:
                        pass

        tokens: list[Token] = []
        for t in payload.get("tokens", []):
            text = t.get("text", "")
            if text in _SPECIAL:
                continue
            tokens.append(Token(
                text=text,
                speaker=(str(t["speaker"]) if t.get("speaker") is not None else None),
                language=t.get("language"),
                start_ms=t.get("start_ms"),
                end_ms=t.get("end_ms"),
            ))

        text = payload.get("text") or "".join(t.text for t in tokens)
        text = " ".join(text.split())
        lang = next((t.language for t in tokens if t.language), None)
        return TranscriptResult(
            text=text, tokens=tokens, language=lang,
            provider=self.name, model=self._async_model,
        )

    async def transcribe(
        self,
        pcm16: bytes,
        *,
        language_hints: list[str] | None = None,
        diarize: bool = False,
    ) -> TranscriptResult:
        if not self._api_key:
            raise RuntimeError("SONIOX_API_KEY is not set (add it to engine/.env)")

        cfg = {
            "api_key": self._api_key,
            "model": self._model,
            "audio_format": "pcm_s16le",
            "num_channels": 1,
            "sample_rate": self.sample_rate,
            "language_hints": language_hints,
            "enable_speaker_diarization": diarize,
            "enable_language_identification": True,
            "enable_endpoint_detection": True,
        }

        # Generous ceiling: server time dominates; scale with audio length.
        dur_s = pcm16_duration_ms(pcm16, self.sample_rate) / 1000
        timeout = max(45.0, dur_s * 2 + 20)

        tokens: list[Token] = []
        error: str | None = None

        # Disable the library's own keepalive (ping_interval=None). Soniox's
        # realtime server doesn't reliably pong our client-side pings while it's
        # busy processing a long stream, so the default keepalive would close the
        # connection with "1011 keepalive ping timeout" mid-transcription. We bound
        # the whole exchange with the application-level asyncio timeout below instead.
        async with websockets.connect(
            self._url, max_size=None, open_timeout=20,
            ping_interval=None, close_timeout=10,
        ) as ws:
            await ws.send(json.dumps(cfg))

            async def _collect() -> None:
                nonlocal error
                async for raw in ws:
                    msg = json.loads(raw) if isinstance(raw, str) else json.loads(raw.decode())
                    if msg.get("error_code") or msg.get("error_message"):
                        error = msg.get("error_message") or f"Soniox error {msg.get('error_code')}"
                        return
                    for t in msg.get("tokens", []):
                        text = t.get("text", "")
                        if text in _SPECIAL or not t.get("is_final", True):
                            continue
                        tokens.append(Token(
                            text=text,
                            speaker=t.get("speaker"),
                            language=t.get("language"),
                            start_ms=t.get("start_ms"),
                            end_ms=t.get("end_ms"),
                        ))
                    if msg.get("finished"):
                        return

            async def _send() -> None:
                # Stream the audio while _collect() drains the socket in parallel.
                # Pacing well above realtime keeps the server's receive buffer from
                # overflowing on long files, without stalling the reader.
                chunk_s = _CHUNK / (self.sample_rate * 2)  # seconds of audio per chunk
                for i in range(0, len(pcm16), _CHUNK):
                    await ws.send(pcm16[i:i + _CHUNK])
                    await asyncio.sleep(chunk_s / _PACE)
                # Empty frame signals end-of-audio; server flushes then reports finished.
                await ws.send("")

            async def _keepalive() -> None:
                # Soniox uses an application-level keepalive (not a WS ping). While
                # it processes a long recording after we've stopped sending audio,
                # this is what stops the server closing the connection with
                # "1011 keepalive ping timeout". Cancelled once we're finished.
                try:
                    while True:
                        await asyncio.sleep(5)
                        await ws.send(_KEEPALIVE)
                except (asyncio.CancelledError, Exception):
                    pass

            collector = asyncio.ensure_future(_collect())
            sender = asyncio.ensure_future(_send())
            keepalive = asyncio.ensure_future(_keepalive())
            try:
                # Only the sender + collector define completion; keepalive just
                # nurses the connection and is torn down afterwards.
                await asyncio.wait_for(asyncio.gather(sender, collector), timeout=timeout)
            except asyncio.TimeoutError:
                # Return what we have; partial is better than nothing.
                error = error or "timed out waiting for Soniox to finish"
            finally:
                for task in (sender, collector, keepalive):
                    if not task.done():
                        task.cancel()

        if error and not tokens:
            raise RuntimeError(error)

        text = "".join(t.text for t in tokens).strip()
        # Soniox tokens usually embed leading spaces; collapse any doubles.
        text = " ".join(text.split())
        lang = next((t.language for t in tokens if t.language), None)

        return TranscriptResult(
            text=text,
            tokens=tokens,
            language=lang,
            provider=self.name,
            model=self._model,
        )
