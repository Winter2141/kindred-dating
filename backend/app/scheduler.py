"""Background jobs that run on a timer: reminders before accepted dates, and email digests.

Every API process runs the loop. Each reminder is claimed with a conditional UPDATE
(`reminded_at IS NULL`), so with several workers exactly one of them sends it; digests are
claimed the same way (see app.services.digest).
"""

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, update

from app.db import utcnow
from app.models import DateProposal, DateStatus, Match, NotificationKind
from app.realtime import Hub
from app.services.digest import send_due_digests
from app.services.notifications import notify

log = logging.getLogger(__name__)

# How long before a date the reminder goes out.
REMIND_BEFORE = timedelta(hours=2)


def reminder_text(place: str, starts_at: datetime, other_name: str, now: datetime) -> str:
    minutes = max(0, round((starts_at - now).total_seconds() / 60))
    if minutes < 60:
        when = f"in {minutes} minutes"
    elif minutes < 90:
        when = "in about an hour"
    else:
        when = f"in about {round(minutes / 60)} hours"
    return f"Your date with {other_name} at {place} starts {when}"


async def send_due_reminders(hub: Hub, now: datetime | None = None) -> int:
    """Remind both people about accepted dates starting soon. Returns how many were sent."""
    now = now or utcnow()
    sent = 0
    async with hub.db.session() as session:
        due = (
            await session.scalars(
                select(DateProposal).where(
                    DateProposal.status == DateStatus.ACCEPTED,
                    DateProposal.reminded_at.is_(None),
                    DateProposal.starts_at > now,
                    DateProposal.starts_at <= now + REMIND_BEFORE,
                )
            )
        ).all()
        for proposal in due:
            claimed = await session.execute(
                update(DateProposal)
                .where(DateProposal.id == proposal.id, DateProposal.reminded_at.is_(None))
                .values(reminded_at=now)
            )
            await session.commit()
            if claimed.rowcount != 1:  # another worker got there first
                continue
            match = await session.get(Match, proposal.match_id)
            if match is None:
                continue
            for person in (match.user_a, match.user_b):
                other = match.other_user(person.id)
                if person.is_persona:
                    continue
                await notify(
                    session,
                    hub,
                    person.id,
                    NotificationKind.DATE_REMINDER,
                    actor_id=other.id,
                    match_id=match.id,
                    body=reminder_text(proposal.place, proposal.starts_at, other.name, now),
                )
            sent += 1
    return sent


async def run(hub: Hub, interval: float) -> None:
    """The loop the app starts on startup and cancels on shutdown."""
    while True:
        try:
            await send_due_reminders(hub)
        except Exception:  # a bad pass must not stop future reminders
            log.exception("sending date reminders failed")
        try:
            await send_due_digests(hub)
        except Exception:
            log.exception("sending email digests failed")
        await asyncio.sleep(interval)
