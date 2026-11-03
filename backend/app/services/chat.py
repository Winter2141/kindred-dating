"""Messaging operations shared by the REST endpoints and the WebSocket handler."""

import asyncio
import random
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import Match, Message, NotificationKind, Reaction, User
from app.realtime import Hub
from app.schemas import MatchOut, MessageOut
from app.services.images import delete_local
from app.services.notifications import notify
from app.services.personas import compose_reply

# How long after sending a message its sender can still unsend it.
UNSEND_WINDOW = timedelta(minutes=15)


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
    for viewer in (first, second):
        await notify(
            session,
            hub,
            viewer.id,
            NotificationKind.MATCH,
            actor_id=match.other_id(viewer.id),
            match_id=match.id,
        )
    return match


class MessageNotFound(LookupError):
    pass


async def reply_target(session: AsyncSession, match: Match, message_id: int) -> Message:
    """The message being answered: it has to be in the same conversation and not unsent."""
    target = await session.get(Message, message_id)
    if target is None or target.match_id != match.id or target.deleted_at is not None:
        raise MessageNotFound(message_id)
    return target


async def send_message(
    session: AsyncSession,
    hub: Hub,
    match: Match,
    sender_id: int,
    body: str,
    client_id: str | None = None,
    image_url: str | None = None,
    reply_to_id: int | None = None,
) -> Message:
    recipient = match.other_user(sender_id)
    sender = match.other_user(recipient.id)
    reply_to = None if reply_to_id is None else await reply_target(session, match, reply_to_id)
    message = Message(
        match_id=match.id,
        sender_id=sender_id,
        body=body,
        image_url=image_url,
        created_at=utcnow(),
        reactions=[],
        # Set the object, not just the id, so building the payload needs no lazy load.
        reply_to=reply_to,
    )
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

    if not hub.manager.is_online(recipient.id) and not recipient.is_persona:
        preview = body or "Sent a photo"
        await notify(
            session,
            hub,
            recipient.id,
            NotificationKind.MESSAGE,
            actor_id=sender_id,
            match_id=match.id,
            body=preview,
        )

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


class CannotUnsend(Exception):
    pass


async def unsend(
    session: AsyncSession, hub: Hub, match: Match, message_id: int, user_id: int
) -> Message:
    """Wipe a message's text and reactions for both people. Only the sender, only briefly."""
    message = await session.get(Message, message_id)
    if message is None or message.match_id != match.id or message.deleted_at is not None:
        raise MessageNotFound(message_id)
    if message.sender_id != user_id:
        raise CannotUnsend("You can only unsend your own messages")
    if utcnow() - message.created_at > UNSEND_WINDOW:
        minutes = int(UNSEND_WINDOW.total_seconds() // 60)
        raise CannotUnsend(f"Messages can only be unsent within {minutes} minutes")

    delete_local(message.image_url, hub.settings)
    message.body = ""
    message.image_url = None
    message.deleted_at = utcnow()
    message.reactions.clear()
    await session.commit()
    await hub.manager.send_many(
        [match.user_a_id, match.user_b_id],
        {
            "type": "message.deleted",
            "match_id": match.id,
            "message_id": message.id,
            "deleted_at": message.deleted_at,
        },
    )
    return message


async def set_reaction(
    session: AsyncSession,
    hub: Hub,
    match: Match,
    message_id: int,
    user_id: int,
    emoji: str | None,
) -> Message:
    """Set, change or (with None, or the same emoji again) clear `user_id`'s reaction."""
    message = await session.get(Message, message_id)
    if message is None or message.match_id != match.id or message.deleted_at is not None:
        raise MessageNotFound(message_id)
    mine = next((r for r in message.reactions if r.user_id == user_id), None)
    if mine is not None and (emoji is None or emoji == mine.emoji):
        message.reactions.remove(mine)
        emoji = None
    elif mine is not None:
        mine.emoji = emoji
    elif emoji is not None:
        message.reactions.append(Reaction(user_id=user_id, emoji=emoji))
    await session.commit()

    await hub.manager.send_many(
        [match.user_a_id, match.user_b_id],
        {
            "type": "reaction",
            "match_id": match.id,
            "message_id": message.id,
            "user_id": user_id,
            "emoji": emoji,
        },
    )
    return message


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
                    select(Message)
                    .where(Message.match_id == match_id, Message.deleted_at.is_(None))
                    .order_by(Message.id)
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
