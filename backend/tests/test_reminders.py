import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app import scheduler
from app.db import utcnow
from app.models import DateProposal
from tests.conftest import like_each_other


def _accepted_date(client: TestClient, make_user, hours_from_now: float):
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Priya")
    match_id = like_each_other(client, me, her)
    starts = (utcnow() + timedelta(days=1)).isoformat()
    date = client.post(
        f"/api/matches/{match_id}/dates",
        json={"place": "Blue Bottle", "starts_at": starts},
        headers=me.headers,
    ).json()
    client.post(
        f"/api/matches/{match_id}/dates/{date['id']}/respond",
        json={"response": "accept"},
        headers=her.headers,
    )

    async def move() -> None:
        # Dates can't be proposed this close, so move it after accepting.
        async with client.app.state.hub.db.session() as session:
            proposal = await session.get(DateProposal, date["id"])
            proposal.starts_at = utcnow() + timedelta(hours=hours_from_now)
            await session.commit()

    client.portal.call(move)
    return me, her, match_id


def _run(client: TestClient) -> int:
    return client.portal.call(scheduler.send_due_reminders, client.app.state.hub)


def test_both_people_are_reminded_once(client: TestClient, make_user) -> None:
    me, her, match_id = _accepted_date(client, make_user, hours_from_now=1.5)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        assert _run(client) == 1
        event = ws.receive_json()
        assert event["type"] == "notification.new"
        assert event["notification"]["kind"] == "date_reminder"
        assert event["notification"]["body"] == (
            "Your date with Sam at Blue Bottle starts in about 2 hours"
        )
    mine = client.get("/api/notifications", headers=me.headers).json()["items"]
    assert mine[0]["kind"] == "date_reminder" and mine[0]["match_id"] == match_id
    assert "Priya" in mine[0]["body"]
    assert _run(client) == 0  # never twice


def test_dates_further_off_wait(client: TestClient, make_user) -> None:
    _accepted_date(client, make_user, hours_from_now=5)
    assert _run(client) == 0


def test_two_workers_send_one_reminder(client: TestClient, make_user) -> None:
    _accepted_date(client, make_user, hours_from_now=1)
    hub = client.app.state.hub

    async def both() -> list[int]:
        return list(
            await asyncio.gather(
                scheduler.send_due_reminders(hub), scheduler.send_due_reminders(hub)
            )
        )

    assert sorted(client.portal.call(both)) == [0, 1]


def test_reminder_wording() -> None:
    now = utcnow()
    text = scheduler.reminder_text
    assert text("Lido", now + timedelta(minutes=25), "Maya", now).endswith("starts in 25 minutes")
    assert text("Lido", now + timedelta(minutes=70), "Maya", now).endswith("in about an hour")
    assert text("Lido", now + timedelta(minutes=118), "Maya", now).endswith("in about 2 hours")
