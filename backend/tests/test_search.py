from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def _say(client: TestClient, account, match_id: int, body: str) -> dict:
    return client.post(
        f"/api/matches/{match_id}/messages", json={"body": body}, headers=account.headers
    ).json()


def _search(client: TestClient, account, q: str, **params):
    return client.get("/api/search", params={"q": q, **params}, headers=account.headers)


def test_finds_messages_in_my_chats_newest_first(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    maya = make_user(name="Maya")
    priya = make_user(name="Priya")
    with_maya = like_each_other(client, me, maya)
    with_priya = like_each_other(client, me, priya)
    _say(client, maya, with_maya, "Have you tried the Ramen place on Elm?")
    _say(client, me, with_maya, "Not yet!")
    _say(client, priya, with_priya, "RAMEN tonight?")

    result = _search(client, me, "ramen").json()
    assert result["query"] == "ramen"
    bodies = [hit["message"]["body"] for hit in result["messages"]]
    assert bodies == ["RAMEN tonight?", "Have you tried the Ramen place on Elm?"]
    assert result["messages"][0]["with_user"]["name"] == "Priya"
    assert result["messages"][0]["match_id"] == with_priya


def test_finds_people_by_name(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    like_each_other(client, me, make_user(name="Maya"))
    like_each_other(client, me, make_user(name="Mayra"))
    like_each_other(client, me, make_user(name="Chloe"))
    people = _search(client, me, "may").json()["people"]
    assert sorted(p["user"]["name"] for p in people) == ["Maya", "Mayra"]


def test_never_searches_other_peoples_chats(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    stranger = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, stranger, her)
    _say(client, her, match_id, "secret picnic plans")
    assert _search(client, me, "picnic").json() == {
        "query": "picnic",
        "people": [],
        "messages": [],
    }


def test_unsent_messages_and_wildcards_are_not_matched(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    oops = _say(client, me, match_id, "wrong chat, sorry")
    client.delete(f"/api/matches/{match_id}/messages/{oops['id']}", headers=me.headers)
    _say(client, her, match_id, "100% agree")
    _say(client, her, match_id, "1000 times yes")

    assert _search(client, me, "wrong chat").json()["messages"] == []
    hits = _search(client, me, "0%").json()["messages"]
    assert [h["message"]["body"] for h in hits] == ["100% agree"]


def test_query_rules(client: TestClient, make_user) -> None:
    me = make_user()
    assert _search(client, me, "a").status_code == 422
    assert _search(client, me, "x" * 81).status_code == 422
    assert client.get("/api/search", params={"q": "hello"}).status_code == 401
