import asyncio
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import scheduler
from app.broker import RedisBroker
from app.config import Settings, get_settings
from app.db import Database
from app.limits import RateLimiter, RedisRateLimiter
from app.observability import Metrics, RequestContextMiddleware, configure_logging
from app.realtime import ConnectionManager, Hub
from app.routers import (
    account,
    admin,
    admin_users,
    announcements,
    auth,
    dates,
    devices,
    discover,
    email,
    email_change,
    matches,
    notifications,
    questions,
    safety,
    search,
    travel,
    two_factor,
    users,
    verification,
    views,
    ws,
)
from app.seed import seed_demo_data


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.media_dir.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(settings.database_url)
        await db.migrate()
        if settings.seed_on_startup:
            await seed_demo_data(db)
        broker = RedisBroker.from_url(settings.redis_url) if settings.redis_url else None
        # With Redis, rate limits are counted across every worker, not per process.
        limiter = (
            RedisRateLimiter.from_url(settings.redis_url) if settings.redis_url else RateLimiter()
        )
        app.state.hub = hub = Hub(
            settings=settings, db=db, manager=ConnectionManager(broker), limiter=limiter
        )
        await hub.manager.start()
        # Not a hub task: hub.drain() waits for those to finish, and this loop never does.
        jobs = (
            asyncio.create_task(scheduler.run(hub, settings.scheduler_interval_seconds))
            if settings.scheduler_interval_seconds > 0
            else None
        )
        yield
        if jobs is not None:
            jobs.cancel()
            await asyncio.gather(jobs, return_exceptions=True)
        await hub.shutdown()
        await hub.manager.stop()
        await db.dispose()

    app = FastAPI(
        title="Kindred API",
        version="1.0.0",
        description="Profiles, matching and real-time chat for the Kindred dating app.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (
        auth,
        two_factor,
        email,
        email_change,
        travel,
        users,
        questions,
        account,
        devices,
        discover,
        matches,
        search,
        dates,
        notifications,
        safety,
        verification,
        views,
        admin,
        admin_users,
        announcements,
        ws,
    ):
        app.include_router(module.router)
    app.mount(settings.media_url, StaticFiles(directory=settings.media_dir), name="media")
    # Added last, so it wraps everything else and sees every request.
    metrics = Metrics()
    app.add_middleware(RequestContextMiddleware, metrics=metrics)

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/metrics", tags=["meta"], include_in_schema=False)
    async def prometheus(
        request: Request, authorization: Annotated[str | None, Header()] = None
    ) -> Response:
        """Prometheus metrics for this process."""
        if settings.metrics_token and not secrets.compare_digest(
            authorization or "", f"Bearer {settings.metrics_token}"
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Metrics need a token")
        people, sockets = request.app.state.hub.manager.local_counts()
        body = metrics.render(
            {
                "kindred_websocket_connections": ("Open WebSockets on this process.", sockets),
                "kindred_online_users": ("People with a WebSocket on this process.", people),
            }
        )
        return Response(body, media_type="text/plain; version=0.0.4; charset=utf-8")

    return app


configure_logging(get_settings().log_format)
app = create_app()
