from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def _chat(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    return me, her, match_id


def _send(client: TestClient, account, match_id: int, body: str, **extra):
    return client.post(
        f"/api/matches/{match_id}/messages", json={"body": body, **extra}, headers=account.headers
    )


def test_a_reply_carries_a_quote_of_the_original(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    question = _send(client, her, match_id, "Mountains or the sea?").json()

    reply = _send(client, me, match_id, "Mountains, always", reply_to_id=question["id"])
    assert reply.status_code == 201
    quote = reply.json()["reply_to"]
    assert quote == {
        "id": question["id"],
        "sender_id": her.id,
        "body": "Mountains or the sea?",
        "image_url": None,
        "deleted_at": None,
    }

    history = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert history[0]["reply_to"] is None
    assert history[1]["reply_to"]["id"] == question["id"]


def test_long_quotes_are_trimmed(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    story = _send(client, her, match_id, "word " * 100).json()
    reply = _send(client, me, match_id, "tl;dr?", reply_to_id=story["id"]).json()
    assert len(reply["reply_to"]["body"]) <= 160
    assert reply["reply_to"]["body"].endswith("…")


def test_replies_must_point_into_the_same_chat(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    someone = make_user()
    other_match = like_each_other(client, me, someone)
    elsewhere = _send(client, someone, other_match, "hello from another chat").json()

    response = _send(client, me, match_id, "hi", reply_to_id=elsewhere["id"])
    assert response.status_code == 422
    assert _send(client, me, match_id, "hi", reply_to_id=999_999).status_code == 422


def test_replying_to_an_unsent_message_is_refused(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    oops = _send(client, her, match_id, "wrong chat").json()
    client.delete(f"/api/matches/{match_id}/messages/{oops['id']}", headers=her.headers)
    assert _send(client, me, match_id, "what?", reply_to_id=oops["id"]).status_code == 422


def test_unsending_the_original_shows_in_the_quote(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    original = _send(client, her, match_id, "secret plan").json()
    _send(client, me, match_id, "love it", reply_to_id=original["id"])
    client.delete(f"/api/matches/{match_id}/messages/{original['id']}", headers=her.headers)

    history = client.get(f"/api/matches/{match_id}/messages", headers=me.headers).json()
    quote = history[1]["reply_to"]
    assert quote["body"] == "" and quote["deleted_at"] is not None


def test_replies_over_the_websocket(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    question = _send(client, her, match_id, "Coffee or tea?").json()

    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()  # hello
        ws.send_json(
            {
                "type": "message.send",
                "match_id": match_id,
                "body": "Coffee",
                "client_id": "c1",
                "reply_to_id": question["id"],
            }
        )
        event = ws.receive_json()
        assert event["type"] == "message.new"
        assert event["message"]["reply_to"]["body"] == "Coffee or tea?"

        ws.send_json(
            {
                "type": "message.send",
                "match_id": match_id,
                "body": "?",
                "client_id": "c2",
                "reply_to_id": 424242,
            }
        )
        error = ws.receive_json()
        assert error["type"] == "error" and error["client_id"] == "c2"


def test_photo_replies(client: TestClient, make_user, tmp_path) -> None:
    from io import BytesIO

    from PIL import Image

    me, her, match_id = _chat(client, make_user)
    question = _send(client, her, match_id, "Show me your dog").json()
    buffer = BytesIO()
    Image.new("RGB", (40, 40), "tan").save(buffer, "JPEG")
    response = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("dog.jpg", buffer.getvalue(), "image/jpeg")},
        data={"caption": "Biscuit", "reply_to_id": str(question["id"])},
        headers=me.headers,
    )
    assert response.status_code == 201
    assert response.json()["reply_to"]["id"] == question["id"]

    gone = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("dog.jpg", buffer.getvalue(), "image/jpeg")},
        data={"reply_to_id": "999999"},
        headers=me.headers,
    )
    assert gone.status_code == 422
