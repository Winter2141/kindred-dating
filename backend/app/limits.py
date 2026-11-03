"""Sliding-window rate limits for the endpoints people (or scripts) could hammer.

The counters live in memory, so they are per process, like the WebSocket hub. Behind
several workers, move them to Redis alongside the realtime broker.
"""

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Limit:
    name: str
    requests: int
    seconds: float


LOGIN = Limit("login", 10, 60)
REGISTER = Limit("register", 5, 60 * 60)
SWIPES = Limit("swipes", 120, 60)
MESSAGES = Limit("messages", 20, 10)
PHOTOS = Limit("photos", 20, 60 * 60)
VOICE_NOTES = Limit("voice-notes", 40, 60 * 60)
REPORTS = Limit("reports", 10, 60 * 60)
EMAILS = Limit("emails", 5, 60 * 60)
EXPORTS = Limit("exports", 10, 60 * 60)


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._calls = 0

    def hit(self, key: str, limit: Limit) -> float | None:
        """Count a request. Returns seconds to wait if it's over the limit, else None."""
        now = self._clock()
        window = self._hits.setdefault(f"{limit.name}:{key}", deque())
        while window and window[0] <= now - limit.seconds:
            window.popleft()
        self._calls += 1
        if self._calls % 1000 == 0:
            self._sweep(now)
        if len(window) >= limit.requests:
            return window[0] + limit.seconds - now
        window.append(now)
        return None

    def _sweep(self, now: float, longest: float = 60 * 60) -> None:
        """Forget keys that have been quiet longer than any window, so memory stays bounded."""
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - longest]:
            del self._hits[key]
