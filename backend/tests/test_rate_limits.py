from fastapi.testclient import TestClient

from app.config import Settings
from app.limits import Limit, RateLimiter
from app.main import create_app
from tests.conftest import birthdate_for, like_each_other


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_sliding_window() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock)
    limit = Limit("demo", 3, 10)
    assert [limiter.hit("a", limit) for _ in range(3)] == [None, None, None]
    assert limiter.hit("a", limit) == 10  # the oldest hit frees up in 10 seconds
    assert limiter.hit("b", limit) is None  # keys are independent

    clock.now += 4
    assert limiter.hit("a", limit) == 6
    clock.now += 6
    assert limiter.hit("a", limit) is None  # the first three have slid out


def test_quiet_keys_are_forgotten() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock)
    limit = Limit("demo", 5, 10)
    limiter.hit("old", limit)
    clock.now += 2 * 60 * 60
    for i in range(999):
        limiter.hit(f"k{i}", limit)
    assert "demo:old" not in limiter._hits


def _limited_app(settings: Settings) -> TestClient:
    return TestClient(create_app(settings.model_copy(update={"rate_limit_enabled": True})))


def test_login_is_limited_per_address(settings: Settings) -> None:
    with _limited_app(settings) as client:
        for _ in range(10):
            response = client.post(
                "/api/auth/login", json={"email": "who@example.com", "password": "guess-again"}
            )
            assert response.status_code == 401
        blocked = client.post(
            "/api/auth/login", json={"email": "who@example.com", "password": "guess-again"}
        )
        assert blocked.status_code == 429
        assert 1 <= int(blocked.headers["Retry-After"]) <= 60
        assert "Try again in" in blocked.json()["detail"]


def test_messages_are_limited_over_rest_and_socket(settings: Settings) -> None:
    with _limited_app(settings) as client:
        me = _register(client, "me@example.com", "man", ["woman"])
        her = _register(client, "her@example.com", "woman", ["man"])
        match_id = like_each_other(client, me, her)
        for i in range(20):
            sent = client.post(
                f"/api/matches/{match_id}/messages", json={"body": f"hi {i}"}, headers=me.headers
            )
            assert sent.status_code == 201
        assert (
            client.post(
                f"/api/matches/{match_id}/messages", json={"body": "again"}, headers=me.headers
            ).status_code
            == 429
        )
        with client.websocket_connect(f"/ws?token={me.token}") as ws:
            ws.receive_json()  # hello
            ws.send_json(
                {"type": "message.send", "match_id": match_id, "body": "x", "client_id": "c9"}
            )
            event = ws.receive_json()
            assert event["type"] == "error" and event["client_id"] == "c9"
            assert "too fast" in event["detail"]
        # Someone else isn't affected.
        reply = client.post(
            f"/api/matches/{match_id}/messages", json={"body": "hey"}, headers=her.headers
        )
        assert reply.status_code == 201


class _Account:
    def __init__(self, body: dict) -> None:
        self.id = body["user"]["id"]
        self.token = body["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}


def _register(client: TestClient, email: str, gender: str, interested_in: list[str]) -> _Account:
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "long-enough",
            "name": email.split("@")[0].title(),
            "birthdate": birthdate_for(30),
            "gender": gender,
            "interested_in": interested_in,
        },
    )
    assert response.status_code == 201, response.text
    return _Account(response.json())
