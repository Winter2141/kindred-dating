import asyncio
from typing import Any

from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis

from app.broker import LocalBroker, RedisBroker
from app.realtime import ConnectionManager


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed_with: int | None = None
        self.changed = asyncio.Event()

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)
        self.changed.set()

    async def close(self, code: int) -> None:
        self.closed_with = code
        self.changed.set()

    async def wait_until(self, check) -> None:  # type: ignore[no-untyped-def]
        """Wait up to two seconds for a pub/sub round trip to reach this socket."""
        async with asyncio.timeout(2):
            while not check():
                await self.changed.wait()
                self.changed.clear()


async def test_local_broker_delivers_in_process() -> None:
    manager = ConnectionManager()
    socket = FakeSocket()
    manager.connect(1, socket)  # type: ignore[arg-type]
    await manager.send_many([1, 2], {"type": "typing"})
    assert socket.sent == [{"type": "typing"}]
    assert isinstance(manager.broker, LocalBroker)


async def test_redis_broker_reaches_sockets_on_another_worker() -> None:
    server = FakeServer()
    worker_a = ConnectionManager(RedisBroker(FakeRedis(server=server)))
    worker_b = ConnectionManager(RedisBroker(FakeRedis(server=server)))
    await worker_a.start()
    await worker_b.start()
    try:
        alice, bob = FakeSocket(), FakeSocket()
        worker_a.connect(1, alice)  # type: ignore[arg-type]
        worker_b.connect(2, bob)  # type: ignore[arg-type]

        # A message sent through worker A reaches Bob, whose socket lives on worker B.
        await worker_a.send_many([1, 2], {"type": "message.new", "body": "hi"})
        await bob.wait_until(lambda: bob.sent)
        await alice.wait_until(lambda: alice.sent)
        assert bob.sent == [{"type": "message.new", "body": "hi"}]
        assert alice.sent == [{"type": "message.new", "body": "hi"}]

        # Closing someone's sockets works across workers too, and never leaks to clients.
        await worker_a.close_all(2, 4401)
        await bob.wait_until(lambda: bob.closed_with is not None)
        assert bob.closed_with == 4401
        assert not worker_b.is_online(2)
        assert all(event["type"] != "__close__" for event in bob.sent)
    finally:
        await worker_a.stop()
        await worker_b.stop()


async def test_a_bad_event_does_not_stop_delivery() -> None:
    server = FakeServer()
    publisher = FakeRedis(server=server)
    manager = ConnectionManager(RedisBroker(FakeRedis(server=server)))
    await manager.start()
    try:
        socket = FakeSocket()
        manager.connect(5, socket)  # type: ignore[arg-type]
        await publisher.publish(RedisBroker.CHANNEL, "not json")
        await manager.send(5, {"type": "typing"})
        await socket.wait_until(lambda: socket.sent)
        assert socket.sent == [{"type": "typing"}]
    finally:
        await manager.stop()
        await publisher.aclose()
