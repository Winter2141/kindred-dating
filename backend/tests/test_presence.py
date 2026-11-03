"""Presence shared between API processes over the broker."""

import asyncio
from typing import Any

from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient

from app import realtime
from app.broker import RedisBroker
from app.realtime import ConnectionManager
from tests.conftest import like_each_other


class Socket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed_with: int | None = None

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)

    async def close(self, code: int) -> None:
        self.closed_with = code


async def eventually(check, seconds: float = 2.0) -> None:  # type: ignore[no-untyped-def]
    """Wait for a pub/sub round trip. State changes inside the managers, so poll it."""
    async with asyncio.timeout(seconds):
        while not check():  # noqa: ASYNC110 - there's no event to wait on from outside
            await asyncio.sleep(0.01)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def _workers(clock: Clock | None = None) -> tuple[ConnectionManager, ConnectionManager]:
    server = FakeServer()
    a = ConnectionManager(RedisBroker(FakeRedis(server=server)), clock=clock or Clock())
    b = ConnectionManager(RedisBroker(FakeRedis(server=server)), clock=clock or Clock())
    await a.start()
    await b.start()
    return a, b


async def test_someone_online_on_one_worker_is_online_on_all() -> None:
    a, b = await _workers()
    try:
        a.connect(7, Socket())  # type: ignore[arg-type]
        await a.announce(7, online=True)
        await eventually(lambda: b.is_online(7))
        assert b.online_among([7, 8]) == {7}

        a.disconnect(7, next(iter(a._sockets[7])))
        await a.announce(7, online=False)
        await eventually(lambda: not b.is_online(7))
    finally:
        await a.stop()
        await b.stop()


async def test_a_new_worker_learns_who_is_already_online() -> None:
    server = FakeServer()
    a = ConnectionManager(RedisBroker(FakeRedis(server=server)))
    await a.start()
    a.connect(3, Socket())  # type: ignore[arg-type]
    late = ConnectionManager(RedisBroker(FakeRedis(server=server)))
    try:
        await late.start()  # asks everyone for their list
        await eventually(lambda: late.is_online(3))
    finally:
        await a.stop()
        await late.stop()


async def test_a_silent_worker_is_forgotten() -> None:
    clock = Clock()
    a, b = await _workers(clock)
    try:
        a.connect(9, Socket())  # type: ignore[arg-type]
        await a.announce(9, online=True)
        await eventually(lambda: b.is_online(9))
        clock.now += realtime.STALE_AFTER_SECONDS + 1  # worker A stopped sending heartbeats
        assert not b.is_online(9)
    finally:
        await a.stop()
        await b.stop()


async def test_internal_events_never_reach_sockets() -> None:
    a, b = await _workers()
    try:
        socket = Socket()
        b.connect(1, socket)  # type: ignore[arg-type]
        await a.announce(1, online=True)
        await b.send(1, {"type": "typing"})
        await eventually(lambda: socket.sent)
        assert socket.sent == [{"type": "typing"}]
    finally:
        await a.stop()
        await b.stop()


async def test_closing_every_socket_still_reports_going_offline() -> None:
    manager = ConnectionManager()
    first, second = Socket(), Socket()
    manager.connect(4, first)  # type: ignore[arg-type]
    manager.connect(4, second)  # type: ignore[arg-type]
    await manager.close_all(4, 4401)
    assert (first.closed_with, second.closed_with) == (4401, 4401)
    # Both handlers finish afterwards; exactly one of them reports the user offline.
    assert manager.disconnect(4, first) is True  # type: ignore[arg-type]
    assert manager.disconnect(4, second) is False  # type: ignore[arg-type]


def test_partners_see_someone_go_offline_after_signing_out_everywhere(
    client: TestClient, make_user
) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    like_each_other(client, me, her)
    with client.websocket_connect(f"/ws?token={her.token}") as hers:
        hers.receive_json()  # hello
        with client.websocket_connect(f"/ws?token={me.token}") as mine:
            mine.receive_json()
            first = hers.receive_json()
            assert (first["type"], first["user_id"], first["online"]) == ("presence", me.id, True)
            client.post("/api/me/sign-out-everywhere", headers=me.headers)
        for _ in range(5):
            event = hers.receive_json()
            if event["type"] == "presence":
                assert event == {**event, "user_id": me.id, "online": False}
                break
        else:
            raise AssertionError("no offline presence event")
