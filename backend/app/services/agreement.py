"""How well two people's answers to the compatibility questions fit together.

Each answer records what you'd pick, which answers you'd accept from someone else, and how
much the question matters to you. For each person we ask: of the weight they put on the
questions both answered, how much does the other person satisfy? The overall agreement
is the geometric mean of the two, so it's only high when it's high both ways.
"""

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import QuestionAnswer
from app.questions import BY_ID, IMPORTANCE_WEIGHTS, MIN_COMMON_QUESTIONS


@dataclass(frozen=True)
class Answer:
    answer: int
    acceptable: tuple[int, ...]
    importance: int


@dataclass(frozen=True)
class Agreement:
    percent: int | None
    common: int
    # Questions where both picked the same answer, in catalog order.
    same_answers: list[str]


def _satisfaction(
    judge: Mapping[str, Answer], other: Mapping[str, Answer], ids: list[str]
) -> float:
    total = sum(IMPORTANCE_WEIGHTS[judge[q].importance] for q in ids)
    met = sum(
        IMPORTANCE_WEIGHTS[judge[q].importance]
        for q in ids
        if other[q].answer in judge[q].acceptable
    )
    return met / total if total else 0.0


def agreement(mine: Mapping[str, Answer], theirs: Mapping[str, Answer]) -> Agreement:
    common = [q for q in BY_ID if q in mine and q in theirs]
    same = [q for q in common if mine[q].answer == theirs[q].answer]
    if len(common) < MIN_COMMON_QUESTIONS:
        return Agreement(percent=None, common=len(common), same_answers=same)
    score = math.sqrt(_satisfaction(mine, theirs, common) * _satisfaction(theirs, mine, common))
    return Agreement(percent=round(score * 100), common=len(common), same_answers=same)


def _to_answer(row: QuestionAnswer) -> Answer:
    return Answer(answer=row.answer, acceptable=tuple(row.acceptable), importance=row.importance)


async def answers_for(
    session: AsyncSession, user_ids: Iterable[int]
) -> dict[int, dict[str, Answer]]:
    """Everyone's answers in one query, keyed by user and then question."""
    ids = list(set(user_ids))
    result: dict[int, dict[str, Answer]] = {uid: {} for uid in ids}
    if not ids:
        return result
    rows = await session.scalars(select(QuestionAnswer).where(QuestionAnswer.user_id.in_(ids)))
    for row in rows:
        if row.question_id in BY_ID:  # ignore answers to retired questions
            result[row.user_id][row.question_id] = _to_answer(row)
    return result
