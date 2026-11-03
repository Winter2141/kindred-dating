"""Per-person chat filing: pin a few chats to the top, mute noisy ones, archive old ones."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import ChatSetting, Match
from app.realtime import Hub

MAX_PINNED = 3
# "Until I turn it back on": far enough away to never come round.
MUTE_FOREVER = datetime(9999, 12, 31, tzinfo=UTC)


class MuteFor(StrEnum):
    HOUR = "1h"
    EIGHT_HOURS = "8h"
    WEEK = "1w"
    ALWAYS = "always"
    OFF = "off"

    def until(self, now: datetime) -> datetime | None:
        match self:
            case MuteFor.HOUR:
                return now + timedelta(hours=1)
            case MuteFor.EIGHT_HOURS:
                return now + timedelta(hours=8)
            case MuteFor.WEEK:
                return now + timedelta(weeks=1)
            case MuteFor.ALWAYS:
                return MUTE_FOREVER
            case MuteFor.OFF:
                return None


class TooManyPinned(Exception):
    pass


def is_muted(setting: ChatSetting | None, now: datetime | None = None) -> bool:
    if setting is None or setting.muted_until is None:
        return False
    return setting.muted_until > (now or utcnow())


async def settings_for(
    session: AsyncSession, user_id: int, match_ids: Iterable[int]
) -> dict[int, ChatSetting]:
    ids = list(match_ids)
    if not ids:
        return {}
    rows = await session.scalars(
        select(ChatSetting).where(ChatSetting.user_id == user_id, ChatSetting.match_id.in_(ids))
    )
    return {row.match_id: row for row in rows}


async def setting_for(session: AsyncSession, user_id: int, match_id: int) -> ChatSetting | None:
    return (await settings_for(session, user_id, [match_id])).get(match_id)


async def update(
    session: AsyncSession,
    hub: Hub,
    user_id: int,
    match: Match,
    *,
    pinned: bool | None = None,
    archived: bool | None = None,
    mute: MuteFor | None = None,
) -> ChatSetting:
    """Change how `user_id` files this chat. Only the fields given are touched."""
    now = utcnow()
    setting = await setting_for(session, user_id, match.id)
    if setting is None:
        setting = ChatSetting(user_id=user_id, match_id=match.id)
        session.add(setting)

    if pinned is True and setting.pinned_at is None:
        count = await session.scalar(
            select(func.count())
            .select_from(ChatSetting)
            .where(ChatSetting.user_id == user_id, ChatSetting.pinned_at.is_not(None))
        )
        if (count or 0) >= MAX_PINNED:
            raise TooManyPinned(f"You can pin up to {MAX_PINNED} chats")
        setting.pinned_at = now
        setting.archived_at = None  # a pinned chat is one you want to see
    elif pinned is False:
        setting.pinned_at = None

    if archived is True:
        setting.archived_at = now
        setting.pinned_at = None
    elif archived is False:
        setting.archived_at = None

    if mute is not None:
        setting.muted_until = mute.until(now)

    await session.commit()
    await hub.manager.send(
        user_id, {"type": "match.settings", "match_id": match.id, **describe(setting)}
    )
    return setting


def describe(setting: ChatSetting | None, now: datetime | None = None) -> dict[str, object]:
    """The fields MatchOut and the live event carry."""
    if setting is None:
        return {"pinned": False, "archived": False, "muted": False, "muted_until": None}
    muted = is_muted(setting, now)
    return {
        "pinned": setting.pinned_at is not None,
        "archived": setting.archived_at is not None,
        "muted": muted,
        "muted_until": setting.muted_until if muted else None,
    }


async def on_incoming_message(
    session: AsyncSession, hub: Hub, recipient_id: int, match_id: int
) -> bool:
    """A new message brings an archived chat back, unless it's muted. Returns `muted`."""
    setting = await setting_for(session, recipient_id, match_id)
    if setting is None:
        return False
    muted = is_muted(setting)
    if setting.archived_at is not None and not muted:
        setting.archived_at = None
        await session.commit()
        await hub.manager.send(
            recipient_id, {"type": "match.settings", "match_id": match_id, **describe(setting)}
        )
    return muted
