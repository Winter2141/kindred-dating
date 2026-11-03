"""Moderation beyond the report queue: find any member, ban directly, read the audit log."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.db import utcnow
from app.deps import AdminUser, HubDep, SessionDep
from app.models import AuditEvent, Match, Report, ReportStatus, User
from app.routers.ws import CLOSE_UNAUTHORIZED
from app.schemas import (
    AdminUserOut,
    AdminUserPage,
    AuditEventOut,
    BanIn,
    PublicProfile,
)
from app.services import audit

router = APIRouter(prefix="/api/admin", tags=["moderation"])

UserFilter = Literal["all", "banned", "verified", "unverified", "admins"]


@router.get("/users")
async def list_users(
    _: AdminUser,
    session: SessionDep,
    q: str = Query(default="", max_length=80, description="Name or email contains"),
    filter_by: UserFilter = Query(default="all", alias="filter"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> AdminUserPage:
    """Members, newest first, with what a moderator needs to judge an account at a glance."""
    query = select(User)
    needle = q.strip().lower()
    if needle:
        query = query.where(
            or_(
                func.lower(User.name).contains(needle, autoescape=True),
                func.lower(User.email).contains(needle, autoescape=True),
            )
        )
    match filter_by:
        case "banned":
            query = query.where(User.banned_at.is_not(None))
        case "verified":
            query = query.where(User.verified_at.is_not(None))
        case "unverified":
            query = query.where(User.verified_at.is_(None))
        case "admins":
            query = query.where(User.is_admin.is_(True))

    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = (
        await session.scalars(query.order_by(User.created_at.desc()).limit(limit).offset(offset))
    ).all()
    ids = [u.id for u in users]
    reports = (
        dict(
            (
                await session.execute(
                    select(Report.reported_id, func.count())
                    .where(Report.reported_id.in_(ids), Report.status == ReportStatus.OPEN)
                    .group_by(Report.reported_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    match_counts: dict[int, int] = {}
    if ids:
        for column in (Match.user_a_id, Match.user_b_id):
            rows = await session.execute(
                select(column, func.count()).where(column.in_(ids)).group_by(column)
            )
            for user_id, count in rows:
                match_counts[user_id] = match_counts.get(user_id, 0) + count

    return AdminUserPage(
        total=total,
        items=[
            AdminUserOut(
                **PublicProfile.build(u).model_dump(),
                email=u.email,
                created_at=u.created_at,
                banned=u.banned_at is not None,
                email_verified=u.email_verified_at is not None,
                is_admin=u.is_admin,
                is_persona=u.is_persona,
                open_reports=reports.get(u.id, 0),
                matches=match_counts.get(u.id, 0),
            )
            for u in users
        ],
    )


@router.post("/users/{user_id}/ban", status_code=status.HTTP_204_NO_CONTENT)
async def ban_user(
    user_id: int, data: BanIn, admin: AdminUser, session: SessionDep, hub: HubDep
) -> None:
    """Ban someone without a report, e.g. after spotting spam. The reason goes in the log."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.is_admin:
        raise HTTPException(status.HTTP_409_CONFLICT, "Moderators can't be banned here")
    if user.banned_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already banned")
    user.banned_at = utcnow()
    user.token_version += 1
    audit.record(
        session, admin.id, audit.AuditAction.USER_BANNED, target_user_id=user.id, detail=data.reason
    )
    await session.commit()
    await hub.manager.close_all(user.id, CLOSE_UNAUTHORIZED)


@router.get("/audit")
async def audit_log(
    _: AdminUser,
    session: SessionDep,
    before: int | None = Query(default=None, description="Only events with a smaller id"),
    limit: int = Query(default=30, ge=1, le=100),
) -> list[AuditEventOut]:
    """Moderator actions, newest first. Page back with `before`."""
    query = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit)
    if before is not None:
        query = query.where(AuditEvent.id < before)
    events = (await session.scalars(query)).all()
    return [AuditEventOut.build(e) for e in events]
