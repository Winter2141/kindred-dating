"""The email digest: one message about what's been waiting while someone was away.

Notifications that sit unread for DIGEST_DELAY while their owner is offline are gathered
into a single email, at most once every DIGEST_EVERY, and only for the kinds that person
asked to hear about by email. Nothing goes to an address that was never confirmed, and
nothing goes during someone's quiet hours (app.quiet); it waits for a later run.

Like the date reminders, every API process runs this, and each digest is claimed with a
conditional UPDATE on digest_sent_at, so only one worker sends it.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import utcnow
from app.mail import send_email
from app.models import Notification, NotificationKind, User
from app.quiet import is_quiet
from app.realtime import Hub
from app.security import create_purpose_token

# Long enough that someone who's just stepped away hears it in the app first.
DIGEST_DELAY = timedelta(minutes=15)
# At most one digest per person in this window, however much happens.
DIGEST_EVERY = timedelta(hours=6)

UNSUBSCRIBE = "unsubscribe"
UNSUBSCRIBE_TTL_MINUTES = 90 * 24 * 60

# What people can switch on and off, and the notification kinds each one covers.
CATEGORIES: dict[str, tuple[NotificationKind, ...]] = {
    "matches": (NotificationKind.MATCH,),
    "messages": (NotificationKind.MESSAGE,),
    "likes": (NotificationKind.LIKE, NotificationKind.SUPER_LIKE),
    "dates": (NotificationKind.DATE_REMINDER,),
}
DEFAULT_PREFS: dict[str, bool] = {"matches": True, "messages": True, "likes": False, "dates": True}


def prefs_for(user: User) -> dict[str, bool]:
    """Saved choices over the defaults, ignoring anything that's no longer a category."""
    saved = user.email_prefs or {}
    return {name: bool(saved.get(name, default)) for name, default in DEFAULT_PREFS.items()}


def wanted_kinds(prefs: dict[str, bool]) -> set[str]:
    return {kind.value for name, kinds in CATEGORIES.items() if prefs.get(name) for kind in kinds}


def unsubscribe_token(user: User, settings: Settings) -> str:
    return create_purpose_token(user.id, UNSUBSCRIBE, settings.secret_key, UNSUBSCRIBE_TTL_MINUTES)


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _name(notification: Notification) -> str:
    return notification.actor.name if notification.actor else "Someone"


@dataclass(frozen=True)
class Digest:
    subject: str
    lines: list[str]


def summarise(notifications: list[Notification]) -> Digest:
    """Turn waiting notifications into an email subject and one line per thing."""
    by_kind: dict[str, list[Notification]] = {}
    for notification in sorted(notifications, key=lambda n: n.created_at, reverse=True):
        by_kind.setdefault(notification.kind, []).append(notification)

    lines: list[str] = []
    for notification in by_kind.get(NotificationKind.MATCH, []):
        lines.append(f"You matched with {_name(notification)}. Say hello!")
    for notification in by_kind.get(NotificationKind.MESSAGE, []):
        count = notification.count or 1
        what = _plural(count, "new message", "new messages")
        preview = f': "{notification.body}"' if notification.body else ""
        lines.append(f"{_name(notification)} sent you {what}{preview}")
    for notification in by_kind.get(NotificationKind.DATE_REMINDER, []):
        lines.append(notification.body or "You have a date coming up")
    likes = by_kind.get(NotificationKind.LIKE, []) + by_kind.get(NotificationKind.SUPER_LIKE, [])
    if likes:
        supers = len(by_kind.get(NotificationKind.SUPER_LIKE, []))
        line = f"{_plural(len(likes), 'person', 'people')} liked your profile"
        if supers:
            line += f" ({supers} with a super like)"
        lines.append(line)

    matches = len(by_kind.get(NotificationKind.MATCH, []))
    chats = by_kind.get(NotificationKind.MESSAGE, [])
    if len(lines) == 1 and matches == 1:
        subject = f"It's a match with {_name(by_kind[NotificationKind.MATCH][0])}"
    elif len(lines) == 1 and len(chats) == 1:
        subject = f"{_name(chats[0])} sent you a message"
    elif matches:
        subject = f"{_plural(matches, 'new match', 'new matches')} and more on Kindred"
    elif chats:
        people = _plural(len(chats), "person is", "people are")
        subject = f"{people} waiting for your reply"
    else:
        subject = "There's news waiting on Kindred"
    return Digest(subject=subject, lines=lines)


def digest_email(
    name: str, digest: Digest, app_link: str, settings_link: str, off_link: str
) -> str:
    items = "\n".join(f"  - {line}" for line in digest.lines)
    return (
        f"Hi {name},\n\n"
        "Here's what happened while you were away:\n\n"
        f"{items}\n\n"
        f"Open Kindred: {app_link}\n\n"
        "--\n"
        f"Choose which emails you get: {settings_link}\n"
        f"Stop all of these emails: {off_link}\n"
    )


async def _waiting(session: AsyncSession, user: User, now: datetime) -> list[Notification]:
    kinds = wanted_kinds(prefs_for(user))
    if not kinds:
        return []
    query = select(Notification).where(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
        Notification.kind.in_(kinds),
        Notification.created_at <= now - DIGEST_DELAY,
    )
    if user.digest_sent_at is not None:  # only what's new since the last digest
        query = query.where(Notification.created_at > user.digest_sent_at)
    return list(await session.scalars(query))


def _due(now: datetime) -> ColumnElement[bool]:
    return or_(User.digest_sent_at.is_(None), User.digest_sent_at <= now - DIGEST_EVERY)


async def send_due_digests(hub: Hub, now: datetime | None = None) -> int:
    """Email everyone who has something waiting and is due a digest. Returns how many."""
    now = now or utcnow()
    settings = hub.settings
    base = settings.app_url.rstrip("/")
    sent = 0
    async with hub.db.session() as session:
        candidates = (
            await session.scalars(
                select(User)
                .where(
                    User.email_verified_at.is_not(None),
                    User.banned_at.is_(None),
                    User.is_persona.is_(False),
                    _due(now),
                    User.id.in_(
                        select(Notification.user_id).where(
                            Notification.read_at.is_(None),
                            Notification.created_at <= now - DIGEST_DELAY,
                        )
                    ),
                )
                .order_by(User.id)
            )
        ).all()
        for user in candidates:
            if hub.manager.is_online(user.id):
                continue  # they'll see it in the app
            if is_quiet(user.quiet_hours, now):
                continue  # it goes out after quiet hours, on a later run
            waiting = await _waiting(session, user, now)
            if not waiting:
                continue
            claimed = await session.execute(
                update(User).where(User.id == user.id, _due(now)).values(digest_sent_at=now)
            )
            await session.commit()
            if claimed.rowcount != 1:  # another worker sent it
                continue
            digest = summarise(waiting)
            body = digest_email(
                user.name,
                digest,
                app_link=f"{base}/app/matches",
                settings_link=f"{base}/app/settings#email",
                off_link=f"{base}/unsubscribe?token={unsubscribe_token(user, settings)}",
            )
            await send_email(
                session, settings, to=user.email, subject=digest.subject, body=body, kind="digest"
            )
            sent += 1
    return sent
