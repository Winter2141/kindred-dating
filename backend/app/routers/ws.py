"""The real-time channel: chat messages, typing indicators, read receipts and presence.

Client -> server events:
    {"type": "message.send", "match_id": 1, "body": "hi", "client_id": "tmp-123",
     "reply_to_id": 7}
    {"type": "typing", "match_id": 1, "is_typing": true}
    {"type": "read", "match_id": 1}
    {"type": "react", "match_id": 1, "message_id": 9, "emoji": "❤️"}
    {"type": "call.invite", "match_id": 1, "kind": "video"}
    {"type": "call.accept", "call_id": "abc"}
    {"type": "call.signal", "call_id": "abc", "data": {...WebRTC offer/answer/candidate}}
    {"type": "call.end", "call_id": "abc", "reason": "ended" | "declined" | "cancelled"}
    {"type": "ping"}

Server -> client events:
    hello, message.new, message.edited, message.deleted, typing, read, reaction, presence,
    match.new, match.settings, call.ringing, call.incoming, call.accepted, call.signal,
    call.ended, call.failed,
    match.removed, notification.new, date.updated, pong, error
"""

import json
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, TypeAdapter, ValidationError, field_validator

from app.db import utcnow
from app.deps import user_from_token
from app.limits import MESSAGES
from app.models import User
from app.realtime import Hub
from app.schemas import MessageBody, ReactionEmoji
from app.services import calls, chat
from app.services.calls import CallKind

log = logging.getLogger(__name__)
router = APIRouter()

CLOSE_UNAUTHORIZED = 4401


class SendMessage(BaseModel):
    type: Literal["message.send"]
    match_id: int
    body: MessageBody
    client_id: Annotated[str, Field(max_length=64)] | None = None
    reply_to_id: int | None = None


class Typing(BaseModel):
    type: Literal["typing"]
    match_id: int
    is_typing: bool


class Read(BaseModel):
    type: Literal["read"]
    match_id: int


class React(BaseModel):
    type: Literal["react"]
    match_id: int
    message_id: int
    emoji: ReactionEmoji


class Ping(BaseModel):
    type: Literal["ping"]


class CallInvite(BaseModel):
    type: Literal["call.invite"]
    match_id: int
    kind: CallKind = "video"


class CallAccept(BaseModel):
    type: Literal["call.accept"]
    call_id: Annotated[str, Field(max_length=32)]


class CallSignal(BaseModel):
    type: Literal["call.signal"]
    call_id: Annotated[str, Field(max_length=32)]
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def small(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value)) > MAX_SIGNAL_BYTES:
            raise ValueError("signal too large")
        return value


class CallEnd(BaseModel):
    type: Literal["call.end"]
    call_id: Annotated[str, Field(max_length=32)]
    reason: Literal["ended", "declined", "cancelled"] = "ended"


MatchEvent = SendMessage | Typing | Read | React
CallEvent = CallInvite | CallAccept | CallSignal | CallEnd
ClientEvent = TypeAdapter(Annotated[MatchEvent | CallEvent | Ping, Field(discriminator="type")])
# WebRTC session descriptions run to a few kilobytes; anything far bigger is not one.
MAX_SIGNAL_BYTES = 32_000


async def _partner_ids(hub: Hub, user_id: int) -> list[int]:
    async with hub.db.session() as session:
        return [s.match.other_id(user_id) for s in await chat.list_matches(session, user_id)]


async def _broadcast_presence(hub: Hub, user: User, online: bool) -> None:
    partners = await _partner_ids(hub, user.id)
    await hub.manager.send_many(
        partners,
        {
            "type": "presence",
            "user_id": user.id,
            "online": online,
            "last_active_at": user.last_active_at,
        },
    )


async def _handle_call(hub: Hub, user_id: int, event: CallEvent) -> dict | None:
    try:
        if isinstance(event, CallInvite):
            async with hub.db.session() as session:
                match = await chat.get_match(session, event.match_id, user_id)
            if match is None:
                raise calls.CallError("gone", "Match not found")
            call = await calls.invite(hub, match, user_id, event.kind)
            return {"type": "call.ringing", "call_id": call.id, "match_id": match.id}
        call = calls.registry(hub).get(event.call_id, user_id)
        match event:
            case CallAccept():
                await calls.accept(hub, call, user_id)
            case CallSignal(data=data):
                await calls.relay(hub, call, user_id, data)
            case CallEnd(reason=reason):
                await calls.end(hub, call, ended_by=user_id, reason=reason)
    except calls.CallError as exc:
        return {
            "type": "call.failed",
            "reason": exc.reason,
            "detail": exc.detail,
            "match_id": getattr(event, "match_id", None),
            "call_id": getattr(event, "call_id", None),
        }
    return None


