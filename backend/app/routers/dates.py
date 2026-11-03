from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import DateProposal, DateStatus, Match
from app.schemas import DateIn, DateOut, DateResponseIn, UpcomingDate
from app.services import chat, dates

router = APIRouter(prefix="/api", tags=["dates"])


async def _match(session: SessionDep, match_id: int, user_id: int) -> Match:
    match = await chat.get_match(session, match_id, user_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found")
    return match


async def _proposal(session: SessionDep, match: Match, date_id: int) -> DateProposal:
    proposal = await session.get(DateProposal, date_id)
    if proposal is None or proposal.match_id != match.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Date not found")
    return proposal


def _http(error: dates.DateError) -> HTTPException:
    return HTTPException(error.status, str(error))


@router.get("/matches/{match_id}/dates")
async def list_dates(match_id: int, user: CurrentUser, session: SessionDep) -> list[DateOut]:
    await _match(session, match_id, user.id)
    rows = await session.scalars(
        select(DateProposal).where(DateProposal.match_id == match_id).order_by(DateProposal.id)
    )
    return [DateOut.model_validate(p) for p in rows]


@router.get("/matches/{match_id}/date-ideas")
async def ideas(match_id: int, user: CurrentUser, session: SessionDep) -> list[str]:
    match = await _match(session, match_id, user.id)
    return dates.date_ideas(user, match.other_user(user.id))


@router.post("/matches/{match_id}/dates", status_code=status.HTTP_201_CREATED)
async def propose_date(
    match_id: int, data: DateIn, user: CurrentUser, session: SessionDep, hub: HubDep
) -> DateOut:
    match = await _match(session, match_id, user.id)
    try:
        proposal = await dates.propose(
            session, hub, match, user.id, data.place, data.starts_at, data.note
        )
    except dates.DateError as error:
        raise _http(error) from None
    return DateOut.model_validate(proposal)


@router.post("/matches/{match_id}/dates/{date_id}/respond")
async def respond_to_date(
    match_id: int,
    date_id: int,
    data: DateResponseIn,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
) -> DateOut:
    match = await _match(session, match_id, user.id)
    proposal = await _proposal(session, match, date_id)
    try:
        proposal = await dates.respond(
            session, hub, match, proposal, user.id, data.response == "accept"
        )
    except dates.DateError as error:
        raise _http(error) from None
    return DateOut.model_validate(proposal)


@router.post("/matches/{match_id}/dates/{date_id}/cancel")
async def cancel_date(
    match_id: int, date_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> DateOut:
    match = await _match(session, match_id, user.id)
    proposal = await _proposal(session, match, date_id)
    try:
        proposal = await dates.cancel(session, hub, match, proposal, user.id)
    except dates.DateError as error:
        raise _http(error) from None
    return DateOut.model_validate(proposal)


@router.get("/dates/upcoming")
async def upcoming(user: CurrentUser, session: SessionDep) -> list[UpcomingDate]:
    """Accepted dates that haven't happened yet, soonest first."""
    rows = await session.execute(
        select(DateProposal, Match)
        .join(Match, Match.id == DateProposal.match_id)
        .where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
            DateProposal.status == DateStatus.ACCEPTED,
            DateProposal.starts_at >= datetime.now(UTC),
        )
        .order_by(DateProposal.starts_at)
    )
    return [
        UpcomingDate.build(proposal, match.other_user(user.id)) for proposal, match in rows.unique()
    ]
