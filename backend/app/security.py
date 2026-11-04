from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

ALGORITHM = "HS256"


class InvalidToken(Exception):
    pass


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


@dataclass(frozen=True)
class AccessClaims:
    user_id: int
    version: int
    # The DeviceSession the token belongs to. Tokens issued before sessions existed have none.
    session_id: int | None


def create_access_token(
    user_id: int,
    secret: str,
    ttl_minutes: int,
    version: int = 0,
    session_id: int | None = None,
) -> str:
    """A signed token. `version` must match the user's token_version for it to stay valid."""
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "ver": version,
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    if session_id is not None:
        payload["sid"] = session_id
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def create_purpose_token(
    user_id: int, purpose: str, secret: str, ttl_minutes: int, claims: dict[str, Any] | None = None
) -> str:
    """A signed, expiring token for one job (confirming an email, resetting a password).

    The purpose is checked on the way back in, so one kind can't be used as another, nor as
    an access token, which has no purpose claim.
    """
    now = datetime.now(UTC)
    payload = {
        **(claims or {}),
        "sub": str(user_id),
        "purpose": purpose,
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_purpose_token(token: str, purpose: str, secret: str) -> tuple[int, dict[str, Any]]:
    """Returns (user id, all claims) if the token is valid and made for `purpose`."""
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp"]})
        if payload.get("purpose") != purpose:
            raise InvalidToken("wrong purpose")
        return int(payload["sub"]), payload
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as exc:
        raise InvalidToken from exc


def decode_access_token(token: str, secret: str) -> AccessClaims:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp"]})
        if "purpose" in payload:  # an emailed link token is never a session
            raise InvalidToken("not an access token")
        sid = payload.get("sid")
        return AccessClaims(
            user_id=int(payload["sub"]),
            version=int(payload.get("ver", 0)),
            session_id=int(sid) if sid is not None else None,
        )
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as exc:
        raise InvalidToken from exc
