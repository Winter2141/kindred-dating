"""Signed-in devices: starting a session at sign-in, checking it on each request, ending it."""

from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import utcnow
from app.models import DeviceSession, User
from app.realtime import CLOSE_UNAUTHORIZED, Hub

# How stale last_seen_at may get before a request writes a fresh one. Writing it on every
# request would turn each read into a write for nothing more precise than "active 2 min ago".
TOUCH_EVERY = timedelta(minutes=5)


def client_address(request: Request) -> str:
    return request.client.host if request.client else ""


async def start(
    session: AsyncSession, settings: Settings, user: User, request: Request
) -> DeviceSession:
    now = utcnow()
    device = DeviceSession(
        user_id=user.id,
        token_version=user.token_version,
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=client_address(request)[:64],
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=settings.access_token_ttl_minutes),
    )
    session.add(device)
    await session.flush()
    return device


def is_live(device: DeviceSession, user: User, now: datetime) -> bool:
    return (
        device.user_id == user.id
        and device.revoked_at is None
        and device.expires_at > now
        and device.token_version == user.token_version
    )


async def touch(session: AsyncSession, device: DeviceSession, address: str, now: datetime) -> None:
    if now - device.last_seen_at < TOUCH_EVERY:
        return
    device.last_seen_at = now
    if address:
        device.ip_address = address[:64]
    await session.commit()


async def live_sessions(session: AsyncSession, user: User) -> list[DeviceSession]:
    now = utcnow()
    rows = await session.scalars(
        select(DeviceSession)
        .where(
            DeviceSession.user_id == user.id,
            DeviceSession.revoked_at.is_(None),
            DeviceSession.expires_at > now,
            DeviceSession.token_version == user.token_version,
        )
        .order_by(DeviceSession.last_seen_at.desc(), DeviceSession.id.desc())
    )
    return list(rows)


class UnknownSession(Exception):
    pass


async def end(session: AsyncSession, hub: Hub, user: User, device_id: int) -> None:
    """Sign one device out and close the live connections it has open."""
    device = await session.get(DeviceSession, device_id)
    if device is None or device.user_id != user.id:
        raise UnknownSession
    device.revoked_at = device.revoked_at or utcnow()
    await session.commit()
    await hub.manager.close_session(user.id, device_id, CLOSE_UNAUTHORIZED)


async def revoke_others(session: AsyncSession, user: User, keep_id: int | None) -> list[int]:
    """End every live session but `keep_id`. Returns the ids that were ended."""
    ended = [device.id for device in await live_sessions(session, user) if device.id != keep_id]
    if ended:
        await session.execute(
            update(DeviceSession).where(DeviceSession.id.in_(ended)).values(revoked_at=utcnow())
        )
    return ended
