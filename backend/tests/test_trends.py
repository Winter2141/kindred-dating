from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import utcnow
from app.models import Report, User
from tests.test_admin import _make_admin, _report


def _shift(
    client: TestClient, report_id: int, filed_hours_ago: float, resolved_after: float | None
):
    """Move a report back in time: filed N hours ago, resolved M hours after that."""

    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            report = await session.get(Report, report_id)
            report.created_at = utcnow() - timedelta(hours=filed_hours_ago)
            if resolved_after is not None:
                report.resolved_at = report.created_at + timedelta(hours=resolved_after)
            await session.commit()

    client.portal.call(run)


def _age_members(client: TestClient, days: float) -> None:
    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            for user in await session.scalars(select(User)):
                user.created_at = utcnow() - timedelta(days=days)
            await session.commit()

    client.portal.call(run)


def test_trends_are_for_moderators_only(client: TestClient, make_user) -> None:
    member = make_user()
    assert client.get("/api/admin/trends", headers=member.headers).status_code == 403


def test_the_queue_day_by_day(client: TestClient, make_user) -> None:
    admin, reporter, spammer, rude = make_user(), make_user(), make_user(), make_user()
    _make_admin(client, admin)
    _age_members(client, days=60)  # joined long before the window
    newcomer = make_user()

    old = _report(client, reporter, spammer, "spam")
    _shift(client, old, filed_hours_ago=50, resolved_after=None)
    first = _report(client, reporter, rude, "harassment")
    client.post(
        f"/api/admin/reports/{first}/resolve", json={"action": "dismiss"}, headers=admin.headers
    )
    _shift(client, first, filed_hours_ago=30, resolved_after=6)
    second = _report(client, newcomer, rude, "harassment")
    client.post(
        f"/api/admin/reports/{second}/resolve", json={"action": "dismiss"}, headers=admin.headers
    )
    _shift(client, second, filed_hours_ago=10, resolved_after=2)

    trends = client.get("/api/admin/trends", params={"days": 7}, headers=admin.headers).json()
    assert trends["days"] == 7
    assert len(trends["activity"]) == 7
    assert trends["activity"][-1]["day"] == utcnow().date().isoformat()
    assert trends["reports_filed"] == 3
    assert trends["reports_resolved"] == 2
    assert trends["median_hours_to_resolve"] == 4.0
    assert 49.9 <= trends["oldest_open_hours"] <= 50.1
    assert trends["new_members"] == 1
    assert trends["by_reason"] == [
        {"reason": "harassment", "count": 2},
        {"reason": "spam", "count": 1},
    ]
    assert sum(d["reports_filed"] for d in trends["activity"]) == 3
    assert sum(d["reports_resolved"] for d in trends["activity"]) == 2
    assert sum(d["new_members"] for d in trends["activity"]) == 1


def test_an_empty_queue(client: TestClient, make_user) -> None:
    admin = make_user()
    _make_admin(client, admin)
    trends = client.get("/api/admin/trends", params={"days": 30}, headers=admin.headers).json()
    assert len(trends["activity"]) == 30
    assert trends["median_hours_to_resolve"] is None
    assert trends["oldest_open_hours"] is None
    assert trends["by_reason"] == []


def test_the_window_is_capped(client: TestClient, make_user) -> None:
    admin = make_user()
    _make_admin(client, admin)
    response = client.get("/api/admin/trends", params={"days": 365}, headers=admin.headers)
    assert response.status_code == 422
