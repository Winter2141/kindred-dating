"""How a real-time event reaches a user's sockets.

`LocalBroker` hands events straight to this process's sockets, which is all a single API
process needs. `RedisBroker` publishes every event to a Redis channel that each API process
subscribes to, so a message sent through one worker reaches sockets held by another.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

log = logging.getLogger(__name__)

# Receives (user ids, JSON-ready payload) and writes it to whichever of their sockets are here.
Deliver = Callable[[list[int], dict[str, Any]], Awaitable[None]]


class Broker(Protocol):
    async def start(self, deliver: Deliver) -> None: ...
    async def publish(self, user_ids: list[int], payload: dict[str, Any]) -> None: ...
    async def stop(self) -> None: ...


class LocalBroker:
    def __init__(self, deliver: Deliver | None = None) -> None:
        self._deliver = deliver

    async def start(self, deliver: Deliver) -> None:
        self._deliver = deliver

    async def publish(self, user_ids: list[int], payload: dict[str, Any]) -> None:
        if self._deliver is not None:
            await self._deliver(user_ids, payload)

    async def stop(self) -> None:
        self._deliver = None


class RedisBroker:
    CHANNEL = "kindred:events"

    def __init__(self, client: Any) -> None:
        self._redis = client
        self._pubsub: Any = None
        self._listener: asyncio.Task[None] | None = None

    @classmethod
    def from_url(cls, url: str) -> "RedisBroker":
        import redis.asyncio as redis  # optional dependency: pip install ".[redis]"

        return cls(redis.from_url(url))

    async def start(self, deliver: Deliver) -> None:
        self._pubsub = self._redis.pubsub()
        await self._pubsub.subscribe(self.CHANNEL)
        self._listener = asyncio.create_task(self._listen(deliver))

    async def _listen(self, deliver: Deliver) -> None:
        async for message in self._pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                event = json.loads(message["data"])
                await deliver(event["user_ids"], event["payload"])
            except Exception:  # one bad event must not stop delivery for everyone
                log.exception("could not deliver a broker event")

    async def publish(self, user_ids: list[int], payload: dict[str, Any]) -> None:
        await self._redis.publish(
            self.CHANNEL, json.dumps({"user_ids": user_ids, "payload": payload})
        )

    async def stop(self) -> None:
        if self._listener is not None:
            self._listener.cancel()
            await asyncio.gather(self._listener, return_exceptions=True)
        if self._pubsub is not None:
            await self._pubsub.unsubscribe(self.CHANNEL)
            await self._pubsub.aclose()
        await self._redis.aclose()
