"""Search across your own conversations: people by name, messages by text."""

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import Match, Message
from app.schemas import MatchOut, MessageOut, PublicProfile, SearchHit, SearchOut
from app.services import chat

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
async def search(
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
    q: str = Query(min_length=2, max_length=80, description="Words to look for"),
    limit: int = Query(default=30, ge=1, le=100),
) -> SearchOut:
    """Matches whose name contains `q`, and your messages containing it, newest first."""
    needle = q.strip().lower()
    summaries = await chat.list_matches(session, user.id)
    by_id = {s.match.id: s for s in summaries}
    online = hub.manager.is_online

    people = [
        MatchOut.build(
            s.match,
            user.id,
            online=online(s.match.other_id(user.id)),
            last_message=s.last_message,
            unread_count=s.unread_count,
            filing=s.filing,
        )
        for s in summaries
        if needle in s.match.other_user(user.id).name.lower()
    ]

    messages: list[SearchHit] = []
    if by_id and len(needle) >= 2:
        rows = await session.scalars(
            select(Message)
            .join(Match, Match.id == Message.match_id)
            .where(
                or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
                Message.deleted_at.is_(None),
                func.lower(Message.body).contains(needle, autoescape=True),
            )
            .order_by(Message.id.desc())
            .limit(limit)
        )
        for message in rows:
            match = by_id[message.match_id].match
            messages.append(
                SearchHit(
                    match_id=match.id,
                    with_user=PublicProfile.build(match.other_user(user.id)),
                    message=MessageOut.model_validate(message),
                )
            )
    return SearchOut(query=q.strip(), people=people, messages=messages)
