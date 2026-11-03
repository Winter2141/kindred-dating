from fastapi.testclient import TestClient

from app.models import User
from tests.conftest import like_each_other


def _promote(client: TestClient, user_id: int) -> None:
    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            (await session.get(User, user_id)).is_admin = True
            await session.commit()

    client.portal.call(run)


def _admin(client: TestClient, make_user):
    admin = make_user(name="Mod", email="mod@example.com")
    _promote(client, admin.id)
    return admin


def test_directory_search_and_filters(client: TestClient, make_user) -> None:
    admin = _admin(client, make_user)
    maya = make_user(name="Maya", email="maya@example.com")
    make_user(name="Priya", email="priya@example.com")
    like_each_other(client, make_user(gender="man", interested_in=["woman"]), maya)

    page = client.get("/api/admin/users", headers=admin.headers).json()
    assert page["total"] == 4
    assert page["items"][0]["name"] != "Mod"  # newest first

    found = client.get("/api/admin/users", params={"q": "MAYA"}, headers=admin.headers).json()
    assert [u["name"] for u in found["items"]] == ["Maya"]
    assert found["items"][0]["matches"] == 1
    by_email = client.get("/api/admin/users", params={"q": "priya@"}, headers=admin.headers)
    assert by_email.json()["total"] == 1

    admins = client.get("/api/admin/users", params={"filter": "admins"}, headers=admin.headers)
    assert [u["name"] for u in admins.json()["items"]] == ["Mod"]

    paged = client.get(
        "/api/admin/users", params={"limit": 2, "offset": 2}, headers=admin.headers
    ).json()
    assert paged["total"] == 4 and len(paged["items"]) == 2


def test_direct_ban_is_logged_and_closes_sessions(client: TestClient, make_user) -> None:
    admin = _admin(client, make_user)
    spammer = make_user(name="Spammy")
    assert (
        client.post(
            f"/api/admin/users/{spammer.id}/ban", json={"reason": "x"}, headers=admin.headers
        ).status_code
        == 422
    )
    banned = client.post(
        f"/api/admin/users/{spammer.id}/ban",
        json={"reason": "Sending the same link to everyone"},
        headers=admin.headers,
    )
    assert banned.status_code == 204
    assert client.get("/api/me", headers=spammer.headers).status_code == 401
    again = client.post(
        f"/api/admin/users/{spammer.id}/ban", json={"reason": "again"}, headers=admin.headers
    )
    assert again.status_code == 409

    banned_list = client.get(
        "/api/admin/users", params={"filter": "banned"}, headers=admin.headers
    ).json()
    assert [u["name"] for u in banned_list["items"]] == ["Spammy"]

    client.post(f"/api/admin/users/{spammer.id}/unban", headers=admin.headers)
    log = client.get("/api/admin/audit", headers=admin.headers).json()
    assert [(e["action"], e["actor_name"], e["target"]["name"]) for e in log] == [
        ("user.unbanned", "Mod", "Spammy"),
        ("user.banned", "Mod", "Spammy"),
    ]
    assert log[1]["detail"] == "Sending the same link to everyone"


def test_report_and_verification_decisions_are_logged(client: TestClient, make_user) -> None:
    admin = _admin(client, make_user)
    reporter = make_user()
    reported = make_user(name="Rude")
    client.post(
        "/api/reports",
        json={"user_id": reported.id, "reason": "harassment", "block": False},
        headers=reporter.headers,
    )
    report_id = client.get("/api/admin/reports", headers=admin.headers).json()[0]["id"]
    client.post(
        f"/api/admin/reports/{report_id}/resolve", json={"action": "dismiss"}, headers=admin.headers
    )
    (event,) = client.get("/api/admin/audit", headers=admin.headers).json()
    assert event["action"] == "report.dismissed"
    assert event["detail"] == f"Report #{report_id} (harassment)"


def test_audit_paging_and_access(client: TestClient, make_user) -> None:
    admin = _admin(client, make_user)
    for i in range(3):
        target = make_user(name=f"T{i}")
        client.post(
            f"/api/admin/users/{target.id}/ban", json={"reason": "testing"}, headers=admin.headers
        )
    first = client.get("/api/admin/audit", params={"limit": 2}, headers=admin.headers).json()
    rest = client.get(
        "/api/admin/audit", params={"before": first[-1]["id"]}, headers=admin.headers
    ).json()
    assert len(first) == 2 and len(rest) == 1

    member = make_user()
    assert client.get("/api/admin/audit", headers=member.headers).status_code == 403
    assert client.get("/api/admin/users", headers=member.headers).status_code == 403
