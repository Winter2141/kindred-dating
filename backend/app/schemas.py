from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.catalog import INTERESTS, MAX_INTERESTS, MAX_PROMPTS, PROMPT_QUESTIONS, REACTIONS
from app.models import (
    DateProposal,
    DateStatus,
    Gender,
    Match,
    Message,
    Notification,
    NotificationKind,
    Report,
    ReportReason,
    ReportStatus,
    SwipeAction,
    User,
)
from app.services.matching import age_on, display_distance

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
Bio = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
MessageBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
Age = Annotated[int, Field(ge=18, le=99)]
DistanceKm = Annotated[int, Field(ge=1, le=500)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Password = Annotated[str, Field(min_length=8, max_length=128)]


class Prompt(BaseModel):
    question: str
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

    @field_validator("question")
    @classmethod
    def known_question(cls, value: str) -> str:
        if value not in PROMPT_QUESTIONS:
            raise ValueError("unknown prompt question")
        return value


def _check_interests(values: list[str]) -> list[str]:
    unknown = [v for v in values if v not in INTERESTS]
    if unknown:
        raise ValueError(f"unknown interests: {', '.join(unknown)}")
    if len(values) > MAX_INTERESTS:
        raise ValueError(f"pick at most {MAX_INTERESTS} interests")
    return list(dict.fromkeys(values))


def _check_prompts(values: list[Prompt]) -> list[Prompt]:
    if len(values) > MAX_PROMPTS:
        raise ValueError(f"answer at most {MAX_PROMPTS} prompts")
    if len({p.question for p in values}) != len(values):
        raise ValueError("each prompt can only be answered once")
    return values


class ProfileFields(BaseModel):
    """Editable profile fields shared by registration and profile updates."""

    bio: Bio = ""
    job_title: ShortText = ""
    city: ShortText = ""
    interests: list[str] = []
    prompts: list[Prompt] = []

    @field_validator("interests")
    @classmethod
    def valid_interests(cls, value: list[str]) -> list[str]:
        return _check_interests(value)

    @field_validator("prompts")
    @classmethod
    def valid_prompts(cls, value: list[Prompt]) -> list[Prompt]:
        return _check_prompts(value)


class RegisterIn(ProfileFields):
    email: EmailStr
    password: Password
    name: Name
    birthdate: date
    gender: Gender
    interested_in: Annotated[list[Gender], Field(min_length=1)]
    age_min: Age = 18
    age_max: Age = 99
    max_distance_km: DistanceKm = 50

    @field_validator("birthdate")
    @classmethod
    def adult(cls, value: date) -> date:
        if age_on(value, date.today()) < 18:
            raise ValueError("you must be at least 18 to join")
        return value

    @model_validator(mode="after")
    def age_range(self) -> Self:
        if self.age_min > self.age_max:
            raise ValueError("age_min must not be greater than age_max")
        return self


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: Password


class AccountDelete(BaseModel):
    password: str


class ProfileUpdate(BaseModel):
    name: Name | None = None
    bio: Bio | None = None
    job_title: ShortText | None = None
    city: ShortText | None = None
    interests: list[str] | None = None
    prompts: list[Prompt] | None = None
    interested_in: Annotated[list[Gender], Field(min_length=1)] | None = None
    age_min: Age | None = None
    age_max: Age | None = None
    max_distance_km: DistanceKm | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    is_paused: bool | None = None
    photos: list[str] | None = Field(
        default=None, description="Reorder or remove existing photos; new ones are uploaded."
    )

    @field_validator("interests")
    @classmethod
    def valid_interests(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _check_interests(value)

    @model_validator(mode="after")
    def coordinates_together(self) -> Self:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("send latitude and longitude together")
        return self

    @field_validator("prompts")
    @classmethod
    def valid_prompts(cls, value: list[Prompt] | None) -> list[Prompt] | None:
        return None if value is None else _check_prompts(value)


class PublicProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    age: int
    gender: Gender
    bio: str
    job_title: str
    city: str
    interests: list[str]
    photos: list[str]
    prompts: list[Prompt]
    last_active_at: datetime
    is_online: bool = False
    distance_km: int | None = None

    @classmethod
    def build(cls, user: User, *, online: bool = False, distance_km: float | None = None) -> Self:
        return cls(
            id=user.id,
            name=user.name,
            age=age_on(user.birthdate, date.today()),
            gender=Gender(user.gender),
            bio=user.bio,
            job_title=user.job_title,
            city=user.city,
            interests=user.interests,
            photos=user.photos,
            prompts=[Prompt.model_construct(**p) for p in user.prompts],
            last_active_at=user.last_active_at,
            is_online=online,
            distance_km=display_distance(distance_km),
        )


class MeOut(PublicProfile):
    email: EmailStr
    birthdate: date
    interested_in: list[Gender]
    age_min: int
    age_max: int
    max_distance_km: int
    has_location: bool
    is_paused: bool
    is_admin: bool

    @classmethod
    def build(cls, user: User, *, online: bool = True) -> Self:
        base = PublicProfile.build(user, online=online).model_dump()
        return cls(
            **base,
            email=user.email,
            birthdate=user.birthdate,
            interested_in=[Gender(g) for g in user.interested_in],
            age_min=user.age_min,
            age_max=user.age_max,
            max_distance_km=user.max_distance_km,
            has_location=user.latitude is not None,
            is_paused=user.is_paused,
            is_admin=user.is_admin,
        )


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: MeOut


class Candidate(PublicProfile):
    compatibility: int = Field(ge=0, le=100)
    shared_interests: list[str]
    super_liked_you: bool = False


class TopPick(Candidate):
    reason: str


class TopPicksOut(BaseModel):
    picks: list[TopPick]
    refreshes_at: datetime


class SwipeIn(BaseModel):
    target_id: int
    action: SwipeAction


class ReactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    emoji: str


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    sender_id: int
    body: str
    image_url: str | None = None
    created_at: datetime
    read_at: datetime | None
    deleted_at: datetime | None = None
    reactions: list[ReactionOut] = []


def _known_reaction(value: str | None) -> str | None:
    if value is not None and value not in REACTIONS:
        raise ValueError(f"reaction must be one of {' '.join(REACTIONS)}")
    return value


ReactionEmoji = Annotated[str | None, AfterValidator(_known_reaction)]


class ReactionIn(BaseModel):
    emoji: ReactionEmoji = Field(description="One of the quick reactions, or null to remove yours")


class MessageIn(BaseModel):
    body: MessageBody


class MatchOut(BaseModel):
    id: int
    user: PublicProfile
    created_at: datetime
    last_activity_at: datetime
    last_message: MessageOut | None = None
    unread_count: int = 0

    @classmethod
    def build(
        cls,
        match: Match,
        viewer_id: int,
        *,
        online: bool = False,
        last_message: Message | None = None,
        unread_count: int = 0,
    ) -> Self:
        return cls(
            id=match.id,
            user=PublicProfile.build(match.other_user(viewer_id), online=online),
            created_at=match.created_at,
            last_activity_at=match.last_activity_at,
            last_message=MessageOut.model_validate(last_message) if last_message else None,
            unread_count=unread_count,
        )


class SwipeOut(BaseModel):
    matched: bool
    match: MatchOut | None = None


class LikeOut(BaseModel):
    user: PublicProfile
    action: SwipeAction
    created_at: datetime


class Interest(BaseModel):
    name: str
    emoji: str


class MetaOut(BaseModel):
    interests: list[Interest]
    prompt_questions: list[str]
    genders: list[Gender]
    max_interests: int = MAX_INTERESTS
    max_prompts: int = MAX_PROMPTS
    max_photos: int
    reactions: list[str] = REACTIONS


class BlockIn(BaseModel):
    user_id: int


class ReportIn(BaseModel):
    user_id: int
    reason: ReportReason
    details: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""
    block: bool = Field(default=True, description="Also block them (recommended)")


class ReportedPerson(PublicProfile):
    email: EmailStr
    banned: bool
    open_reports: int


class ReportOut(BaseModel):
    id: int
    reason: ReportReason
    details: str
    status: ReportStatus
    created_at: datetime
    resolved_at: datetime | None
    reporter: PublicProfile
    reported: ReportedPerson

    @classmethod
    def build(cls, report: Report, open_reports: int) -> Self:
        reported = report.reported
        return cls(
            id=report.id,
            reason=ReportReason(report.reason),
            details=report.details,
            status=ReportStatus(report.status),
            created_at=report.created_at,
            resolved_at=report.resolved_at,
            reporter=PublicProfile.build(report.reporter),
            reported=ReportedPerson(
                **PublicProfile.build(reported).model_dump(),
                email=reported.email,
                banned=reported.banned_at is not None,
                open_reports=open_reports,
            ),
        )


class ResolveIn(BaseModel):
    action: Literal["dismiss", "ban"]


class ModerationStats(BaseModel):
    open_reports: int
    resolved_this_week: int
    banned_users: int
    total_users: int


class NotificationOut(BaseModel):
    id: int
    kind: NotificationKind
    actor: PublicProfile | None
    match_id: int | None
    body: str
    count: int
    created_at: datetime
    read_at: datetime | None

    @classmethod
    def build(cls, notification: Notification) -> Self:
        return cls(
            id=notification.id,
            kind=NotificationKind(notification.kind),
            actor=PublicProfile.build(notification.actor) if notification.actor else None,
            match_id=notification.match_id,
            body=notification.body,
            count=notification.count,
            created_at=notification.created_at,
            read_at=notification.read_at,
        )


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread: int


class DateIn(BaseModel):
    place: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    starts_at: AwareDatetime
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""


class DateResponseIn(BaseModel):
    response: Literal["accept", "decline"]


class DateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    proposer_id: int
    place: str
    starts_at: datetime
    note: str
    status: DateStatus
    created_at: datetime
    responded_at: datetime | None


class UpcomingDate(DateOut):
    with_user: PublicProfile

    @classmethod
    def build(cls, proposal: DateProposal, other: User) -> Self:
        base = DateOut.model_validate(proposal).model_dump()
        return cls(**base, with_user=PublicProfile.build(other))


class TipOut(BaseModel):
    key: str
    text: str
    points: int


class StrengthOut(BaseModel):
    score: int = Field(ge=0, le=100)
    tips: list[TipOut]


class ActivityDay(BaseModel):
    day: date
    likes_received: int
    matches: int
    messages: int


class InterestCount(BaseModel):
    interest: str
    count: int


class InsightsOut(BaseModel):
    days: int
    likes_sent: int
    passes_sent: int
    likes_received: int
    super_likes_received: int
    matches: int
    match_rate: float = Field(description="Matches per like you sent, 0-1")
    messages_sent: int
    messages_received: int
    reply_rate: float | None = Field(description="Share of their messages you answered, 0-1")
    median_reply_minutes: int | None
    liked_by_interests: list[InterestCount]
    activity: list[ActivityDay]
