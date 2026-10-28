from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import Match, Message
from app.schemas import MatchOut, MessageIn, MessageOut
from app.services import chat
from app.services.personas import icebreakers

router = APIRouter(prefix="/api/matches", tags=["matches"])


async def _match_or_404(session: SessionDep, match_id: int, user_id: int) -> Match:
    match = await chat.get_match(session, match_id, user_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found")
    return match


@router.get("")
async def list_matches(user: CurrentUser, session: SessionDep, hub: HubDep) -> list[MatchOut]:
    summaries = await chat.list_matches(session, user.id)
    return [
        MatchOut.build(
            s.match,
            user.id,
            online=hub.manager.is_online(s.match.other_id(user.id)),
            last_message=s.last_message,
            unread_count=s.unread_count,
        )
        for s in summaries
    ]


@router.get("/{match_id}")
async def read_match(
    match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> MatchOut:
    match = await _match_or_404(session, match_id, user.id)
    return MatchOut.build(match, user.id, online=hub.manager.is_online(match.other_id(user.id)))


@router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unmatch(match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep) -> Response:
    match = await _match_or_404(session, match_id, user.id)
    other_id = match.other_id(user.id)
    await session.delete(match)
    await session.commit()
    await hub.manager.send_many(
        [user.id, other_id], {"type": "match.removed", "match_id": match_id}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{match_id}/messages")
async def list_messages(
    match_id: int,
    user: CurrentUser,
    session: SessionDep,
    before: int | None = Query(default=None, description="Only messages with a smaller id"),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[MessageOut]:
    """A page of messages, oldest first. Pass `before` to page further back."""
    await _match_or_404(session, match_id, user.id)
    query = select(Message).where(Message.match_id == match_id)
    if before is not None:
        query = query.where(Message.id < before)
    newest_first = (await session.scalars(query.order_by(Message.id.desc()).limit(limit))).all()
    return [MessageOut.model_validate(m) for m in reversed(newest_first)]


@router.post("/{match_id}/messages", status_code=status.HTTP_201_CREATED)
async def post_message(
    match_id: int, data: MessageIn, user: CurrentUser, session: SessionDep, hub: HubDep
) -> MessageOut:
    """REST fallback for sending; the web client sends over the WebSocket."""
    match = await _match_or_404(session, match_id, user.id)
    message = await chat.send_message(session, hub, match, user.id, data.body)
    return MessageOut.model_validate(message)


@router.post("/{match_id}/read")
async def mark_read(
    match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> dict[str, int]:
    match = await _match_or_404(session, match_id, user.id)
    return {"marked": await chat.mark_read(session, hub, match, user.id)}


@router.get("/{match_id}/icebreakers")
async def match_icebreakers(match_id: int, user: CurrentUser, session: SessionDep) -> list[str]:
    match = await _match_or_404(session, match_id, user.id)
    return icebreakers(user, match.other_user(user.id))
