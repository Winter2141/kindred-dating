from fastapi.testclient import TestClient

from app.questions import QUESTIONS
from app.services.agreement import Answer, agreement


def _answer(client: TestClient, account, question_id: str, **body):
    return client.put(f"/api/questions/{question_id}", json=body, headers=account.headers)


def test_the_catalog_and_my_answers(client: TestClient, make_user) -> None:
    me = make_user()
    empty = client.get("/api/questions", headers=me.headers).json()
    assert len(empty["questions"]) == len(QUESTIONS)
    assert empty["answers"] == {}
    assert empty["importance_labels"] == ["A little", "Somewhat", "Very"]

    saved = _answer(client, me, "kids", answer=0, acceptable=[0, 2], importance=2)
    assert saved.json() == {"answer": 0, "acceptable": [0, 2], "importance": 2}
    anything = _answer(client, me, "pets", answer=1).json()
    assert anything["acceptable"] == [0, 1, 2] and anything["importance"] == 1

    mine = client.get("/api/questions", headers=me.headers).json()["answers"]
    assert set(mine) == {"kids", "pets"}

    changed = _answer(client, me, "kids", answer=2, acceptable=[2], importance=0).json()
    assert changed["answer"] == 2
    assert client.delete("/api/questions/pets", headers=me.headers).status_code == 204
    assert set(client.get("/api/questions", headers=me.headers).json()["answers"]) == {"kids"}


def test_answers_are_validated(client: TestClient, make_user) -> None:
    me = make_user()
    assert _answer(client, me, "nope", answer=0).status_code == 404
    assert _answer(client, me, "kids", answer=3).status_code == 422
    assert _answer(client, me, "kids", answer=0, acceptable=[5]).status_code == 422
    assert _answer(client, me, "kids", answer=0, importance=3).status_code == 422


def _a(answer: int, acceptable: tuple[int, ...], importance: int = 1) -> Answer:
    return Answer(answer=answer, acceptable=acceptable, importance=importance)


def test_agreement_needs_enough_common_questions() -> None:
    mine = {"kids": _a(0, (0,)), "pets": _a(0, (0,))}
    fit = agreement(mine, dict(mine))
    assert fit.percent is None and fit.common == 2


def test_agreement_is_high_only_when_it_works_both_ways() -> None:
    mine = {q: _a(0, (0,)) for q in ("kids", "pets", "tidy")}
    same = {q: _a(0, (0,)) for q in ("kids", "pets", "tidy")}
    assert agreement(mine, same).percent == 100
    assert agreement(mine, same).same_answers == ["kids", "pets", "tidy"]

    # They accept anything, but none of their answers suit me: low both ways round.
    easygoing = {q: _a(1, (0, 1, 2)) for q in ("kids", "pets", "tidy")}
    assert agreement(mine, easygoing).percent == 0
    assert agreement(easygoing, mine).percent == 0


def test_important_questions_weigh_more() -> None:
    mine = {
        "kids": _a(0, (0,), importance=2),
        "pets": _a(0, (0,), importance=0),
        "tidy": _a(0, (0,), importance=0),
    }
    agrees_on_kids = {"kids": _a(0, (0, 1, 2)), "pets": _a(2, (0, 1, 2)), "tidy": _a(2, (0, 1, 2))}
    agrees_on_rest = {"kids": _a(2, (0, 1, 2)), "pets": _a(0, (0, 1, 2)), "tidy": _a(0, (0, 1, 2))}
    assert agreement(mine, agrees_on_kids).percent > 90
    assert agreement(mine, agrees_on_rest).percent < 25


def test_agreement_with_someone(client: TestClient, make_user) -> None:
    me = make_user(gender="man", interested_in=["woman"])
    her = make_user()
    for question in ("kids", "pets", "tidy", "morning"):
        _answer(client, me, question, answer=0, acceptable=[0, 1])
        _answer(client, her, question, answer=0 if question != "morning" else 1)

    fit = client.get(f"/api/users/{her.id}/agreement", headers=me.headers).json()
    assert fit["percent"] == 100 and fit["common"] == 4
    assert [s["question"] for s in fit["same"]][:1] == ["Do you want children someday?"]
    assert len(fit["same"]) == 3

    deck = client.get("/api/discover", headers=me.headers).json()
    assert deck[0]["id"] == her.id and deck[0]["agreement"] == 100

    assert client.get(f"/api/users/{me.id}/agreement", headers=me.headers).status_code == 404
    assert client.get("/api/users/99999/agreement", headers=me.headers).status_code == 404
