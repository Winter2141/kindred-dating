import io
import random
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.services.personas import compose_reply
from tests.conftest import like_each_other


def _png(width: int = 2400, height: int = 1200) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 138, 91)).save(buffer, "PNG")
    return buffer.getvalue()


def _pair(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    return me, her, like_each_other(client, me, her)


def test_photo_messages_are_resized_and_delivered(
    client: TestClient, make_user, settings: Settings
) -> None:
    me, her, match_id = _pair(client, make_user)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        response = client.post(
            f"/api/matches/{match_id}/photos",
            files={"file": ("sunset.png", _png(), "image/png")},
            data={"caption": "  view from the trail  "},
            headers=me.headers,
        )
        assert response.status_code == 201
        message = response.json()
        assert message["body"] == "view from the trail"
        assert message["image_url"].startswith("/media/") and message["image_url"].endswith(".webp")
        event = ws.receive_json()
        assert event["type"] == "message.new"
        assert event["message"]["image_url"] == message["image_url"]

    served = client.get(message["image_url"])
    assert served.status_code == 200
    with Image.open(io.BytesIO(served.content)) as image:
        assert max(image.size) == 1600


def test_captions_are_optional_and_files_must_be_images(client: TestClient, make_user) -> None:
    me, _, match_id = _pair(client, make_user)
    bare = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("a.png", _png(300, 200), "image/png")},
        headers=me.headers,
    )
    assert bare.status_code == 201 and bare.json()["body"] == ""
    not_image = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers=me.headers,
    )
    assert not_image.status_code == 415
    stranger = make_user()
    blocked = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("a.png", _png(300, 200), "image/png")},
        headers=stranger.headers,
    )
    assert blocked.status_code == 404


def test_unsending_a_photo_deletes_the_file(
    client: TestClient, make_user, settings: Settings
) -> None:
    me, _, match_id = _pair(client, make_user)
    sent = client.post(
        f"/api/matches/{match_id}/photos",
        files={"file": ("a.png", _png(300, 200), "image/png")},
        headers=me.headers,
    ).json()
    stored = settings.media_dir / sent["image_url"].rsplit("/", 1)[1]
    assert stored.exists()
    unsent = client.delete(f"/api/matches/{match_id}/messages/{sent['id']}", headers=me.headers)
    assert unsent.json()["image_url"] is None
    assert not stored.exists()


def test_personas_answer_a_bare_photo() -> None:
    persona = SimpleNamespace(name="Maya", city="", job_title="", interests=[], prompts=[])
    human = SimpleNamespace(name="Alex", city="", job_title="", interests=[], prompts=[])
    history = [
        SimpleNamespace(sender_id=2, body="hi", image_url=None),
        SimpleNamespace(sender_id=1, body="Hey!", image_url=None),
        SimpleNamespace(sender_id=2, body="", image_url="/media/x.webp"),
    ]
    reply = compose_reply(persona, human, history, 1, random.Random(2))
    assert "photo" in reply or "picture" in reply or "eye" in reply
