from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.services.insights import Insights, _count_messages
from tests.conftest import like_each_other

T0 = datetime(2026, 11, 1, 18, 0, tzinfo=UTC)


def _msg(match_id: int, sender_id: int, minutes: int) -> SimpleNamespace:
    return SimpleNamespace(
        match_id=match_id, sender_id=sender_id, created_at=T0 + timedelta(minutes=minutes)
    )


def test_reply_rate_and_median_reply_time() -> None:
    result = Insights(days=14)
    messages = [
        # Chat 1: they write twice, I answer after 10 minutes, they write again, I answer after 30.
        _msg(1, 2, 0),
        _msg(1, 2, 1),
        _msg(1, 1, 10),
        _msg(1, 2, 40),
        _msg(1, 1, 70),
        # Chat 2: they write and I never answer.
        _msg(2, 3, 5),
        # Chat 3: I start; nothing to answer.
        _msg(3, 1, 8),
    ]
    _count_messages(result, 1, messages, lambda when, attribute: None)
    assert (result.messages_sent, result.messages_received) == (3, 4)
    assert result.reply_rate == 0.67  # 2 of 3 waits answered
    assert result.median_reply_minutes == 20  # median of 10 and 30


def test_no_conversations_means_no_rates() -> None:
    result = Insights(days=7)
    _count_messages(result, 1, [], lambda when, attribute: None)
    assert result.reply_rate is None and result.median_reply_minutes is None


def test_insights_endpoint(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user(interests=["Coffee", "Hiking"])
    fan = make_user(interests=["Coffee", "Books"])
    other = make_user()
    match_id = like_each_other(client, me, her)
    client.post("/api/swipes", json={"target_id": other.id, "action": "pass"}, headers=me.headers)
    client.post("/api/swipes", json={"target_id": me.id, "action": "super"}, headers=fan.headers)
    client.post(f"/api/matches/{match_id}/messages", json={"body": "hey!"}, headers=her.headers)
    client.post(f"/api/matches/{match_id}/messages", json={"body": "hi :)"}, headers=me.headers)

    body = client.get("/api/me/insights", params={"days": 7}, headers=me.headers).json()
    assert body["days"] == 7
    assert (body["likes_sent"], body["passes_sent"]) == (1, 1)
    assert (body["likes_received"], body["super_likes_received"]) == (2, 1)
    assert (body["matches"], body["match_rate"]) == (1, 1.0)
    assert (body["messages_sent"], body["messages_received"]) == (1, 1)
    assert body["reply_rate"] == 1.0 and body["median_reply_minutes"] == 0
    assert body["liked_by_interests"][0] == {"interest": "Coffee", "count": 2}
    assert len(body["activity"]) == 7
    today = body["activity"][-1]
    assert (today["likes_received"], today["matches"], today["messages"]) == (2, 1, 2)

    assert client.get("/api/me/insights", params={"days": 3}, headers=me.headers).status_code == 422
