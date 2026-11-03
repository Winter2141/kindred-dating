import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.broker import RedisBroker
from app.config import Settings, get_settings
from app.db import Database
from app.realtime import ConnectionManager, Hub
from app.routers import (
    account,
    admin,
    auth,
    dates,
    discover,
    email,
    matches,
    notifications,
    questions,
    safety,
    search,
    users,
    verification,
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
        app.state.hub = hub = Hub(settings=settings, db=db, manager=ConnectionManager(broker))
        await hub.manager.start()
        yield
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
        email,
        users,
        questions,
        account,
        discover,
        matches,
        search,
        dates,
        notifications,
        safety,
        verification,
        admin,
        ws,
    ):
        app.include_router(module.router)
    app.mount(settings.media_url, StaticFiles(directory=settings.media_dir), name="media")

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = create_app()
