"""FastAPI dependencies that apply the limits in app.limits to a route."""

import math

from fastapi import Depends, HTTPException, Request, status

from app.deps import CurrentUser, HubDep
from app.limits import Limit


def _too_many(retry_after: float) -> HTTPException:
    seconds = max(1, math.ceil(retry_after))
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"Too many attempts. Try again in {seconds} second{'s' if seconds != 1 else ''}.",
        headers={"Retry-After": str(seconds)},
    )


def per_ip(limit: Limit) -> object:
    """Dependency that limits by client address, for endpoints used before signing in."""

    async def check(request: Request, hub: HubDep) -> None:
        if not hub.settings.rate_limit_enabled:
            return
        address = request.client.host if request.client else "unknown"
        if (wait := hub.limiter.hit(address, limit)) is not None:
            raise _too_many(wait)

    return Depends(check)


def per_user(limit: Limit) -> object:
    """Dependency that limits by signed-in user."""

    async def check(user: CurrentUser, hub: HubDep) -> None:
        if not hub.settings.rate_limit_enabled:
            return
        if (wait := hub.limiter.hit(str(user.id), limit)) is not None:
            raise _too_many(wait)

    return Depends(check)
