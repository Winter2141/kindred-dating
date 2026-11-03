"""An append-only record of what moderators did, and to whom."""

from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent


class AuditAction(StrEnum):
    REPORT_DISMISSED = "report.dismissed"
    USER_BANNED = "user.banned"
    USER_UNBANNED = "user.unbanned"
    VERIFICATION_APPROVED = "verification.approved"
    VERIFICATION_REJECTED = "verification.rejected"


def record(
    session: AsyncSession,
    actor_id: int,
    action: AuditAction,
    *,
    target_user_id: int | None = None,
    detail: str = "",
) -> AuditEvent:
    """Add an event to the session; it's saved with the change it describes."""
    event = AuditEvent(
        actor_id=actor_id, action=action, target_user_id=target_user_id, detail=detail[:500]
    )
    session.add(event)
    return event
