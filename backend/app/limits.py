"""Sliding-window rate limits for the endpoints people (or scripts) could hammer.

`RateLimiter` keeps the counters in memory, which is right for a single process.
`RedisRateLimiter` keeps them in Redis sorted sets, so every API worker counts against the
same window; it's used whenever KINDRED_REDIS_URL is set. Both answer `check()` with the
seconds to wait, or None when the request may go ahead.
"""

import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


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


class Limiter(Protocol):
    async def check(self, key: str, limit: "Limit") -> float | None: ...


class RateLimiter:
    """In-memory sliding windows, one deque of timestamps per key."""

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

    async def check(self, key: str, limit: Limit) -> float | None:
        return self.hit(key, limit)

    def _sweep(self, now: float, longest: float = 60 * 60) -> None:
        """Forget keys that have been quiet longer than any window, so memory stays bounded."""
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - longest]:
            del self._hits[key]


class RedisRateLimiter:
    """Sliding windows shared by every worker: a sorted set of hit times per key.

    Each check runs in one MULTI transaction: drop hits older than the window, add this one,
    count. Over the limit, the hit is taken back out and the caller is told how long until
    the oldest hit leaves the window. Two workers racing at the limit may both be refused,
    which errs on the safe side.
    """

    PREFIX = "kindred:rate"

    def __init__(self, client: Any, clock: Callable[[], float] = time.time) -> None:
        self._redis = client
        self._clock = clock  # wall-clock time, so every worker agrees on it

    @classmethod
    def from_url(cls, url: str) -> "RedisRateLimiter":
        import redis.asyncio as redis  # optional dependency: pip install ".[redis]"

        return cls(redis.from_url(url))

    async def check(self, key: str, limit: Limit) -> float | None:
        now = self._clock()
        redis_key = f"{self.PREFIX}:{limit.name}:{key}"
        member = f"{now:.6f}:{secrets.token_hex(4)}"
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(redis_key, "-inf", now - limit.seconds)
            pipe.zadd(redis_key, {member: now})
            pipe.zcard(redis_key)
            pipe.zrange(redis_key, 0, 0, withscores=True)
            pipe.expire(redis_key, int(limit.seconds) + 1)
            _, _, count, oldest, _ = await pipe.execute()
        if count <= limit.requests:
            return None
        await self._redis.zrem(redis_key, member)
        first_at = oldest[0][1] if oldest else now
        return max(0.0, first_at + limit.seconds - now)
