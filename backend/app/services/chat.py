"""Messaging operations shared by the REST endpoints and the WebSocket handler."""

import asyncio
import random
from dataclasses import dataclass

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import Match, Message, User
from app.realtime import Hub
from app.schemas import MatchOut, MessageOut
from app.services.personas import compose_reply


async def get_match(session: AsyncSession, match_id: int, user_id: int) -> Match | None:
    """The match if it exists and `user_id` is part of it; otherwise None."""
    match = await session.get(Match, match_id)
    return match if match and match.includes(user_id) else None


@dataclass
class MatchSummary:
    match: Match
    last_message: Message | None
    unread_count: int


async def list_matches(session: AsyncSession, user_id: int) -> list[MatchSummary]:
    matches = (
        (
            await session.execute(
                select(Match)
                .where(or_(Match.user_a_id == user_id, Match.user_b_id == user_id))
                .order_by(Match.last_activity_at.desc())
            )
        )
        .unique()
        .scalars()
        .all()
    )
    if not matches:
        return []
    ids = [m.id for m in matches]

    last_ids = (
        select(func.max(Message.id)).where(Message.match_id.in_(ids)).group_by(Message.match_id)
    )
    last_messages = {
        m.match_id: m
        for m in (await session.scalars(select(Message).where(Message.id.in_(last_ids)))).all()
    }
    unread_rows = await session.execute(
        select(Message.match_id, func.count())
        .where(
            Message.match_id.in_(ids),
            Message.sender_id != user_id,
            Message.read_at.is_(None),
        )
        .group_by(Message.match_id)
    )
    unread = {match_id: count for match_id, count in unread_rows}
    return [MatchSummary(m, last_messages.get(m.id), unread.get(m.id, 0)) for m in matches]


async def create_match(session: AsyncSession, hub: Hub, first: User, second: User) -> Match:
    """Persist a match and tell both people about it in real time."""
    user_a_id, user_b_id = Match.ordered_pair(first.id, second.id)
    match = Match(user_a_id=user_a_id, user_b_id=user_b_id)
    session.add(match)
    await session.commit()
    await session.refresh(match, ["user_a", "user_b"])

    online = hub.manager.is_online
    for viewer in (first, second):
        other = match.other_id(viewer.id)
        payload = MatchOut.build(match, viewer.id, online=online(other))
        await hub.manager.send(viewer.id, {"type": "match.new", "match": payload})
    return match


async def send_message(
    session: AsyncSession,
    hub: Hub,
    match: Match,
    sender_id: int,
    body: str,
    client_id: str | None = None,
) -> Message:
    recipient = match.other_user(sender_id)
    sender = match.other_user(recipient.id)
    message = Message(match_id=match.id, sender_id=sender_id, body=body, created_at=utcnow())
    session.add(message)
    match.last_activity_at = message.created_at
    sender.last_active_at = message.created_at
    await session.commit()

    payload = {
        "type": "message.new",
        "message": MessageOut.model_validate(message),
        "client_id": client_id,
    }
    await hub.manager.send_many([match.user_a_id, match.user_b_id], payload)

    if hub.settings.demo_mode and recipient.is_persona and not sender.is_persona:
        schedule_persona_reply(hub, match.id, persona_id=recipient.id, human_id=sender_id)
    return message


async def mark_read(session: AsyncSession, hub: Hub, match: Match, reader_id: int) -> int:
    """Mark the other person's messages as read and send them a read receipt."""
    now = utcnow()
    result = await session.execute(
        update(Message)
        .where(
            Message.match_id == match.id,
            Message.sender_id != reader_id,
            Message.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await session.commit()
    if result.rowcount:
        await hub.manager.send(
            match.other_id(reader_id),
            {"type": "read", "match_id": match.id, "reader_id": reader_id, "read_at": now},
        )
    return result.rowcount


def typing_event(match_id: int, user_id: int, is_typing: bool) -> dict[str, object]:
    return {"type": "typing", "match_id": match_id, "user_id": user_id, "is_typing": is_typing}


def schedule_persona_reply(hub: Hub, match_id: int, *, persona_id: int, human_id: int) -> None:
    if match_id in hub.pending_replies:
        return
    hub.pending_replies.add(match_id)
    hub.spawn(_persona_reply(hub, match_id, persona_id, human_id))


async def _persona_reply(hub: Hub, match_id: int, persona_id: int, human_id: int) -> None:
    settings = hub.settings
    replied = False
    try:
        await asyncio.sleep(random.uniform(*settings.persona_read_delay))
        async with hub.db.session() as session:
            match = await session.get(Match, match_id)
            if match is None:
                return
            await mark_read(session, hub, match, persona_id)

        await hub.manager.send(human_id, typing_event(match_id, persona_id, True))
        await asyncio.sleep(random.uniform(*settings.persona_typing_delay))

        async with hub.db.session() as session:
            match = await session.get(Match, match_id)
            if match is None:
                return
            history = (
                await session.scalars(
                    select(Message).where(Message.match_id == match_id).order_by(Message.id)
                )
            ).all()
            persona, human = match.other_user(human_id), match.other_user(persona_id)
            body = compose_reply(persona, human, history, persona_id)
            hub.pending_replies.discard(match_id)
            await send_message(session, hub, match, persona_id, body)
            replied = True
    finally:
        hub.pending_replies.discard(match_id)
        if not replied:
            await hub.manager.send(human_id, typing_event(match_id, persona_id, False))
