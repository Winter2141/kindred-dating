import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.conftest import like_each_other


@pytest.fixture
def settings(settings: Settings) -> Settings:
    # Unanswered calls give up quickly here, so the missed-call path can be tested.
    return settings.model_copy(update={"call_ring_seconds": 0.3})


def _next(ws, kind: str) -> dict:
    """The next event of `kind`, skipping presence and other chatter."""
    for _ in range(20):
        event = ws.receive_json()
        if event["type"] == kind:
            return event
    raise AssertionError(f"no {kind} event")


def _pair(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"], name="Sam")
    her = make_user(name="Priya")
    return me, her, like_each_other(client, me, her)


def test_a_whole_call(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with (
        client.websocket_connect(f"/ws?token={me.token}") as mine,
        client.websocket_connect(f"/ws?token={her.token}") as hers,
    ):
        mine.send_json({"type": "call.invite", "match_id": match_id, "kind": "video"})
        ringing = _next(mine, "call.ringing")
        call_id = ringing["call_id"]
        incoming = _next(hers, "call.incoming")
        assert incoming["call_id"] == call_id and incoming["kind"] == "video"
        assert incoming["from"]["name"] == "Sam"

        hers.send_json({"type": "call.accept", "call_id": call_id})
        assert _next(mine, "call.accepted")["call_id"] == call_id

        offer = {"type": "offer", "sdp": "v=0..."}
        mine.send_json({"type": "call.signal", "call_id": call_id, "data": offer})
        assert _next(hers, "call.signal")["data"] == offer
        hers.send_json({"type": "call.signal", "call_id": call_id, "data": {"type": "answer"}})
        assert _next(mine, "call.signal")["data"] == {"type": "answer"}

        hers.send_json({"type": "call.end", "call_id": call_id})
        assert _next(mine, "call.ended")["reason"] == "ended"
        log = _next(mine, "message.new")["message"]
        assert log["call_kind"] == "video" and log["call_ms"] is not None
        assert log["sender_id"] == me.id

    # The call is over, so it can't be ended or joined again.
    with client.websocket_connect(f"/ws?token={me.token}") as mine:
        mine.receive_json()
        mine.send_json({"type": "call.end", "call_id": call_id})
        assert _next(mine, "call.failed")["reason"] == "gone"


def test_unanswered_calls_ring_out_as_missed(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with (
        client.websocket_connect(f"/ws?token={me.token}") as mine,
        client.websocket_connect(f"/ws?token={her.token}") as hers,
    ):
        mine.send_json({"type": "call.invite", "match_id": match_id, "kind": "audio"})
        _next(hers, "call.incoming")
        ended = _next(hers, "call.ended")
        assert ended["reason"] == "missed" and ended["by"] is None
        missed = _next(hers, "message.new")["message"]
        assert missed["call_kind"] == "audio" and missed["call_ms"] is None
        _next(mine, "call.ended")


def test_declining(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with (
        client.websocket_connect(f"/ws?token={me.token}") as mine,
        client.websocket_connect(f"/ws?token={her.token}") as hers,
    ):
        mine.send_json({"type": "call.invite", "match_id": match_id})
        call_id = _next(hers, "call.incoming")["call_id"]
        hers.send_json({"type": "call.end", "call_id": call_id, "reason": "declined"})
        ended = _next(mine, "call.ended")
        assert ended["reason"] == "declined" and ended["by"] == her.id


def test_cannot_call_someone_offline_busy_or_not_a_match(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    other = make_user(name="Lena")
    other_match = like_each_other(client, me, other)
    with client.websocket_connect(f"/ws?token={me.token}") as mine:
        mine.receive_json()
        mine.send_json({"type": "call.invite", "match_id": match_id})
        failed = _next(mine, "call.failed")
        assert failed["reason"] == "unavailable" and "online" in failed["detail"]

        stranger_match = 999_999
        mine.send_json({"type": "call.invite", "match_id": stranger_match})
        assert _next(mine, "call.failed")["reason"] == "gone"

        with (
            client.websocket_connect(f"/ws?token={her.token}") as hers,
            client.websocket_connect(f"/ws?token={other.token}") as lenas,
        ):
            mine.send_json({"type": "call.invite", "match_id": match_id})
            call_id = _next(mine, "call.ringing")["call_id"]
            _next(hers, "call.incoming")
            # Lena can't butt in on someone else's call...
            lenas.send_json({"type": "call.accept", "call_id": call_id})
            assert _next(lenas, "call.failed")["reason"] == "gone"
            # ...and Sam can't start a second one.
            mine.send_json({"type": "call.invite", "match_id": other_match})
            assert _next(mine, "call.failed")["reason"] == "busy"
            # Signals have a size limit.
            mine.send_json(
                {"type": "call.signal", "call_id": call_id, "data": {"sdp": "x" * 40_000}}
            )
            assert _next(mine, "error")["detail"]


def test_hanging_up_by_leaving(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with client.websocket_connect(f"/ws?token={her.token}") as hers:
        with client.websocket_connect(f"/ws?token={me.token}") as mine:
            mine.send_json({"type": "call.invite", "match_id": match_id})
            call_id = _next(hers, "call.incoming")["call_id"]
            hers.send_json({"type": "call.accept", "call_id": call_id})
            _next(mine, "call.accepted")
        # Sam's tab closed: the call ends for Priya too.
        assert _next(hers, "call.ended")["call_id"] == call_id


def test_call_records_stay(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    with (
        client.websocket_connect(f"/ws?token={me.token}") as mine,
        client.websocket_connect(f"/ws?token={her.token}") as hers,
    ):
        mine.send_json({"type": "call.invite", "match_id": match_id})
        call_id = _next(hers, "call.incoming")["call_id"]
        mine.send_json({"type": "call.end", "call_id": call_id, "reason": "cancelled"})
        record = _next(mine, "message.new")["message"]
    unsend = client.delete(f"/api/matches/{match_id}/messages/{record['id']}", headers=me.headers)
    assert unsend.status_code == 403
    config = client.get(f"/api/matches/{match_id}/call-config", headers=me.headers).json()
    assert config["ice_servers"][0]["urls"][0].startswith("stun:")
