from fastapi.testclient import TestClient

from app.config import Settings
from app.security import create_purpose_token
from tests.test_email import _outbox, _token_from


def _ask(client: TestClient, me, new_email: str, password: str = "correct-horse"):
    return client.post(
        "/api/me/email", json={"new_email": new_email, "password": password}, headers=me.headers
    )


def _link(client: TestClient, to: str) -> str:
    (email,) = [e for e in _outbox(client, to) if e["kind"] == "change"][:1]
    return _token_from(email)


def _login(client: TestClient, email: str) -> int:
    return client.post(
        "/api/auth/login", json={"email": email, "password": "correct-horse"}
    ).status_code


def test_moving_to_a_new_address(client: TestClient, make_user) -> None:
    me = make_user()
    asked = _ask(client, me, "New.Me@Example.com")
    assert asked.status_code == 202
    assert asked.json()["pending_email"] == "new.me@example.com"
    assert asked.json()["email"] == me.email

    # The old address is warned straight away, without spelling out the new one.
    notice = next(e for e in _outbox(client, me.email) if e["kind"] == "notice")
    assert "about to change" in notice["subject"]
    assert "n•••••@example.com" in notice["body"] and "new.me@" not in notice["body"]
    # Until the link is followed, sign-in still uses the old address.
    assert _login(client, me.email) == 200
    assert _login(client, "new.me@example.com") == 401

    token = _link(client, "new.me@example.com")
    assert (
        "http://localhost:5173/confirm-email-change?token="
        in _outbox(client, "new.me@example.com")[0]["body"]
    )
    confirmed = client.post("/api/auth/confirm-email-change", json={"token": token})
    assert confirmed.json() == {"email": "new.me@example.com", "verified": True}

    profile = client.get("/api/me", headers=me.headers).json()
    assert profile["email"] == "new.me@example.com"
    assert profile["email_verified"] is True and profile["pending_email"] is None
    assert _login(client, "new.me@example.com") == 200
    assert _login(client, me.email) == 401
    # The old address gets one last email, and the link can't be used twice.
    assert any("has changed" in e["subject"] for e in _outbox(client, me.email))
    again = client.post("/api/auth/confirm-email-change", json={"token": token})
    assert again.status_code == 400


def test_what_cant_be_asked_for(client: TestClient, make_user) -> None:
    me, other = make_user(), make_user()
    assert _ask(client, me, "fresh@example.com", password="wrong").status_code == 403
    assert _ask(client, me, me.email.upper()).status_code == 422
    taken = _ask(client, me, other.email)
    assert taken.status_code == 409
    assert taken.json()["detail"] == "Another account already uses that email"
    assert client.get("/api/me", headers=me.headers).json()["pending_email"] is None
    assert _outbox(client, "fresh@example.com") == []


def test_cancelling_or_asking_again_voids_the_earlier_link(client: TestClient, make_user) -> None:
    me = make_user()
    _ask(client, me, "first@example.com")
    first = _link(client, "first@example.com")
    _ask(client, me, "second@example.com")
    assert client.post("/api/auth/confirm-email-change", json={"token": first}).status_code == 400

    cancelled = client.delete("/api/me/email/pending", headers=me.headers)
    assert cancelled.json()["pending_email"] is None
    second = _link(client, "second@example.com")
    assert client.post("/api/auth/confirm-email-change", json={"token": second}).status_code == 400
    assert client.get("/api/me", headers=me.headers).json()["email"] == me.email


def test_resending_the_link(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.post("/api/me/email/resend", headers=me.headers).status_code == 404
    _ask(client, me, "later@example.com")
    assert client.post("/api/me/email/resend", headers=me.headers).status_code == 204
    links = [e for e in _outbox(client, "later@example.com") if e["kind"] == "change"]
    assert len(links) == 2
    # Either link works, since both name the same pair of addresses.
    token = _token_from(links[1])
    assert client.post("/api/auth/confirm-email-change", json={"token": token}).status_code == 200


def test_the_address_is_taken_before_the_link_is_followed(client: TestClient, make_user) -> None:
    me = make_user()
    _ask(client, me, "popular@example.com")
    token = _link(client, "popular@example.com")
    make_user(email="popular@example.com")
    response = client.post("/api/auth/confirm-email-change", json={"token": token})
    assert response.status_code == 409
    assert client.get("/api/me", headers=me.headers).json()["email"] == me.email


def test_only_change_links_are_accepted(client: TestClient, make_user, settings: Settings) -> None:
    me = make_user()
    _ask(client, me, "elsewhere@example.com")
    claims = {"email": "elsewhere@example.com", "from": me.email}
    wrong_purpose = create_purpose_token(me.id, "verify_email", settings.secret_key, 10, claims)
    forged_target = create_purpose_token(
        me.id, "change_email", settings.secret_key, 10, {**claims, "email": "mine@example.com"}
    )
    for token in ("nonsense", wrong_purpose, forged_target):
        response = client.post("/api/auth/confirm-email-change", json={"token": token})
        assert response.status_code == 400
