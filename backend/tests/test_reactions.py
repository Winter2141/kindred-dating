from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def _setup(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    message = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "dinner at 8?"}, headers=me.headers
    ).json()
    return me, her, match_id, message["id"]


def _react(client: TestClient, account, match_id: int, message_id: int, emoji):
    return client.put(
        f"/api/matches/{match_id}/messages/{message_id}/reaction",
        json={"emoji": emoji},
        headers=account.headers,
    )


def test_react_change_and_toggle_off(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _setup(client, make_user)

    first = _react(client, her, match_id, message_id, "❤️")
    assert first.status_code == 200
    assert first.json()["reactions"] == [{"user_id": her.id, "emoji": "❤️"}]

    changed = _react(client, her, match_id, message_id, "🔥").json()
    assert changed["reactions"] == [{"user_id": her.id, "emoji": "🔥"}]
    both = _react(client, me, match_id, message_id, "😂").json()
    assert {r["user_id"] for r in both["reactions"]} == {me.id, her.id}

    same_again = _react(client, her, match_id, message_id, "🔥").json()
    assert same_again["reactions"] == [{"user_id": me.id, "emoji": "😂"}]
    cleared = _react(client, me, match_id, message_id, None).json()
    assert cleared["reactions"] == []


def test_reactions_show_up_in_history(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _setup(client, make_user)
    _react(client, her, match_id, message_id, "👍")
    history = client.get(f"/api/matches/{match_id}/messages", headers=me.headers).json()
    assert history[0]["reactions"] == [{"user_id": her.id, "emoji": "👍"}]
    summary = client.get("/api/matches", headers=me.headers).json()[0]
    assert summary["last_message"]["reactions"][0]["emoji"] == "👍"


def test_reactions_are_live_over_the_socket(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _setup(client, make_user)
    with (
        client.websocket_connect(f"/ws?token={me.token}") as mine,
        client.websocket_connect(f"/ws?token={her.token}") as hers,
    ):
        mine.receive_json()  # hello
        hers.receive_json()  # hello
        hers.send_json(
            {"type": "react", "match_id": match_id, "message_id": message_id, "emoji": "😮"}
        )
        event = mine.receive_json()
        while event["type"] != "reaction":
            event = mine.receive_json()
        assert event == {
            "type": "reaction",
            "match_id": match_id,
            "message_id": message_id,
            "user_id": her.id,
            "emoji": "😮",
        }

        hers.send_json({"type": "react", "match_id": match_id, "message_id": 999, "emoji": "😮"})
        error = hers.receive_json()
        while error["type"] != "error":
            error = hers.receive_json()
        assert error["detail"] == "Message not found"


def test_reaction_validation(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _setup(client, make_user)
    assert _react(client, her, match_id, message_id, "🦄").status_code == 422
    assert _react(client, her, match_id, 999, "❤️").status_code == 404
    stranger = make_user()
    assert _react(client, stranger, match_id, message_id, "❤️").status_code == 404
    assert client.get("/api/meta").json()["reactions"][0] == "❤️"
