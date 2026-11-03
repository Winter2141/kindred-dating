"""In-app notifications: likes, matches and messages you missed while away."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import Notification, NotificationKind
from app.realtime import Hub
from app.schemas import NotificationOut


async def notify(
    session: AsyncSession,
    hub: Hub,
    user_id: int,
    kind: NotificationKind,
    *,
    actor_id: int | None = None,
    match_id: int | None = None,
    body: str = "",
) -> Notification:
    """Record a notification and push it live. Missed messages collapse into one per chat."""
    notification = None
    if kind is NotificationKind.MESSAGE:
        notification = await session.scalar(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.kind == NotificationKind.MESSAGE,
                Notification.match_id == match_id,
                Notification.read_at.is_(None),
            )
        )
    if notification is None:
        notification = Notification(user_id=user_id, kind=kind, actor_id=actor_id)
        session.add(notification)
    notification.match_id = match_id
    notification.body = body[:200]
    notification.count = (notification.count or 0) + 1
    notification.created_at = utcnow()
    await session.commit()
    await session.refresh(notification, ["actor"])
    await hub.manager.send(
        user_id,
        {"type": "notification.new", "notification": NotificationOut.build(notification)},
    )
    return notification
