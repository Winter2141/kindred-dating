from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime configuration, read from KINDRED_* environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="KINDRED_", extra="ignore")

    database_url: str = f"sqlite+aiosqlite:///{(BASE_DIR / 'kindred.db').as_posix()}"
    secret_key: str = "dev-only-secret-change-me-in-production"
    access_token_ttl_minutes: int = 60 * 24 * 7
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    media_dir: Path = BASE_DIR / "media"
    media_url: str = "/media"
    max_photo_bytes: int = 8 * 1024 * 1024
    max_photos: int = 6

    # Demo mode makes the seeded personas feel alive: they like you back and reply in chat.
    demo_mode: bool = True
    seed_on_startup: bool = True
    # Seconds a persona "reads" and then "types" before replying, as (min, max) ranges.
    persona_read_delay: tuple[float, float] = (0.8, 1.6)
    persona_typing_delay: tuple[float, float] = (1.6, 3.2)


@lru_cache
def get_settings() -> Settings:
    return Settings()
