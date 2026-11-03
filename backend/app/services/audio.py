"""Uploaded voice notes: checked by their first bytes and stored as they came.

Browsers record voice notes themselves (MediaRecorder), so the server never has to decode
audio: it only checks that the file really is one of the formats browsers produce, and
trusts the client's duration and waveform within sane bounds, as it would a caption.
"""

import uuid

from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.config import Settings

# Longest voice note, and how many bars the waveform is drawn with.
MAX_VOICE_MS = 2 * 60 * 1000
MIN_VOICE_MS = 500
WAVEFORM_BARS = 48


def sniff_audio(head: bytes) -> str | None:
    """The file extension for a supported audio format, judged from its first bytes."""
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"  # EBML: Chrome, Edge and Firefox record WebM/Opus
    if head.startswith(b"OggS"):
        return "ogg"
    if head[4:8] == b"ftyp":
        return "m4a"  # Safari records AAC in an MP4 container
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "mp3"
    return None


def clean_waveform(levels: list[float]) -> list[int]:
    """Resample the client's peaks to a fixed number of bars, each 0-100."""
    if not levels:
        return [0] * WAVEFORM_BARS
    bars = []
    for i in range(WAVEFORM_BARS):
        start = i * len(levels) // WAVEFORM_BARS
        end = max(start + 1, (i + 1) * len(levels) // WAVEFORM_BARS)
        chunk = levels[start:end]
        bars.append(round(max(0.0, min(100.0, max(chunk)))))
    return bars


async def save_voice(file: UploadFile, settings: Settings) -> str:
    """Store an uploaded voice note and return its public URL, or raise a 413/415."""
    raw = await file.read(settings.max_voice_bytes + 1)
    if len(raw) > settings.max_voice_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Voice note is too large")
    extension = sniff_audio(raw[:16])
    if extension is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "That file isn't a supported recording"
        )
    name = f"voice-{uuid.uuid4().hex}.{extension}"
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    await run_in_threadpool((settings.media_dir / name).write_bytes, raw)
    return f"{settings.media_url.rstrip('/')}/{name}"
