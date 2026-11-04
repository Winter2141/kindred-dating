import re
from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import Notification, NotificationKind, User
from app.services import digest
from tests.conftest import like_each_other


def _digests(client: TestClient, to: str) -> list[dict]:
    emails = client.get("/api/dev/outbox", params={"to": to}).json()
    return [email for email in emails if email["kind"] == "digest"]


def _confirm(client: TestClient, *accounts) -> None:
    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            for account in accounts:
                user = await session.get(User, account.id)
                user.email_verified_at = utcnow()
            await session.commit()

    client.portal.call(run)


def _run(client: TestClient, minutes_later: float = 20) -> int:
    """Run the job as if `minutes_later` had passed, long enough for things to wait."""
    later = utcnow() + timedelta(minutes=minutes_later)
    return client.portal.call(digest.send_due_digests, client.app.state.hub, later)


def _pair(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Priya")
    _confirm(client, me, her)
    return me, her


def test_a_match_and_a_message_arrive_in_one_email(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    match_id = like_each_other(client, me, her)
    client.post(f"/api/matches/{match_id}/messages", json={"body": "Hi Priya!"}, headers=me.headers)

    assert _run(client) == 2  # both of them have a match waiting
    (email,) = _digests(client, her.email)
    assert email["subject"] == "1 new match and more on Kindred"
    assert "You matched with Sam. Say hello!" in email["body"]
    assert 'Sam sent you 1 new message: "Hi Priya!"' in email["body"]
    assert "/app/settings#email" in email["body"]
    (mine,) = _digests(client, me.email)
    assert mine["subject"] == "It's a match with Priya"


def test_nothing_is_sent_twice_or_too_soon(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    like_each_other(client, me, her)

    assert _run(client, minutes_later=5) == 0  # they may still be about to look
    assert _run(client) == 2
    assert _run(client, minutes_later=30) == 0  # already told them
    assert _run(client, minutes_later=60 * 7) == 0  # nothing new since


def test_only_what_is_still_unread(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    like_each_other(client, me, her)
    client.post("/api/notifications/read", headers=her.headers)

    assert _run(client) == 1
    assert _digests(client, her.email) == []


def test_unconfirmed_addresses_and_online_people_get_nothing(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    _confirm(client, her)
    like_each_other(client, me, her)

    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        assert _run(client) == 0  # she's here, and he never confirmed his email
    assert _run(client) == 1


def test_preferences_choose_what_is_emailed(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    defaults = client.get("/api/me/email-preferences", headers=her.headers).json()
    assert defaults == {
        "matches": True,
        "messages": True,
        "likes": False,
        "dates": True,
        "email_verified": True,
    }

    client.post("/api/swipes", json={"target_id": her.id, "action": "like"}, headers=me.headers)
    assert _run(client) == 0  # likes are off by default

    response = client.put(
        "/api/me/email-preferences",
        json={"matches": False, "messages": True, "likes": True, "dates": True},
        headers=her.headers,
    )
    assert response.json()["likes"] is True
    assert _run(client) == 1
    (email,) = _digests(client, her.email)
    assert email["subject"] == "There's news waiting on Kindred"
    assert "1 person liked your profile" in email["body"]


def test_the_unsubscribe_link_turns_everything_off(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    like_each_other(client, me, her)
    _run(client)
    (email,) = _digests(client, her.email)
    token = re.search(r"/unsubscribe\?token=([\w.-]+)", email["body"]).group(1)

    assert client.post("/api/email/unsubscribe", json={"token": token}).status_code == 204
    prefs = client.get("/api/me/email-preferences", headers=her.headers).json()
    assert not any(prefs[name] for name in digest.DEFAULT_PREFS)

    bad = client.post("/api/email/unsubscribe", json={"token": her.token})
    assert bad.status_code == 400  # a session token is not an unsubscribe link


def _note(kind: NotificationKind, name: str = "", body: str = "", count: int = 1) -> Notification:
    actor = User(name=name) if name else None
    return Notification(kind=kind, actor=actor, body=body, count=count, created_at=utcnow())


def test_summaries_read_naturally() -> None:
    one_chat = digest.summarise([_note(NotificationKind.MESSAGE, "Maya", "See you at 8?", 3)])
    assert one_chat.subject == "Maya sent you a message"
    assert one_chat.lines == ['Maya sent you 3 new messages: "See you at 8?"']

    chats = digest.summarise(
        [_note(NotificationKind.MESSAGE, "Maya"), _note(NotificationKind.MESSAGE, "Leo")]
    )
    assert chats.subject == "2 people are waiting for your reply"

    likes = digest.summarise(
        [_note(NotificationKind.LIKE, "A"), _note(NotificationKind.SUPER_LIKE, "B")]
    )
    assert likes.lines == ["2 people liked your profile (1 with a super like)"]

    reminder = digest.summarise([_note(NotificationKind.DATE_REMINDER, body="Your date soon")])
    assert reminder.lines == ["Your date soon"]


def test_saved_preferences_fill_in_new_categories() -> None:
    assert digest.prefs_for(User(email_prefs=None)) == digest.DEFAULT_PREFS
    old = digest.prefs_for(User(email_prefs={"matches": False, "retired": True}))
    assert old == {**digest.DEFAULT_PREFS, "matches": False}
    assert digest.wanted_kinds({"likes": True}) == {"like", "super_like"}
