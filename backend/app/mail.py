"""Sending email: through SMTP in production, or into an outbox table everywhere else.

The outbox keeps every message in the database (and logs it), so the sign-up and password
reset flows work locally and in the demo without a mail server. Set
KINDRED_EXPOSE_OUTBOX=true to read it at GET /api/dev/outbox; never do that in production,
where anyone could read reset links.
"""

import logging
import smtplib
from email.message import EmailMessage

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import OutboxEmail, User
from app.security import create_purpose_token

log = logging.getLogger(__name__)

# Purposes for the signed tokens in emailed links, and how long each link works.
VERIFY_EMAIL = "verify_email"
RESET_PASSWORD = "reset_password"
VERIFY_TTL_MINUTES = 3 * 24 * 60
RESET_TTL_MINUTES = 60


def link(settings: Settings, path: str, token: str) -> str:
    """A link into the web app, e.g. /reset-password?token=..."""
    return f"{settings.app_url.rstrip('/')}{path}?token={token}"


async def send_verification(session: AsyncSession, settings: Settings, user: User) -> None:
    """Email a confirmation link. The token names the address, so changing it voids the link."""
    token = create_purpose_token(
        user.id, VERIFY_EMAIL, settings.secret_key, VERIFY_TTL_MINUTES, {"email": user.email}
    )
    subject, body = verification_email(user.name, link(settings, "/verify-email", token))
    await send_email(session, settings, to=user.email, subject=subject, body=body, kind="verify")


async def send_email(
    session: AsyncSession, settings: Settings, *, to: str, subject: str, body: str, kind: str
) -> None:
    """Deliver one plain-text email using the configured backend."""
    if settings.mail_backend == "smtp":
        await run_in_threadpool(_send_smtp, settings, to, subject, body)
        return
    session.add(OutboxEmail(to=to, subject=subject, body=body, kind=kind))
    await session.commit()
    log.info("email to %s: %s\n%s", to, subject, body)


def _send_smtp(settings: Settings, to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


def verification_email(name: str, link: str) -> tuple[str, str]:
    subject = "Confirm your email for Kindred"
    body = (
        f"Hi {name},\n\n"
        "Welcome to Kindred! Confirm this is your email address so we can reach you about "
        "your account:\n\n"
        f"{link}\n\n"
        "The link works for three days. If you didn't sign up, you can ignore this email.\n\n"
        "The Kindred team\n"
    )
    return subject, body


def reset_email(name: str, link: str) -> tuple[str, str]:
    subject = "Reset your Kindred password"
    body = (
        f"Hi {name},\n\n"
        "Someone (hopefully you) asked to reset the password for your Kindred account. "
        "Choose a new one here:\n\n"
        f"{link}\n\n"
        "The link works once, for an hour. If you didn't ask for this, your password hasn't "
        "changed and you can ignore this email.\n\n"
        "The Kindred team\n"
    )
    return subject, body
