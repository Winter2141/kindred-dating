from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.db import utcnow
from app.models import DeviceSession, User
from app.services import devices

IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
)
WINDOWS_EDGE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
)


def sign_in(client: TestClient, email: str, user_agent: str = WINDOWS_EDGE) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "correct-horse"},
        headers={"User-Agent": user_agent},
    )
    assert response.status_code == 200, response.text
    assert response.json()["session_id"] is not None
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_signing_in_starts_a_session(client: TestClient, make_user) -> None:
    me = make_user()
    phone = sign_in(client, me.email, IPHONE)

    sessions = client.get("/api/me/sessions", headers=phone).json()
    assert len(sessions) == 2  # registering signed the first browser in too
    newest = sessions[0]
    assert newest["label"] == "Safari on iPhone"
    assert newest["mobile"] is True
    assert newest["current"] is True
    assert newest["ip_address"] == "testclient"
    assert sessions[1]["current"] is False


def test_signing_out_one_device_leaves_the_others(client: TestClient, make_user) -> None:
    me = make_user()
    laptop = sign_in(client, me.email)
    phone = sign_in(client, me.email, IPHONE)

    phone_id = next(
        s["id"] for s in client.get("/api/me/sessions", headers=phone).json() if s["current"]
    )
    assert client.delete(f"/api/me/sessions/{phone_id}", headers=laptop).status_code == 204

    assert client.get("/api/me", headers=phone).status_code == 401
    assert client.get("/api/me", headers=laptop).status_code == 200
    labels = [s["label"] for s in client.get("/api/me/sessions", headers=laptop).json()]
    assert "Safari on iPhone" not in labels


def test_logout_ends_this_session(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.post("/api/auth/logout", headers=me.headers).status_code == 204
    assert client.get("/api/me", headers=me.headers).status_code == 401


def test_sign_out_others_keeps_this_one(client: TestClient, make_user) -> None:
    me = make_user()
    phone = sign_in(client, me.email, IPHONE)
    laptop = sign_in(client, me.email)

    response = client.post("/api/me/sessions/sign-out-others", headers=laptop)
    assert response.status_code == 204

    assert client.get("/api/me", headers=me.headers).status_code == 401
    assert client.get("/api/me", headers=phone).status_code == 401
    sessions = client.get("/api/me/sessions", headers=laptop).json()
    assert [s["current"] for s in sessions] == [True]


def test_a_password_change_ends_the_old_sessions(client: TestClient, make_user) -> None:
    me = make_user()
    sign_in(client, me.email, IPHONE)
    response = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "battery-staple"},
        headers=me.headers,
    )
    fresh = {"Authorization": f"Bearer {response.json()['access_token']}"}

    sessions = client.get("/api/me/sessions", headers=fresh).json()
    assert len(sessions) == 1
    assert sessions[0]["current"] is True


def test_other_peoples_sessions_are_off_limits(client: TestClient, make_user) -> None:
    me, someone = make_user(), make_user()
    theirs = client.get("/api/me/sessions", headers=someone.headers).json()[0]["id"]

    assert client.delete(f"/api/me/sessions/{theirs}", headers=me.headers).status_code == 404
    assert client.get("/api/me", headers=someone.headers).status_code == 200
    assert client.delete("/api/me/sessions/99999", headers=me.headers).status_code == 404


def test_signing_out_a_device_closes_only_its_sockets(client: TestClient, make_user) -> None:
    me = make_user()
    phone = sign_in(client, me.email, IPHONE)
    phone_token = phone["Authorization"].removeprefix("Bearer ")
    phone_id = client.get("/api/me/sessions", headers=phone).json()[0]["id"]

    with (
        client.websocket_connect(f"/ws?token={me.token}") as laptop_ws,
        client.websocket_connect(f"/ws?token={phone_token}") as phone_ws,
    ):
        laptop_ws.receive_json()  # hello
        phone_ws.receive_json()
        client.delete(f"/api/me/sessions/{phone_id}", headers=me.headers)

        with pytest.raises(WebSocketDisconnect) as closed:
            phone_ws.receive_json()
        assert closed.value.code == 4401
        laptop_ws.send_json({"type": "ping"})
        assert laptop_ws.receive_json()["type"] == "pong"

    with (
        pytest.raises(WebSocketDisconnect) as refused,
        client.websocket_connect(f"/ws?token={phone_token}"),
    ):
        pass
    assert refused.value.code == 4401


def _session(user: User, **fields) -> DeviceSession:
    now = utcnow()
    defaults = {
        "id": 1,
        "user_id": user.id,
        "token_version": user.token_version,
        "created_at": now,
        "last_seen_at": now,
        "expires_at": now + timedelta(days=1),
        "revoked_at": None,
    }
    return DeviceSession(**{**defaults, **fields})


def test_what_makes_a_session_live() -> None:
    user = User(id=7, token_version=2)
    now = utcnow()
    assert devices.is_live(_session(user), user, now)
    assert not devices.is_live(_session(user, revoked_at=now), user, now)
    assert not devices.is_live(_session(user, expires_at=now), user, now)
    assert not devices.is_live(_session(user, token_version=1), user, now)
    assert not devices.is_live(_session(user, user_id=8), user, now)


class _FakeSession:
    commits = 0

    async def commit(self) -> None:
        self.commits += 1


async def test_last_seen_is_only_written_now_and_then() -> None:
    user = User(id=7, token_version=0)
    now = utcnow()
    fake = _FakeSession()
    recent = _session(user, last_seen_at=now - timedelta(minutes=1), ip_address="1.1.1.1")
    await devices.touch(fake, recent, "2.2.2.2", now)  # type: ignore[arg-type]
    assert fake.commits == 0
    assert recent.ip_address == "1.1.1.1"

    stale = _session(user, last_seen_at=now - timedelta(minutes=10), ip_address="1.1.1.1")
    await devices.touch(fake, stale, "2.2.2.2", now)  # type: ignore[arg-type]
    assert fake.commits == 1
    assert stale.last_seen_at == now
    assert stale.ip_address == "2.2.2.2"
