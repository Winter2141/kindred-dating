"""Blocking: once either person blocks the other, they disappear from each other's app."""

from sqlalchemy import Select, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Block


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
