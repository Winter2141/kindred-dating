"""Alembic environment.

The app runs migrations itself on startup (see `app.db.run_migrations`), handing over an
open connection. The `alembic` command line builds its own engine from the settings.
"""

import asyncio
from typing import Any

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app import models  # noqa: F401  (registers the tables)
from app.db import Base, UTCDateTime

target_metadata = Base.metadata


def render_item(type_: str, obj: Any, autogen_context: Any) -> str | bool:
    """Write UTCDateTime as a plain DateTime so migrations don't import app code."""
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False


def configure(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite can only change columns by copying the table
        compare_type=True,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    from app.config import get_settings

    engine = create_async_engine(get_settings().database_url)
    async with engine.connect() as connection:
        await connection.run_sync(configure)
        await connection.commit()
    await engine.dispose()


connection = context.config.attributes.get("connection")
if connection is not None:
    configure(connection)
else:
    asyncio.run(run_online())
