from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import DateTime, event, inspect
from sqlalchemy.engine import Connection, Dialect
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator

MIGRATIONS_DIR = Path(__file__).with_name("migrations")
# The schema the app had before it used migrations; such databases are stamped with it.
BASELINE_REVISION = "0001"


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Stores aware datetimes as UTC and always hands back aware datetimes.

    SQLite has no time zone support, so without this every value read back would be naive.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    pass


class Database:
    def __init__(self, url: str) -> None:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine: AsyncEngine = create_async_engine(url, connect_args=connect_args)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)

        if url.startswith("sqlite"):

            @event.listens_for(self.engine.sync_engine, "connect")
            def _enable_foreign_keys(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

    async def migrate(self) -> None:
        """Bring the schema up to date with the latest migration."""
        async with self.engine.begin() as conn:
            await conn.run_sync(run_migrations)

    def session(self) -> AsyncSession:
        return self.sessionmaker()

    async def dispose(self) -> None:
        await self.engine.dispose()


def run_migrations(connection: Connection) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["connection"] = connection
    tables = inspect(connection).get_table_names()
    if "users" in tables and "alembic_version" not in tables:
        command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, "head")
