"""Two-factor sign-in with an authenticator app, and recovery codes for when it's lost."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from app import totp
from app.db import utcnow
from app.deps import CurrentUser, SessionDep, SettingsDep
from app.limits import LOGIN
from app.models import User
from app.ratelimit import per_ip
from app.routers.auth import MFA_LOGIN, token_for
from app.schemas import (
    MfaLoginIn,
    PasswordConfirm,
    RecoveryCodesOut,
    TokenOut,
    TwoFactorCodeIn,
    TwoFactorDisableIn,
    TwoFactorSetupOut,
    TwoFactorStatus,
)
from app.security import InvalidToken, decode_purpose_token, verify_password
from app.services import security_log
from app.services.security_log import SecurityKind

router = APIRouter(prefix="/api", tags=["two-factor"])


def _status(user: User) -> TwoFactorStatus:
    return TwoFactorStatus(
        enabled=user.totp_enabled_at is not None,
        recovery_codes_left=len(user.recovery_codes or []),
    )


def _wrong_code() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "That code isn't right. Try the newest one")


def _check_password(user: User, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password isn't right")


def check_second_factor(user: User, code: str) -> bool:
    """Accept a current authenticator code, or use up one recovery code. Updates `user`."""
    counter = totp.verify(user.totp_secret or "", code, last_counter=user.totp_last_counter)
    if counter is not None:
        user.totp_last_counter = counter
        return True
    hashed = totp.hash_recovery_code(code)
    if hashed in (user.recovery_codes or []):
        user.recovery_codes = [h for h in user.recovery_codes if h != hashed]
        return True
    return False


def _fresh_codes(user: User) -> list[str]:
    codes = totp.new_recovery_codes()
    user.recovery_codes = [totp.hash_recovery_code(c) for c in codes]
    return codes


@router.get("/me/2fa")
async def two_factor_status(user: CurrentUser) -> TwoFactorStatus:
    return _status(user)


@router.post("/me/2fa/setup")
async def start_setup(user: CurrentUser, session: SessionDep) -> TwoFactorSetupOut:
    """A new secret to scan. Nothing changes until a code from it is confirmed."""
    if user.totp_enabled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is already on")
    user.totp_secret = totp.new_secret()
    await session.commit()
    uri = totp.provisioning_uri(user.totp_secret, user.email)
    return TwoFactorSetupOut(secret=user.totp_secret, otpauth_url=uri, qr_svg=totp.qr_svg(uri))


@router.post("/me/2fa/enable")
async def enable(
    data: TwoFactorCodeIn, request: Request, user: CurrentUser, session: SessionDep
) -> RecoveryCodesOut:
    """Turn it on with a code from the app. Returns recovery codes, shown only this once."""
    if user.totp_enabled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is already on")
    if not user.totp_secret:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start setup first")
    counter = totp.verify(user.totp_secret, data.code)
    if counter is None:
        raise _wrong_code()
    user.totp_last_counter = counter
    user.totp_enabled_at = utcnow()
    codes = _fresh_codes(user)
    security_log.record(session, user.id, SecurityKind.TWO_FACTOR_ON, request)
    await session.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/me/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable(
    data: TwoFactorDisableIn, request: Request, user: CurrentUser, session: SessionDep
) -> Response:
    """Needs your password and a code (or recovery code), so a stolen session can't do it."""
    if user.totp_enabled_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is already off")
    _check_password(user, data.password)
    if not check_second_factor(user, data.code):
        raise _wrong_code()
    security_log.record(session, user.id, SecurityKind.TWO_FACTOR_OFF, request)
    user.totp_secret = None
    user.totp_enabled_at = None
    user.totp_last_counter = None
    user.recovery_codes = []
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/me/2fa/recovery-codes")
async def regenerate_codes(
    data: PasswordConfirm, user: CurrentUser, session: SessionDep
) -> RecoveryCodesOut:
    """Replace every recovery code with ten new ones."""
    if user.totp_enabled_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Turn on two-factor sign-in first")
    _check_password(user, data.password)
    codes = _fresh_codes(user)
    await session.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/auth/login/2fa", dependencies=[per_ip(LOGIN)])
async def login_second_step(
    data: MfaLoginIn, request: Request, session: SessionDep, settings: SettingsDep
) -> TokenOut:
    """Finish signing in with the challenge from /auth/login and a code."""
    expired = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again: that took too long")
    try:
        user_id, claims = decode_purpose_token(data.mfa_token, MFA_LOGIN, settings.secret_key)
    except InvalidToken:
        raise expired from None
    user = await session.get(User, user_id)
    if user is None or user.banned_at is not None or claims.get("ver") != user.token_version:
        raise expired
    if user.totp_enabled_at is None:
        raise expired
    if not check_second_factor(user, data.code):
        raise _wrong_code()
    security_log.record(session, user.id, SecurityKind.SIGN_IN, request)
    await session.commit()  # records the used code, so it can't be replayed
    return await token_for(session, settings, user, request)
