"""The real-time channel: chat messages, typing indicators, read receipts and presence.

Client -> server events:
    {"type": "message.send", "match_id": 1, "body": "hi", "client_id": "tmp-123"}
    {"type": "typing", "match_id": 1, "is_typing": true}
    {"type": "read", "match_id": 1}
    {"type": "ping"}

Server -> client events:
    hello, message.new, typing, read, presence, match.new, match.removed, pong, error
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from app.db import utcnow
from app.deps import user_from_token
from app.models import User
from app.realtime import Hub
from app.schemas import MessageBody
from app.services import chat

log = logging.getLogger(__name__)
router = APIRouter()

CLOSE_UNAUTHORIZED = 4401


class SendMessage(BaseModel):
    type: Literal["message.send"]
    match_id: int
    body: MessageBody
    client_id: Annotated[str, Field(max_length=64)] | None = None


class Typing(BaseModel):
    type: Literal["typing"]
    match_id: int
    is_typing: bool


class Read(BaseModel):
    type: Literal["read"]
    match_id: int


class Ping(BaseModel):
    type: Literal["ping"]


ClientEvent = TypeAdapter(
    Annotated[SendMessage | Typing | Read | Ping, Field(discriminator="type")]
)


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


async def _handle(hub: Hub, user_id: int, event: SendMessage | Typing | Read | Ping) -> dict | None:
    """Apply one client event. Returns a payload to send back to this socket, if any."""
    if isinstance(event, Ping):
        return {"type": "pong"}

    async with hub.db.session() as session:
        match = await chat.get_match(session, event.match_id, user_id)
        if match is None:
            return {"type": "error", "detail": "Match not found", "match_id": event.match_id}

        match event:
            case SendMessage(body=body, client_id=client_id):
                await chat.send_message(session, hub, match, user_id, body, client_id)
            case Typing(is_typing=is_typing):
                await hub.manager.send(
                    match.other_id(user_id), chat.typing_event(match.id, user_id, is_typing)
                )
            case Read():
                await chat.mark_read(session, hub, match, user_id)
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
            reply = await _handle(hub, user.id, event)
            if reply is not None:
                await websocket.send_json(reply)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error for user %s", user.id)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
    finally:
        if hub.manager.disconnect(user.id, websocket):
            async with hub.db.session() as session:
                fresh = await session.get(User, user.id)
                if fresh is not None:
                    fresh.last_active_at = utcnow()
                    await session.commit()
                    await _broadcast_presence(hub, fresh, online=False)
