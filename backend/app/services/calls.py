"""Audio and video calls between matches.

The media goes peer to peer over WebRTC; the server only rings the other person and passes
the WebRTC offer, answer and ICE candidates between the two browsers over the existing
WebSocket. It also keeps a small in-memory registry of calls in progress, so it can say
"busy", refuse messages about calls you're not part of, and log each call in the chat
when it ends. Like presence, the registry is per process.
"""

import asyncio
import secrets
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.db import utcnow
from app.models import Match
from app.realtime import Hub
from app.services import chat

CallKind = Literal["audio", "video"]


@dataclass
class Call:
    id: str
    match_id: int
    kind: CallKind
    caller_id: int
    callee_id: int
    started_at: datetime = field(default_factory=utcnow)
    answered_at: datetime | None = None

    def other(self, user_id: int) -> int:
        return self.callee_id if user_id == self.caller_id else self.caller_id

    def includes(self, user_id: int) -> bool:
        return user_id in (self.caller_id, self.callee_id)


class CallError(Exception):
    """Something the client should be told about, with a machine-readable reason."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class CallRegistry:
    def __init__(self) -> None:
        self._calls: dict[str, Call] = {}

    def peek(self, call_id: str) -> Call | None:
        return self._calls.get(call_id)

    def get(self, call_id: str, user_id: int) -> Call:
        call = self._calls.get(call_id)
        if call is None or not call.includes(user_id):
            raise CallError("gone", "That call has ended")
        return call

    def busy(self, user_id: int) -> bool:
        return any(c.includes(user_id) for c in self._calls.values())

    def start(self, match: Match, caller_id: int, kind: CallKind) -> Call:
        call = Call(
            id=secrets.token_urlsafe(9),
            match_id=match.id,
            kind=kind,
            caller_id=caller_id,
            callee_id=match.other_id(caller_id),
        )
        self._calls[call.id] = call
        return call

    def finish(self, call_id: str) -> Call | None:
        return self._calls.pop(call_id, None)

    def for_user(self, user_id: int) -> list[Call]:
        return [c for c in self._calls.values() if c.includes(user_id)]


def registry(hub: Hub) -> CallRegistry:
    # Kept on the hub but created here, so the hub doesn't need to know about calls.
    return hub.__dict__.setdefault("calls", CallRegistry())


async def invite(hub: Hub, match: Match, caller_id: int, kind: CallKind) -> Call:
    calls = registry(hub)
    callee_id = match.other_id(caller_id)
    callee = match.other_user(caller_id)
    if calls.busy(caller_id):
        raise CallError("busy", "You're already in a call")
    if callee.is_persona:
        raise CallError("unavailable", f"{callee.name} is a demo profile and can't take calls")
    if not hub.manager.is_online(callee_id):
        raise CallError("unavailable", f"{callee.name} isn't online right now")
    if calls.busy(callee_id):
        raise CallError("busy", f"{callee.name} is on another call")

    call = calls.start(match, caller_id, kind)
    caller = match.other_user(callee_id)
    await hub.manager.send(
        callee_id,
        {
            "type": "call.incoming",
            "call_id": call.id,
            "match_id": match.id,
            "kind": kind,
            "from": {"id": caller.id, "name": caller.name, "photo": (caller.photos or [None])[0]},
        },
    )
    hub.spawn(_ring_out(hub, call.id))
    return call


async def _ring_out(hub: Hub, call_id: str) -> None:
    """Stop ringing if nobody answers."""
    await asyncio.sleep(hub.settings.call_ring_seconds)
    call = registry(hub).peek(call_id)
    if call is not None and call.answered_at is None:
        await end(hub, call, ended_by=None, reason="missed")


async def accept(hub: Hub, call: Call, user_id: int) -> None:
    if user_id != call.callee_id or call.answered_at is not None:
        raise CallError("invalid", "Only the person being called can answer, once")
    call.answered_at = utcnow()
    await hub.manager.send(call.caller_id, {"type": "call.accepted", "call_id": call.id})


async def relay(hub: Hub, call: Call, user_id: int, data: dict[str, object]) -> None:
    """Pass a WebRTC offer, answer or ICE candidate to the other side, untouched."""
    await hub.manager.send(
        call.other(user_id), {"type": "call.signal", "call_id": call.id, "data": data}
    )


async def end(
    hub: Hub,
    call: Call,
    *,
    ended_by: int | None,
    reason: Literal["ended", "declined", "missed", "cancelled"],
) -> None:
    """Hang up for both people and note the call in their chat."""
    if registry(hub).finish(call.id) is None:
        return  # already over
    await hub.manager.send_many(
        [call.caller_id, call.callee_id],
        {"type": "call.ended", "call_id": call.id, "reason": reason, "by": ended_by},
    )
    duration_ms = (
        int((utcnow() - call.answered_at).total_seconds() * 1000) if call.answered_at else None
    )
    async with hub.db.session() as session:
        match = await session.get(Match, call.match_id)
        if match is not None:
            await chat.send_message(
                session,
                hub,
                match,
                call.caller_id,
                "",
                call=(call.kind, duration_ms),
            )
