"""Who can show up for whom: shared by the Discover deck and the daily top picks."""

import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Swipe, SwipeAction, User
from app.realtime import Hub
from app.schemas import Candidate, PublicProfile, TopPick
from app.services.matching import (
    birthdate_bounds,
    bounding_box,
    compatibility,
    distance_between,
    is_mutual_fit,
    location,
)
from app.services.safety import hidden_ids

TOP_PICKS_PER_DAY = 4
# Picks are drawn from this many of your strongest candidates, so they vary day to day.
TOP_PICKS_POOL = 12
TOP_PICK_MIN_SCORE = 50


async def find_candidates(
    session: AsyncSession, hub: Hub, user: User, now: datetime
) -> list[Candidate]:
    """Everyone who fits `user` and whom `user` fits, best fit first.

    Excludes people already swiped on, people who passed on `user`, paused, banned and
    blocked accounts. People who super-liked `user` come first.
    """
    today = now.date()
    swiped_by_me = select(Swipe.target_id).where(Swipe.swiper_id == user.id)
    passed_on_me = select(Swipe.swiper_id).where(
        Swipe.target_id == user.id, Swipe.action == SwipeAction.PASS
    )
    earliest, latest = birthdate_bounds(user.age_min, user.age_max, today)

    # SQL narrows by the cheap columns; JSON list membership and exact distances are checked
    # in Python so the query stays portable between SQLite and Postgres.
    query = select(User)
    if (here := location(user)) is not None:
        min_lat, max_lat, min_lng, max_lng = bounding_box(here, user.max_distance_km)
        query = query.where(
            User.latitude.is_(None)
            | (User.latitude.between(min_lat, max_lat) & User.longitude.between(min_lng, max_lng))
        )
    rows = await session.scalars(
        query.where(
            User.id != user.id,
            User.is_paused.is_(False),
            User.banned_at.is_(None),
            User.id.not_in(swiped_by_me),
            User.id.not_in(passed_on_me),
            User.id.not_in(hidden_ids(user.id)),
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
        base = PublicProfile.build(
            other,
            online=hub.manager.is_online(other.id),
            distance_km=distance_between(user, other),
        )
        candidates.append(
            Candidate(
                **base.model_dump(),
                compatibility=fit.score,
                shared_interests=fit.shared_interests,
                super_liked_you=other.id in super_likers,
            )
        )
    candidates.sort(key=lambda c: (c.super_liked_you, c.compatibility), reverse=True)
    return candidates


def pick_reason(candidate: Candidate) -> str:
    """One line on why someone made the cut."""
    shared = [i.lower() for i in candidate.shared_interests]
    if len(shared) >= 2:
        return f"You both love {shared[0]} and {shared[1]}"
    if shared:
        return f"You're both into {shared[0]}"
    if candidate.distance_km is not None and candidate.distance_km <= 5:
        return "Lives just around the corner"
    if candidate.is_online:
        return "Online right now"
    return f"{candidate.compatibility}% compatible"


def top_picks(user_id: int, day: date, candidates: list[Candidate]) -> list[TopPick]:
    """Today's handful of standouts: a daily, per-person draw from the strongest fits.

    The draw is seeded by person and date, so picks stay put all day and change tomorrow.
    People who super-liked you are left out because they're already first in your deck.
    """
    pool = sorted(
        (c for c in candidates if c.compatibility >= TOP_PICK_MIN_SCORE and not c.super_liked_you),
        key=lambda c: c.compatibility,
        reverse=True,
    )[:TOP_PICKS_POOL]
    rng = random.Random(f"{user_id}:{day.isoformat()}")
    chosen = rng.sample(pool, k=min(TOP_PICKS_PER_DAY, len(pool)))
    chosen.sort(key=lambda c: c.compatibility, reverse=True)
    return [TopPick(**c.model_dump(), reason=pick_reason(c)) for c in chosen]


def next_refresh(now: datetime) -> datetime:
    """Picks turn over at midnight UTC."""
    tomorrow = now.date() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=now.tzinfo)
