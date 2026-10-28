import io

from fastapi.testclient import TestClient
from PIL import Image

from tests.conftest import birthdate_for


def test_register_then_login(client: TestClient, make_user) -> None:
    account = make_user(email="Ada@Example.com", name="Ada")
    assert account.email == "Ada@Example.com"

    response = client.post(
        "/api/auth/login", json={"email": "ada@example.com", "password": "correct-horse"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["name"] == "Ada"
    assert response.json()["user"]["email"] == "ada@example.com"


def test_duplicate_email_is_rejected(client: TestClient, make_user) -> None:
    make_user(email="dup@example.com")
    response = client.post(
        "/api/auth/register",
        json={
            "email": "DUP@example.com",
            "password": "another-password",
            "name": "Copy",
            "birthdate": birthdate_for(30),
            "gender": "man",
            "interested_in": ["woman"],
        },
    )
    assert response.status_code == 409


def test_wrong_password(client: TestClient, make_user) -> None:
    make_user(email="ada@example.com")
    response = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope"})
    assert response.status_code == 401


def test_minors_cannot_register(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "kid@example.com",
            "password": "long-enough",
            "name": "Kid",
            "birthdate": birthdate_for(17),
            "gender": "man",
            "interested_in": ["woman"],
        },
    )
    assert response.status_code == 422
    assert "18" in response.text


def test_unknown_interest_is_rejected(client: TestClient, make_user) -> None:
    account = make_user()
    response = client.patch("/api/me", json={"interests": ["Juggling"]}, headers=account.headers)
    assert response.status_code == 422


def test_me_requires_auth(client: TestClient) -> None:
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_update_profile(client: TestClient, make_user) -> None:
    account = make_user()
    response = client.patch(
        "/api/me",
        json={
            "bio": "  Hello there  ",
            "interests": ["Coffee", "Coffee", "Wine"],
            "prompts": [{"question": "My ideal Sunday", "answer": "Pancakes"}],
            "age_min": 25,
            "age_max": 35,
        },
        headers=account.headers,
    )
    assert response.status_code == 200
    me = response.json()
    assert me["bio"] == "Hello there"
    assert me["interests"] == ["Coffee", "Wine"]
    assert me["prompts"] == [{"question": "My ideal Sunday", "answer": "Pancakes"}]
    assert (me["age_min"], me["age_max"]) == (25, 35)


def test_age_range_must_be_ordered(client: TestClient, make_user) -> None:
    account = make_user(age_max=35)
    response = client.patch("/api/me", json={"age_min": 40}, headers=account.headers)
    assert response.status_code == 422


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2000, 1000), "coral").save(buffer, "PNG")
    return buffer.getvalue()


def test_photo_upload_resizes_and_serves(client: TestClient, make_user) -> None:
    account = make_user()
    response = client.post(
        "/api/me/photos",
        files={"file": ("me.png", _png(), "image/png")},
        headers=account.headers,
    )
    assert response.status_code == 201
    url = response.json()["photos"][0]
    assert url.startswith("/media/") and url.endswith(".webp")

    served = client.get(url)
    assert served.status_code == 200
    with Image.open(io.BytesIO(served.content)) as image:
        assert max(image.size) == 1200

    removed = client.delete("/api/me/photos", params={"url": url}, headers=account.headers)
    assert removed.json()["photos"] == []
    assert client.get(url).status_code == 404


def test_photo_upload_rejects_non_images(client: TestClient, make_user) -> None:
    account = make_user()
    response = client.post(
        "/api/me/photos",
        files={"file": ("notes.txt", b"definitely not a picture", "text/plain")},
        headers=account.headers,
    )
    assert response.status_code == 415


def test_photos_can_only_be_reordered(client: TestClient, make_user) -> None:
    account = make_user()
    response = client.patch(
        "/api/me", json={"photos": ["https://evil.example/x.jpg"]}, headers=account.headers
    )
    assert response.status_code == 422


def test_meta_lists_vocabularies(client: TestClient) -> None:
    meta = client.get("/api/meta").json()
    assert {"name": "Coffee", "emoji": "☕"} in meta["interests"]
    assert "My ideal Sunday" in meta["prompt_questions"]
    assert meta["genders"] == ["woman", "man", "nonbinary"]
