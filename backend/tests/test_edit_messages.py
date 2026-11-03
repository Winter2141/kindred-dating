from datetime import timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.db import utcnow
from app.models import Message
from tests.conftest import like_each_other


def _chat(client: TestClient, make_user, body: str = "See you at 7"):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    sent = client.post(
        f"/api/matches/{match_id}/messages", json={"body": body}, headers=me.headers
    ).json()
    return me, her, match_id, sent["id"]


def _edit(client: TestClient, account, match_id: int, message_id: int, body: str):
    return client.patch(
        f"/api/matches/{match_id}/messages/{message_id}",
        json={"body": body},
        headers=account.headers,
    )


def test_editing_updates_the_text_for_both(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _chat(client, make_user)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        response = _edit(client, me, match_id, message_id, "  See you at 8  ")
        assert response.status_code == 200
        edited = response.json()
        assert edited["body"] == "See you at 8"
        assert edited["edited_at"] is not None
        event = ws.receive_json()
        assert event["type"] == "message.edited"
        assert event["message"]["body"] == "See you at 8"

    history = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert history[0]["body"] == "See you at 8" and history[0]["edited_at"] is not None


def test_saving_the_same_text_is_not_an_edit(client: TestClient, make_user) -> None:
    me, _, match_id, message_id = _chat(client, make_user)
    response = _edit(client, me, match_id, message_id, "See you at 7")
    assert response.status_code == 200
    assert response.json()["edited_at"] is None


def test_only_the_sender_edits_and_never_to_empty(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _chat(client, make_user)
    assert _edit(client, her, match_id, message_id, "hacked").status_code == 403
    blank = _edit(client, me, match_id, message_id, "   ")
    assert blank.status_code == 403
    assert "Unsend it instead" in blank.json()["detail"]
    assert _edit(client, me, match_id, 999_999, "hi").status_code == 404


def test_the_edit_window_closes(client: TestClient, make_user) -> None:
    me, _, match_id, message_id = _chat(client, make_user)
    hub = client.app.state.hub

    async def backdate() -> None:
        async with hub.db.session() as session:
            message = await session.get(Message, message_id)
            message.created_at = utcnow() - timedelta(minutes=20)
            await session.commit()

    client.portal.call(backdate)
    response = _edit(client, me, match_id, message_id, "too late")
    assert response.status_code == 403
    assert "15 minutes" in response.json()["detail"]


def test_unsent_messages_cannot_be_edited(client: TestClient, make_user) -> None:
    me, _, match_id, message_id = _chat(client, make_user)
    client.delete(f"/api/matches/{match_id}/messages/{message_id}", headers=me.headers)
    assert _edit(client, me, match_id, message_id, "back again").status_code == 404


def test_photo_captions_can_be_cleared_but_stay_short(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    match_id = like_each_other(client, me, her)
    buffer = BytesIO()
    Image.new("RGB", (30, 30), "teal").save(buffer, "JPEG")
    photo = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("lake.jpg", buffer.getvalue(), "image/jpeg")},
        data={"caption": "Lake Bled"},
        headers=me.headers,
    ).json()

    cleared = _edit(client, me, match_id, photo["id"], "")
    assert cleared.status_code == 200 and cleared.json()["body"] == ""
    assert _edit(client, me, match_id, photo["id"], "x" * 501).status_code == 403


def test_quotes_show_the_edited_text(client: TestClient, make_user) -> None:
    me, her, match_id, message_id = _chat(client, make_user)
    client.post(
        f"/api/matches/{match_id}/messages",
        json={"body": "Perfect", "reply_to_id": message_id},
        headers=her.headers,
    )
    _edit(client, me, match_id, message_id, "See you at 8")
    history = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert history[1]["reply_to"]["body"] == "See you at 8"
