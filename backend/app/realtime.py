"""WebSocket fan-out.

Every connected socket is registered under its user id; a user can have several tabs open.
Events go out through a broker (see app.broker): delivered in-process by default, or via
Redis pub/sub so that several API processes can each reach the sockets they hold.

Presence ("is this person online?") is shared the same way. Each process announces people
coming online and going offline on its sockets, and every few seconds repeats the full list
as a heartbeat. Other processes keep that list per process and forget a process that stops
sending heartbeats, so a crashed worker can't leave people looking online forever.
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Coroutine, Iterable
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

from app.broker import Broker, LocalBroker
from app.config import Settings
from app.db import Database
from app.limits import RateLimiter

log = logging.getLogger(__name__)

# Internal event that closes a user's sockets wherever they are; never sent to clients.
CLOSE_EVENT = "__close__"
# Internal presence events between API processes (never sent to clients):
PRESENCE_EVENT = "__presence__"  # one user came online or went offline on a process
ALIVE_EVENT = "__alive__"  # a process's full list of online users, sent as a heartbeat
SYNC_EVENT = "__sync__"  # a new process asks everyone for their list straight away
INTERNAL_EVENTS = {PRESENCE_EVENT, ALIVE_EVENT, SYNC_EVENT}

HEARTBEAT_SECONDS = 10.0
# A process that misses this many heartbeats is assumed gone, with its users.
STALE_AFTER_SECONDS = HEARTBEAT_SECONDS * 3


@dataclass
class _Peer:
    """What another API process last told us: who's online there, and when it said so."""

    users: set[int] = field(default_factory=set)
    seen_at: float = 0.0


class ConnectionManager:
    def __init__(
        self, broker: Broker | None = None, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        # Users whose sockets were all closed by close_all; their handlers still disconnect.
        self._closing: set[int] = set()
        self.broker: Broker = broker or LocalBroker(self.deliver_local)
        self.process_id = uuid.uuid4().hex
        self._peers: dict[str, _Peer] = {}
        self._clock = clock
        self._heartbeat: asyncio.Task[None] | None = None

    @property
    def shared(self) -> bool:
        """True when other processes may hold sockets too (a pub/sub broker)."""
        return not isinstance(self.broker, LocalBroker)

    async def start(self) -> None:
        await self.broker.start(self.deliver_local)
        if self.shared:
            await self._publish_internal({"type": SYNC_EVENT})
            await self._announce_all()
            self._heartbeat = asyncio.create_task(self._beat())

    async def stop(self) -> None:
        if self._heartbeat is not None:
            self._heartbeat.cancel()
            await asyncio.gather(self._heartbeat, return_exceptions=True)
        await self.broker.stop()

    async def _beat(self) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            try:
                await self._announce_all()
            except Exception:  # Redis hiccup: try again next beat
                log.warning("presence heartbeat failed", exc_info=True)

    async def _publish_internal(self, data: dict[str, Any]) -> None:
        await self.broker.publish([], {**data, "process": self.process_id})

    async def _announce_all(self) -> None:
        await self._publish_internal({"type": ALIVE_EVENT, "users": sorted(self._sockets)})

    async def announce(self, user_id: int, online: bool) -> None:
        """Tell other processes someone came online or went offline here."""
        if self.shared:
            await self._publish_internal(
                {"type": PRESENCE_EVENT, "user_id": user_id, "online": online}
            )

    async def _handle_internal(self, data: dict[str, Any]) -> None:
        sender = data.get("process")
        if sender == self.process_id:
            return
        if data["type"] == SYNC_EVENT:
            await self._announce_all()
            return
        peer = self._peers.setdefault(sender, _Peer())
        peer.seen_at = self._clock()
        if data["type"] == ALIVE_EVENT:
            peer.users = set(data["users"])
        elif data["online"]:
            peer.users.add(data["user_id"])
        else:
            peer.users.discard(data["user_id"])

    def connect(self, user_id: int, websocket: WebSocket) -> bool:
        """Register a socket. Returns True if the user just came online."""
        came_online = not self._sockets[user_id]
        self._sockets[user_id].add(websocket)
        return came_online

    def disconnect(self, user_id: int, websocket: WebSocket) -> bool:
        """Forget a socket. Returns True if the user just went offline."""
        sockets = self._sockets.get(user_id)
        if not sockets:
            # close_all already dropped their sockets; the first handler to finish reports it.
            if user_id in self._closing:
                self._closing.discard(user_id)
                return True
            return False
        sockets.discard(websocket)
        if sockets:
            return False
        del self._sockets[user_id]
        return True

    def is_online(self, user_id: int) -> bool:
        """Online here, or on another process that has sent a heartbeat recently."""
        if self._sockets.get(user_id):
            return True
        now = self._clock()
        return any(
            user_id in peer.users and now - peer.seen_at < STALE_AFTER_SECONDS
            for peer in self._peers.values()
        )

    def local_counts(self) -> tuple[int, int]:
        """(people, sockets) connected to this process, for metrics."""
        return len(self._sockets), sum(len(s) for s in self._sockets.values())

    def online_among(self, user_ids: Iterable[int]) -> set[int]:
        return {uid for uid in user_ids if self.is_online(uid)}

    async def send(self, user_id: int, payload: dict[str, Any]) -> None:
        await self.send_many([user_id], payload)

    async def send_many(self, user_ids: Iterable[int], payload: dict[str, Any]) -> None:
        await self.broker.publish(sorted(set(user_ids)), jsonable_encoder(payload))

    async def close_all(self, user_id: int, code: int) -> None:
        """Close every socket a user has open, on every process, e.g. after a ban."""
        await self.broker.publish([user_id], {"type": CLOSE_EVENT, "code": code})

    async def deliver_local(self, user_ids: list[int], data: dict[str, Any]) -> None:
        """Write an event to the sockets this process holds for each user."""
        if data.get("type") in INTERNAL_EVENTS:
            await self._handle_internal(data)
            return
        for user_id in user_ids:
            if data.get("type") == CLOSE_EVENT:
                await self._close_local(user_id, data["code"])
                continue
            for websocket in list(self._sockets.get(user_id, ())):
                try:
                    await websocket.send_json(data)
                except Exception:  # the socket closed between lookup and send
                    log.debug("dropping dead socket for user %s", user_id)
                    self.disconnect(user_id, websocket)

    async def _close_local(self, user_id: int, code: int) -> None:
        sockets = self._sockets.pop(user_id, set())
        if sockets:
            self._closing.add(user_id)
        for websocket in list(sockets):
            try:
                await websocket.close(code=code)
            except Exception:
                log.debug("socket for user %s was already closed", user_id)


@dataclass
class Hub:
    """Everything the chat services need outside a request: sockets, DB and settings."""

    settings: Settings
    db: Database
    manager: ConnectionManager = field(default_factory=ConnectionManager)
    limiter: RateLimiter = field(default_factory=RateLimiter)
    # Matches with a persona reply in flight; later messages are folded into that reply.
    pending_replies: set[int] = field(default_factory=set)
    _tasks: set[asyncio.Task[Any]] = field(default_factory=set)

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        """Run a background coroutine, keeping a reference so it isn't garbage collected."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def _task_done(self, task: asyncio.Task[Any]) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception():
            log.error("background task failed", exc_info=task.exception())

    async def drain(self) -> None:
        """Wait for background work (used by tests and on shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def shutdown(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)
