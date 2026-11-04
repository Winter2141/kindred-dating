from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, select

from app.catalog import INTERESTS
from app.deps import CurrentUser, HubDep, SessionDep
from app.limits import SWIPES
from app.models import Match, NotificationKind, SavedProfile, Swipe, SwipeAction, User
from app.ratelimit import per_user
from app.schemas import (
    Candidate,
    LikedItem,
    LikeOut,
    MatchOut,
    PublicProfile,
    SwipeIn,
    SwipeOut,
    TopPicksOut,
)
from app.services import chat
from app.services.discovery import Filters, find_candidates, next_refresh, top_picks
from app.services.matching import distance_between
from app.services.notifications import notify
from app.services.personas import likes_back
from app.services.safety import hidden_ids, is_hidden

router = APIRouter(prefix="/api", tags=["discover"])


@router.get("/discover")
async def discover(
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
    limit: int = Query(default=20, ge=1, le=50),
    verified_only: bool = Query(default=False, description="Only photo-verified people"),
    active_within_days: int | None = Query(default=None, ge=1, le=30),
    interests: list[str] = Query(default=[], description="Anyone into at least one of these"),
    with_prompts: bool = Query(default=False, description="Only profiles with prompt answers"),
    min_agreement: int | None = Query(default=None, ge=1, le=100),
) -> list[Candidate]:
    """People who fit your preferences (and you theirs), best fit first.

    Excludes anyone you've already swiped on and anyone who passed on you. People who
    super-liked you jump to the front of the queue. The optional filters narrow the deck
    further; `min_agreement` leaves out people you can't be compared with yet.
    """
    unknown = [i for i in interests if i not in INTERESTS]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"unknown interests: {', '.join(unknown)}"
        )
    filters = Filters(
        verified_only=verified_only,
        active_within_days=active_within_days,
        interests=tuple(interests),
        with_prompts=with_prompts,
        min_agreement=min_agreement,
    )
    candidates = await find_candidates(session, hub, user, datetime.now(UTC), filters)
    return candidates[:limit]


@router.get("/discover/top-picks")
async def daily_top_picks(user: CurrentUser, session: SessionDep, hub: HubDep) -> TopPicksOut:
    """A few standout profiles chosen for you each day, with why they were picked."""
    now = datetime.now(UTC)
    candidates = await find_candidates(session, hub, user, now)
    return TopPicksOut(
        picks=top_picks(user.id, now.date(), candidates), refreshes_at=next_refresh(now)
    )


