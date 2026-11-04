import time

from fastapi.testclient import TestClient

from app import totp
from tests.test_email import _outbox, _token_from

SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


def _events(client: TestClient, account, headers: dict | None = None) -> list[dict]:
    response = client.get("/api/me/security-events", headers=headers or account.headers)
    assert response.status_code == 200
    return response.json()


def _kinds(client: TestClient, account, headers: dict | None = None) -> list[str]:
    return [event["kind"] for event in _events(client, account, headers)]


def _login(client: TestClient, email: str, password: str = "correct-horse", **headers):
    return client.post(
        "/api/auth/login", json={"email": email, "password": password}, headers=headers
    )


def test_sign_ins_and_wrong_passwords(client: TestClient, make_user) -> None:
    me = make_user()
    assert _events(client, me) == []  # signing up isn't a sign-in

    assert _login(client, me.email, "wrong-horse").status_code == 401
    assert _login(client, me.email, **{"User-Agent": SAFARI}).status_code == 200
    events = _events(client, me)
    assert [e["kind"] for e in events] == ["sign_in", "sign_in_failed"]  # newest first
    assert events[0]["device"] == "Safari on iPhone"
    assert events[0]["ip_address"] == "testclient"

    # A wrong password for an address nobody has leaves no trace anywhere.
    assert _login(client, "nobody@example.com").status_code == 401


def test_password_and_sign_out_everywhere(client: TestClient, make_user) -> None:
    me = make_user()
    changed = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "battery-staple"},
        headers=me.headers,
    )
    headers = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert _kinds(client, me, headers) == ["password_changed"]

    client.post("/api/me/sign-out-everywhere", headers=headers)
    fresh = _login(client, me.email, "battery-staple").json()["access_token"]
    kinds = _kinds(client, me, {"Authorization": f"Bearer {fresh}"})
    assert kinds == ["sign_in", "signed_out_everywhere", "password_changed"]


def test_password_reset_from_a_link(client: TestClient, make_user) -> None:
    me = make_user()
    client.post("/api/auth/forgot-password", json={"email": me.email})
    link = next(e for e in _outbox(client, me.email) if e["kind"] == "reset")
    reset = client.post(
        "/api/auth/reset-password",
        json={"token": _token_from(link), "new_password": "a-new-password"},
    )
    headers = {"Authorization": f"Bearer {reset.json()['access_token']}"}
    assert _kinds(client, me, headers) == ["password_reset"]


def test_email_changes(client: TestClient, make_user) -> None:
    me = make_user()
    client.post(
        "/api/me/email",
        json={"new_email": "moved@example.com", "password": "correct-horse"},
        headers=me.headers,
    )
    link = next(e for e in _outbox(client, "moved@example.com") if e["kind"] == "change")
    client.post("/api/auth/confirm-email-change", json={"token": _token_from(link)})
    assert _kinds(client, me) == ["email_changed", "email_change_requested"]


def test_two_factor_on_off_and_its_sign_in(client: TestClient, make_user) -> None:
    me = make_user()
    secret = client.post("/api/me/2fa/setup", headers=me.headers).json()["secret"]
    client.post(
        "/api/me/2fa/enable", json={"code": totp.code_at(secret, time.time())}, headers=me.headers
    )

    challenge = _login(client, me.email).json()["mfa_token"]
    assert _kinds(client, me) == ["two_factor_on"]  # the password alone isn't a sign-in yet
    recovery = client.post(
        "/api/me/2fa/recovery-codes", json={"password": "correct-horse"}, headers=me.headers
    ).json()["recovery_codes"]
    signed_in = client.post(
        "/api/auth/login/2fa", json={"mfa_token": challenge, "code": recovery[0]}
    )
    assert signed_in.status_code == 200
    client.post(
        "/api/me/2fa/disable",
        json={"password": "correct-horse", "code": recovery[1]},
        headers=me.headers,
    )
    assert _kinds(client, me) == ["two_factor_off", "sign_in", "two_factor_on"]


def test_only_your_own_events(client: TestClient, make_user) -> None:
    me, other = make_user(), make_user()
    _login(client, other.email)
    assert _events(client, me) == []
    assert client.get("/api/me/security-events").status_code == 401
