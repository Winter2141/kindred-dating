import re

import pytest
from fastapi.testclient import TestClient

from app import kindness
from tests.conftest import like_each_other
from tests.test_admin import _make_admin, _report


@pytest.mark.parametrize(
    ("text", "phrases"),
    [
        ("You're so ugly", ["you're so ugly"]),
        ("ur pathetic lol", ["ur pathetic"]),
        ("your stupid", ["your stupid"]),
        ("u r a joke", ["u r a joke"]),
        ("you are really gross", ["you are really gross"]),
        ("shuuut  up", ["shuuut  up"]),
        ("what an id1ot", ["idiot"]),
        ("L0SER", ["loser"]),
        ("kys", ["kys"]),
        ("honestly no one would date you", ["no one would date you"]),
        ("idiot. you're such a creep", ["idiot", "you're such a creep"]),
    ],
)
def test_insults_are_spotted(text: str, phrases: list[str]) -> None:
    assert kindness.unkind_phrases(text) == phrases


@pytest.mark.parametrize(
    "text",
    [
        "",
        "Hi! How was the hike?",
        "I'm so dumb, I forgot my keys",
        "We could go to the ugly sweater party",
        "The fat cat cafe on 5th?",
        "Did you fatten up on pasta in Rome?",
        "Shutters up already?",
        "Up for a dog walk?",
        "Let's not go diet shopping",
        "You're so funny",
    ],
)
def test_ordinary_messages_are_left_alone(text: str) -> None:
    assert kindness.unkind_phrases(text) == []


def test_some_words_count_wherever_they_are() -> None:
    # A blunt list: "loser" is flagged even about yourself. It's only a nudge.
    assert kindness.is_unkind("total loser move by me")


def test_patterns_use_only_syntax_javascript_shares() -> None:
    for source in kindness.patterns():
        re.compile(source)
        # Lookbehinds, named groups and inline flags differ between the two engines.
        assert "(?<" not in source
        assert "(?P" not in source
        assert "(?i" not in source


def _chat(client: TestClient, make_user):
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    return me, her, like_each_other(client, me, her)


def test_unkind_messages_are_flagged_for_moderators(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    admin = make_user()
    _make_admin(client, admin)
    for text in ("hey there", "you're so ugly", "loser"):
        response = client.post(
            f"/api/matches/{match_id}/messages", json={"body": text}, headers=me.headers
        )
        assert response.status_code == 201
        assert "flagged" not in response.json()  # never shown to either person

    _report(client, her, me, reason="harassment")
    (report,) = client.get("/api/admin/reports", headers=admin.headers).json()
    # Reporting blocked them and deleted the chat, but the count stays on the account.
    assert report["reported"]["unkind_messages"] == 2


def test_editing_an_insult_in_counts_too(client: TestClient, make_user) -> None:
    me, her, match_id = _chat(client, make_user)
    admin = make_user()
    _make_admin(client, admin)
    sent = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "you're fun"}, headers=me.headers
    ).json()
    for body in ("you're dumb", "you're so dumb"):  # once: it was already unkind
        client.patch(
            f"/api/matches/{match_id}/messages/{sent['id']}",
            json={"body": body},
            headers=me.headers,
        )
    _report(client, her, me)
    (report,) = client.get("/api/admin/reports", headers=admin.headers).json()
    assert report["reported"]["unkind_messages"] == 1


def test_the_app_gets_the_patterns(client: TestClient) -> None:
    meta = client.get("/api/meta").json()
    assert meta["unkind_patterns"] == kindness.patterns()
