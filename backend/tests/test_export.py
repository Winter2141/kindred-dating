import json

from fastapi.testclient import TestClient

from tests.conftest import like_each_other


def test_export_has_everything_about_me(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"], name="Sam", bio="Loves maps")
    her = make_user(name="Priya")
    other = make_user(name="Lena")
    match_id = like_each_other(client, me, her)
    client.post("/api/swipes", json={"target_id": other.id, "action": "pass"}, headers=me.headers)
    hello = client.post(
        f"/api/matches/{match_id}/messages", json={"body": "Hi Priya!"}, headers=me.headers
    ).json()
    client.post(f"/api/matches/{match_id}/messages", json={"body": "Hey!"}, headers=her.headers)
    client.put(
        f"/api/matches/{match_id}/messages/{hello['id']}/reaction",
        json={"emoji": "❤️"},
        headers=her.headers,
    )
    client.put("/api/questions/kids", json={"answer": 0, "acceptable": [0, 2]}, headers=me.headers)
    client.patch(f"/api/matches/{match_id}/settings", json={"pinned": True}, headers=me.headers)

    response = client.get("/api/me/export", headers=me.headers)
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="kindred-export-'
    )
    data = json.loads(response.content)

    assert data["format"] == "kindred-export" and data["version"] == 1
    assert data["account"]["email"] == me.email
    assert data["profile"]["name"] == "Sam" and data["profile"]["bio"] == "Loves maps"
    assert data["question_answers"] == [
        {
            "question": "Do you want children someday?",
            "answer": "Yes",
            "would_accept": ["Yes", "Not sure yet"],
            "importance": 1,
        }
    ]
    assert {(s["on"], s["action"]) for s in data["swipes"]} == {("Priya", "like"), ("Lena", "pass")}

    (conversation,) = data["conversations"]
    assert conversation["with"] == "Priya" and conversation["pinned"] is True
    assert [(m["from"], m["text"]) for m in conversation["messages"]] == [
        ("me", "Hi Priya!"),
        ("them", "Hey!"),
    ]
    assert conversation["messages"][0]["reactions"] == [{"from": "them", "emoji": "❤️"}]


def test_export_leaves_out_secrets_and_other_peoples_details(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    like_each_other(client, me, her)
    raw = client.get("/api/me/export", headers=me.headers).text
    for secret in ("password", "token_version", "totp_secret", "recovery_codes", her.email):
        assert secret not in raw


def test_export_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/me/export").status_code == 401
