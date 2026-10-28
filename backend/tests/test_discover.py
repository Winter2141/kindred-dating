from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.services.matching import age_on, birthdate_bounds, compatibility
from tests.conftest import like_each_other


def _ids(client: TestClient, account) -> list[int]:
    return [c["id"] for c in client.get("/api/discover", headers=account.headers).json()]


def test_discover_respects_both_peoples_preferences(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], age=30, age_min=25, age_max=35)
    fits = make_user(gender="woman", interested_in=["man"], age=29)
    wrong_gender = make_user(gender="man", interested_in=["man"], age=29)
    not_into_men = make_user(gender="woman", interested_in=["woman"], age=29)
    too_old = make_user(gender="woman", interested_in=["man"], age=40)
    thinks_im_too_old = make_user(gender="woman", interested_in=["man"], age=26, age_max=28)

    ids = _ids(client, me)
    assert fits.id in ids
    for excluded in (wrong_gender, not_into_men, too_old, thinks_im_too_old):
        assert excluded.id not in ids
    assert me.id not in ids


def test_swiped_and_rejected_people_leave_the_deck(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    swiped = make_user()
    passed_on_me = make_user()
    client.post("/api/swipes", json={"target_id": swiped.id, "action": "pass"}, headers=me.headers)
    client.post(
        "/api/swipes", json={"target_id": me.id, "action": "pass"}, headers=passed_on_me.headers
    )
    assert _ids(client, me) == []


def test_super_likes_jump_the_queue(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], interests=["Coffee", "Hiking", "Books"])
    great_fit = make_user(interests=["Coffee", "Hiking", "Books"])
    super_fan = make_user(interests=["Surfing"])
    client.post(
        "/api/swipes", json={"target_id": me.id, "action": "super"}, headers=super_fan.headers
    )

    deck = client.get("/api/discover", headers=me.headers).json()
    assert [c["id"] for c in deck] == [super_fan.id, great_fit.id]
    assert deck[0]["super_liked_you"] is True
    assert deck[1]["shared_interests"] == ["Coffee", "Hiking", "Books"]
    assert deck[1]["compatibility"] > deck[0]["compatibility"]


def test_one_sided_like_is_not_a_match(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    response = client.post(
        "/api/swipes", json={"target_id": her.id, "action": "like"}, headers=me.headers
    )
    assert response.json() == {"matched": False, "match": None}

    likes = client.get("/api/likes", headers=her.headers).json()
    assert [like["user"]["id"] for like in likes] == [me.id]


def test_mutual_like_creates_a_match(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Robin")
    like_each_other(client, me, her)

    mine = client.get("/api/matches", headers=me.headers).json()
    hers = client.get("/api/matches", headers=her.headers).json()
    assert mine[0]["user"]["name"] == "Robin"
    assert hers[0]["user"]["name"] == "Sam"
    assert client.get("/api/likes", headers=me.headers).json() == []


def test_cannot_swipe_twice_or_on_self(client: TestClient, make_user) -> None:
    me = make_user()
    other = make_user(gender="man", interested_in=["woman"])
    body = {"target_id": other.id, "action": "like"}
    assert client.post("/api/swipes", json=body, headers=me.headers).status_code == 200
    assert client.post("/api/swipes", json=body, headers=me.headers).status_code == 409
    own = {"target_id": me.id, "action": "like"}
    assert client.post("/api/swipes", json=own, headers=me.headers).status_code == 422


def test_undo_brings_a_profile_back(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    client.post("/api/swipes", json={"target_id": her.id, "action": "pass"}, headers=me.headers)
    assert _ids(client, me) == []

    undone = client.post("/api/swipes/undo", headers=me.headers)
    assert undone.json()["id"] == her.id
    assert _ids(client, me) == [her.id]
    assert client.post("/api/swipes/undo", headers=me.headers).status_code == 404


def test_undo_refuses_to_break_a_match(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    client.post("/api/swipes", json={"target_id": me.id, "action": "like"}, headers=her.headers)
    client.post("/api/swipes", json={"target_id": her.id, "action": "like"}, headers=me.headers)
    assert client.post("/api/swipes/undo", headers=me.headers).status_code == 409


def test_age_helpers() -> None:
    assert age_on(date(1990, 6, 15), date(2026, 6, 14)) == 35
    assert age_on(date(1990, 6, 15), date(2026, 6, 15)) == 36
    earliest, latest = birthdate_bounds(25, 30, date(2026, 6, 15))
    assert age_on(latest, date(2026, 6, 15)) == 25
    assert age_on(earliest, date(2026, 6, 15)) == 30
    assert age_on(earliest - timedelta(days=1), date(2026, 6, 15)) == 31


def test_compatibility_rewards_overlap_and_activity() -> None:
    now = datetime(2026, 6, 15, tzinfo=UTC)

    def person(interests: list[str], active_days_ago: float = 0) -> SimpleNamespace:
        return SimpleNamespace(
            interests=interests,
            birthdate=date(1996, 1, 1),
            last_active_at=now - timedelta(days=active_days_ago),
        )

    me = person(["Coffee", "Hiking", "Books", "Film"])
    perfect = compatibility(me, person(["Coffee", "Hiking"]), now)
    assert perfect.score == 100
    assert perfect.shared_interests == ["Coffee", "Hiking"]
    assert compatibility(me, person(["Surfing"]), now).score == 45
    assert compatibility(me, person(["Coffee", "Hiking"], active_days_ago=30), now).score == 80
