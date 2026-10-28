import io
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError

from app.catalog import INTERESTS, PROMPT_QUESTIONS
from app.config import Settings
from app.deps import CurrentUser, HubDep, SessionDep, SettingsDep
from app.models import Gender, User
from app.schemas import Interest, MeOut, MetaOut, ProfileUpdate, PublicProfile

router = APIRouter(prefix="/api", tags=["profile"])

MAX_PHOTO_SIDE = 1200


@router.get("/meta")
async def meta(settings: SettingsDep) -> MetaOut:
    return MetaOut(
        interests=[Interest(name=n, emoji=e) for n, e in INTERESTS.items()],
        prompt_questions=PROMPT_QUESTIONS,
        genders=list(Gender),
        max_photos=settings.max_photos,
    )


@router.get("/me")
async def read_me(user: CurrentUser) -> MeOut:
    return MeOut.build(user)


@router.patch("/me")
async def update_me(data: ProfileUpdate, user: CurrentUser, session: SessionDep) -> MeOut:
    changes = data.model_dump(exclude_unset=True)

    age_min = changes.get("age_min", user.age_min)
    age_max = changes.get("age_max", user.age_max)
    if age_min > age_max:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "age_min is above age_max")

    if "photos" in changes:
        photos = changes["photos"]
        if not set(photos) <= set(user.photos) or len(set(photos)) != len(photos):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "photos can only reorder or remove existing photos; upload new ones",
            )

    for field, value in changes.items():
        if value is None and field not in {"bio", "job_title", "city"}:
            continue
        setattr(user, field, list(value) if isinstance(value, list) else value)
    await session.commit()
    return MeOut.build(user)


def _process_photo(raw: bytes, destination: Path) -> None:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.save(destination, "WEBP", quality=85)
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("not an image") from exc


def _local_photo_path(url: str, settings: Settings) -> Path | None:
    prefix = settings.media_url.rstrip("/") + "/"
    if not url.startswith(prefix):
        return None
    return settings.media_dir / Path(url.removeprefix(prefix)).name


@router.post("/me/photos", status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> MeOut:
    if len(user.photos) >= settings.max_photos:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You can have up to {settings.max_photos} photos"
        )
    raw = await file.read(settings.max_photo_bytes + 1)
    if len(raw) > settings.max_photo_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo is too large")

    name = f"{uuid.uuid4().hex}.webp"
    try:
        await run_in_threadpool(_process_photo, raw, settings.media_dir / name)
    except ValueError:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "That file isn't a supported image"
        ) from None

    user.photos = [*user.photos, f"{settings.media_url.rstrip('/')}/{name}"]
    await session.commit()
    return MeOut.build(user)


@router.delete("/me/photos")
async def delete_photo(
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    url: str = Query(description="URL of the photo to remove"),
) -> MeOut:
    if url not in user.photos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    user.photos = [p for p in user.photos if p != url]
    await session.commit()
    if (path := _local_photo_path(url, settings)) is not None:
        path.unlink(missing_ok=True)
    return MeOut.build(user)


@router.get("/users/{user_id}")
async def read_user(
    user_id: int, _: CurrentUser, session: SessionDep, hub: HubDep
) -> PublicProfile:
    other = await session.get(User, user_id)
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return PublicProfile.build(other, online=hub.manager.is_online(other.id))
