from datetime import timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.db import utcnow
from app.main import create_app
from app.seed_data import DEMO_EMAIL, DEMO_PASSWORD, SECOND_DEMO_EMAIL


def test_demo_data_gives_a_full_first_session(settings: Settings) -> None:
    seeded = settings.model_copy(update={"seed_on_startup": True})
    with TestClient(create_app(seeded)) as client:
        login = client.post(
            "/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
        )
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        deck = client.get("/api/discover", params={"limit": 50}, headers=headers).json()
        assert len(deck) >= 15
        assert deck[0]["super_liked_you"] and deck[1]["super_liked_you"]
        assert all(card["gender"] == "woman" for card in deck)

        matches = client.get("/api/matches", headers=headers).json()
        assert len(matches) == 5
        assert sum(m["unread_count"] for m in matches) == 2
        assert len(client.get("/api/likes", headers=headers).json()) == 6
        assert login.json()["user"]["is_admin"] is True
        bell = client.get("/api/notifications", headers=headers).json()
        # Two super likes, two fresh matches and Sofia's unread messages.
        assert bell["unread"] == 5
        assert {n["kind"] for n in bell["items"]} == {"like", "super_like", "match", "message"}
        queue = client.get("/api/admin/reports", headers=headers).json()
        assert [r["reported"]["name"] for r in queue] == ["Ryan", "Ryan", "Owen", "Henrik"]
        assert queue[-1]["reported"]["unkind_messages"] == 3
        trends = client.get("/api/admin/trends", params={"days": 30}, headers=headers).json()
        assert trends["reports_resolved"] == 18  # the dismissed history behind the Trends tab
        assert trends["median_hours_to_resolve"] is not None

        second = client.post(
            "/api/auth/login", json={"email": SECOND_DEMO_EMAIL, "password": DEMO_PASSWORD}
        )
        assert second.json()["user"]["name"] == "Maya"

    # Restarting doesn't seed twice.
    with TestClient(create_app(seeded)) as client:
        login = client.post(
            "/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert len(client.get("/api/matches", headers=headers).json()) == 5


def test_demo_data_has_people_to_travel_to(settings: Settings) -> None:
    seeded = settings.model_copy(update={"seed_on_startup": True})
    with TestClient(create_app(seeded)) as client:
        login = client.post(
            "/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        deck = client.get("/api/discover", params={"limit": 50}, headers=headers).json()
        # Harriet lives in London but is visiting Brooklyn this week.
        (harriet,) = [card for card in deck if card["name"] == "Harriet"]
        assert harriet["visiting"] == "Brooklyn, NY" and harriet["city"] == "London, UK"
        assert not any(card["city"] == "Lisbon, Portugal" for card in deck)

        until = (utcnow().date() + timedelta(days=3)).isoformat()
        client.put("/api/me/travel", json={"place": "Lisbon", "until": until}, headers=headers)
        deck = client.get("/api/discover", params={"limit": 50}, headers=headers).json()
        assert {card["name"] for card in deck} == {"Inês", "Beatriz", "Leonor"}


def test_demo_data_shows_who_viewed_alex(settings: Settings) -> None:
    seeded = settings.model_copy(update={"seed_on_startup": True})
    with TestClient(create_app(seeded)) as client:
        login = client.post(
            "/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        viewers = client.get("/api/me/viewers", headers=headers).json()["viewers"]
        assert [v["user"]["name"] for v in viewers][:2] == ["Harriet", "Amara"]
        assert next(v for v in viewers if v["user"]["name"] == "Amara")["liked_you"] is True
