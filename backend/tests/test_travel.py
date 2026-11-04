from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import User
from app.places import canonical


def _deck(client: TestClient, account) -> list[dict]:
    return client.get("/api/discover", headers=account.headers).json()


def _ids(cards: list[dict]) -> set[int]:
    return {card["id"] for card in cards}


def _travel(client: TestClient, account, place: str, days: int = 5):
    until = (utcnow().date() + timedelta(days=days)).isoformat()
    return client.put(
        "/api/me/travel", json={"place": place, "until": until}, headers=account.headers
    )


def _people(make_user):
    traveller = make_user(gender="man", interested_in=["woman"], city="Brooklyn, NY")
    at_home = make_user(city="Williamsburg, NY")
    abroad = make_user(city="Lisbon, Portugal")
    return traveller, at_home, abroad


def test_place_names_are_matched_loosely() -> None:
    assert canonical("lisbon") == "Lisbon, Portugal"
    assert canonical("  Lisbon,   portugal ") == "Lisbon, Portugal"
    assert canonical("Atlantis") is None
    assert canonical("") is None


def test_a_trip_moves_the_deck(client: TestClient, make_user) -> None:
    traveller, at_home, abroad = _people(make_user)
    assert _ids(_deck(client, traveller)) == {at_home.id}

    response = _travel(client, traveller, "lisbon", days=5)
    assert response.status_code == 200
    me = response.json()
    until = (utcnow().date() + timedelta(days=5)).isoformat()
    assert me["travel"] == {"place": "Lisbon, Portugal", "until": until}
    assert me["visiting"] == "Lisbon, Portugal"
    assert me["city"] == "Brooklyn, NY"  # home doesn't change

    deck = _deck(client, traveller)
    assert _ids(deck) == {abroad.id}
    assert deck[0]["distance_km"] <= 2

    # People in Lisbon can find the traveller, labelled as visiting.
    (card,) = [c for c in _deck(client, abroad) if c["id"] == traveller.id]
    assert card["visiting"] == "Lisbon, Portugal"
    assert card["city"] == "Brooklyn, NY"
    assert traveller.id not in _ids(_deck(client, at_home))


def test_ending_a_trip(client: TestClient, make_user) -> None:
    traveller, at_home, _ = _people(make_user)
    _travel(client, traveller, "Lisbon, Portugal")
    ended = client.delete("/api/me/travel", headers=traveller.headers).json()
    assert ended["travel"] is None and ended["visiting"] is None
    assert _ids(_deck(client, traveller)) == {at_home.id}


def test_a_trip_ends_on_its_own(client: TestClient, make_user) -> None:
    traveller, at_home, abroad = _people(make_user)
    _travel(client, traveller, "Lisbon, Portugal")

    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            user = await session.get(User, traveller.id)
            user.travel_until = utcnow() - timedelta(minutes=1)
            await session.commit()

    client.portal.call(run)
    me = client.get("/api/me", headers=traveller.headers).json()
    assert me["travel"] is None and me["visiting"] is None
    assert _ids(_deck(client, traveller)) == {at_home.id}
    assert traveller.id not in _ids(_deck(client, abroad))


def test_what_makes_a_trip(client: TestClient, make_user) -> None:
    traveller = make_user(city="Brooklyn, NY")
    today = utcnow().date()

    def ask(place: str, until) -> tuple[int, str]:
        response = client.put(
            "/api/me/travel",
            json={"place": place, "until": until.isoformat()},
            headers=traveller.headers,
        )
        return response.status_code, response.json().get("detail")

    assert ask("Atlantis", today)[0] == 422
    assert ask("brooklyn", today) == (422, "That's where you live")
    assert ask("Paris", today - timedelta(days=1)) == (422, "That day has already gone")
    assert ask("Paris", today + timedelta(days=31)) == (
        422,
        "Trips can last up to 30 days from today",
    )
    # A trip can be as short as today, as long as 30 days, and can be changed.
    assert ask("Paris", today)[0] == 200
    assert ask("Berlin", today + timedelta(days=30))[0] == 200
    travel = client.get("/api/me", headers=traveller.headers).json()["travel"]
    assert travel["place"] == "Berlin, Germany"


def test_the_export_includes_a_trip(client: TestClient, make_user) -> None:
    traveller = make_user(city="Brooklyn, NY")
    _travel(client, traveller, "Paris")
    account = client.get("/api/me/export", headers=traveller.headers).json()["account"]
    assert account["travelling_to"] == "Paris, France"
