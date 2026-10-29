import random
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app
from app.models import User
from app.services.personas import compose_reply, icebreakers, likes_back
from tests.conftest import Account, birthdate_for, like_each_other


def _pair(client: TestClient, make_user) -> tuple[Account, Account, int]:
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Robin")
    return me, her, like_each_other(client, me, her)


def _receive_until(ws, event_type: str, limit: int = 10) -> dict:
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == event_type:
            return event
    raise AssertionError(f"no {event_type} event")


def test_rest_messages_and_unread_counts(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    for text in ("hi", "how's your week?"):
        sent = client.post(
            f"/api/matches/{match_id}/messages", json={"body": text}, headers=me.headers
        )
        assert sent.status_code == 201

    summary = client.get("/api/matches", headers=her.headers).json()[0]
    assert summary["unread_count"] == 2
    assert summary["last_message"]["body"] == "how's your week?"

    page = client.get(f"/api/matches/{match_id}/messages", headers=her.headers).json()
    assert [m["body"] for m in page] == ["hi", "how's your week?"]
    older = client.get(
        f"/api/matches/{match_id}/messages", params={"before": page[1]["id"]}, headers=her.headers
    ).json()
    assert [m["body"] for m in older] == ["hi"]

    assert client.post(f"/api/matches/{match_id}/read", headers=her.headers).json() == {"marked": 2}
    assert client.get("/api/matches", headers=her.headers).json()[0]["unread_count"] == 0


def test_strangers_cannot_read_a_conversation(client: TestClient, make_user) -> None:
    _, _, match_id = _pair(client, make_user)
    stranger = make_user()
    response = client.get(f"/api/matches/{match_id}/messages", headers=stranger.headers)
    assert response.status_code == 404
    response = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "hey"}, headers=stranger.headers
    )
    assert response.status_code == 404


def test_blank_messages_are_rejected(client: TestClient, make_user) -> None:
    me, _, match_id = _pair(client, make_user)
    response = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "   "}, headers=me.headers
    )
    assert response.status_code == 422


