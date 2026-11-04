from fastapi.testclient import TestClient

from app.routers import saved
from tests.test_travel import _deck, _ids


def _save(client: TestClient, account, other):
    return client.put(f"/api/saved/{other.id}", headers=account.headers)


def _saved(client: TestClient, account) -> list[int]:
    return [row["user"]["id"] for row in client.get("/api/saved", headers=account.headers).json()]


def _people(make_user):
    me = make_user(gender="man", interested_in=["woman"])
    return me, make_user(), make_user()


def test_saving_takes_someone_out_of_the_deck(client: TestClient, make_user) -> None:
    me, first, second = _people(make_user)
    assert _ids(_deck(client, me)) == {first.id, second.id}

    response = _save(client, me, first)
    assert response.status_code == 200 and response.json()["user"]["id"] == first.id
    assert _save(client, me, first).status_code == 200  # saving again is harmless
    assert _ids(_deck(client, me)) == {second.id}
    _save(client, me, second)
    assert _saved(client, me) == [second.id, first.id]  # newest first


def test_putting_someone_back(client: TestClient, make_user) -> None:
    me, first, _ = _people(make_user)
    _save(client, me, first)
    assert client.delete(f"/api/saved/{first.id}", headers=me.headers).status_code == 204
    assert _saved(client, me) == []
    assert first.id in _ids(_deck(client, me))


def test_deciding_clears_the_saved_list(client: TestClient, make_user) -> None:
    me, first, second = _people(make_user)
    _save(client, me, first)
    _save(client, me, second)
    client.post("/api/swipes", json={"target_id": first.id, "action": "like"}, headers=me.headers)
    client.post("/api/swipes", json={"target_id": second.id, "action": "pass"}, headers=me.headers)
    assert _saved(client, me) == []
    # And someone already decided on can't be saved.
    conflict = _save(client, me, first)
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "You've already decided on them"


def test_what_cant_be_saved(client: TestClient, make_user) -> None:
    me, first, _ = _people(make_user)
    assert _save(client, me, me).status_code == 422
    assert client.put("/api/saved/99999", headers=me.headers).status_code == 404
    client.post("/api/blocks", json={"user_id": me.id}, headers=first.headers)
    assert _save(client, me, first).status_code == 404


def test_blocking_hides_someone_saved(client: TestClient, make_user) -> None:
    me, first, _ = _people(make_user)
    _save(client, me, first)
    client.post("/api/blocks", json={"user_id": me.id}, headers=first.headers)
    assert _saved(client, me) == []


def test_there_is_a_limit(client: TestClient, make_user, monkeypatch) -> None:
    monkeypatch.setattr(saved, "MAX_SAVED", 1)
    me, first, second = _people(make_user)
    _save(client, me, first)
    full = _save(client, me, second)
    assert full.status_code == 409 and "up to 1 people" in full.json()["detail"]


def test_the_export_lists_people_saved_for_later(client: TestClient, make_user) -> None:
    me, first, _ = _people(make_user)
    _save(client, me, first)
    export = client.get("/api/me/export", headers=me.headers).json()
    assert [row["who"] for row in export["saved_for_later"]] == [f"User {first.id}"]
