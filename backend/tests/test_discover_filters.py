from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.models import User


def _ids(client: TestClient, account, **params) -> set[int]:
    response = client.get("/api/discover", params=params, headers=account.headers)
    assert response.status_code == 200, response.text
    return {c["id"] for c in response.json()}


def _update(client: TestClient, user_id: int, **fields) -> None:
    async def apply() -> None:
        async with client.app.state.hub.db.session() as session:
            user = await session.get(User, user_id)
            for name, value in fields.items():
                setattr(user, name, value)
            await session.commit()

    client.portal.call(apply)


def _deck(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"], interests=["Coffee", "Hiking"])
    hiker = make_user(name="Hiker", interests=["Hiking"])
    reader = make_user(
        name="Reader",
        interests=["Books"],
        prompts=[{"question": "I geek out on", "answer": "first editions"}],
    )
    return me, hiker, reader


def test_no_filters_shows_everyone(client: TestClient, make_user) -> None:
    me, hiker, reader = _deck(client, make_user)
    assert _ids(client, me) == {hiker.id, reader.id}


def test_verified_only(client: TestClient, make_user) -> None:
    me, hiker, _ = _deck(client, make_user)
    _update(client, hiker.id, verified_at=utcnow())
    assert _ids(client, me, verified_only=True) == {hiker.id}


def test_recently_active(client: TestClient, make_user) -> None:
    me, hiker, reader = _deck(client, make_user)
    _update(client, reader.id, last_active_at=utcnow() - timedelta(days=10))
    assert _ids(client, me, active_within_days=7) == {hiker.id}
    assert _ids(client, me, active_within_days=14) == {hiker.id, reader.id}


def test_interests_and_prompts(client: TestClient, make_user) -> None:
    me, hiker, reader = _deck(client, make_user)
    assert _ids(client, me, interests=["Books"]) == {reader.id}
    assert _ids(client, me, interests=["Books", "Hiking"]) == {hiker.id, reader.id}
    assert _ids(client, me, with_prompts=True) == {reader.id}
    bad = client.get("/api/discover", params={"interests": ["Skydiving"]}, headers=me.headers)
    assert bad.status_code == 422


def test_minimum_agreement(client: TestClient, make_user) -> None:
    me, hiker, reader = _deck(client, make_user)
    for question in ("kids", "pets", "tidy"):
        for account in (me, hiker):
            client.put(f"/api/questions/{question}", json={"answer": 0}, headers=account.headers)
    # The reader hasn't answered anything, so can't be compared and is left out.
    assert _ids(client, me, min_agreement=80) == {hiker.id}
    zero = client.get("/api/discover", params={"min_agreement": 0}, headers=me.headers)
    assert zero.status_code == 422
