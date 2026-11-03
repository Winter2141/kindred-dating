from fastapi.testclient import TestClient

PROMPT = {"question": "My ideal Sunday", "answer": "Farmers market, then a nap"}


def _people(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Priya", prompts=[PROMPT])
    return me, her


def _like(client: TestClient, who, target, **extra):
    return client.post(
        "/api/swipes", json={"target_id": target.id, "action": "like", **extra}, headers=who.headers
    )


def test_a_comment_on_a_prompt_shows_on_likes(client: TestClient, make_user) -> None:
    me, her = _people(client, make_user)
    sent = _like(
        client,
        me,
        her,
        liked_item="prompt:My ideal Sunday",
        comment="  A nap is non-negotiable  ",
    )
    assert sent.status_code == 200 and sent.json()["matched"] is False

    (like,) = client.get("/api/likes", headers=her.headers).json()
    assert like["comment"] == "A nap is non-negotiable"
    assert like["liked_item"] == {
        "kind": "prompt",
        "photo": None,
        "question": "My ideal Sunday",
        "answer": "Farmers market, then a nap",
    }
    feed = client.get("/api/notifications", headers=her.headers).json()
    assert feed["items"][0]["body"] == "A nap is non-negotiable"


def test_the_comment_opens_the_chat_when_it_becomes_a_match(client: TestClient, make_user) -> None:
    me, her = _people(client, make_user)
    _like(client, me, her, liked_item="prompt:My ideal Sunday", comment="Same!")
    matched = _like(client, her, me)
    assert matched.json()["matched"] is True
    match_id = matched.json()["match"]["id"]
    messages = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert [(m["sender_id"], m["body"]) for m in messages] == [(me.id, "Same!")]


def test_liked_items_must_exist(client: TestClient, make_user) -> None:
    me, her = _people(client, make_user)
    for item in ("prompt:Not on her profile", "photo:0", "photo:x", "video:1"):
        assert _like(client, me, her, liked_item=item).status_code == 422
    passing = client.post(
        "/api/swipes",
        json={"target_id": her.id, "action": "pass", "comment": "nope"},
        headers=me.headers,
    )
    assert passing.status_code == 422


def test_plain_likes_still_work(client: TestClient, make_user) -> None:
    me, her = _people(client, make_user)
    assert _like(client, me, her, comment="").status_code == 200
    (like,) = client.get("/api/likes", headers=her.headers).json()
    assert like["comment"] is None and like["liked_item"] is None
