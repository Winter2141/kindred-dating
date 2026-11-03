"""Personal stats: how your swiping and chatting have gone over a recent window.

The window is capped at 90 days, so rows are aggregated in Python; that keeps date handling
identical on SQLite and Postgres.
"""

import statistics
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Match, Message, Swipe, SwipeAction, User


@dataclass
class Day:
    day: date
    likes_received: int = 0
    matches: int = 0
    messages: int = 0


@dataclass
class Insights:
    days: int
    likes_sent: int = 0
    passes_sent: int = 0
    likes_received: int = 0
    super_likes_received: int = 0
    matches: int = 0
    match_rate: float = 0.0
    messages_sent: int = 0
    messages_received: int = 0
    reply_rate: float | None = None
    median_reply_minutes: int | None = None
    liked_by_interests: list[tuple[str, int]] = field(default_factory=list)
    activity: list[Day] = field(default_factory=list)


async def build_insights(session: AsyncSession, user: User, now: datetime, days: int) -> Insights:
    since = now - timedelta(days=days)
    result = Insights(days=days)
    calendar = {
        (since + timedelta(days=offset + 1)).date(): Day(
            (since + timedelta(days=offset + 1)).date()
        )
        for offset in range(days)
    }

    def bump(when: datetime, attribute: str) -> None:
        if (day := calendar.get(when.date())) is not None:
            setattr(day, attribute, getattr(day, attribute) + 1)

    mine = await session.scalars(
        select(Swipe).where(Swipe.swiper_id == user.id, Swipe.created_at >= since)
    )
    for swipe in mine:
        if SwipeAction(swipe.action).is_positive:
            result.likes_sent += 1
        else:
            result.passes_sent += 1

    received = await session.execute(
        select(Swipe, User)
        .join(User, User.id == Swipe.swiper_id)
        .where(
            Swipe.target_id == user.id,
            Swipe.action != SwipeAction.PASS,
            Swipe.created_at >= since,
        )
    )
    interests: Counter[str] = Counter()
    for swipe, liker in received:
        result.likes_received += 1
        result.super_likes_received += swipe.action == SwipeAction.SUPER
        interests.update(liker.interests)
        bump(swipe.created_at, "likes_received")
    result.liked_by_interests = interests.most_common(5)

    matches = (
        await session.scalars(
            select(Match).where(
                or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
                Match.created_at >= since,
            )
        )
    ).unique()
    for match in matches:
        result.matches += 1
        bump(match.created_at, "matches")
    if result.likes_sent:
        result.match_rate = round(min(1.0, result.matches / result.likes_sent), 2)

    my_match_ids = select(Match.id).where(
        or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
    )
    messages = await session.scalars(
        select(Message)
        .where(
            Message.match_id.in_(my_match_ids),
            Message.created_at >= since,
            Message.deleted_at.is_(None),
        )
        .order_by(Message.match_id, Message.id)
    )
    _count_messages(result, user.id, list(messages), bump)
    result.activity = list(calendar.values())
    return result


def _count_messages(result: Insights, user_id: int, messages: list[Message], bump) -> None:  # type: ignore[no-untyped-def]
    """Message totals, plus how often and how fast `user_id` answers the other person."""
    waits: list[float] = []
    answered = unanswered = 0
    waiting_since: datetime | None = None
    current_match: int | None = None

    for message in messages:
        if message.match_id != current_match:
            if waiting_since is not None:
                unanswered += 1
            current_match, waiting_since = message.match_id, None
        bump(message.created_at, "messages")
        if message.sender_id == user_id:
            result.messages_sent += 1
            if waiting_since is not None:
                answered += 1
                waits.append((message.created_at - waiting_since).total_seconds() / 60)
                waiting_since = None
        else:
            result.messages_received += 1
            if waiting_since is None:
                waiting_since = message.created_at
    if waiting_since is not None:
        unanswered += 1

    if answered + unanswered:
        result.reply_rate = round(answered / (answered + unanswered), 2)
    if waits:
        result.median_reply_minutes = round(statistics.median(waits))