async def _handle(hub: Hub, user_id: int, event: MatchEvent | CallEvent | Ping) -> dict | None:
    """Apply one client event. Returns a payload to send back to this socket, if any."""
    if isinstance(event, Ping):
        return {"type": "pong"}
    if isinstance(event, CallInvite | CallAccept | CallSignal | CallEnd):
        return await _handle_call(hub, user_id, event)

    async with hub.db.session() as session:
        match = await chat.get_match(session, event.match_id, user_id)
        if match is None:
            return {"type": "error", "detail": "Match not found", "match_id": event.match_id}

        match event:
            case SendMessage(body=body, client_id=client_id, reply_to_id=reply_to_id):
                try:
                    await chat.send_message(
                        session, hub, match, user_id, body, client_id, reply_to_id=reply_to_id
                    )
                except chat.MessageNotFound:
                    return {
                        "type": "error",
                        "detail": "The message you're replying to is gone",
                        "match_id": match.id,
                        "client_id": client_id,
                    }
            case Typing(is_typing=is_typing):
                await hub.manager.send(
                    match.other_id(user_id), chat.typing_event(match.id, user_id, is_typing)
                )
            case Read():
                await chat.mark_read(session, hub, match, user_id)
            case React(message_id=message_id, emoji=emoji):
                try:
                    await chat.set_reaction(session, hub, match, message_id, user_id, emoji)
                except chat.MessageNotFound:
                    return {"type": "error", "detail": "Message not found", "match_id": match.id}
    return None


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = "") -> None:
    hub: Hub = websocket.app.state.hub
    async with hub.db.session() as session:
        user = await user_from_token(session, token, hub.settings.secret_key)
    if user is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="Not signed in")
        return

    await websocket.accept()
    if hub.manager.connect(user.id, websocket):
        await hub.manager.announce(user.id, online=True)
        async with hub.db.session() as session:
            user = await session.get(User, user.id) or user
            user.last_active_at = utcnow()
            await session.commit()
        await _broadcast_presence(hub, user, online=True)
    partners = await _partner_ids(hub, user.id)
    await websocket.send_json(
        {"type": "hello", "user_id": user.id, "online": sorted(hub.manager.online_among(partners))}
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                event = ClientEvent.validate_json(raw)
            except ValidationError as exc:
                await websocket.send_json(
                    {"type": "error", "detail": exc.errors(include_url=False)[0]["msg"]}
                )
                continue
            if (
                isinstance(event, SendMessage)
                and hub.settings.rate_limit_enabled
                and hub.limiter.hit(str(user.id), MESSAGES) is not None
            ):
                await websocket.send_json(
                    {
                        "type": "error",
                        "detail": "You're sending messages too fast. Take a breath.",
                        "match_id": event.match_id,
                        "client_id": event.client_id,
                    }
                )
                continue
            reply = await _handle(hub, user.id, event)
            if reply is not None:
                await websocket.send_json(reply)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error for user %s", user.id)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
    finally:
        # This handler may be finishing because its task was cancelled (client gone, server
        # shutting down), so the database work runs as a hub task rather than in here.
        if hub.manager.disconnect(user.id, websocket):
            hub.spawn(_went_offline(hub, user.id))


async def _went_offline(hub: Hub, user_id: int) -> None:
    await hub.manager.announce(user_id, online=False)
    if hub.manager.is_online(user_id):  # reconnected in the meantime, maybe elsewhere
        return
    for call in calls.registry(hub).for_user(user_id):
        await calls.end(hub, call, ended_by=user_id, reason="ended")
    async with hub.db.session() as session:
        user = await session.get(User, user_id)
        if user is None:
            return
        user.last_active_at = utcnow()
        await session.commit()
        await _broadcast_presence(hub, user, online=False)
