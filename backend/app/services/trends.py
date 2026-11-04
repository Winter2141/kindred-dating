"""Moderation trends: how fast the queue moves and what people report, day by day.

Like the personal insights, the window is short (at most 90 days), so rows are bucketed by
day in Python, which keeps date handling the same on SQLite and Postgres.
"""

import statistics
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Report, ReportStatus, User


@dataclass
class TrendDay:
    day: date
    reports_filed: int = 0
    reports_resolved: int = 0
    new_members: int = 0


@dataclass
class Trends:
    days: int
    reports_filed: int = 0
    reports_resolved: int = 0
    new_members: int = 0
    # Over reports resolved in the window; None until there's at least one.
    median_hours_to_resolve: float | None = None
    # How long the oldest report still open has been waiting, right now.
    oldest_open_hours: float | None = None
    by_reason: list[tuple[str, int]] = field(default_factory=list)
    activity: list[TrendDay] = field(default_factory=list)


def _hours(delta: timedelta) -> float:
    return round(delta.total_seconds() / 3600, 1)


async def build_trends(session: AsyncSession, now: datetime, days: int) -> Trends:
    since = now - timedelta(days=days)
    calendar = {
        (since + timedelta(days=offset + 1)).date(): TrendDay(
            (since + timedelta(days=offset + 1)).date()
        )
        for offset in range(days)
    }
    result = Trends(days=days)

    def bump(when: datetime | None, attribute: str) -> None:
        if when is not None and (day := calendar.get(when.date())) is not None:
            setattr(day, attribute, getattr(day, attribute) + 1)

    reports = await session.scalars(
        select(Report).where(or_(Report.created_at >= since, Report.resolved_at >= since))
    )
    reasons: Counter[str] = Counter()
    waits: list[float] = []
    for report in reports:
        if report.created_at >= since:
            result.reports_filed += 1
            reasons[report.reason] += 1
            bump(report.created_at, "reports_filed")
        if report.resolved_at is not None and report.resolved_at >= since:
            result.reports_resolved += 1
            waits.append(_hours(report.resolved_at - report.created_at))
            bump(report.resolved_at, "reports_resolved")

    joined = await session.scalars(select(User.created_at).where(User.created_at >= since))
    for created_at in joined:
        result.new_members += 1
        bump(created_at, "new_members")

    oldest = await session.scalar(
        select(Report.created_at)
        .where(Report.status == ReportStatus.OPEN)
        .order_by(Report.created_at.asc())
        .limit(1)
    )
    result.oldest_open_hours = _hours(now - oldest) if oldest is not None else None
    result.median_hours_to_resolve = round(statistics.median(waits), 1) if waits else None
    result.by_reason = reasons.most_common()
    result.activity = list(calendar.values())
    return result
