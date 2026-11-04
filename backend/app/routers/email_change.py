"""Moving an account to a new email address.

The new address has to prove it can read mail before it replaces the old one, and the old
address hears about it twice: when the change is asked for (so a stolen session can be caught
in time) and once it's done. Until the link is followed, sign-in keeps using the old address.
"""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import utcnow
from app.deps import CurrentUser, SessionDep, SettingsDep
from app.limits import EMAILS
from app.mail import (
    CHANGE_EMAIL,
    CHANGE_EMAIL_TTL_MINUTES,
    change_email_message,
    change_requested_notice,
    email_changed_notice,
    link,
    send_email,
)
from app.models import User
from app.ratelimit import per_user
from app.routers.account import _require_password
from app.schemas import EmailChangeConfirmIn, EmailChangeIn, EmailVerifiedOut, MeOut
from app.security import InvalidToken, create_purpose_token, decode_purpose_token

router = APIRouter(prefix="/api", tags=["email"])

TAKEN = "Another account already uses that email"
INVALID = "That link is invalid, expired or replaced by a newer one"


async def _in_use(session: AsyncSession, email: str, user_id: int) -> bool:
    return bool(
        await session.scalar(
            select(func.count()).select_from(User).where(User.email == email, User.id != user_id)
        )
    )


async def _send_link(session: AsyncSession, settings: Settings, user: User) -> None:
    """Email the pending address a link. The token names both addresses, so it stops working
    if either one changes (a newer request, a cancel, or the change going through)."""
    assert user.pending_email is not None
    token = create_purpose_token(
        user.id,
        CHANGE_EMAIL,
        settings.secret_key,
        CHANGE_EMAIL_TTL_MINUTES,
        {"email": user.pending_email, "from": user.email},
    )
    subject, body = change_email_message(
        user.name, user.pending_email, link(settings, "/confirm-email-change", token)
    )
    await send_email(
        session, settings, to=user.pending_email, subject=subject, body=body, kind="change"
    )


@router.post("/me/email", status_code=status.HTTP_202_ACCEPTED, dependencies=[per_user(EMAILS)])
async def request_email_change(
    data: EmailChangeIn, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> MeOut:
    """Start moving to a new address. Asking again replaces the earlier request."""
    _require_password(data.password, user.password_hash)
    new_email = data.new_email.lower()
    if new_email == user.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's already your email")
    if await _in_use(session, new_email, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEN)

    user.pending_email = new_email
    await session.commit()
    await _send_link(session, settings, user)
    subject, body = change_requested_notice(user.name, new_email)
    await send_email(session, settings, to=user.email, subject=subject, body=body, kind="notice")
    return MeOut.build(user)


@router.post(
    "/me/email/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[per_user(EMAILS)],
)
async def resend_email_change(
    user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> Response:
    if user.pending_email is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There's no email change waiting")
    await _send_link(session, settings, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/email/pending")
async def cancel_email_change(user: CurrentUser, session: SessionDep) -> MeOut:
    """Keep the current address. Any link already sent stops working."""
    user.pending_email = None
    await session.commit()
    return MeOut.build(user)


@router.post("/auth/confirm-email-change")
async def confirm_email_change(
    data: EmailChangeConfirmIn, session: SessionDep, settings: SettingsDep
) -> EmailVerifiedOut:
    """Follow the link sent to the new address. Works without being signed in."""
    try:
        user_id, claims = decode_purpose_token(data.token, CHANGE_EMAIL, settings.secret_key)
    except InvalidToken:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID) from None
    user = await session.get(User, user_id)
    if (
        user is None
        or user.banned_at is not None
        or user.pending_email is None
        or user.pending_email != claims.get("email")
        or user.email != claims.get("from")
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID)
    # Someone may have signed up with it since the link was sent.
    if await _in_use(session, user.pending_email, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEN)

    old_email = user.email
    user.email = user.pending_email
    user.pending_email = None
    # Following the link proves they can read mail sent there.
    user.email_verified_at = utcnow()
    try:
        await session.commit()
    except IntegrityError:  # lost a race with a sign-up for the same address
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEN) from None

    subject, body = email_changed_notice(user.name, user.email)
    await send_email(session, settings, to=old_email, subject=subject, body=body, kind="notice")
    return EmailVerifiedOut(email=user.email)
