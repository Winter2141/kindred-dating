import json

import pytest
from fastapi.testclient import TestClient

from app.services.audio import WAVEFORM_BARS, clean_waveform, sniff_audio
from tests.conftest import like_each_other

# The first bytes of a WebM file (EBML header) followed by filler: enough for the sniffer.
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 200


def _chat(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    return me, her, like_each_other(client, me, her)


def _voice(client, account, match_id, data: bytes = WEBM, **form):
    fields = {"duration_ms": "4200", "waveform": json.dumps([10, 80, 40, 95, 5]), **form}
    return client.post(
        f"/api/matches/{match_id}/voice",
        files={"file": ("note.webm", data, "audio/webm")},
        data=fields,
        headers=account.headers,
    )


@pytest.mark.parametrize(
    ("head", "extension"),
    [
        (b"\x1a\x45\xdf\xa3....", "webm"),
        (b"OggS\x00\x02", "ogg"),
        (b"\x00\x00\x00\x20ftypM4A ", "m4a"),
        (b"ID3\x04\x00", "mp3"),
        (b"\xff\xfb\x90\x00", "mp3"),
        (b"<html>", None),
        (b"\x89PNG\r\n", None),
    ],
)
def test_sniffing(head: bytes, extension: str | None) -> None:
    assert sniff_audio(head) == extension


def test_waveforms_are_resampled_and_clamped() -> None:
    bars = clean_waveform([-5, 50, 250] * 40)
    assert len(bars) == WAVEFORM_BARS
    assert min(bars) >= 0 and max(bars) == 100
    assert clean_waveform([]) == [0] * WAVEFORM_BARS
    assert clean_waveform([42]) == [42] * WAVEFORM_BARS


def test_sending_a_voice_note(client: TestClient, make_user, settings) -> None:
    me, her, match_id = _chat(client, make_user)
    with client.websocket_connect(f"/ws?token={her.token}") as ws:
        ws.receive_json()  # hello
        response = _voice(client, me, match_id)
        assert response.status_code == 201, response.text
        note = response.json()
        assert note["body"] == ""
        assert note["audio_url"].startswith("/media/voice-") and note["audio_url"].endswith(".webm")
        assert note["audio_ms"] == 4200
        assert len(note["waveform"]) == WAVEFORM_BARS
        assert ws.receive_json()["message"]["audio_url"] == note["audio_url"]

    stored = settings.media_dir / note["audio_url"].rsplit("/", 1)[1]
    assert stored.read_bytes() == WEBM
    assert client.get(note["audio_url"]).status_code == 200


def test_voice_notes_are_checked(client: TestClient, make_user) -> None:
    me, _, match_id = _chat(client, make_user)
    assert _voice(client, me, match_id, data=b"<script>alert(1)</script>").status_code == 415
    assert _voice(client, me, match_id, duration_ms="100").status_code == 422
    assert _voice(client, me, match_id, duration_ms=str(10 * 60 * 1000)).status_code == 422
    assert _voice(client, me, match_id, waveform="not json").status_code == 422
    assert _voice(client, me, match_id, reply_to_id="999999").status_code == 422


def test_voice_notes_can_be_unsent_but_not_edited(client: TestClient, make_user, settings) -> None:
    me, her, match_id = _chat(client, make_user)
    note = _voice(client, me, match_id).json()
    stored = settings.media_dir / note["audio_url"].rsplit("/", 1)[1]

    edit = client.patch(
        f"/api/matches/{match_id}/messages/{note['id']}", json={"body": "hi"}, headers=me.headers
    )
    assert edit.status_code == 403

    unsent = client.delete(f"/api/matches/{match_id}/messages/{note['id']}", headers=me.headers)
    assert unsent.status_code == 200
    assert unsent.json()["audio_url"] is None and unsent.json()["waveform"] is None
    assert not stored.exists()


def test_missed_voice_notes_are_notified(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    _voice(client, me, match_id)
    feed = client.get("/api/notifications", headers=her.headers).json()
    message = next(n for n in feed["items"] if n["kind"] == "message")
    assert message["body"] == "Sent a voice note"


def test_replying_with_a_voice_note(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    question = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "Say hi!"}, headers=her.headers
    ).json()
    note = _voice(client, me, match_id, reply_to_id=str(question["id"])).json()
    assert note["reply_to"]["id"] == question["id"]

    answer = client.post(
        f"/api/matches/{match_id}/messages",
        json={"body": "Cute", "reply_to_id": note["id"]},
        headers=her.headers,
    ).json()
    assert answer["reply_to"]["audio_url"] == note["audio_url"]


def test_personas_answer_voice_notes() -> None:
    from types import SimpleNamespace

    from app.services.personas import compose_reply

    persona = SimpleNamespace(name="Maya", interests=["Coffee"])
    human = SimpleNamespace(name="Alex", interests=["Coffee"])
    note = SimpleNamespace(sender_id=1, body="", image_url=None, audio_url="/media/voice-x.webm")
    reply = compose_reply(persona, human, [note], persona_id=2)
    assert any(word in reply.lower() for word in ("voice", "listened"))
