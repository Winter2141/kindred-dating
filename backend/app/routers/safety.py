"""Blocking and reporting other people."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep
from app.limits import REPORTS
from app.models import Block, Match, Report, User
from app.ratelimit import per_user
from app.schemas import BlockIn, PublicProfile, ReportIn

router = APIRouter(prefix="/api", tags=["safety"])


async def _block(session: SessionDep, hub: HubDep, user: User, target_id: int) -> None:
    """Record the block (once) and end any match between the two, live for both sides."""
    if not await session.scalar(
        select(Block.id).where(Block.blocker_id == user.id, Block.blocked_id == target_id)
    ):
        session.add(Block(blocker_id=user.id, blocked_id=target_id))

    a_id, b_id = Match.ordered_pair(user.id, target_id)
    match = await session.scalar(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match_id = match.id if match else None
    if match is not None:
        await session.delete(match)
    await session.commit()
    if match_id is not None:
        await hub.manager.send_many(
            [user.id, target_id], {"type": "match.removed", "match_id": match_id}
        )


async def _target(session: SessionDep, user: User, target_id: int) -> User:
    if target_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's you")
    target = await session.get(User, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return target


@router.post("/blocks", status_code=status.HTTP_204_NO_CONTENT)
async def block(data: BlockIn, user: CurrentUser, session: SessionDep, hub: HubDep) -> Response:
    target = await _target(session, user, data.user_id)
    await _block(session, hub, user, target.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/blocks")
async def list_blocks(user: CurrentUser, session: SessionDep) -> list[PublicProfile]:
    rows = await session.scalars(
        select(User)
        .join(Block, Block.blocked_id == User.id)
        .where(Block.blocker_id == user.id)
        .order_by(Block.created_at.desc())
    )
    return [PublicProfile.build(blocked) for blocked in rows]


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock(user_id: int, user: CurrentUser, session: SessionDep) -> Response:
    existing = await session.scalar(
        select(Block).where(Block.blocker_id == user.id, Block.blocked_id == user_id)
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You haven't blocked this person")
    await session.delete(existing)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reports", status_code=status.HTTP_201_CREATED, dependencies=[per_user(REPORTS)])
async def report(
    data: ReportIn, user: CurrentUser, session: SessionDep, hub: HubDep
) -> dict[str, int]:
    """File a report for the moderators; by default the person is blocked too."""
    target = await _target(session, user, data.user_id)
    filed = Report(
        reporter_id=user.id, reported_id=target.id, reason=data.reason, details=data.details
    )
    session.add(filed)
    await session.commit()
    if data.block:
        await _block(session, hub, user, target.id)
    return {"id": filed.id}
