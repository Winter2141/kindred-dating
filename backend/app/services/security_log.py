"""A short history of what touched someone's account security, shown to them in Settings.

Sign-ins, wrong passwords, password and email changes, two-factor and "sign out everywhere":
the things to look at when an account might be in someone else's hands. Each entry keeps
the browser and address it came from, like the device list does.
"""

from enum import StrEnum

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SecurityEvent
from app.services.devices import client_address

# Enough to spot something odd; older entries are left out of the list.
SHOWN = 20


class SecurityKind(StrEnum):
    SIGN_IN = "sign_in"
    SIGN_IN_FAILED = "sign_in_failed"
    PASSWORD_CHANGED = "password_changed"
    PASSWORD_RESET = "password_reset"
    EMAIL_CHANGE_REQUESTED = "email_change_requested"
    EMAIL_CHANGED = "email_changed"
    TWO_FACTOR_ON = "two_factor_on"
    TWO_FACTOR_OFF = "two_factor_off"
    SIGNED_OUT_EVERYWHERE = "signed_out_everywhere"


def record(
    session: AsyncSession, user_id: int, kind: SecurityKind, request: Request | None = None
) -> None:
    """Add an entry to the session; it's saved with the change it describes."""
    session.add(
        SecurityEvent(
            user_id=user_id,
            kind=kind,
            user_agent=(request.headers.get("user-agent", "") if request else "")[:255],
            ip_address=(client_address(request) if request else "")[:64],
        )
    )


async def recent(session: AsyncSession, user_id: int) -> list[SecurityEvent]:
    rows = await session.scalars(
        select(SecurityEvent)
        .where(SecurityEvent.user_id == user_id)
        .order_by(SecurityEvent.created_at.desc(), SecurityEvent.id.desc())
        .limit(SHOWN)
    )
    return list(rows)
