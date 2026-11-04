"""Announcements: moderators post a short notice, and everyone sees it as a banner.

Each person sees the newest live announcements they haven't dismissed. An announcement is
live from when it's posted until it ends: after a set time, or when a moderator ends it.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.deps import AdminUser, CurrentUser, SessionDep
from app.models import Announcement, AnnouncementDismissal
from app.schemas import AdminAnnouncementOut, AnnouncementIn, AnnouncementOut
from app.services import audit
from app.services.audit import AuditAction

router = APIRouter(prefix="/api", tags=["announcements"])

# Nobody needs more than a few banners at once; older ones wait their turn.
MAX_SHOWN = 3


def _live(now: datetime) -> ColumnElement[bool]:
    return (Announcement.ends_at.is_(None)) | (Announcement.ends_at > now)


@router.get("/announcements")
async def current_announcements(user: CurrentUser, session: SessionDep) -> list[AnnouncementOut]:
    """Live announcements you haven't dismissed, newest first."""
    dismissed = select(AnnouncementDismissal.announcement_id).where(
        AnnouncementDismissal.user_id == user.id
    )
    rows = await session.scalars(
        select(Announcement)
        .where(_live(utcnow()), Announcement.id.not_in(dismissed))
        .order_by(Announcement.created_at.desc(), Announcement.id.desc())
        .limit(MAX_SHOWN)
    )
    return [AnnouncementOut.model_validate(a) for a in rows]


@router.post("/announcements/{announcement_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_announcement(
    announcement_id: int, user: CurrentUser, session: SessionDep
) -> Response:
    if await session.get(Announcement, announcement_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found")
    already = await session.scalar(
        select(AnnouncementDismissal.id).where(
            AnnouncementDismissal.user_id == user.id,
            AnnouncementDismissal.announcement_id == announcement_id,
        )
    )
    if already is None:
        session.add(AnnouncementDismissal(user_id=user.id, announcement_id=announcement_id))
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _admin_out(
    session: AsyncSession, announcements: list[Announcement]
) -> list[AdminAnnouncementOut]:
    counts = dict(
        (
            await session.execute(
                select(AnnouncementDismissal.announcement_id, func.count())
                .where(AnnouncementDismissal.announcement_id.in_([a.id for a in announcements]))
                .group_by(AnnouncementDismissal.announcement_id)
            )
        ).all()
    )
    now = utcnow()
    return [
        AdminAnnouncementOut.build(a, now=now, dismissed_count=counts.get(a.id, 0))
        for a in announcements
    ]


@router.get("/admin/announcements")
async def all_announcements(_: AdminUser, session: SessionDep) -> list[AdminAnnouncementOut]:
    """Everything posted, newest first, with how many people dismissed each."""
    rows = (
        await session.scalars(
            select(Announcement).order_by(Announcement.created_at.desc()).limit(50)
        )
    ).all()
    return await _admin_out(session, list(rows))


@router.post("/admin/announcements", status_code=status.HTTP_201_CREATED)
async def post_announcement(
    data: AnnouncementIn, admin: AdminUser, session: SessionDep
) -> AdminAnnouncementOut:
    now = utcnow()
    announcement = Announcement(
        author_id=admin.id,
        title=data.title,
        body=data.body,
        tone=data.tone,
        created_at=now,
        ends_at=now + timedelta(hours=data.hours) if data.hours else None,
    )
    session.add(announcement)
    await session.flush()
    audit.record(session, admin.id, AuditAction.ANNOUNCEMENT_POSTED, detail=data.title)
    await session.commit()
    (out,) = await _admin_out(session, [announcement])
    return out


@router.post("/admin/announcements/{announcement_id}/end")
async def end_announcement(
    announcement_id: int, admin: AdminUser, session: SessionDep
) -> AdminAnnouncementOut:
    """Take an announcement down for everyone, now."""
    announcement = await session.get(Announcement, announcement_id)
    if announcement is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found")
    now = utcnow()
    if announcement.ends_at is None or announcement.ends_at > now:
        announcement.ends_at = now
        audit.record(session, admin.id, AuditAction.ANNOUNCEMENT_ENDED, detail=announcement.title)
        await session.commit()
    (out,) = await _admin_out(session, [announcement])
    return out
