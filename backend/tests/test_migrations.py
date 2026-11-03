from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app import models  # noqa: F401
from app.db import BASELINE_REVISION, Base, alembic_config, run_migrations


def _engine(path: Path):
    return create_engine(f"sqlite:///{path.as_posix()}")


def test_migrations_build_the_same_schema_as_the_models(tmp_path: Path) -> None:
    engine = _engine(tmp_path / "migrated.db")
    with engine.begin() as connection:
        run_migrations(connection)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []


def test_databases_from_before_migrations_are_adopted(tmp_path: Path) -> None:
    engine = _engine(tmp_path / "legacy.db")
    with engine.begin() as connection:
        # What create_all produced before migrations existed: the baseline schema, unversioned.
        command.upgrade(alembic_config(connection), BASELINE_REVISION)
        connection.execute(text("DROP TABLE alembic_version"))
        connection.execute(
            text(
                "INSERT INTO users (email, password_hash, name, birthdate, gender, interested_in,"
                " age_min, age_max, bio, job_title, city, interests, photos, prompts,"
                " is_persona, created_at, last_active_at) VALUES ('a@b.co', 'x', 'A',"
                " '1990-01-01', 'man', '[]', 18, 99, '', '', '', '[]', '[]', '[]', 0,"
                " '2026-01-01', '2026-01-01')"
            )
        )
    with engine.begin() as connection:
        run_migrations(connection)  # must not try to create the tables again
    with engine.connect() as connection:
        assert "alembic_version" in inspect(connection).get_table_names()
        version = connection.scalar(text("SELECT version_num FROM alembic_version"))
        assert version is not None and version > BASELINE_REVISION
        assert connection.scalar(text("SELECT count(*) FROM users")) == 1
