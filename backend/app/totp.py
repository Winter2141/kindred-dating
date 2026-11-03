"""Time-based one-time passwords (RFC 6238), as used by authenticator apps.

A shared secret and the current 30-second time step go through HMAC-SHA1, and six digits
are cut from the result (RFC 4226's dynamic truncation). Small enough to write out here
rather than pull in a dependency, and the RFC's own test vectors check it.
"""

import base64
import hashlib
import hmac
import io
import secrets
import struct
import time
from urllib.parse import quote, urlencode

import segno

STEP_SECONDS = 30
DIGITS = 6
# Accept the code from one step either side, for clocks that drift a little.
WINDOW = 1


def new_secret() -> str:
    """160 random bits, base32-encoded without padding, as authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    padded = secret.upper() + "=" * (-len(secret) % 8)
    return base64.b32decode(padded)


def hotp(key: bytes, counter: int, digits: int = DIGITS, digest: str = "sha1") -> str:
    """RFC 4226: an HMAC of the counter, truncated to `digits` decimal digits."""
    mac = hmac.new(key, struct.pack(">Q", counter), digest).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def counter_at(timestamp: float) -> int:
    return int(timestamp // STEP_SECONDS)


def code_at(secret: str, timestamp: float) -> str:
    return hotp(_key(secret), counter_at(timestamp))


def verify(
    secret: str, code: str, *, now: float | None = None, last_counter: int | None = None
) -> int | None:
    """The time step a valid code belongs to, or None.

    Codes from a step at or before `last_counter` are refused, so each code works once even
    within its 30 seconds.
    """
    code = code.strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    current = counter_at(time.time() if now is None else now)
    key = _key(secret)
    for counter in range(current - WINDOW, current + WINDOW + 1):
        if last_counter is not None and counter <= last_counter:
            continue
        if hmac.compare_digest(hotp(key, counter), code):
            return counter
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "Kindred") -> str:
    """The otpauth:// link an authenticator app reads from the QR code."""
    label = quote(f"{issuer}:{account}")
    query = urlencode(
        {"secret": secret, "issuer": issuer, "digits": DIGITS, "period": STEP_SECONDS}
    )
    return f"otpauth://totp/{label}?{query}"


def qr_svg(data: str) -> str:
    """An SVG QR code of `data`, sized by its viewBox so CSS can scale it."""
    buffer = io.BytesIO()
    segno.make(data, error="m").save(
        buffer, kind="svg", scale=1, border=2, dark="#120d0c", light="#ffffff", omitsize=True
    )
    return buffer.getvalue().decode()


# Recovery codes: ten one-off codes for when the phone with the app is gone.
RECOVERY_CODE_COUNT = 10


def new_recovery_codes() -> list[str]:
    """Codes like 'k7m2-q9xd', easy to read aloud and type."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o, 1/l/i
    return [
        "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2))
        for _ in range(RECOVERY_CODE_COUNT)
    ]


def hash_recovery_code(code: str) -> str:
    # The codes are random and single-use, so a plain SHA-256 is enough (no need for bcrypt).
    return hashlib.sha256(code.strip().lower().replace(" ", "").encode()).hexdigest()
