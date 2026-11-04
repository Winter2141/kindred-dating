from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.quiet import in_window, is_quiet
from app.services import digest
from tests.conftest import like_each_other
from tests.test_digest import _digests, _pair


def test_windows_can_wrap_past_midnight() -> None:
    assert in_window(23, 22, 8) and in_window(0, 22, 8) and in_window(7, 22, 8)
    assert not in_window(8, 22, 8) and not in_window(21, 22, 8)
    assert in_window(13, 12, 14) and not in_window(14, 12, 14)
    assert not in_window(5, 5, 5)


def test_quiet_is_measured_in_their_own_time_zone() -> None:
    quiet = {"start": 22, "end": 8, "timezone": "America/New_York"}
    four_am_utc = datetime(2026, 11, 4, 4, 0, tzinfo=UTC)  # 11 pm in New York
    three_pm_utc = datetime(2026, 11, 4, 15, 0, tzinfo=UTC)  # 10 am in New York
    assert is_quiet(quiet, four_am_utc)
    assert not is_quiet(quiet, three_pm_utc)
    assert not is_quiet(None, four_am_utc)
    # A broken saved value never holds mail back.
    assert not is_quiet({"start": 22, "end": 8, "timezone": "Nowhere/Special"}, four_am_utc)
    assert not is_quiet({"start": 22}, four_am_utc)


def test_setting_and_clearing_quiet_hours(client: TestClient, make_user) -> None:
    me = make_user()
    assert client.get("/api/me", headers=me.headers).json()["quiet_hours"] is None
    quiet = {"start": 23, "end": 7, "timezone": "Europe/Lisbon"}
    saved = client.put("/api/me/quiet-hours", json=quiet, headers=me.headers)
    assert saved.status_code == 200 and saved.json()["quiet_hours"] == quiet
    assert client.get("/api/me", headers=me.headers).json()["quiet_hours"] == quiet

    cleared = client.delete("/api/me/quiet-hours", headers=me.headers)
    assert cleared.json()["quiet_hours"] is None


def test_what_quiet_hours_accept(client: TestClient, make_user) -> None:
    me = make_user()
    for bad in (
        {"start": 22, "end": 22, "timezone": "UTC"},
        {"start": 24, "end": 8, "timezone": "UTC"},
        {"start": -1, "end": 8, "timezone": "UTC"},
        {"start": 22, "end": 8, "timezone": "Mars/Olympus_Mons"},
    ):
        response = client.put("/api/me/quiet-hours", json=bad, headers=me.headers)
        assert response.status_code == 422, bad


def test_digests_wait_until_quiet_hours_end(client: TestClient, make_user) -> None:
    me, her = _pair(client, make_user)
    like_each_other(client, me, her)
    later = utcnow() + timedelta(minutes=20)
    # Priya's quiet hours cover the next two hours, in UTC to keep the sums simple.
    quiet = {"start": later.hour, "end": (later.hour + 2) % 24, "timezone": "UTC"}
    client.put("/api/me/quiet-hours", json=quiet, headers=her.headers)

    hub = client.app.state.hub
    assert client.portal.call(digest.send_due_digests, hub, later) == 1  # only Sam's
    assert _digests(client, her.email) == []
    after = later + timedelta(hours=2, minutes=5)
    assert client.portal.call(digest.send_due_digests, hub, after) == 1
    (email,) = _digests(client, her.email)
    assert "Sam" in email["body"]
