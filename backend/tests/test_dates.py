from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import like_each_other
from tests.test_chat import _make_persona, _register


def _when(**delta) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def _pair(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"], interests=["Coffee", "Vinyl"])
    her = make_user(interests=["Vinyl", "Coffee", "Books"])
    return me, her, like_each_other(client, me, her)


def _propose(client: TestClient, account, match_id: int, **overrides):
    payload = {"place": "Blue Bottle, Williamsburg", "starts_at": _when(days=2), "note": "My treat"}
    return client.post(
        f"/api/matches/{match_id}/dates", json=payload | overrides, headers=account.headers
    )


def test_propose_and_accept_live(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        proposed = _propose(client, me, match_id)
        assert proposed.status_code == 201
        date = proposed.json()
        assert (date["status"], date["proposer_id"], date["note"]) == (
            "proposed",
            me.id,
            "My treat",
        )
        event = ws.receive_json()
        assert event["type"] == "date.updated" and event["date"]["id"] == date["id"]

    accepted = client.post(
        f"/api/matches/{match_id}/dates/{date['id']}/respond",
        json={"response": "accept"},
        headers=her.headers,
    ).json()
    assert accepted["status"] == "accepted" and accepted["responded_at"]

    for account, other_name in ((me, "User 2"), (her, "User 1")):
        upcoming = client.get("/api/dates/upcoming", headers=account.headers).json()
        assert [(d["place"], d["with_user"]["name"]) for d in upcoming] == [
            ("Blue Bottle, Williamsburg", other_name)
        ]
    history = client.get(f"/api/matches/{match_id}/dates", headers=me.headers).json()
    assert [d["status"] for d in history] == ["accepted"]


def test_only_one_open_proposal_and_only_the_other_person_answers(
    client: TestClient, make_user
) -> None:
    me, her, match_id = _pair(client, make_user)
    date = _propose(client, me, match_id).json()
    assert _propose(client, her, match_id).status_code == 409
    own = client.post(
        f"/api/matches/{match_id}/dates/{date['id']}/respond",
        json={"response": "accept"},
        headers=me.headers,
    )
    assert own.status_code == 403

    declined = client.post(
        f"/api/matches/{match_id}/dates/{date['id']}/respond",
        json={"response": "decline"},
        headers=her.headers,
    ).json()
    assert declined["status"] == "declined"
    again = client.post(
        f"/api/matches/{match_id}/dates/{date['id']}/respond",
        json={"response": "accept"},
        headers=her.headers,
    )
    assert again.status_code == 409
    assert _propose(client, her, match_id, place="Tacos").status_code == 201


def test_cancelling(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    date = _propose(client, me, match_id).json()
    url = f"/api/matches/{match_id}/dates/{date['id']}"
    assert client.post(f"{url}/cancel", headers=her.headers).status_code == 403
    assert client.post(f"{url}/cancel", headers=me.headers).json()["status"] == "cancelled"
    assert client.post(f"{url}/cancel", headers=me.headers).status_code == 409

    second = _propose(client, me, match_id).json()
    url = f"/api/matches/{match_id}/dates/{second['id']}"
    client.post(f"{url}/respond", json={"response": "accept"}, headers=her.headers)
    assert client.post(f"{url}/cancel", headers=her.headers).json()["status"] == "cancelled"
    assert client.get("/api/dates/upcoming", headers=me.headers).json() == []


def test_time_and_access_rules(client: TestClient, make_user) -> None:
    me, _, match_id = _pair(client, make_user)
    assert _propose(client, me, match_id, starts_at=_when(minutes=5)).status_code == 422
    assert _propose(client, me, match_id, starts_at=_when(days=90)).status_code == 422
    naive = (datetime.now() + timedelta(days=2)).replace(tzinfo=None).isoformat()
    assert _propose(client, me, match_id, starts_at=naive).status_code == 422
    assert _propose(client, me, match_id, place=" ").status_code == 422
    stranger = make_user()
    assert _propose(client, stranger, match_id).status_code == 404


def test_date_ideas_follow_shared_interests(client: TestClient, make_user) -> None:
    me, _, match_id = _pair(client, make_user)
    ideas = client.get(f"/api/matches/{match_id}/date-ideas", headers=me.headers).json()
    assert ideas == ["A record shop crawl", "Coffee at a cosy café", "Drinks somewhere with a view"]


def test_personas_accept_dates_in_demo_mode(settings: Settings) -> None:
    demo = settings.model_copy(update={"demo_mode": True})
    with TestClient(create_app(demo)) as client:
        human = _register(client, "human@example.com", "man", ["woman"])
        persona = _register(client, "persona@example.com", "woman", ["man"])
        _make_persona(client, persona)
        client.post(
            "/api/swipes",
            json={"target_id": human["id"], "action": "like"},
            headers=persona["headers"],
        )
        match = client.post(
            "/api/swipes",
            json={"target_id": persona["id"], "action": "like"},
            headers=human["headers"],
        ).json()["match"]

        with client.websocket_connect(f"/ws?token={human['token']}") as ws:
            ws.receive_json()  # hello
            client.post(
                f"/api/matches/{match['id']}/dates",
                json={"place": "The planetarium", "starts_at": _when(days=3)},
                headers=human["headers"],
            )
            statuses, reply = [], None
            while reply is None:
                event = ws.receive_json()
                if event["type"] == "date.updated":
                    statuses.append(event["date"]["status"])
                elif (
                    event["type"] == "message.new"
                    and event["message"]["sender_id"] == persona["id"]
                ):
                    reply = event["message"]["body"]
            assert statuses == ["proposed", "accepted"]
            assert reply.startswith("Yes! The planetarium on ")
