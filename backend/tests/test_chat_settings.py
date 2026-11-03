from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import ChatSetting
from tests.conftest import like_each_other


def _settings(client: TestClient, account, match_id: int, **changes):
    return client.patch(f"/api/matches/{match_id}/settings", json=changes, headers=account.headers)


def _say(client: TestClient, account, match_id: int, body: str = "hey") -> None:
    client.post(f"/api/matches/{match_id}/messages", json={"body": body}, headers=account.headers)


def _setup(client: TestClient, make_user, partners: int = 1):
    me = make_user(gender="man", interested_in=["woman"])
    others = [make_user(name=f"Partner {i}") for i in range(partners)]
    ids = [like_each_other(client, me, other) for other in others]
    return me, others, ids


def test_pinned_chats_come_first_in_pin_order(client: TestClient, make_user) -> None:
    me, others, ids = _setup(client, make_user, partners=3)
    for other, match_id in zip(others, ids, strict=True):
        _say(client, other, match_id)  # the last one is now the most recent

    assert _settings(client, me, ids[0], pinned=True).json()["pinned"] is True
    _settings(client, me, ids[1], pinned=True)
    listed = client.get("/api/matches", headers=me.headers).json()
    assert [m["id"] for m in listed] == [ids[0], ids[1], ids[2]]
    assert [m["pinned"] for m in listed] == [True, True, False]

    _settings(client, me, ids[0], pinned=False)
    listed = client.get("/api/matches", headers=me.headers).json()
    assert [m["id"] for m in listed] == [ids[1], ids[2], ids[0]]


def test_at_most_three_pins(client: TestClient, make_user) -> None:
    me, _, ids = _setup(client, make_user, partners=4)
    for match_id in ids[:3]:
        assert _settings(client, me, match_id, pinned=True).status_code == 200
    refused = _settings(client, me, ids[3], pinned=True)
    assert refused.status_code == 409
    assert "up to 3" in refused.json()["detail"]
    # Re-pinning an already pinned chat isn't a fourth pin.
    assert _settings(client, me, ids[0], pinned=True).status_code == 200


def test_settings_are_private_and_live(client: TestClient, make_user) -> None:
    me, (her,), (match_id,) = _setup(client, make_user)
    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()  # hello
        _settings(client, me, match_id, archived=True)
        event = ws.receive_json()
        assert event == {
            "type": "match.settings",
            "match_id": match_id,
            "pinned": False,
            "archived": True,
            "muted": False,
            "muted_until": None,
        }
    theirs = client.get(f"/api/matches/{match_id}", headers=her.headers).json()
    assert theirs["archived"] is False
    assert client.get(f"/api/matches/{match_id}", headers=me.headers).json()["archived"] is True


def test_a_new_message_brings_an_archived_chat_back(client: TestClient, make_user) -> None:
    me, (her,), (match_id,) = _setup(client, make_user)
    _settings(client, me, match_id, archived=True)
    _say(client, her, match_id, "you there?")
    assert client.get(f"/api/matches/{match_id}", headers=me.headers).json()["archived"] is False


def test_muted_chats_stay_archived_and_quiet(client: TestClient, make_user) -> None:
    me, (her,), (match_id,) = _setup(client, make_user)
    muted = _settings(client, me, match_id, archived=True, mute="always").json()
    assert muted["muted"] is True and muted["muted_until"].startswith("9999")

    _say(client, her, match_id, "hello??")
    state = client.get(f"/api/matches/{match_id}", headers=me.headers).json()
    assert state["archived"] is True
    feed = client.get("/api/notifications", headers=me.headers).json()
    assert not [n for n in feed["items"] if n["kind"] == "message"]

    _settings(client, me, match_id, mute="off")
    _say(client, her, match_id, "ok now?")
    feed = client.get("/api/notifications", headers=me.headers).json()
    assert [n for n in feed["items"] if n["kind"] == "message"]


def test_timed_mutes_expire(client: TestClient, make_user) -> None:
    me, _, (match_id,) = _setup(client, make_user)
    hour = _settings(client, me, match_id, mute="1h").json()
    assert hour["muted"] is True

    async def expire() -> None:
        hub = client.app.state.hub
        async with hub.db.session() as session:
            setting = await session.get(ChatSetting, 1)
            setting.muted_until = utcnow() - timedelta(minutes=1)
            await session.commit()

    client.portal.call(expire)
    state = client.get(f"/api/matches/{match_id}", headers=me.headers).json()
    assert state["muted"] is False and state["muted_until"] is None


def test_archiving_unpins(client: TestClient, make_user) -> None:
    me, _, (match_id,) = _setup(client, make_user)
    _settings(client, me, match_id, pinned=True)
    state = _settings(client, me, match_id, archived=True).json()
    assert state == {
        "match_id": match_id,
        "pinned": False,
        "archived": True,
        "muted": False,
        "muted_until": None,
    }
    assert _settings(client, me, match_id, mute="forever").status_code == 422
    stranger = make_user()
    assert _settings(client, stranger, match_id, pinned=True).status_code == 404
