from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.services.profile_strength import profile_strength


def _user(**overrides) -> SimpleNamespace:
    base = {
        "photos": [],
        "prompts": [],
        "bio": "",
        "interests": [],
        "latitude": None,
        "longitude": None,
        "job_title": "",
    }
    return SimpleNamespace(**(base | overrides))


def test_empty_profile_scores_zero_with_photos_first() -> None:
    strength = profile_strength(_user())
    assert strength.score == 0
    assert [t.key for t in strength.tips][:2] == ["photos", "prompts"]
    assert strength.tips[0].points == 25
    assert sum(t.points for t in strength.tips) == 100


def test_complete_profile_scores_100() -> None:
    strength = profile_strength(
        _user(
            photos=["a", "b", "c"],
            prompts=[{}, {}],
            bio="I bake bread on Sundays and hike whenever the weather lets me get away.",
            interests=["Coffee", "Hiking", "Books", "Film", "Dogs"],
            latitude=40.7,
            longitude=-74.0,
            job_title="Baker",
        )
    )
    assert strength.score == 100
    assert strength.tips == []


def test_partial_credit() -> None:
    strength = profile_strength(_user(photos=["a"], bio="Hi!", interests=["Coffee", "Hiking"]))
    # 8 for one photo, 7 for a short bio, 6 for two interests.
    assert strength.score == 21
    photos = next(t for t in strength.tips if t.key == "photos")
    assert photos.text.startswith("Add 2 more photos") and photos.points == 17


def test_strength_endpoint(client: TestClient, make_user) -> None:
    me = make_user(city="Brooklyn, NY", interests=["Coffee", "Hiking", "Books"])
    body = client.get("/api/me/strength", headers=me.headers).json()
    # Location (15) + three interests (9).
    assert body["score"] == 24
    assert body["tips"][0] == {
        "key": "photos",
        "text": "Add a photo. Profiles without one rarely get likes",
        "points": 25,
    }
    updated = client.patch("/api/me", json={"job_title": "Designer"}, headers=me.headers)
    assert updated.status_code == 200
    assert client.get("/api/me/strength", headers=me.headers).json()["score"] == 34
