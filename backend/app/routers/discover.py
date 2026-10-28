from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import Match, Swipe, SwipeAction, User
from app.schemas import Candidate, LikeOut, MatchOut, PublicProfile, SwipeIn, SwipeOut
from app.services import chat
from app.services.matching import birthdate_bounds, compatibility, is_mutual_fit
from app.services.personas import likes_back

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
    now = datetime.now(UTC)
    today = now.date()
    swiped_by_me = select(Swipe.target_id).where(Swipe.swiper_id == user.id)
    passed_on_me = select(Swipe.swiper_id).where(
        Swipe.target_id == user.id, Swipe.action == SwipeAction.PASS
    )
    earliest, latest = birthdate_bounds(user.age_min, user.age_max, today)

    # SQL narrows by the cheap columns; JSON list membership is checked in Python so the
    # query stays portable between SQLite and Postgres.
    rows = await session.scalars(
        select(User).where(
            User.id != user.id,
            User.id.not_in(swiped_by_me),
            User.id.not_in(passed_on_me),
            User.gender.in_(user.interested_in),
            User.birthdate.between(earliest, latest),
        )
    )
    super_likers = set(
        await session.scalars(
            select(Swipe.swiper_id).where(
                Swipe.target_id == user.id, Swipe.action == SwipeAction.SUPER
            )
        )
    )

    candidates = []
    for other in rows:
        if not is_mutual_fit(user, other, today):
            continue
        fit = compatibility(user, other, now)
        base = PublicProfile.build(other, online=hub.manager.is_online(other.id))
        candidates.append(
            Candidate(
                **base.model_dump(),
                compatibility=fit.score,
                shared_interests=fit.shared_interests,
                super_liked_you=other.id in super_likers,
            )
        )
    candidates.sort(key=lambda c: (c.super_liked_you, c.compatibility), reverse=True)
    return candidates[:limit]


@router.post("/swipes")
async def swipe(data: SwipeIn, user: CurrentUser, session: SessionDep, hub: HubDep) -> SwipeOut:
    if data.target_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "You can't swipe on yourself")
    target = await session.get(User, data.target_id)
    if target is None:
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
            Swipe.action != SwipeAction.PASS,
            Swipe.swiper_id.not_in(swiped_by_me),
        )
        .order_by(Swipe.created_at.desc())
    )
    return [
        LikeOut(
            user=PublicProfile.build(liker, online=hub.manager.is_online(liker.id)),
            action=SwipeAction(swipe.action),
            created_at=swipe.created_at,
        )
        for swipe, liker in rows
    ]
