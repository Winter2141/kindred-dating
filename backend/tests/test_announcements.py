from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import Announcement
from tests.test_admin import _make_admin


def _post(client: TestClient, admin, **fields):
    payload = {"title": "Video calls are here", "body": "Tap the camera in any chat."} | fields
    return client.post("/api/admin/announcements", json=payload, headers=admin.headers)


def _current(client: TestClient, account) -> list[dict]:
    return client.get("/api/announcements", headers=account.headers).json()


def test_only_moderators_post(client: TestClient, make_user) -> None:
    member = make_user()
    assert _post(client, member).status_code == 403
    assert client.get("/api/admin/announcements", headers=member.headers).status_code == 403


def test_everyone_sees_it_until_they_dismiss_it(client: TestClient, make_user) -> None:
    admin, first, second = make_user(), make_user(), make_user()
    _make_admin(client, admin)
    posted = _post(client, admin, tone="celebration", hours=24)
    assert posted.status_code == 201
    body = posted.json()
    assert body["active"] is True and body["tone"] == "celebration"
    assert body["author_name"] == "User 1" and body["dismissed_count"] == 0

    assert [a["title"] for a in _current(client, first)] == ["Video calls are here"]
    announcement_id = body["id"]
    dismiss = client.post(f"/api/announcements/{announcement_id}/dismiss", headers=first.headers)
    assert dismiss.status_code == 204
    # Dismissing twice is harmless, and only hides it for that person.
    client.post(f"/api/announcements/{announcement_id}/dismiss", headers=first.headers)
    assert _current(client, first) == []
    assert len(_current(client, second)) == 1

    (listed,) = client.get("/api/admin/announcements", headers=admin.headers).json()
    assert listed["dismissed_count"] == 1
    assert client.post("/api/announcements/999/dismiss", headers=first.headers).status_code == 404


def test_newest_first_and_at_most_three(client: TestClient, make_user) -> None:
    admin, member = make_user(), make_user()
    _make_admin(client, admin)
    for n in range(4):
        _post(client, admin, title=f"Notice {n}")
    assert [a["title"] for a in _current(client, member)] == ["Notice 3", "Notice 2", "Notice 1"]


def test_ending_an_announcement(client: TestClient, make_user) -> None:
    admin, member = make_user(), make_user()
    _make_admin(client, admin)
    announcement_id = _post(client, admin, hours=None).json()["id"]
    assert _post(client, admin, hours=None).json()["ends_at"] is None

    ended = client.post(f"/api/admin/announcements/{announcement_id}/end", headers=admin.headers)
    assert ended.json()["active"] is False
    assert announcement_id not in {a["id"] for a in _current(client, member)}

    audit = client.get("/api/admin/audit", headers=admin.headers).json()
    actions = [event["action"] for event in audit]
    assert "announcement.posted" in actions and "announcement.ended" in actions


def test_announcements_expire(client: TestClient, make_user) -> None:
    admin, member = make_user(), make_user()
    _make_admin(client, admin)
    _post(client, admin, hours=1)

    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            announcement = await session.get(Announcement, 1)
            announcement.ends_at = utcnow() - timedelta(minutes=1)
            await session.commit()

    client.portal.call(run)
    assert _current(client, member) == []


def test_what_an_announcement_needs(client: TestClient, make_user) -> None:
    admin = make_user()
    _make_admin(client, admin)
    assert _post(client, admin, title="   ").status_code == 422
    assert _post(client, admin, title="x" * 81).status_code == 422
    assert _post(client, admin, body="x" * 401).status_code == 422
    assert _post(client, admin, tone="shouting").status_code == 422
    assert _post(client, admin, hours=0).status_code == 422
