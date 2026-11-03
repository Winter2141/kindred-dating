import random
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.services.verification import POSES_BY_ID


def _jpeg() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (60, 60), "peachpuff").save(buffer, "JPEG")
    return buffer.getvalue()


def _with_photo(client: TestClient, account) -> None:
    client.post(
        "/api/me/photos", files={"file": ("me.jpg", _jpeg(), "image/jpeg")}, headers=account.headers
    )


def _admin(client: TestClient, make_user):
    admin = make_user(email="mod@example.com")

    async def promote() -> None:
        from app.models import User

        async with client.app.state.hub.db.session() as session:
            (await session.get(User, admin.id)).is_admin = True
            await session.commit()

    client.portal.call(promote)
    return admin


def _start(client: TestClient, account):
    return client.post("/api/me/verification", headers=account.headers)


def _selfie(client: TestClient, account):
    return client.post(
        "/api/me/verification/selfie",
        files={"file": ("selfie.jpg", _jpeg(), "image/jpeg")},
        headers=account.headers,
    )


def test_the_whole_flow(client: TestClient, make_user, settings) -> None:
    me = make_user()
    admin = _admin(client, make_user)
    assert client.get("/api/me/verification", headers=me.headers).json() == {
        "status": "none",
        "verified": False,
        "pose": None,
        "note": "",
    }
    assert _start(client, me).status_code == 409  # no profile photo yet
    _with_photo(client, me)

    started = _start(client, me).json()
    assert started["status"] == "awaiting_photo"
    assert started["pose"]["id"] in POSES_BY_ID

    sent = _selfie(client, me)
    assert sent.status_code == 200 and sent.json()["status"] == "pending"
    assert _start(client, me).status_code == 409  # already waiting

    queue = client.get("/api/admin/verifications", headers=admin.headers).json()
    assert [r["user"]["id"] for r in queue] == [me.id]
    selfie = settings.media_dir / queue[0]["selfie_url"].rsplit("/", 1)[1]
    assert selfie.exists()
    assert (
        client.get("/api/admin/stats", headers=admin.headers).json()["pending_verifications"] == 1
    )

    approved = client.post(
        f"/api/admin/verifications/{queue[0]['id']}/review",
        json={"approve": True},
        headers=admin.headers,
    ).json()
    assert approved["status"] == "approved" and approved["user"]["verified"] is True
    assert approved["selfie_url"] is None and not selfie.exists()

    assert client.get("/api/me", headers=me.headers).json()["verified"] is True
    mine = client.get("/api/me/verification", headers=me.headers).json()
    assert mine["status"] == "approved" and mine["verified"] is True
    feed = client.get("/api/notifications", headers=me.headers).json()
    assert feed["items"][0]["kind"] == "verified"
    assert _start(client, me).status_code == 409  # nothing more to do


def test_rejection_needs_a_reason_and_lets_you_retry(client: TestClient, make_user) -> None:
    me = make_user()
    admin = _admin(client, make_user)
    _with_photo(client, me)
    _start(client, me)
    _selfie(client, me)
    request_id = client.get("/api/admin/verifications", headers=admin.headers).json()[0]["id"]

    no_reason = client.post(
        f"/api/admin/verifications/{request_id}/review",
        json={"approve": False},
        headers=admin.headers,
    )
    assert no_reason.status_code == 422
    client.post(
        f"/api/admin/verifications/{request_id}/review",
        json={"approve": False, "note": "We couldn't see the pose."},
        headers=admin.headers,
    )
    mine = client.get("/api/me/verification", headers=me.headers).json()
    assert mine == {
        "status": "rejected",
        "verified": False,
        "pose": None,
        "note": "We couldn't see the pose.",
    }
    again = client.post(
        f"/api/admin/verifications/{request_id}/review",
        json={"approve": True},
        headers=admin.headers,
    )
    assert again.status_code == 409
    assert _start(client, me).json()["status"] == "awaiting_photo"


def test_asking_again_changes_the_pose(client: TestClient, make_user) -> None:
    me = make_user()
    _with_photo(client, me)
    first = _start(client, me).json()["pose"]["id"]
    second = _start(client, me).json()["pose"]["id"]
    assert first != second


def test_selfies_need_a_pose_first(client: TestClient, make_user) -> None:
    me = make_user()
    _with_photo(client, me)
    assert _selfie(client, me).status_code == 409


def test_only_moderators_review(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.get("/api/admin/verifications", headers=me.headers).status_code == 403
    review = client.post(
        "/api/admin/verifications/1/review", json={"approve": True}, headers=me.headers
    )
    assert review.status_code == 403


def test_pose_choice_avoids_repeats() -> None:
    from types import SimpleNamespace

    from app.services import verification

    previous = SimpleNamespace(pose="peace")
    rng = random.Random(1)
    choices = {
        rng.choice([p for p in verification.POSES if p.id != previous.pose]).id for _ in range(50)
    }
    assert "peace" not in choices and len(choices) > 3
