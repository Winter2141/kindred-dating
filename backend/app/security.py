from datetime import UTC, datetime, timedelta

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


def create_access_token(user_id: int, secret: str, ttl_minutes: int, version: int = 0) -> str:
    """A signed token. `version` must match the user's token_version for it to stay valid."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "ver": version,
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> tuple[int, int]:
    """Returns (user id, token version)."""
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp"]})
        return int(payload["sub"]), int(payload.get("ver", 0))
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as exc:
        raise InvalidToken from exc
