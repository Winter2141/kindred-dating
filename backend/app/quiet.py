"""Quiet hours: a nightly window, in someone's own time zone, when nothing should buzz.

Stored on the user as {"start": 22, "end": 8, "timezone": "America/New_York"}. During it,
email digests wait until morning (app.services.digest) and the web app holds back desktop
notifications. Everything still lands in the app, so nothing is lost, just not announced.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def in_window(hour: int, start: int, end: int) -> bool:
    """Whether `hour` is in [start, end), wrapping past midnight when start > end."""
    if start == end:
        return False
    return start <= hour < end if start < end else hour >= start or hour < end


def is_quiet(quiet: dict[str, Any] | None, now: datetime) -> bool:
    if not quiet:
        return False
    try:
        local = now.astimezone(ZoneInfo(quiet["timezone"]))
        return in_window(local.hour, int(quiet["start"]), int(quiet["end"]))
    except (KeyError, TypeError, ValueError, ZoneInfoNotFoundError):
        return False  # a bad saved value shouldn't hold mail back forever
