from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import Message
from tests.conftest import like_each_other


def _conversation(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    sent = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "oops, wrong chat"}, headers=me.headers
    ).json()
    return me, her, match_id, sent["id"]


def _age_message(client: TestClient, message_id: int, minutes: int) -> None:
    hub = client.app.state.hub

    async def backdate() -> None:
        async with hub.db.session() as session:
            message = await session.get(Message, message_id)
            message.created_at = utcnow() - timedelta(minutes=minutes)
            await session.commit()

    client.portal.call(backdate)


def test_unsending_wipes_the_text_for_both(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _conversation(client, make_user)
    client.put(
        f"/api/matches/{match_id}/messages/{message_id}/reaction",
        json={"emoji": "😂"},
        headers=her.headers,
    )
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        response = client.delete(
            f"/api/matches/{match_id}/messages/{message_id}", headers=me.headers
        )
        assert response.status_code == 200
        unsent = response.json()
        assert unsent["body"] == "" and unsent["deleted_at"] is not None
        assert unsent["reactions"] == []
        event = ws.receive_json()
        assert event["type"] == "message.deleted"
        assert (event["match_id"], event["message_id"]) == (match_id, message_id)

    history = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert history[0]["body"] == "" and history[0]["deleted_at"] is not None
    preview = client.get("/api/matches", headers=her.headers).json()[0]["last_message"]
    assert preview["deleted_at"] is not None


def test_only_the_sender_can_unsend_and_only_once(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _conversation(client, make_user)
    theirs = client.delete(f"/api/matches/{match_id}/messages/{message_id}", headers=her.headers)
    assert theirs.status_code == 403
    assert (
        client.delete(
            f"/api/matches/{match_id}/messages/{message_id}", headers=me.headers
        ).status_code
        == 200
    )
    again = client.delete(f"/api/matches/{match_id}/messages/{message_id}", headers=me.headers)
    assert again.status_code == 404
    react = client.put(
        f"/api/matches/{match_id}/messages/{message_id}/reaction",
        json={"emoji": "❤️"},
        headers=her.headers,
    )
    assert react.status_code == 404


def test_unsend_window_closes(client: TestClient, make_user) -> None:
    me, _, match_id, message_id = _conversation(client, make_user)
    _age_message(client, message_id, minutes=16)
    response = client.delete(f"/api/matches/{match_id}/messages/{message_id}", headers=me.headers)
    assert response.status_code == 403
    assert "15 minutes" in response.json()["detail"]