@router.post("/swipes", dependencies=[per_user(SWIPES)])
async def swipe(data: SwipeIn, user: CurrentUser, session: SessionDep, hub: HubDep) -> SwipeOut:
    if data.target_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "You can't swipe on yourself")
    target = await session.get(User, data.target_id)
    if target is None or await is_hidden(session, user.id, target.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    existing = await session.scalar(
        select(Swipe).where(Swipe.swiper_id == user.id, Swipe.target_id == target.id)
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already swiped on this person")

    if data.liked_item is not None and resolve_item(target, data.liked_item) is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That photo or prompt isn't on their profile"
        )
    # Deciding on someone saved for later takes them off the saved list.
    await session.execute(
        delete(SavedProfile).where(
            SavedProfile.user_id == user.id, SavedProfile.saved_id == target.id
        )
    )
    session.add(
        Swipe(
            swiper_id=user.id,
            target_id=target.id,
            action=data.action,
            liked_item=data.liked_item,
            comment=data.comment,
        )
    )
    await session.commit()
    if not data.action.is_positive:
        return SwipeOut(matched=False)

    their_swipe = await session.scalar(
        select(Swipe).where(Swipe.swiper_id == target.id, Swipe.target_id == user.id)
    )
    persona_likes_back = hub.settings.demo_mode and target.is_persona
    if their_swipe is None and persona_likes_back and likes_back(target.id, user.id):
        their_swipe = Swipe(swiper_id=target.id, target_id=user.id, action=SwipeAction.LIKE)
        session.add(their_swipe)
        await session.commit()

    if their_swipe is None or not SwipeAction(their_swipe.action).is_positive:
        if not target.is_persona:
            kind = (
                NotificationKind.SUPER_LIKE
                if data.action is SwipeAction.SUPER
                else NotificationKind.LIKE
            )
            await notify(session, hub, target.id, kind, actor_id=user.id, body=data.comment or "")
        return SwipeOut(matched=False)

    match = await chat.create_match(session, hub, user, target)
    await open_with_comments(session, hub, match)
    return SwipeOut(
        matched=True,
        match=MatchOut.build(match, user.id, online=hub.manager.is_online(target.id)),
    )


def resolve_item(person: User, item: str) -> LikedItem | None:
    """Turn "photo:1" or "prompt:<question>" into what it points at, if it's still there."""
    kind, _, value = item.partition(":")
    if kind == "photo" and value.isdigit() and int(value) < len(person.photos):
        return LikedItem(kind="photo", photo=person.photos[int(value)])
    if kind == "prompt":
        for prompt in person.prompts:
            if prompt["question"] == value:
                return LikedItem(kind="prompt", question=value, answer=prompt["answer"])
    return None


async def open_with_comments(session: SessionDep, hub: HubDep, match: Match) -> None:
    """A comment sent with a like becomes the first message once you match."""
    swipes = (
        await session.scalars(
            select(Swipe)
            .where(
                ((Swipe.swiper_id == match.user_a_id) & (Swipe.target_id == match.user_b_id))
                | ((Swipe.swiper_id == match.user_b_id) & (Swipe.target_id == match.user_a_id)),
                Swipe.comment.is_not(None),
            )
            .order_by(Swipe.created_at)
        )
    ).all()
    for swipe in swipes:
        await chat.send_message(session, hub, match, swipe.swiper_id, swipe.comment or "")


@router.post("/swipes/undo")
async def undo_last_swipe(user: CurrentUser, session: SessionDep) -> PublicProfile:
    """Take back your most recent swipe, unless it already turned into a match."""
    last = await session.scalar(
        select(Swipe).where(Swipe.swiper_id == user.id).order_by(Swipe.id.desc()).limit(1)
    )
    if last is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing to undo")
    pair = Match.ordered_pair(user.id, last.target_id)
    matched = await session.scalar(
        select(Match.id).where(Match.user_a_id == pair[0], Match.user_b_id == pair[1])
    )
    if matched:
        raise HTTPException(status.HTTP_409_CONFLICT, "That swipe already became a match")
    target = await session.get(User, last.target_id)
    await session.delete(last)
    await session.commit()
    assert target is not None  # the FK cascade would have removed the swipe otherwise
    return PublicProfile.build(target)


@router.get("/likes")
async def likes_you(user: CurrentUser, session: SessionDep, hub: HubDep) -> list[LikeOut]:
    """People who liked you that you haven't swiped on yet."""
    swiped_by_me = select(Swipe.target_id).where(Swipe.swiper_id == user.id)
    rows = await session.execute(
        select(Swipe, User)
        .join(User, User.id == Swipe.swiper_id)
        .where(
            Swipe.target_id == user.id,
            User.banned_at.is_(None),
            Swipe.action != SwipeAction.PASS,
            Swipe.swiper_id.not_in(swiped_by_me),
            Swipe.swiper_id.not_in(hidden_ids(user.id)),
        )
        .order_by(Swipe.created_at.desc())
    )
    return [
        LikeOut(
            user=PublicProfile.build(
                liker,
                online=hub.manager.is_online(liker.id),
                distance_km=distance_between(user, liker),
            ),
            action=SwipeAction(swipe.action),
            created_at=swipe.created_at,
            comment=swipe.comment,
            liked_item=resolve_item(user, swipe.liked_item) if swipe.liked_item else None,
        )
        for swipe, liker in rows
    ]
