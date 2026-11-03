import pytest
from fastapi.testclient import TestClient

from app.places import geocode, search
from app.services.matching import bounding_box, display_distance, haversine_km

BROOKLYN = (40.6782, -73.9442)
PHILADELPHIA = (39.9526, -75.1652)


def test_haversine_matches_known_distances() -> None:
    assert haversine_km(BROOKLYN, BROOKLYN) == 0
    assert haversine_km(BROOKLYN, PHILADELPHIA) == pytest.approx(130, abs=5)
    assert haversine_km((51.5074, -0.1278), (48.8566, 2.3522)) == pytest.approx(344, abs=3)


def test_bounding_box_contains_the_radius() -> None:
    min_lat, max_lat, min_lng, max_lng = bounding_box(BROOKLYN, 50)
    assert haversine_km(BROOKLYN, (max_lat, BROOKLYN[1])) == pytest.approx(50, abs=0.1)
    assert haversine_km(BROOKLYN, (BROOKLYN[0], max_lng)) == pytest.approx(50, abs=0.5)
    assert min_lat < BROOKLYN[0] < max_lat and min_lng < BROOKLYN[1] < max_lng


def test_distances_are_rounded_for_privacy() -> None:
    assert display_distance(None) is None
    assert display_distance(0.2) == 1
    assert display_distance(12.6) == 13


def test_gazetteer_lookups() -> None:
    assert geocode("Brooklyn, NY") == BROOKLYN
    assert geocode("  brooklyn ") == BROOKLYN
    assert geocode("Atlantis") is None
    assert search("ho")[0] == "Hoboken, NJ"
    assert "Park Slope, NY" in search("slope")


def _deck(client: TestClient, account) -> list[dict]:
    return client.get("/api/discover", headers=account.headers).json()


def test_discover_respects_distance_both_ways(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], city="Brooklyn, NY")
    nearby = make_user(name="Near", city="Hoboken, NJ")
    far = make_user(name="Far", city="Philadelphia, PA")
    unknown = make_user(name="Somewhere", city="")

    deck = {c["name"]: c["distance_km"] for c in _deck(client, me)}
    assert deck == {"Near": 10, "Somewhere": None}

    client.patch("/api/me", json={"max_distance_km": 200}, headers=me.headers)
    assert "Far" not in {c["name"] for c in _deck(client, me)}  # Far still wants 50 km
    client.patch("/api/me", json={"max_distance_km": 200}, headers=far.headers)
    deck = {c["name"]: c["distance_km"] for c in _deck(client, me)}
    assert deck["Far"] == 131
    assert unknown.id and nearby.id


def test_location_comes_from_city_or_browser(client: TestClient, make_user) -> None:
    me = make_user(city="Brooklyn, NY")
    profile = client.get("/api/me", headers=me.headers).json()
    assert profile["has_location"] is True and profile["max_distance_km"] == 50
    assert "latitude" not in profile  # coordinates never leave the server

    moved = client.patch("/api/me", json={"city": "Atlantis"}, headers=me.headers).json()
    assert moved["has_location"] is False
    shared = client.patch(
        "/api/me", json={"latitude": 40.7, "longitude": -74.0}, headers=me.headers
    ).json()
    assert shared["has_location"] is True

    half = client.patch("/api/me", json={"latitude": 40.7}, headers=me.headers)
    assert half.status_code == 422
    too_far = client.patch("/api/me", json={"max_distance_km": 9000}, headers=me.headers)
    assert too_far.status_code == 422


def test_profiles_show_distance_but_not_coordinates(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], city="Brooklyn, NY")
    her = make_user(city="Manhattan, NY")
    profile = client.get(f"/api/users/{her.id}", headers=me.headers).json()
    assert profile["distance_km"] == 12
    assert "latitude" not in profile and "longitude" not in profile


def test_places_autocomplete(client: TestClient, make_user) -> None:
    me = make_user()
    response = client.get("/api/places", params={"q": "jer"}, headers=me.headers)
    assert response.json() == ["Jersey City, NJ"]
