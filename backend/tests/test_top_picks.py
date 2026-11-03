from datetime import UTC, date, datetime

from fastapi.testclient import TestClient

from app.schemas import Candidate
from app.services.discovery import next_refresh, pick_reason, top_picks


def _candidate(user_id: int, score: int, **overrides) -> Candidate:
    data = {
        "id": user_id,
        "name": f"P{user_id}",
        "age": 30,
        "gender": "woman",
        "bio": "",
        "job_title": "",
        "city": "",
        "interests": [],
        "photos": [],
        "prompts": [],
        "last_active_at": datetime(2026, 11, 1, tzinfo=UTC),
        "compatibility": score,
        "shared_interests": [],
    }
    return Candidate(**(data | overrides))


POOL = [_candidate(i, 50 + i) for i in range(1, 21)]


def test_picks_are_stable_within_a_day_and_rotate_across_days() -> None:
    monday = top_picks(1, date(2026, 11, 2), POOL)
    assert [p.id for p in monday] == [p.id for p in top_picks(1, date(2026, 11, 2), POOL)]
    assert len(monday) == 4
    week = {tuple(p.id for p in top_picks(1, date(2026, 11, d), POOL)) for d in range(2, 9)}
    assert len(week) > 1
    assert [p.id for p in monday] != [p.id for p in top_picks(2, date(2026, 11, 2), POOL)]


def test_picks_come_from_the_strongest_fits() -> None:
    picks = top_picks(1, date(2026, 11, 2), POOL)
    strongest = {c.id for c in sorted(POOL, key=lambda c: c.compatibility)[-12:]}
    assert {p.id for p in picks} <= strongest
    assert [p.compatibility for p in picks] == sorted(
        (p.compatibility for p in picks), reverse=True
    )


def test_weak_fits_and_super_likers_are_left_out() -> None:
    pool = [
        _candidate(1, 40),
        _candidate(2, 90, super_liked_you=True),
        _candidate(3, 75),
    ]
    assert [p.id for p in top_picks(1, date(2026, 11, 2), pool)] == [3]
    assert top_picks(1, date(2026, 11, 2), []) == []


def test_reasons_explain_the_pick() -> None:
    both = _candidate(1, 80, shared_interests=["Coffee", "Hiking"])
    assert pick_reason(both) == "You both love coffee and hiking"
    assert pick_reason(_candidate(1, 80, shared_interests=["Vinyl"])) == "You're both into vinyl"
    assert pick_reason(_candidate(1, 80, distance_km=3)) == "Lives just around the corner"
    assert pick_reason(_candidate(1, 80)) == "80% compatible"


def test_refresh_is_next_midnight_utc() -> None:
    assert next_refresh(datetime(2026, 11, 2, 15, 30, tzinfo=UTC)) == datetime(
        2026, 11, 3, tzinfo=UTC
    )


def test_top_picks_endpoint(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], interests=["Coffee", "Hiking"])
    for _ in range(6):
        make_user(interests=["Coffee", "Hiking", "Books"])
    response = client.get("/api/discover/top-picks", headers=me.headers).json()
    assert len(response["picks"]) == 4
    assert response["picks"][0]["reason"] == "You both love coffee and hiking"
    assert response["refreshes_at"].endswith(("+00:00", "Z"))
