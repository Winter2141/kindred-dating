"""How complete a profile is, and what would improve it most."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import User

GOOD_BIO_LENGTH = 60


@dataclass(frozen=True)
class Tip:
    key: str
    text: str
    points: int


@dataclass(frozen=True)
class Strength:
    score: int
    tips: list[Tip]


def profile_strength(user: "User") -> Strength:
    """A 0-100 score from six parts, and tips for the missing points, biggest first.

    - Photos (25): 3+ photos for full marks, partial credit for 1-2.
    - Prompts (20): two answered prompts.
    - Bio (15): a few sentences, at least 60 characters.
    - Interests (15): five or more.
    - Location (15): a known place or a shared location, so distances work.
    - Work (10): a job title.
    """
    parts: list[tuple[str, int, int, str]] = []  # (key, earned, possible, tip)

    photos = len(user.photos)
    photo_tip = (
        "Add a photo. Profiles without one rarely get likes"
        if photos == 0
        else f"Add {3 - photos} more photo{'s' if 3 - photos > 1 else ''}: show your hobbies"
    )
    parts.append(("photos", round(25 * min(photos, 3) / 3), 25, photo_tip))

    prompts = len(user.prompts)
    parts.append(
        (
            "prompts",
            10 * min(prompts, 2),
            20,
            "Answer a prompt: they make great conversation openers",
        )
    )

    bio_length = len(user.bio.strip())
    bio_points = 15 if bio_length >= GOOD_BIO_LENGTH else (7 if bio_length else 0)
    parts.append(
        ("bio", bio_points, 15, "Write a bio of a few sentences so people get a sense of you")
    )

    interests = len(user.interests)
    parts.append(
        (
            "interests",
            3 * min(interests, 5),
            15,
            "Pick at least five interests to find people like you",
        )
    )

    has_location = user.latitude is not None and user.longitude is not None
    parts.append(
        (
            "location",
            15 if has_location else 0,
            15,
            "Set your neighbourhood so we can show distances",
        )
    )

    parts.append(("work", 10 if user.job_title.strip() else 0, 10, "Add what you do for work"))

    score = sum(earned for _, earned, _, _ in parts)
    tips = [
        Tip(key=key, text=text, points=possible - earned)
        for key, earned, possible, text in parts
        if earned < possible
    ]
    tips.sort(key=lambda tip: tip.points, reverse=True)
    return Strength(score=score, tips=tips)
