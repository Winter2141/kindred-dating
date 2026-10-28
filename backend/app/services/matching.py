"""Who shows up in Discover, and how well two people fit."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import User


def age_on(birthdate: date, today: date) -> int:
    had_birthday = (today.month, today.day) >= (birthdate.month, birthdate.day)
    return today.year - birthdate.year - (0 if had_birthday else 1)


def years_before(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:  # 29 February in a non-leap year
        return day.replace(year=day.year - years, day=28)


def birthdate_bounds(age_min: int, age_max: int, today: date) -> tuple[date, date]:
    """Inclusive birthdate range for people aged age_min..age_max on `today`."""
    latest = years_before(today, age_min)
    earliest = years_before(today, age_max + 1) + timedelta(days=1)
    return earliest, latest


def is_mutual_fit(me: "User", other: "User", today: date) -> bool:
    """Both people match each other's gender and age preferences."""
    my_age, their_age = age_on(me.birthdate, today), age_on(other.birthdate, today)
    return (
        other.gender in me.interested_in
        and me.gender in other.interested_in
        and me.age_min <= their_age <= me.age_max
        and other.age_min <= my_age <= other.age_max
    )


@dataclass(frozen=True)
class Compatibility:
    score: int
    shared_interests: list[str]


# Weights add up to 100.
INTEREST_WEIGHT = 55
AGE_WEIGHT = 25
ACTIVITY_WEIGHT = 20


def compatibility(me: "User", other: "User", now: datetime | None = None) -> Compatibility:
    """A transparent 0-100 score.

    - Shared interests (55): overlap relative to the smaller interest list, so someone with
      three interests that all match you scores as high as someone with eight.
    - Age closeness (25): full marks within 2 years, fading out at a 12 year gap.
    - Recent activity (20): full marks if active today, fading out over two weeks.
    """
    now = now or datetime.now(UTC)
    shared = [i for i in other.interests if i in set(me.interests)]
    smaller = min(len(me.interests), len(other.interests))
    interest_part = len(shared) / smaller if smaller else 0.0

    gap = abs(age_on(me.birthdate, now.date()) - age_on(other.birthdate, now.date()))
    age_part = 1.0 if gap <= 2 else max(0.0, 1 - (gap - 2) / 10)

    idle_days = max(0.0, (now - other.last_active_at).total_seconds() / 86400)
    activity_part = 1.0 if idle_days <= 1 else max(0.0, 1 - (idle_days - 1) / 13)

    score = (
        INTEREST_WEIGHT * interest_part + AGE_WEIGHT * age_part + ACTIVITY_WEIGHT * activity_part
    )
    return Compatibility(score=round(score), shared_interests=shared)