def test_unmatch_removes_the_conversation(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    assert client.delete(f"/api/matches/{match_id}", headers=her.headers).status_code == 204
    assert client.get("/api/matches", headers=me.headers).json() == []
    assert client.get(f"/api/matches/{match_id}", headers=me.headers).status_code == 404


def test_websocket_rejects_bad_tokens(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect("/ws?token=nope"):
        pass
    assert exc.value.code == 4401


def test_live_chat_between_two_people(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)

    with client.websocket_connect(f"/ws?token={me.token}") as mine:
        assert mine.receive_json() == {"type": "hello", "user_id": me.id, "online": []}

        with client.websocket_connect(f"/ws?token={her.token}") as hers:
            online = _receive_until(mine, "presence")
            assert (online["user_id"], online["online"]) == (her.id, True)
            assert hers.receive_json()["online"] == [me.id]

            hers.send_json({"type": "typing", "match_id": match_id, "is_typing": True})
            typing = _receive_until(mine, "typing")
            assert typing == {
                "type": "typing",
                "match_id": match_id,
                "user_id": her.id,
                "is_typing": True,
            }

            hers.send_json(
                {"type": "message.send", "match_id": match_id, "body": "hey you", "client_id": "c1"}
            )
            echoed = _receive_until(hers, "message.new")
            delivered = _receive_until(mine, "message.new")
            assert echoed["client_id"] == "c1"
            assert delivered["message"]["body"] == "hey you"
            assert delivered["message"]["sender_id"] == her.id
            assert delivered["message"]["read_at"] is None

            mine.send_json({"type": "read", "match_id": match_id})
            receipt = _receive_until(hers, "read")
            assert receipt["reader_id"] == me.id

            hers.send_json({"type": "ping"})
            assert _receive_until(hers, "pong") == {"type": "pong"}

        offline = _receive_until(mine, "presence")
        assert (offline["user_id"], offline["online"]) == (her.id, False)
        assert offline["last_active_at"] is not None
        assert client.app.state.hub.manager.is_online(me.id)


def test_websocket_reports_bad_events_without_disconnecting(client: TestClient, make_user) -> None:
    me, _, match_id = _pair(client, make_user)
    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()  # hello
        ws.send_text("not json")
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "message.send", "match_id": 999, "body": "hi"})
        assert ws.receive_json() == {"type": "error", "detail": "Match not found", "match_id": 999}
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_match_event_is_pushed_live(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user(name="Robin")
    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()  # hello
        client.post("/api/swipes", json={"target_id": me.id, "action": "like"}, headers=her.headers)
        client.post("/api/swipes", json={"target_id": her.id, "action": "like"}, headers=me.headers)
        event = _receive_until(ws, "match.new")
        assert event["match"]["user"]["name"] == "Robin"


def test_personas_reply_in_demo_mode(settings: Settings, make_user) -> None:
    demo = settings.model_copy(update={"demo_mode": True})
    with TestClient(create_app(demo)) as client:
        human = _register(client, "human@example.com", "man", ["woman"])
        persona = _register(client, "persona@example.com", "woman", ["man"])
        _make_persona(client, persona)

        # Personas like back deterministically; find the pair outcome and assert consistency.
        response = client.post(
            "/api/swipes",
            json={"target_id": persona["id"], "action": "like"},
            headers=human["headers"],
        )
        assert response.json()["matched"] is likes_back(persona["id"], human["id"])
        if not response.json()["matched"]:
            client.post(
                "/api/swipes",
                json={"target_id": human["id"], "action": "like"},
                headers=persona["headers"],
            )
            response = client.get("/api/matches", headers=human["headers"])
            match_id = response.json()[0]["id"]
        else:
            match_id = response.json()["match"]["id"]

        with client.websocket_connect(f"/ws?token={human['token']}") as ws:
            ws.receive_json()  # hello
            ws.send_json({"type": "message.send", "match_id": match_id, "body": "hey there!"})
            assert _receive_until(ws, "message.new")["message"]["sender_id"] == human["id"]
            assert _receive_until(ws, "read")["reader_id"] == persona["id"]
            assert _receive_until(ws, "typing")["is_typing"] is True
            reply = _receive_until(ws, "message.new")["message"]
            assert reply["sender_id"] == persona["id"]
            assert reply["body"].startswith("Hey ")


def _register(client: TestClient, email: str, gender: str, interested_in: list[str]) -> dict:
    body = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "long-enough",
            "name": email.split("@")[0].title(),
            "birthdate": birthdate_for(29),
            "gender": gender,
            "interested_in": interested_in,
            "interests": ["Coffee", "Hiking"],
        },
    ).json()
    token = body["access_token"]
    return {
        "id": body["user"]["id"],
        "token": token,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def _make_persona(client: TestClient, account: dict) -> None:
    hub = client.app.state.hub

    async def flag() -> None:
        async with hub.db.session() as session:
            user = await session.get(User, account["id"])
            user.is_persona = True
            await session.commit()

    client.portal.call(flag)


PERSONA = SimpleNamespace(
    name="Maya",
    city="Brooklyn, NY",
    job_title="Pastry chef",
    interests=["Coffee", "Baking", "Vinyl"],
    prompts=[{"question": "My ideal Sunday", "answer": "Markets and a long nap."}],
)
HUMAN = SimpleNamespace(
    name="Alex", city="", job_title="", interests=["Coffee", "Hiking"], prompts=[]
)


def _history(*lines: tuple[int, str]) -> list[SimpleNamespace]:
    return [SimpleNamespace(sender_id=sender, body=body) for sender, body in lines]


def test_persona_greets_with_a_shared_interest() -> None:
    reply = compose_reply(PERSONA, HUMAN, _history((2, "hey!")), 1, random.Random(1))
    assert reply.startswith("Hey Alex!")
    assert "coffee too" in reply


def test_persona_answers_questions_from_its_profile() -> None:
    history = _history((2, "hi"), (1, "Hey!"), (2, "what do you do for work?"))
    reply = compose_reply(PERSONA, HUMAN, history, 1, random.Random(1))
    assert "pastry chef" in reply and reply.endswith("What about you?")

    history = _history((2, "hi"), (1, "Hey!"), (2, "any plans this weekend?"))
    assert "Markets and a long nap." in compose_reply(PERSONA, HUMAN, history, 1)


def test_persona_suggests_a_date_eventually() -> None:
    history = _history(*[(1 if i % 2 else 2, "nice") for i in range(11)])
    assert "coffee" in compose_reply(PERSONA, HUMAN, history, 1, random.Random(3))


def test_icebreakers_use_shared_interests_and_prompts() -> None:
    ideas = icebreakers(HUMAN, PERSONA)
    assert len(ideas) == 3
    assert ideas[0].startswith("We both love coffee!")
    assert "Markets and a long nap." in ideas[1]
