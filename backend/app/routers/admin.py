"""Moderation: the report queue and bans. Admins only."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select, update

from app.db import utcnow
from app.deps import AdminUser, HubDep, SessionDep
from app.models import Report, ReportStatus, User, VerificationRequest, VerificationStatus
from app.routers.ws import CLOSE_UNAUTHORIZED
from app.schemas import ModerationStats, ReportOut, ResolveIn, TrendsOut
from app.services import audit
from app.services.trends import build_trends

router = APIRouter(prefix="/api/admin", tags=["moderation"])


async def _open_counts(session: SessionDep, user_ids: set[int]) -> dict[int, int]:
    if not user_ids:
        return {}
    rows = await session.execute(
        select(Report.reported_id, func.count())
        .where(Report.reported_id.in_(user_ids), Report.status == ReportStatus.OPEN)
        .group_by(Report.reported_id)
    )
    return {user_id: count for user_id, count in rows}


@router.get("/reports")
async def list_reports(
    _: AdminUser,
    session: SessionDep,
    status_filter: ReportStatus = Query(default=ReportStatus.OPEN, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ReportOut]:
    """Reports in a given state. Open ones come oldest first so nothing waits too long."""
    order = Report.id.asc() if status_filter is ReportStatus.OPEN else Report.id.desc()
    reports = (
        await session.scalars(
            select(Report).where(Report.status == status_filter).order_by(order).limit(limit)
        )
    ).all()
    counts = await _open_counts(session, {r.reported_id for r in reports})
    return [ReportOut.build(r, counts.get(r.reported_id, 0)) for r in reports]


@router.post("/reports/{report_id}/resolve")
async def resolve_report(
    report_id: int, data: ResolveIn, admin: AdminUser, session: SessionDep, hub: HubDep
) -> ReportOut:
    """Dismiss one report, or ban the person, which closes every open report about them."""
    report = await session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if report.status != ReportStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "This report was already handled")
    now = utcnow()
    reported = report.reported

    if data.action == "dismiss":
        report.status = ReportStatus.DISMISSED
        report.resolved_at, report.resolved_by_id = now, admin.id
        audit.record(
            session,
            admin.id,
            audit.AuditAction.REPORT_DISMISSED,
            target_user_id=reported.id,
            detail=f"Report #{report.id} ({report.reason})",
        )
    else:
        if reported.is_admin:
            raise HTTPException(status.HTTP_409_CONFLICT, "Moderators can't be banned here")
        reported.banned_at = now
        reported.token_version += 1
        audit.record(
            session,
            admin.id,
            audit.AuditAction.USER_BANNED,
            target_user_id=reported.id,
            detail=f"From report #{report.id} ({report.reason})",
        )
        await session.execute(
            update(Report)
            .where(Report.reported_id == reported.id, Report.status == ReportStatus.OPEN)
            .values(status=ReportStatus.ACTIONED, resolved_at=now, resolved_by_id=admin.id)
        )
    await session.commit()
    await session.refresh(report)
    if data.action == "ban":
        await hub.manager.close_all(reported.id, CLOSE_UNAUTHORIZED)
    counts = await _open_counts(session, {reported.id})
    return ReportOut.build(report, counts.get(reported.id, 0))


@router.post("/users/{user_id}/unban", status_code=status.HTTP_204_NO_CONTENT)
async def unban(user_id: int, admin: AdminUser, session: SessionDep) -> Response:
    user = await session.get(User, user_id)
    if user is None or user.banned_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No banned user with that id")
    user.banned_at = None
    audit.record(session, admin.id, audit.AuditAction.USER_UNBANNED, target_user_id=user.id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/trends")
async def trends(
    _: AdminUser,
    session: SessionDep,
    days: int = Query(default=14, ge=7, le=90),
) -> TrendsOut:
    """Reports filed and resolved, new members, and how long reports wait, by day."""
    return TrendsOut.build(await build_trends(session, utcnow(), days))


@router.get("/stats")
async def stats(_: AdminUser, session: SessionDep) -> ModerationStats:
    week_ago = utcnow() - timedelta(days=7)

    async def count(query) -> int:  # type: ignore[no-untyped-def]
        return await session.scalar(query) or 0

    return ModerationStats(
        pending_verifications=await count(
            select(func.count())
            .select_from(VerificationRequest)
            .where(VerificationRequest.status == VerificationStatus.PENDING)
        ),
        open_reports=await count(select(func.count()).where(Report.status == ReportStatus.OPEN)),
        resolved_this_week=await count(select(func.count()).where(Report.resolved_at >= week_ago)),
        banned_users=await count(
            select(func.count()).select_from(User).where(User.banned_at.is_not(None))
        ),
        total_users=await count(select(func.count()).select_from(User)),
    )
