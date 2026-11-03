import re

from fastapi.testclient import TestClient

from app.config import Settings
from app.security import create_access_token, create_purpose_token


def _outbox(client: TestClient, to: str) -> list[dict]:
    response = client.get("/api/dev/outbox", params={"to": to})
    assert response.status_code == 200
    return response.json()


def _token_from(email: dict) -> str:
    match = re.search(r"\?token=([\w.-]+)", email["body"])
    assert match, email["body"]
    return match.group(1)


def test_signing_up_sends_a_confirmation_link(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.get("/api/me", headers=me.headers).json()["email_verified"] is False
    (email,) = _outbox(client, me.email)
    assert email["kind"] == "verify" and "Confirm your email" in email["subject"]
    assert "http://localhost:5173/verify-email?token=" in email["body"]

    confirmed = client.post("/api/auth/verify-email", json={"token": _token_from(email)})
    assert confirmed.json() == {"email": me.email, "verified": True}
    assert client.get("/api/me", headers=me.headers).json()["email_verified"] is True
    # Following the link again is harmless.
    assert (
        client.post("/api/auth/verify-email", json={"token": _token_from(email)}).status_code == 200
    )
    assert client.post("/api/me/verify-email/resend", headers=me.headers).status_code == 409


def test_resending_and_bad_links(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.post("/api/me/verify-email/resend", headers=me.headers).status_code == 204
    assert len(_outbox(client, me.email)) == 2
    assert client.post("/api/auth/verify-email", json={"token": "nonsense"}).status_code == 400


def test_link_tokens_are_not_sessions_and_vice_versa(
    client: TestClient, make_user, settings: Settings
) -> None:
    me = make_user()
    verify = _token_from(_outbox(client, me.email)[0])
    assert client.get("/api/me", headers={"Authorization": f"Bearer {verify}"}).status_code == 401
    access = create_access_token(me.id, settings.secret_key, 10)
    assert client.post("/api/auth/verify-email", json={"token": access}).status_code == 400
    reset = create_purpose_token(me.id, "reset_password", settings.secret_key, 10, {"ver": 0})
    assert client.post("/api/auth/verify-email", json={"token": reset}).status_code == 400


def test_password_reset(client: TestClient, make_user) -> None:
    me = make_user()
    accepted = client.post("/api/auth/forgot-password", json={"email": me.email.upper()})
    assert accepted.status_code == 202
    reset = next(e for e in _outbox(client, me.email) if e["kind"] == "reset")
    token = _token_from(reset)

    signed_in = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"}
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["email_verified"] is True
    # Old sessions are gone, the new password works and the link is used up.
    assert client.get("/api/me", headers=me.headers).status_code == 401
    login = client.post("/api/auth/login", json={"email": me.email, "password": "brand-new-pass"})
    assert login.status_code == 200
    again = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "another-pass-1"}
    )
    assert again.status_code == 400


def test_forgot_password_does_not_reveal_accounts(client: TestClient) -> None:
    response = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert response.status_code == 202
    assert _outbox(client, "nobody@example.com") == []


def test_reset_needs_a_good_password(client: TestClient, make_user) -> None:
    me = make_user()
    client.post("/api/auth/forgot-password", json={"email": me.email})
    token = _token_from(next(e for e in _outbox(client, me.email) if e["kind"] == "reset"))
    short = client.post("/api/auth/reset-password", json={"token": token, "new_password": "abc"})
    assert short.status_code == 422


def test_the_outbox_is_off_unless_enabled(settings: Settings) -> None:
    from app.main import create_app

    with TestClient(create_app(settings.model_copy(update={"expose_outbox": False}))) as client:
        assert client.get("/api/dev/outbox").status_code == 404
