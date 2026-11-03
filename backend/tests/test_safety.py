from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def _ids(response) -> list[int]:
    return [item["id"] for item in response.json()]


def test_blocking_hides_people_in_both_directions(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    other = make_user()
    assert set(_ids(client.get("/api/discover", headers=me.headers))) == {her.id, other.id}

    response = client.post("/api/blocks", json={"user_id": her.id}, headers=me.headers)
    assert response.status_code == 204
    assert _ids(client.get("/api/discover", headers=me.headers)) == [other.id]
    assert client.get(f"/api/users/{her.id}", headers=me.headers).status_code == 404
    # The blocked person can't find or like the blocker either.
    assert client.get(f"/api/users/{me.id}", headers=her.headers).status_code == 404
    swipe = client.post(
        "/api/swipes", json={"target_id": me.id, "action": "like"}, headers=her.headers
    )
    assert swipe.status_code == 404


def test_blocking_ends_the_match_live(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        client.post("/api/blocks", json={"user_id": her.id}, headers=me.headers)
        assert ws.receive_json() == {"type": "match.removed", "match_id": match_id}
    assert client.get("/api/matches", headers=me.headers).json() == []
    assert client.get("/api/matches", headers=her.headers).json() == []


def test_blocked_likers_leave_the_likes_page(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    client.post("/api/swipes", json={"target_id": me.id, "action": "like"}, headers=her.headers)
    assert len(client.get("/api/likes", headers=me.headers).json()) == 1
    client.post("/api/blocks", json={"user_id": her.id}, headers=me.headers)
    assert client.get("/api/likes", headers=me.headers).json() == []


def test_block_list_and_unblock(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user(name="Robin")
    client.post("/api/blocks", json={"user_id": her.id}, headers=me.headers)
    client.post("/api/blocks", json={"user_id": her.id}, headers=me.headers)  # idempotent
    blocked = client.get("/api/blocks", headers=me.headers).json()
    assert [p["name"] for p in blocked] == ["Robin"]

    assert client.delete(f"/api/blocks/{her.id}", headers=me.headers).status_code == 204
    assert client.get("/api/blocks", headers=me.headers).json() == []
    assert _ids(client.get("/api/discover", headers=me.headers)) == [her.id]
    assert client.delete(f"/api/blocks/{her.id}", headers=me.headers).status_code == 404


def test_reports_block_by_default(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    other = make_user()
    response = client.post(
        "/api/reports",
        json={"user_id": her.id, "reason": "harassment", "details": "  rude messages  "},
        headers=me.headers,
    )
    assert response.status_code == 201
    assert _ids(client.get("/api/discover", headers=me.headers)) == [other.id]

    keep = client.post(
        "/api/reports",
        json={"user_id": other.id, "reason": "spam", "block": False},
        headers=me.headers,
    )
    assert keep.status_code == 201
    assert _ids(client.get("/api/discover", headers=me.headers)) == [other.id]


def test_report_validation(client: TestClient, make_user) -> None:
    me = make_user()
    bad_reason = client.post(
        "/api/reports", json={"user_id": me.id + 1, "reason": "vibes"}, headers=me.headers
    )
    assert bad_reason.status_code == 422
    yourself = client.post(
        "/api/reports", json={"user_id": me.id, "reason": "spam"}, headers=me.headers
    )
    assert yourself.status_code == 422
    nobody = client.post("/api/blocks", json={"user_id": 9999}, headers=me.headers)
    assert nobody.status_code == 404
