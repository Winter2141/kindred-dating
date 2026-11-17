"""Blocking: once either person blocks the other, they disappear from each other's app."""

from sqlalchemy import Select, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Block, Match, Message


def hidden_ids(user_id: int) -> Select[tuple[int]]:
    """Subquery of everyone `user_id` blocked or was blocked by."""
    return select(
        union(
            select(Block.blocked_id).where(Block.blocker_id == user_id),
            select(Block.blocker_id).where(Block.blocked_id == user_id),
        ).subquery()
    )


async def is_hidden(session: AsyncSession, user_id: int, other_id: int) -> bool:
    found = await session.scalar(
        select(Block.id)
        .where(
            ((Block.blocker_id == user_id) & (Block.blocked_id == other_id))
            | ((Block.blocker_id == other_id) & (Block.blocked_id == user_id))
        )
        .limit(1)
    )
    return found is not None


# How much of a conversation a report keeps.
EVIDENCE_MESSAGES = 20


async def conversation_evidence(
    session: AsyncSession, reporter_id: int, reported_id: int
) -> list[dict[str, str]]:
    """The pair's last messages, oldest first, to keep with a report before a block deletes them."""
    a, b = Match.ordered_pair(reporter_id, reported_id)
    match_id = await session.scalar(
        select(Match.id).where(Match.user_a_id == a, Match.user_b_id == b)
    )
    if match_id is None:
        return []
    rows = await session.scalars(
        select(Message)
        .where(Message.match_id == match_id, Message.deleted_at.is_(None))
        .order_by(Message.id.desc())
        .limit(EVIDENCE_MESSAGES)
    )
    return [
        {
            "from": "reporter" if message.sender_id == reporter_id else "reported",
            "text": message.body
            or ("(voice note)" if message.audio_url else "(photo)" if message.image_url else ""),
            "at": message.created_at.isoformat(),
        }
        for message in reversed(rows.all())
        if not message.call_kind
    ]
