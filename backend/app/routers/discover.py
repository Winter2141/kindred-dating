from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import Match, NotificationKind, Swipe, SwipeAction, User
from app.schemas import (
    Candidate,
    LikeOut,
    MatchOut,
    PublicProfile,
    SwipeIn,
    SwipeOut,
    TopPicksOut,
)
from app.services import chat
from app.services.discovery import find_candidates, next_refresh, top_picks
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
) -> list[Candidate]:
    """People who fit your preferences (and you theirs), best fit first.

    Excludes anyone you've already swiped on and anyone who passed on you. People who
    super-liked you jump to the front of the queue.
    """
    candidates = await find_candidates(session, hub, user, datetime.now(UTC))
    return candidates[:limit]


@router.get("/discover/top-picks")
async def daily_top_picks(user: CurrentUser, session: SessionDep, hub: HubDep) -> TopPicksOut:
    """A few standout profiles chosen for you each day, with why they were picked."""
    now = datetime.now(UTC)
    candidates = await find_candidates(session, hub, user, now)
    return TopPicksOut(
        picks=top_picks(user.id, now.date(), candidates), refreshes_at=next_refresh(now)
    )


@router.post("/swipes")
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

    session.add(Swipe(swiper_id=user.id, target_id=target.id, action=data.action))
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
            await notify(session, hub, target.id, kind, actor_id=user.id)
        return SwipeOut(matched=False)

    match = await chat.create_match(session, hub, user, target)
    return SwipeOut(
        matched=True,
        match=MatchOut.build(match, user.id, online=hub.manager.is_online(target.id)),
    )


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
        )
        for swipe, liker in rows
    ]
