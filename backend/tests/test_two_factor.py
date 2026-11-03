import base64
import time

from fastapi.testclient import TestClient

from app import totp


def test_rfc_6238_vectors() -> None:
    """The SHA-1 test vectors from RFC 6238, appendix B (8 digits)."""
    key = b"12345678901234567890"
    for timestamp, expected in [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
    ]:
        assert totp.hotp(key, totp.counter_at(timestamp), digits=8) == expected


def test_verify_window_and_replay() -> None:
    secret = base64.b32encode(b"12345678901234567890").decode()
    now = 1_800_000_000.0
    code = totp.code_at(secret, now)
    step = totp.counter_at(now)
    assert totp.verify(secret, code, now=now) == step
    assert totp.verify(secret, code, now=now + 30) == step  # one step of drift is fine
    assert totp.verify(secret, code, now=now + 90) is None
    assert totp.verify(secret, code, now=now, last_counter=step) is None  # already used
    assert totp.verify(secret, "12 34 5", now=now) is None
    assert totp.verify(secret, "abcdef", now=now) is None


def test_recovery_codes_look_right() -> None:
    codes = totp.new_recovery_codes()
    assert len(codes) == 10 and len(set(codes)) == 10
    assert all(len(c) == 9 and c[4] == "-" for c in codes)
    assert totp.hash_recovery_code(" ABCD-EFGH ") == totp.hash_recovery_code("abcd-efgh")


def test_qr_codes_are_svg() -> None:
    svg = totp.qr_svg(totp.provisioning_uri("JBSWY3DPEHPK3PXP", "me@example.com"))
    assert svg.startswith("<?xml") or svg.startswith("<svg")
    assert "viewBox" in svg


def _now_code(secret: str, offset: int = 0) -> str:
    return totp.code_at(secret, time.time() + offset)


def _enable(client: TestClient, account) -> tuple[str, list[str]]:
    setup = client.post("/api/me/2fa/setup", headers=account.headers).json()
    assert setup["otpauth_url"].startswith("otpauth://totp/Kindred%3A")
    assert "<svg" in setup["qr_svg"]
    enabled = client.post(
        "/api/me/2fa/enable", json={"code": _now_code(setup["secret"])}, headers=account.headers
    )
    assert enabled.status_code == 200, enabled.text
    return setup["secret"], enabled.json()["recovery_codes"]


def _login(client: TestClient, account):
    return client.post(
        "/api/auth/login", json={"email": account.email, "password": "correct-horse"}
    ).json()


def test_turning_it_on(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.get("/api/me/2fa", headers=me.headers).json() == {
        "enabled": False,
        "recovery_codes_left": 0,
    }
    setup = client.post("/api/me/2fa/setup", headers=me.headers).json()
    wrong = client.post("/api/me/2fa/enable", json={"code": "000000"}, headers=me.headers)
    assert wrong.status_code == 403
    assert client.get("/api/me", headers=me.headers).json()["two_factor_enabled"] is False

    enabled = client.post(
        "/api/me/2fa/enable", json={"code": _now_code(setup["secret"])}, headers=me.headers
    )
    assert len(enabled.json()["recovery_codes"]) == 10
    assert client.get("/api/me", headers=me.headers).json()["two_factor_enabled"] is True
    assert client.post("/api/me/2fa/setup", headers=me.headers).status_code == 409


def test_signing_in_needs_the_code(client: TestClient, make_user) -> None:
    me = make_user()
    secret, _ = _enable(client, me)

    challenge = _login(client, me)
    assert challenge["mfa_required"] is True and "access_token" not in challenge

    bad = client.post(
        "/api/auth/login/2fa", json={"mfa_token": challenge["mfa_token"], "code": "000000"}
    )
    assert bad.status_code == 403
    # The code used to enable it is spent; the next one works.
    good = client.post(
        "/api/auth/login/2fa",
        json={"mfa_token": challenge["mfa_token"], "code": _now_code(secret, 30)},
    )
    assert good.status_code == 200
    assert good.json()["user"]["two_factor_enabled"] is True

    replay = client.post(
        "/api/auth/login/2fa",
        json={"mfa_token": challenge["mfa_token"], "code": _now_code(secret, 30)},
    )
    assert replay.status_code == 403


def test_recovery_codes_work_once(client: TestClient, make_user) -> None:
    me = make_user()
    _, codes = _enable(client, me)
    token = _login(client, me)["mfa_token"]
    first = client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": codes[0]})
    assert first.status_code == 200
    again = client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": codes[0]})
    assert again.status_code == 403
    status = client.get("/api/me/2fa", headers=me.headers).json()
    assert status["recovery_codes_left"] == 9


def test_challenges_are_not_sessions_and_expire_with_sign_out(
    client: TestClient, make_user
) -> None:
    me = make_user()
    secret, codes = _enable(client, me)
    token = _login(client, me)["mfa_token"]
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    client.post("/api/me/sign-out-everywhere", headers=me.headers)
    stale = client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": codes[1]})
    assert stale.status_code == 401


def test_turning_it_off_and_new_codes(client: TestClient, make_user) -> None:
    me = make_user()
    secret, codes = _enable(client, me)
    new = client.post(
        "/api/me/2fa/recovery-codes", json={"password": "correct-horse"}, headers=me.headers
    ).json()["recovery_codes"]
    assert set(new).isdisjoint(codes)

    wrong_password = client.post(
        "/api/me/2fa/disable", json={"password": "nope", "code": new[0]}, headers=me.headers
    )
    assert wrong_password.status_code == 403
    old_code = client.post(
        "/api/me/2fa/disable",
        json={"password": "correct-horse", "code": codes[0]},
        headers=me.headers,
    )
    assert old_code.status_code == 403
    off = client.post(
        "/api/me/2fa/disable",
        json={"password": "correct-horse", "code": new[0]},
        headers=me.headers,
    )
    assert off.status_code == 204
    assert "access_token" in _login(client, me)
