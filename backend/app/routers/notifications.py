from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select, update

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.models import Notification
from app.schemas import NotificationList, NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    user: CurrentUser, session: SessionDep, limit: int = Query(default=30, ge=1, le=100)
) -> NotificationList:
    """Newest first, with how many are still unread."""
    items = await session.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    unread = await session.scalar(
        select(func.count()).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return NotificationList(
        items=[NotificationOut.build(n) for n in items.unique()], unread=unread or 0
    )


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(user: CurrentUser, session: SessionDep) -> Response:
    await session.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: int, user: CurrentUser, session: SessionDep
) -> NotificationOut:
    notification = await session.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    notification.read_at = notification.read_at or utcnow()
    await session.commit()
    return NotificationOut.build(notification)
