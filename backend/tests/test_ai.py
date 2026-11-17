import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai import AIUnavailable, OpenAIWriter, make_writer, safety_id
from app.config import Settings
from app.services.assistant import clean_ideas
from tests.conftest import like_each_other
from tests.test_admin import _make_admin, _report


class FakeWriter:
    """Stands in for OpenAI: records each request and answers from a queue."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    async def write_json(self, **request: Any) -> dict[str, Any]:
        self.calls.append(request)
        answer = self.answers.pop(0) if self.answers else {"ideas": []}
        if isinstance(answer, Exception):
            raise answer
        return answer


def _use(client: TestClient, writer: FakeWriter | None) -> FakeWriter | None:
    client.app.state.hub.ai = writer
    return writer


def _pair(client: TestClient, make_user):
    me = make_user(
        gender="man",
        interested_in=["woman"],
        name="Sam",
        job_title="Architect",
        interests=["Cycling", "Coffee", "Museums"],
    )
    her = make_user(name="Priya", interests=["Coffee", "Yoga"], job_title="Data scientist")
    return me, her, like_each_other(client, me, her)


def _send(client: TestClient, account, match_id: int, body: str) -> int:
    response = client.post(
        f"/api/matches/{match_id}/messages", json={"body": body}, headers=account.headers
    )
    return response.json()["id"]


# --- Without a key -----------------------------------------------------------------------


def test_no_key_means_no_model(settings: Settings) -> None:
    assert make_writer(settings) is None
    assert make_writer(settings.model_copy(update={"openai_api_key": "sk-test"})) is not None


def test_meta_says_whether_ai_is_on(client: TestClient) -> None:
    assert client.get("/api/meta").json()["ai_enabled"] is False
    _use(client, FakeWriter())
    assert client.get("/api/meta").json()["ai_enabled"] is True


def test_bio_ideas_without_a_key_come_from_the_profile(client: TestClient, make_user) -> None:
    me = make_user(job_title="Pastry chef", city="Brooklyn, NY", interests=["Baking", "Vinyl"])
    for tone in ("warm", "funny", "direct"):
        body = client.post("/api/ai/bio", json={"tone": tone}, headers=me.headers).json()
        assert body["source"] == "basic" and len(body["ideas"]) == 3
        assert all(len(idea) <= 500 for idea in body["ideas"])
    assert any("Pastry chef" in idea for idea in body["ideas"])
    assert client.post("/api/ai/bio", json={"tone": "spicy"}, headers=me.headers).status_code == 422


def test_message_ideas_without_a_key(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    openers = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=me.headers).json()
    assert openers["source"] == "basic" and len(openers["ideas"]) == 3
    assert "coffee" in openers["ideas"][0].lower()  # their shared interest

    _send(client, her, match_id, "What's the best museum you've been to?")
    replies = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=me.headers).json()
    assert replies["source"] == "basic" and len(replies["ideas"]) == 3
    # The same conversation gets the same suggestions each time.
    again = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=me.headers).json()
    assert again == replies


def test_report_summaries_need_a_key(client: TestClient, make_user) -> None:
    admin, reporter, reported = make_user(), make_user(), make_user()
    _make_admin(client, admin)
    report_id = _report(client, reporter, reported, "harassment")
    response = client.post(f"/api/admin/reports/{report_id}/ai-summary", headers=admin.headers)
    assert response.status_code == 503


# --- With a model ------------------------------------------------------------------------


def test_bio_ideas_from_the_model(client: TestClient, make_user) -> None:
    writer = _use(
        client,
        FakeWriter(
            {
                "ideas": [
                    '  "Architect who cycles."  ',
                    "architect who cycles.",
                    "Coffee first.",
                    "",
                    7,
                ]
            }
        ),
    )
    me = make_user(name="Sam", job_title="Architect", interests=["Cycling"], bio="old bio")
    body = client.post(
        "/api/ai/bio", json={"draft": "I like bikes", "tone": "funny"}, headers=me.headers
    ).json()
    assert body == {"ideas": ["Architect who cycles.", "Coffee first."], "source": "ai"}

    (call,) = writer.calls
    assert call["name"] == "bio_ideas" and call["user_id"] == me.id
    assert "Sam, 28" in call["prompt"] and "Cycling" in call["prompt"]
    assert "I like bikes" in call["prompt"] and "playful" in call["prompt"]
    assert me.email not in call["prompt"]  # only what other members can see
    assert call["schema"]["required"] == ["ideas"]


def test_a_failing_or_useless_model_falls_back(client: TestClient, make_user) -> None:
    me = make_user()
    _use(client, FakeWriter(AIUnavailable("timeout"), {"ideas": []}, {"nonsense": True}))
    for _ in range(3):
        body = client.post("/api/ai/bio", json={}, headers=me.headers).json()
        assert body["source"] == "basic" and len(body["ideas"]) == 3


def test_openers_from_the_model(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    writer = _use(client, FakeWriter({"ideas": ["Which museum first?", "Coffee this week?"]}))
    body = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=me.headers).json()
    assert body == {"ideas": ["Which museum first?", "Coffee this week?"], "source": "ai"}
    prompt = writer.calls[0]["prompt"]
    assert "Sam's profile" in prompt and "Priya's profile" in prompt
    assert "haven't talked yet" in prompt and "Data scientist" in prompt


def test_replies_follow_the_conversation(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    _send(client, me, match_id, "Hey Priya!")
    unsent = _send(client, her, match_id, "Something I regret")
    client.delete(f"/api/matches/{match_id}/messages/{unsent}", headers=her.headers)
    _send(client, her, match_id, "Hi! Best coffee in town?")

    writer = _use(client, FakeWriter({"ideas": ["Sey, no contest. You?"]}))
    body = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=me.headers).json()
    assert body["ideas"] == ["Sey, no contest. You?"]
    prompt = writer.calls[0]["prompt"]
    assert "Sam: Hey Priya!" in prompt and "Priya: Hi! Best coffee in town?" in prompt
    assert "regret" not in prompt  # unsent messages stay unsent


def test_only_people_in_the_chat_get_ideas(client: TestClient, make_user) -> None:
    _, _, match_id = _pair(client, make_user)
    stranger = make_user()
    response = client.post(f"/api/matches/{match_id}/ai/message-ideas", headers=stranger.headers)
    assert response.status_code == 404


def test_report_summary_from_the_model(client: TestClient, make_user) -> None:
    admin = make_user()
    _make_admin(client, admin)
    me, her, match_id = _pair(client, make_user)
    _send(client, me, match_id, "Answer me already")
    report_id = _report(client, her, me, "harassment")

    answer = {
        "summary": "Sam kept messaging after no reply.",
        "concerns": ["Pushy tone", " ", "x" * 300],
        "suggested_action": "warn",
    }
    writer = _use(client, FakeWriter(answer))
    member = client.post(f"/api/admin/reports/{report_id}/ai-summary", headers=her.headers)
    assert member.status_code == 403
    body = client.post(f"/api/admin/reports/{report_id}/ai-summary", headers=admin.headers).json()
    assert body["summary"] == "Sam kept messaging after no reply."
    assert body["suggested_action"] == "warn"
    assert body["concerns"] == ["Pushy tone", "x" * 200]
    (call,) = writer.calls
    assert "Report reason: harassment" in call["prompt"]
    assert "Sam: Answer me already" in call["prompt"]
    assert call["user_id"] == admin.id

    _use(client, FakeWriter({"summary": "", "concerns": [], "suggested_action": "maybe"}))
    bad = client.post(f"/api/admin/reports/{report_id}/ai-summary", headers=admin.headers)
    assert bad.status_code == 503
    missing = client.post("/api/admin/reports/999/ai-summary", headers=admin.headers)
    assert missing.status_code == 404


# --- Pieces ------------------------------------------------------------------------------


def test_cleaning_model_output() -> None:
    assert clean_ideas({"ideas": ["a", "A", "b", "c", "d"]}) == ["a", "b", "c"]
    assert clean_ideas({"ideas": ["x" * 400]}, limit=10) == ["x" * 9 + "…"]
    assert clean_ideas("not a dict") == []
    assert clean_ideas({"ideas": "a string"}) == []


async def test_the_openai_writer_asks_for_strict_json_and_no_storage(settings: Settings) -> None:
    writer = OpenAIWriter(settings.model_copy(update={"openai_api_key": "sk-test"}))
    sent: dict[str, Any] = {}

    async def create(**kwargs: Any) -> SimpleNamespace:
        sent.update(kwargs)
        return SimpleNamespace(output_text=json.dumps({"ideas": ["hi"]}))

    writer._client = SimpleNamespace(responses=SimpleNamespace(create=create))  # type: ignore[assignment]
    schema = {"type": "object"}
    result = await writer.write_json(
        instructions="be kind", prompt="hello", schema=schema, name="test", user_id=7
    )
    assert result == {"ideas": ["hi"]}
    assert sent["store"] is False
    assert sent["model"] == settings.openai_model
    assert sent["text"]["format"] == {
        "type": "json_schema",
        "name": "test",
        "schema": schema,
        "strict": True,
    }
    assert sent["safety_identifier"] == safety_id(7, settings.secret_key)
    assert sent["safety_identifier"] != "7"


async def test_the_openai_writer_turns_errors_into_unavailable(settings: Settings) -> None:
    writer = OpenAIWriter(settings.model_copy(update={"openai_api_key": "sk-test"}))

    async def garbage(**_: Any) -> SimpleNamespace:
        return SimpleNamespace(output_text="not json")

    writer._client = SimpleNamespace(responses=SimpleNamespace(create=garbage))  # type: ignore[assignment]
    with pytest.raises(AIUnavailable):
        await writer.write_json(instructions="", prompt="", schema={}, name="x", user_id=1)


def test_a_report_keeps_the_conversation_a_block_deletes(client: TestClient, make_user) -> None:
    me, her, match_id = _pair(client, make_user)
    _send(client, me, match_id, "Why won't you answer")
    unsent = _send(client, me, match_id, "Something I took back")
    client.delete(f"/api/matches/{match_id}/messages/{unsent}", headers=me.headers)
    _send(client, her, match_id, "Please stop")
    _report(client, her, me, "harassment")  # blocks, which deletes the chat

    async def evidence() -> list[dict]:
        from app.models import Report

        async with client.app.state.hub.db.session() as session:
            return (await session.get(Report, 1)).evidence

    saved = client.portal.call(evidence)
    assert [(line["from"], line["text"]) for line in saved] == [
        ("reported", "Why won't you answer"),
        ("reporter", "Please stop"),
    ]
    assert client.get(f"/api/matches/{match_id}/messages", headers=her.headers).status_code == 404
