from collections.abc import Callable, Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.matching import years_before


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        secret_key="test-secret-that-is-long-enough-for-hs256",
        media_dir=tmp_path / "media",
        seed_on_startup=False,
        demo_mode=False,
        persona_read_delay=(0, 0),
        persona_typing_delay=(0, 0),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def birthdate_for(age: int) -> str:
    """A birthdate that makes someone exactly `age` today (birthday was a month ago)."""
    return (years_before(date.today(), age) - timedelta(days=30)).isoformat()


class Account:
    def __init__(self, client: TestClient, payload: dict[str, Any]) -> None:
        response = client.post("/api/auth/register", json=payload)
        assert response.status_code == 201, response.text
        body = response.json()
        self.id: int = body["user"]["id"]
        self.token: str = body["access_token"]
        self.email: str = payload["email"]
        self.headers = {"Authorization": f"Bearer {self.token}"}


@pytest.fixture
def make_user(client: TestClient) -> Callable[..., Account]:
    counter = iter(range(1, 10_000))

    def factory(**overrides: Any) -> Account:
        n = next(counter)
        payload: dict[str, Any] = {
            "email": f"user{n}@example.com",
            "password": "correct-horse",
            "name": f"User {n}",
            "birthdate": birthdate_for(overrides.pop("age", 28)),
            "gender": "woman",
            "interested_in": ["man"],
            "interests": ["Coffee", "Hiking", "Books"],
        }
        payload.update(overrides)
        return Account(client, payload)

    return factory


def like_each_other(client: TestClient, first: Account, second: Account) -> int:
    """Create a match between two accounts and return its id."""
    client.post(
        "/api/swipes", json={"target_id": second.id, "action": "like"}, headers=first.headers
    )
    response = client.post(
        "/api/swipes", json={"target_id": first.id, "action": "like"}, headers=second.headers
    )
    assert response.json()["matched"] is True
    return response.json()["match"]["id"]
