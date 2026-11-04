from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import utcnow
from app.models import ProfileView, User
from tests.conftest import like_each_other


def _view(client: TestClient, viewer, viewed) -> int:
    return client.post(f"/api/users/{viewed.id}/view", headers=viewer.headers).status_code


def _viewers(client: TestClient, account) -> dict:
    return client.get("/api/me/viewers", headers=account.headers).json()


def _age_views(client: TestClient, days: float) -> None:
    async def run() -> None:
        async with client.app.state.hub.db.session() as session:
            for view in await session.scalars(select(ProfileView)):
                view.viewed_at -= timedelta(days=days)
            await session.commit()

    client.portal.call(run)


def test_seeing_who_looked(client: TestClient, make_user) -> None:
    me, first, second = make_user(), make_user(gender="man"), make_user(gender="man")
    assert _viewers(client, me) == {"private": False, "viewers": []}

    assert _view(client, first, me) == 204
    assert _view(client, second, me) == 204
    client.post("/api/swipes", json={"target_id": me.id, "action": "like"}, headers=second.headers)

    viewers = _viewers(client, me)["viewers"]
    assert [v["user"]["id"] for v in viewers] == [second.id, first.id]  # newest first
    assert viewers[0]["liked_you"] is True and viewers[1]["liked_you"] is False
    assert viewers[0]["times"] == 1
    # Looking at yourself isn't a view.
    assert _view(client, me, me) == 204
    assert me.id not in {v["user"]["id"] for v in _viewers(client, me)["viewers"]}


def test_looking_again_counts_days_not_clicks(client: TestClient, make_user) -> None:
    me, viewer = make_user(), make_user(gender="man")
    for _ in range(3):
        _view(client, viewer, me)
    assert _viewers(client, me)["viewers"][0]["times"] == 1

    _age_views(client, days=1)
    _view(client, viewer, me)
    (view,) = _viewers(client, me)["viewers"]
    assert view["times"] == 2


def test_old_views_drop_off(client: TestClient, make_user) -> None:
    me, viewer = make_user(), make_user(gender="man")
    _view(client, viewer, me)
    _age_views(client, days=31)
    assert _viewers(client, me)["viewers"] == []


def test_browsing_privately_works_both_ways(client: TestClient, make_user) -> None:
    me, viewer = make_user(), make_user(gender="man")
    _view(client, viewer, me)

    private = client.patch("/api/me", json={"browse_privately": True}, headers=viewer.headers)
    assert private.json()["browse_privately"] is True
    _view(client, viewer, make_user())  # not recorded
    assert _viewers(client, viewer) == {"private": True, "viewers": []}

    # The look from before going private stays; nothing new was added.
    count = client.portal.call(_count_views, client)
    assert count == 1


async def _count_views(client: TestClient) -> int:
    async with client.app.state.hub.db.session() as session:
        return len((await session.scalars(select(ProfileView))).all())


def test_blocks_and_bans_hide_views(client: TestClient, make_user) -> None:
    me, blocked, banned = make_user(), make_user(gender="man"), make_user(gender="man")
    _view(client, blocked, me)
    _view(client, banned, me)
    client.post("/api/blocks", json={"user_id": blocked.id}, headers=me.headers)
    assert _view(client, blocked, me) == 404

    async def ban() -> None:
        async with client.app.state.hub.db.session() as session:
            user = await session.get(User, banned.id)
            user.banned_at = utcnow()
            await session.commit()

    client.portal.call(ban)
    assert _viewers(client, me)["viewers"] == []
    assert client.post("/api/users/99999/view", headers=me.headers).status_code == 404


def test_the_export_lists_profiles_you_opened(client: TestClient, make_user) -> None:
    me, other = make_user(), make_user(gender="man", name="Sam")
    like_each_other(client, me, other)
    _view(client, me, other)
    _view(client, other, me)
    export = client.get("/api/me/export", headers=me.headers).json()
    assert [v["who"] for v in export["profiles_viewed"]] == ["Sam"]
    assert export["account"]["browses_privately"] is False
