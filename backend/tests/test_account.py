import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import like_each_other


def test_changing_password_signs_out_other_sessions(client: TestClient, make_user) -> None:
    me = make_user(email="pw@example.com")
    response = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "battery-staple"},
        headers=me.headers,
    )
    assert response.status_code == 200
    fresh = {"Authorization": f"Bearer {response.json()['access_token']}"}

    assert client.get("/api/me", headers=me.headers).status_code == 401
    assert client.get("/api/me", headers=fresh).status_code == 200
    login = client.post(
        "/api/auth/login", json={"email": "pw@example.com", "password": "battery-staple"}
    )
    assert login.status_code == 200


def test_password_change_checks_the_current_password(client: TestClient, make_user) -> None:
    me = make_user()
    wrong = client.post(
        "/api/me/password",
        json={"current_password": "not-it-at-all", "new_password": "battery-staple"},
        headers=me.headers,
    )
    assert wrong.status_code == 403
    same = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "correct-horse"},
        headers=me.headers,
    )
    assert same.status_code == 422


def test_sign_out_everywhere_revokes_tokens_and_sockets(client: TestClient, make_user) -> None:
    me = make_user()
    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()  # hello
        response = client.post("/api/me/sign-out-everywhere", headers=me.headers)
        assert response.status_code == 204
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    assert client.get("/api/me", headers=me.headers).status_code == 401


def test_paused_profiles_leave_the_deck(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    assert [c["id"] for c in client.get("/api/discover", headers=me.headers).json()] == [her.id]

    paused = client.patch("/api/me", json={"is_paused": True}, headers=her.headers)
    assert paused.json()["is_paused"] is True
    assert client.get("/api/discover", headers=me.headers).json() == []

    client.patch("/api/me", json={"is_paused": False}, headers=her.headers)
    assert len(client.get("/api/discover", headers=me.headers).json()) == 1


def test_deleting_the_account_removes_everything(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], email="gone@example.com")
    her = make_user()
    match_id = like_each_other(client, me, her)
    client.post(f"/api/matches/{match_id}/messages", json={"body": "hi"}, headers=me.headers)

    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        wrong = client.request(
            "DELETE", "/api/me", json={"password": "nope-nope"}, headers=me.headers
        )
        assert wrong.status_code == 403
        response = client.request(
            "DELETE", "/api/me", json={"password": "correct-horse"}, headers=me.headers
        )
        assert response.status_code == 204
        event = ws.receive_json()
        assert event == {"type": "match.removed", "match_id": match_id}

    assert client.get("/api/me", headers=me.headers).status_code == 401
    assert client.get("/api/matches", headers=her.headers).json() == []
    login = client.post(
        "/api/auth/login", json={"email": "gone@example.com", "password": "correct-horse"}
    )
    assert login.status_code == 401
