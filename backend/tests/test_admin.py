from fastapi.testclient import TestClient

from app.models import User
from tests.conftest import Account


def _make_admin(client: TestClient, account: Account) -> None:
    hub = client.app.state.hub

    async def promote() -> None:
        async with hub.db.session() as session:
            user = await session.get(User, account.id)
            user.is_admin = True
            await session.commit()

    client.portal.call(promote)


def _report(client: TestClient, reporter: Account, reported: Account, reason: str = "spam") -> int:
    response = client.post(
        "/api/reports",
        json={"user_id": reported.id, "reason": reason, "details": "selling things"},
        headers=reporter.headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_only_admins_see_the_queue(client: TestClient, make_user) -> None:
    member = make_user()
    assert client.get("/api/admin/reports", headers=member.headers).status_code == 403
    assert client.get("/api/admin/stats", headers=member.headers).status_code == 403
    assert client.get("/api/me", headers=member.headers).json()["is_admin"] is False


def test_queue_lists_open_reports_with_context(client: TestClient, make_user) -> None:
    admin, spammer = make_user(), make_user(name="Spammy")
    first, second = make_user(), make_user()
    _make_admin(client, admin)
    _report(client, first, spammer)
    _report(client, second, spammer, reason="fake_profile")

    queue = client.get("/api/admin/reports", headers=admin.headers).json()
    assert [r["reason"] for r in queue] == ["spam", "fake_profile"]  # oldest first
    assert queue[0]["reported"]["name"] == "Spammy"
    assert queue[0]["reported"]["open_reports"] == 2
    assert queue[0]["reported"]["email"].endswith("@example.com")
    assert queue[0]["details"] == "selling things"


def test_dismissing_closes_only_that_report(client: TestClient, make_user) -> None:
    admin, reported, a, b = make_user(), make_user(), make_user(), make_user()
    _make_admin(client, admin)
    first = _report(client, a, reported)
    _report(client, b, reported)

    resolved = client.post(
        f"/api/admin/reports/{first}/resolve", json={"action": "dismiss"}, headers=admin.headers
    ).json()
    assert resolved["status"] == "dismissed"
    assert resolved["reported"]["open_reports"] == 1
    assert len(client.get("/api/admin/reports", headers=admin.headers).json()) == 1
    again = client.post(
        f"/api/admin/reports/{first}/resolve", json={"action": "dismiss"}, headers=admin.headers
    )
    assert again.status_code == 409


def test_banning_locks_the_account_and_clears_their_reports(client: TestClient, make_user) -> None:
    admin = make_user(gender="man", interested_in=["woman"])
    bad = make_user(email="bad@example.com")
    a, b = make_user(), make_user()
    _make_admin(client, admin)
    first = _report(client, a, bad)
    _report(client, b, bad)
    assert bad.id in [c["id"] for c in client.get("/api/discover", headers=admin.headers).json()]

    with client.websocket_connect(f"/ws?token={bad.token}") as ws:
        ws.receive_json()  # hello
        banned = client.post(
            f"/api/admin/reports/{first}/resolve", json={"action": "ban"}, headers=admin.headers
        ).json()
        assert banned["status"] == "actioned"
        assert banned["reported"]["banned"] is True
        assert ws.receive().get("code") == 4401

    assert client.get("/api/admin/reports", headers=admin.headers).json() == []
    actioned = client.get(
        "/api/admin/reports", params={"status": "actioned"}, headers=admin.headers
    ).json()
    assert len(actioned) == 2
    assert client.get("/api/me", headers=bad.headers).status_code == 401
    login = client.post(
        "/api/auth/login", json={"email": "bad@example.com", "password": "correct-horse"}
    )
    assert login.status_code == 403
    assert bad.id not in [
        c["id"] for c in client.get("/api/discover", headers=admin.headers).json()
    ]

    stats = client.get("/api/admin/stats", headers=admin.headers).json()
    assert stats == {
        "pending_verifications": 0,
        "open_reports": 0,
        "resolved_this_week": 2,
        "banned_users": 1,
        "total_users": 4,
    }

    assert client.post(f"/api/admin/users/{bad.id}/unban", headers=admin.headers).status_code == 204
    login = client.post(
        "/api/auth/login", json={"email": "bad@example.com", "password": "correct-horse"}
    )
    assert login.status_code == 200


def test_admins_cannot_be_banned_from_the_queue(client: TestClient, make_user) -> None:
    admin, other_admin, reporter = make_user(), make_user(), make_user()
    _make_admin(client, admin)
    _make_admin(client, other_admin)
    report_id = _report(client, reporter, other_admin)
    response = client.post(
        f"/api/admin/reports/{report_id}/resolve", json={"action": "ban"}, headers=admin.headers
    )
    assert response.status_code == 409
