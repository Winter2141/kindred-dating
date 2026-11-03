"""WebSocket fan-out.

Every connected socket is registered under its user id; a user can have several tabs open.
Events go out through a broker (see app.broker): delivered in-process by default, or via
Redis pub/sub so that several API processes can each reach the sockets they hold.
"""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Coroutine, Iterable
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


class ConnectionManager:
    def __init__(self, broker: Broker | None = None) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self.broker: Broker = broker or LocalBroker(self.deliver_local)

    async def start(self) -> None:
        await self.broker.start(self.deliver_local)

    async def stop(self) -> None:
        await self.broker.stop()

    def connect(self, user_id: int, websocket: WebSocket) -> bool:
        """Register a socket. Returns True if the user just came online."""
        came_online = not self._sockets[user_id]
        self._sockets[user_id].add(websocket)
        return came_online

    def disconnect(self, user_id: int, websocket: WebSocket) -> bool:
        """Forget a socket. Returns True if the user just went offline."""
        sockets = self._sockets.get(user_id)
        if not sockets:
            return False
        sockets.discard(websocket)
        if sockets:
            return False
        del self._sockets[user_id]
        return True

    def is_online(self, user_id: int) -> bool:
        return bool(self._sockets.get(user_id))

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
        for websocket in list(self._sockets.pop(user_id, ())):
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
