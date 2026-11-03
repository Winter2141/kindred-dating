"""Compatibility questions: answer them, and see how your answers line up with someone's."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, select

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.models import QuestionAnswer, User
from app.questions import BY_ID, IMPORTANCE_LABELS, MIN_COMMON_QUESTIONS, QUESTIONS
from app.schemas import (
    AgreementOut,
    AnswerIn,
    AnswerOut,
    QuestionOut,
    QuestionsOut,
    SharedAnswer,
)
from app.services.agreement import agreement, answers_for
from app.services.safety import is_hidden

router = APIRouter(prefix="/api", tags=["questions"])


def _question_or_404(question_id: str):
    question = BY_ID.get(question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such question")
    return question


@router.get("/questions")
async def list_questions(user: CurrentUser, session: SessionDep) -> QuestionsOut:
    """Every question, grouped by topic in catalog order, with your answers so far."""
    mine = (await answers_for(session, [user.id]))[user.id]
    return QuestionsOut(
        questions=[
            QuestionOut(id=q.id, text=q.text, options=list(q.options), topic=q.topic)
            for q in QUESTIONS
        ],
        importance_labels=list(IMPORTANCE_LABELS),
        min_common=MIN_COMMON_QUESTIONS,
        answers={
            qid: AnswerOut(answer=a.answer, acceptable=list(a.acceptable), importance=a.importance)
            for qid, a in mine.items()
        },
    )


@router.put("/questions/{question_id}")
async def answer_question(
    question_id: str, data: AnswerIn, user: CurrentUser, session: SessionDep
) -> AnswerOut:
    """Answer (or change your answer to) a question.

    `acceptable` lists the answers you'd be happy for a match to give; leave it out to
    accept anything.
    """
    question = _question_or_404(question_id)
    count = len(question.options)
    acceptable = sorted(set(data.acceptable)) if data.acceptable else list(range(count))
    if not 0 <= data.answer < count or any(not 0 <= i < count for i in acceptable):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Answers are numbered 0 to {count - 1}"
        )

    row = await session.scalar(
        select(QuestionAnswer).where(
            QuestionAnswer.user_id == user.id, QuestionAnswer.question_id == question_id
        )
    )
    if row is None:
        row = QuestionAnswer(user_id=user.id, question_id=question_id)
        session.add(row)
    row.answer = data.answer
    row.acceptable = acceptable
    row.importance = data.importance
    row.updated_at = utcnow()
    await session.commit()
    return AnswerOut(answer=row.answer, acceptable=row.acceptable, importance=row.importance)


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def skip_question(question_id: str, user: CurrentUser, session: SessionDep) -> Response:
    """Take back an answer."""
    _question_or_404(question_id)
    await session.execute(
        delete(QuestionAnswer).where(
            QuestionAnswer.user_id == user.id, QuestionAnswer.question_id == question_id
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/{user_id}/agreement")
async def read_agreement(user_id: int, user: CurrentUser, session: SessionDep) -> AgreementOut:
    """How your answers fit with someone's, and the questions you answered the same way."""
    other = await session.get(User, user_id)
    if other is None or other.id == user.id or await is_hidden(session, user.id, other.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    answers = await answers_for(session, [user.id, other.id])
    fit = agreement(answers[user.id], answers[other.id])
    return AgreementOut(
        percent=fit.percent,
        common=fit.common,
        same=[
            SharedAnswer(
                question=BY_ID[qid].text,
                answer=BY_ID[qid].options[answers[user.id][qid].answer],
            )
            for qid in fit.same_answers
        ],
    )
