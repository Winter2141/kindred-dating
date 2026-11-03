"""Uploaded images: validated, EXIF-rotated, resized and stored as WebP."""

import io
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings

PROFILE_PHOTO_SIDE = 1200
CHAT_PHOTO_SIDE = 1600


def _process(raw: bytes, destination: Path, max_side: int) -> None:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((max_side, max_side))
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.save(destination, "WEBP", quality=85)
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("not an image") from exc


async def save_upload(file: UploadFile, settings: Settings, max_side: int) -> str:
    """Store an uploaded image and return its public URL, or raise a 413/415."""
    raw = await file.read(settings.max_photo_bytes + 1)
    if len(raw) > settings.max_photo_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo is too large")
    name = f"{uuid.uuid4().hex}.webp"
    try:
        await run_in_threadpool(_process, raw, settings.media_dir / name, max_side)
    except ValueError:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "That file isn't a supported image"
        ) from None
    return f"{settings.media_url.rstrip('/')}/{name}"


def local_path(url: str, settings: Settings) -> Path | None:
    """The file behind a URL we serve from media_dir, or None for external URLs."""
    prefix = settings.media_url.rstrip("/") + "/"
    if not url.startswith(prefix):
        return None
    return settings.media_dir / Path(url.removeprefix(prefix)).name


def delete_local(url: str | None, settings: Settings) -> None:
    if url and (path := local_path(url, settings)) is not None:
        path.unlink(missing_ok=True)
