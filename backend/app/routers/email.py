"""Email confirmation and password resets, plus the development outbox."""

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from app.db import utcnow
from app.deps import CurrentUser, SessionDep, SettingsDep
from app.limits import EMAILS
from app.mail import (
    RESET_PASSWORD,
    RESET_TTL_MINUTES,
    VERIFY_EMAIL,
    link,
    reset_email,
    send_email,
    send_verification,
)
from app.models import OutboxEmail, User
from app.ratelimit import per_ip, per_user
from app.routers.auth import token_for
from app.schemas import (
    EmailVerifiedOut,
    ForgotPasswordIn,
    OutboxEmailOut,
    ResetPasswordIn,
    TokenOut,
    VerifyEmailIn,
)
from app.security import (
    InvalidToken,
    create_purpose_token,
    decode_purpose_token,
    hash_password,
)

router = APIRouter(prefix="/api", tags=["email"])


@router.post("/me/verify-email/resend", status_code=204, dependencies=[per_user(EMAILS)])
async def resend_verification(
    user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> Response:
    if user.email_verified_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Your email is already confirmed")
    await send_verification(session, settings, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auth/verify-email")
async def verify_email(
    data: VerifyEmailIn, session: SessionDep, settings: SettingsDep
) -> EmailVerifiedOut:
    """Confirm an address from the emailed link. Works without being signed in."""
    try:
        user_id, claims = decode_purpose_token(data.token, VERIFY_EMAIL, settings.secret_key)
    except InvalidToken:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That link is invalid or has expired"
        ) from None
    user = await session.get(User, user_id)
    if user is None or user.email != claims.get("email"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That link is invalid or has expired")
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        await session.commit()
    return EmailVerifiedOut(email=user.email)


@router.post(
    "/auth/forgot-password", status_code=status.HTTP_202_ACCEPTED, dependencies=[per_ip(EMAILS)]
)
async def forgot_password(
    data: ForgotPasswordIn, session: SessionDep, settings: SettingsDep
) -> Response:
    """Email a reset link. Always answers the same way, so it can't reveal who has an account."""
    user = await session.scalar(select(User).where(User.email == data.email.lower()))
    if user is not None and user.banned_at is None and not user.is_persona:
        # The token carries the current token version: resetting (or signing out
        # everywhere) bumps it, so each link works once.
        token = create_purpose_token(
            user.id,
            RESET_PASSWORD,
            settings.secret_key,
            RESET_TTL_MINUTES,
            {"ver": user.token_version},
        )
        subject, body = reset_email(user.name, link(settings, "/reset-password", token))
        await send_email(session, settings, to=user.email, subject=subject, body=body, kind="reset")
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/auth/reset-password")
async def reset_password(
    data: ResetPasswordIn, request: Request, session: SessionDep, settings: SettingsDep
) -> TokenOut:
    """Set a new password from a reset link. Signs out every device and signs this one in."""
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "That reset link is invalid or used up")
    try:
        user_id, claims = decode_purpose_token(data.token, RESET_PASSWORD, settings.secret_key)
    except InvalidToken:
        raise invalid from None
    user = await session.get(User, user_id)
    if user is None or user.banned_at is not None or claims.get("ver") != user.token_version:
        raise invalid
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    # Getting the link proves they can read mail sent to this address.
    user.email_verified_at = user.email_verified_at or utcnow()
    await session.commit()
    return await token_for(session, settings, user, request)


@router.get("/dev/outbox")
async def outbox(
    session: SessionDep,
    settings: SettingsDep,
    to: str | None = Query(default=None, description="Only emails to this address"),
) -> list[OutboxEmailOut]:
    """The latest emails the outbox mail backend 'sent'. Disabled unless expose_outbox is on."""
    if not settings.expose_outbox:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    query = select(OutboxEmail).order_by(OutboxEmail.id.desc()).limit(30)
    if to:
        query = query.where(OutboxEmail.to == to.lower())
    return [OutboxEmailOut.model_validate(e) for e in await session.scalars(query)]
