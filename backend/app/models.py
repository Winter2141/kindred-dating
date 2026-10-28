from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow


class Gender(StrEnum):
    WOMAN = "woman"
    MAN = "man"
    NONBINARY = "nonbinary"


class SwipeAction(StrEnum):
    LIKE = "like"
    PASS = "pass"
    SUPER = "super"

    @property
    def is_positive(self) -> bool:
        return self is not SwipeAction.PASS


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))

    name: Mapped[str] = mapped_column(String(50))
    birthdate: Mapped[date] = mapped_column(Date)
    gender: Mapped[str] = mapped_column(String(16))
    interested_in: Mapped[list[str]] = mapped_column(JSON, default=list)
    age_min: Mapped[int] = mapped_column(default=18)
    age_max: Mapped[int] = mapped_column(default=99)

    bio: Mapped[str] = mapped_column(Text, default="")
    job_title: Mapped[str] = mapped_column(String(80), default="")
    city: Mapped[str] = mapped_column(String(80), default="")
    # JSON columns are only change-tracked on reassignment, so always assign a new list.
    interests: Mapped[list[str]] = mapped_column(JSON, default=list)
    photos: Mapped[list[str]] = mapped_column(JSON, default=list)
    prompts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    is_persona: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (CheckConstraint("age_min <= age_max", name="ck_users_age_range"),)


class Swipe(Base):
    __tablename__ = "swipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    swiper_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("swiper_id", "target_id", name="uq_swipes_pair"),)


class Match(Base):
    """A mutual like. The pair is stored with user_a_id < user_b_id so it is unique."""

    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user_a: Mapped[User] = relationship(foreign_keys=[user_a_id], lazy="joined")
    user_b: Mapped[User] = relationship(foreign_keys=[user_b_id], lazy="joined")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="match", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_matches_pair"),
        CheckConstraint("user_a_id < user_b_id", name="ck_matches_order"),
    )

    @staticmethod
    def ordered_pair(first: int, second: int) -> tuple[int, int]:
        return (first, second) if first < second else (second, first)

    def includes(self, user_id: int) -> bool:
        return user_id in (self.user_a_id, self.user_b_id)

    def other_id(self, user_id: int) -> int:
        return self.user_b_id if user_id == self.user_a_id else self.user_a_id

    def other_user(self, user_id: int) -> User:
        return self.user_b if user_id == self.user_a_id else self.user_a


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    match: Mapped[Match] = relationship(back_populates="messages")

    __table_args__ = (Index("ix_messages_match_id_id", "match_id", "id"),)
