from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, UploadFile, status

from app.catalog import INTERESTS, PROMPT_QUESTIONS
from app.deps import CurrentUser, HubDep, SessionDep, SettingsDep
from app.models import Gender, User
from app.places import geocode
from app.places import search as search_places
from app.schemas import (
    ActivityDay,
    InsightsOut,
    Interest,
    InterestCount,
    MeOut,
    MetaOut,
    ProfileUpdate,
    PublicProfile,
    StrengthOut,
    TipOut,
)
from app.services.images import PROFILE_PHOTO_SIDE, delete_local, save_upload
from app.services.insights import build_insights
from app.services.matching import distance_between
from app.services.profile_strength import profile_strength
from app.services.safety import is_hidden

router = APIRouter(prefix="/api", tags=["profile"])


@router.get("/meta")
async def meta(settings: SettingsDep) -> MetaOut:
    return MetaOut(
        interests=[Interest(name=n, emoji=e) for n, e in INTERESTS.items()],
        prompt_questions=PROMPT_QUESTIONS,
        genders=list(Gender),
        max_photos=settings.max_photos,
    )


@router.get("/places")
async def places(q: str = Query(min_length=1, max_length=80)) -> list[str]:
    """Known places matching `q`, for the city autocomplete."""
    return search_places(q)


@router.get("/me")
async def read_me(user: CurrentUser) -> MeOut:
    return MeOut.build(user)


@router.get("/me/strength")
async def read_strength(user: CurrentUser) -> StrengthOut:
    """How complete your profile is, with the tips worth the most points first."""
    strength = profile_strength(user)
    return StrengthOut(
        score=strength.score,
        tips=[TipOut(key=t.key, text=t.text, points=t.points) for t in strength.tips],
    )


@router.get("/me/insights")
async def read_insights(
    user: CurrentUser, session: SessionDep, days: int = Query(default=14, ge=7, le=90)
) -> InsightsOut:
    """Your swiping and chatting over the last `days` days, with a per-day series."""
    stats = await build_insights(session, user, datetime.now(UTC), days)
    return InsightsOut(
        days=stats.days,
        likes_sent=stats.likes_sent,
        passes_sent=stats.passes_sent,
        likes_received=stats.likes_received,
        super_likes_received=stats.super_likes_received,
        matches=stats.matches,
        match_rate=stats.match_rate,
        messages_sent=stats.messages_sent,
        messages_received=stats.messages_received,
        reply_rate=stats.reply_rate,
        median_reply_minutes=stats.median_reply_minutes,
        liked_by_interests=[
            InterestCount(interest=name, count=count) for name, count in stats.liked_by_interests
        ],
        activity=[
            ActivityDay(
                day=d.day, likes_received=d.likes_received, matches=d.matches, messages=d.messages
            )
            for d in stats.activity
        ],
    )


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

    # A new city moves you to that place, unless the browser sent precise coordinates too.
    if "city" in changes and changes.get("latitude") is None:
        user.latitude, user.longitude = geocode(changes["city"] or "") or (None, None)

    for field, value in changes.items():
        if value is None and field not in {"bio", "job_title", "city"}:
            continue
        setattr(user, field, list(value) if isinstance(value, list) else value)
    await session.commit()
    return MeOut.build(user)


@router.post("/me/photos", status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> MeOut:
    if len(user.photos) >= settings.max_photos:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You can have up to {settings.max_photos} photos"
        )
    url = await save_upload(file, settings, PROFILE_PHOTO_SIDE)
    user.photos = [*user.photos, url]
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
    delete_local(url, settings)
    return MeOut.build(user)


@router.get("/users/{user_id}")
async def read_user(
    user_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> PublicProfile:
    other = await session.get(User, user_id)
    if other is None or await is_hidden(session, user.id, other.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return PublicProfile.build(
        other,
        online=hub.manager.is_online(other.id),
        distance_km=distance_between(user, other),
    )
