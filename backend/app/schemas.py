from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.catalog import INTERESTS, MAX_INTERESTS, MAX_PROMPTS, PROMPT_QUESTIONS
from app.models import Gender, Match, Message, SwipeAction, User
from app.services.matching import age_on

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
Bio = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
MessageBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
Age = Annotated[int, Field(ge=18, le=99)]


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
    password: Annotated[str, Field(min_length=8, max_length=128)]
    name: Name
    birthdate: date
    gender: Gender
    interested_in: Annotated[list[Gender], Field(min_length=1)]
    age_min: Age = 18
    age_max: Age = 99

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
    photos: list[str] | None = Field(
        default=None, description="Reorder or remove existing photos; new ones are uploaded."
    )

    @field_validator("interests")
    @classmethod
    def valid_interests(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _check_interests(value)

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

    @classmethod
    def build(cls, user: User, *, online: bool = False) -> Self:
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
        )


class MeOut(PublicProfile):
    email: EmailStr
    birthdate: date
    interested_in: list[Gender]
    age_min: int
    age_max: int

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
        )


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: MeOut


class Candidate(PublicProfile):
    compatibility: int = Field(ge=0, le=100)
    shared_interests: list[str]
    super_liked_you: bool = False


class SwipeIn(BaseModel):
    target_id: int
    action: SwipeAction


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    sender_id: int
    body: str
    created_at: datetime
    read_at: datetime | None


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
