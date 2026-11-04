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
    false,
    text,
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


class ReportReason(StrEnum):
    FAKE_PROFILE = "fake_profile"
    INAPPROPRIATE = "inappropriate"
    HARASSMENT = "harassment"
    SPAM = "spam"
    UNDERAGE = "underage"
    OTHER = "other"


class ReportStatus(StrEnum):
    OPEN = "open"
    DISMISSED = "dismissed"
    ACTIONED = "actioned"


class NotificationKind(StrEnum):
    LIKE = "like"
    SUPER_LIKE = "super_like"
    MATCH = "match"
    MESSAGE = "message"
    DATE_REMINDER = "date_reminder"
    VERIFIED = "verified"
    VERIFICATION_REJECTED = "verification_rejected"


class VerificationStatus(StrEnum):
    AWAITING_PHOTO = "awaiting_photo"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class DateStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    CANCELLED = "cancelled"


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

    # Either a known place's centre or what the browser shared; never shown to anyone else.
    latitude: Mapped[float | None] = mapped_column(default=None)
    longitude: Mapped[float | None] = mapped_column(default=None)
    max_distance_km: Mapped[int] = mapped_column(default=50, server_default=text("50"))

    is_persona: Mapped[bool] = mapped_column(default=False)
    # Paused profiles keep their matches and chats but don't appear in anyone's deck.
    is_paused: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Bumped to revoke every token issued so far (password change, sign out everywhere).
    token_version: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    is_admin: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Banned accounts can't sign in and are hidden from everyone.
    banned_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Two-factor sign-in: the authenticator secret, when it was switched on, the last code's
    # time step (so a code can't be reused) and SHA-256 hashes of unused recovery codes.
    totp_secret: Mapped[str | None] = mapped_column(String(64), default=None)
    totp_enabled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    totp_last_counter: Mapped[int | None] = mapped_column(default=None)
    recovery_codes: Mapped[list[str] | None] = mapped_column(JSON, default=None)
    # Set once they follow the link in the confirmation email.
    email_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Set when a moderator matched a posed selfie to the profile photos.
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Which email digests they want (see app.services.digest); None means the defaults.
    email_prefs: Mapped[dict[str, bool] | None] = mapped_column(JSON, default=None)
    digest_sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        CheckConstraint("age_min <= age_max", name="ck_users_age_range"),
        Index("ix_users_location", "latitude", "longitude"),
    )


class Swipe(Base):
    __tablename__ = "swipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    swiper_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(8))
    # A like can point at something on their profile ("photo:2", "prompt:My ideal Sunday")
    # and carry a comment about it, which also opens the chat if it becomes a match.
    liked_item: Mapped[str | None] = mapped_column(String(140), default=None)
    comment: Mapped[str | None] = mapped_column(Text, default=None)
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
    # Photo messages carry an image and an optional caption in `body`.
    image_url: Mapped[str | None] = mapped_column(String(255), default=None)
    # Voice notes: the recording, its length and a coarse waveform (0-100 per bar) to draw.
    audio_url: Mapped[str | None] = mapped_column(String(255), default=None)
    audio_ms: Mapped[int | None] = mapped_column(default=None)
    waveform: Mapped[list[int] | None] = mapped_column(JSON, default=None)
    # Call log entries: "audio" or "video", and how long it lasted (None if not answered).
    call_kind: Mapped[str | None] = mapped_column(String(8), default=None)
    call_ms: Mapped[int | None] = mapped_column(default=None)
    # The message this one answers, quoted above it in the chat.
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Unsent messages keep their place in the conversation but lose their text.
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    match: Mapped[Match] = relationship(back_populates="messages")
    reactions: Mapped[list["Reaction"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, lazy="selectin", order_by="Reaction.id"
    )
    # Eager loaders skip self-references unless given a depth; one level is the quote itself,
    # so a quote never loads its own quote.
    reply_to: Mapped["Message | None"] = relationship(
        remote_side=[id], lazy="selectin", join_depth=1
    )

    __table_args__ = (Index("ix_messages_match_id_id", "match_id", "id"),)


class Reaction(Base):
    """One emoji per person per message; reacting again changes or removes it."""

    __tablename__ = "reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    emoji: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_reactions_message_user"),)


class Block(Base):
    """`blocker` never sees `blocked` again, and vice versa."""

    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_blocks_pair"),)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reported_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(24))
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default=ReportStatus.OPEN, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    resolved_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )

    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id], lazy="joined")
    reported: Mapped[User] = relationship(foreign_keys=[reported_id], lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), default=None
    )
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), default=None
    )
    body: Mapped[str] = mapped_column(Text, default="")
    # Missed messages from one chat collapse into a single notification with a count.
    count: Mapped[int] = mapped_column(default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id], lazy="joined")

    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)


class DateProposal(Base):
    """A first date suggested in a chat. At most one per match waits for an answer."""

    __tablename__ = "date_proposals"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    proposer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    place: Mapped[str] = mapped_column(String(120))
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default=DateStatus.PROPOSED)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Set once the "starts soon" reminder has gone out (see app.scheduler).
    reminded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class ChatSetting(Base):
    """How one person files a conversation: pinned to the top, muted, or archived."""

    __tablename__ = "chat_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    pinned_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Muted "until I turn it back on" is stored as a date far in the future.
    muted_until: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    __table_args__ = (UniqueConstraint("user_id", "match_id", name="uq_chat_settings_user_match"),)


class QuestionAnswer(Base):
    """One person's answer to a compatibility question (see app.questions)."""

    __tablename__ = "question_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(40))
    # Indexes into the question's options: mine, and the ones I'd accept from a partner.
    answer: Mapped[int] = mapped_column()
    acceptable: Mapped[list[int]] = mapped_column(JSON, default=list)
    # 0 = a little, 1 = somewhat, 2 = very
    importance: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_question_answers_user_question"),
    )


class VerificationRequest(Base):
    """A selfie copying a random pose, which a moderator compares with the profile photos."""

    __tablename__ = "verification_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pose: Mapped[str] = mapped_column(String(32))
    selfie_url: Mapped[str | None] = mapped_column(String(255), default=None)
    status: Mapped[str] = mapped_column(
        String(16), default=VerificationStatus.AWAITING_PHOTO, index=True
    )
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    reviewed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")


class AuditEvent(Base):
    """One moderator action (see app.services.audit). Rows are never edited or deleted."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(40), index=True)
    target_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, default=None
    )
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id], lazy="joined")
    target: Mapped[User | None] = relationship(foreign_keys=[target_user_id], lazy="joined")


class OutboxEmail(Base):
    """An email the outbox mail backend kept instead of sending (see app.mail)."""

    __tablename__ = "outbox_emails"

    id: Mapped[int] = mapped_column(primary_key=True)
    to: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class DeviceSession(Base):
    """One signed-in browser. Its id rides in the access token, so it can be signed out alone.

    A session is live while it isn't revoked or expired and was issued at the user's current
    token_version (bumping that, e.g. on a password change, ends every session at once).
    """

    __tablename__ = "device_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_version: Mapped[int] = mapped_column(default=0)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
