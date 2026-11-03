from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def _feed(client: TestClient, account) -> dict:
    return client.get("/api/notifications", headers=account.headers).json()


def test_likes_and_super_likes_notify_the_other_person(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her, other = make_user(), make_user()
    client.post("/api/swipes", json={"target_id": her.id, "action": "like"}, headers=me.headers)
    client.post("/api/swipes", json={"target_id": other.id, "action": "super"}, headers=me.headers)
    client.post("/api/swipes", json={"target_id": me.id, "action": "pass"}, headers=other.headers)

    feed = _feed(client, her)
    assert feed["unread"] == 1
    assert feed["items"][0]["kind"] == "like"
    assert feed["items"][0]["actor"]["name"] == "Sam"
    assert _feed(client, other)["items"][0]["kind"] == "super_like"
    assert _feed(client, me)["items"] == []  # passing on someone doesn't tell them


def test_a_match_notifies_both_people(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    for account in (me, her):
        kinds = [n["kind"] for n in _feed(client, account)["items"]]
        assert kinds[0] == "match"
        assert _feed(client, account)["items"][0]["match_id"] == match_id


def test_missed_messages_collapse_per_chat(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user()
    match_id = like_each_other(client, me, her)
    client.post("/api/notifications/read", headers=her.headers)

    for text in ("hey", "are you around tonight?"):
        client.post(f"/api/matches/{match_id}/messages", json={"body": text}, headers=me.headers)
    feed = _feed(client, her)
    assert feed["unread"] == 1
    missed = feed["items"][0]
    assert (missed["kind"], missed["count"], missed["body"]) == (
        "message",
        2,
        "are you around tonight?",
    )


def test_online_people_get_live_pushes_but_no_missed_message_entries(
    client: TestClient, make_user
) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    client.post("/api/notifications/read", headers=her.headers)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        client.post(f"/api/matches/{match_id}/messages", json={"body": "hi"}, headers=me.headers)
        assert ws.receive_json()["type"] == "message.new"
    assert _feed(client, her)["unread"] == 0

    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        other = make_user(gender="man", interested_in=["woman"])
        client.post(
            "/api/swipes", json={"target_id": her.id, "action": "super"}, headers=other.headers
        )
        event = ws.receive_json()
        assert event["type"] == "notification.new"
        assert event["notification"]["kind"] == "super_like"


def test_marking_notifications_read(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    like_each_other(client, me, her)
    first = _feed(client, me)["items"][0]
    marked = client.post(f"/api/notifications/{first['id']}/read", headers=me.headers).json()
    assert marked["read_at"] is not None
    assert _feed(client, me)["unread"] == 0
    assert (
        client.post(f"/api/notifications/{first['id']}/read", headers=her.headers).status_code
        == 404
    )

    client.post(
        "/api/swipes",
        json={"target_id": her.id, "action": "like"},
        headers=make_user(gender="man", interested_in=["woman"]).headers,
    )
    assert _feed(client, her)["unread"] == 3  # like, then match, then the new like
    assert client.post("/api/notifications/read", headers=her.headers).status_code == 204
    assert _feed(client, her)["unread"] == 0
