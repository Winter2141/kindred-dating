"""Demo data: a signed-in demo user, a second real account and ~45 personas.

Run `python -m app.seed --reset` to wipe the database and seed again.
"""

import argparse
import asyncio
import random
import secrets
import unicodedata
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base, Database, utcnow
from app.models import (
    Match,
    Message,
    Notification,
    NotificationKind,
    QuestionAnswer,
    Report,
    ReportReason,
    ReportStatus,
    Swipe,
    SwipeAction,
    User,
    VerificationRequest,
    VerificationStatus,
)
from app.places import geocode
from app.questions import QUESTIONS
from app.security import hash_password
from app.seed_data import DEMO_EMAIL, DEMO_PASSWORD, PERSONAS, SECOND_DEMO_EMAIL, unsplash
from app.services.matching import years_before

# Alex's existing conversations: (persona, hours since match, [(sender, text), ...], unread)
CONVERSATIONS: list[tuple[str, int, list[tuple[str, str]], int]] = [
    (
        "Maya",
        50,
        [
            ("alex", "A pastry chef who's into vinyl? You might be my favourite person on here."),
            ("them", "Ha! Bold opening. What's spinning on your turntable this week?"),
            ("alex", "Rumours, as always. Fleetwood Mac is my comfort food."),
            ("them", "Respect. I'm more of a Khruangbin-while-baking person 🎶"),
            ("alex", "That's a perfect baking soundtrack. What are you making this week?"),
            ("them", "Testing a cardamom bun recipe. I might need an honest taste tester…"),
        ],
        0,
    ),
    (
        "Sofia",
        26,
        [
            (
                "alex",
                "Hi Sofia! Cycling the Portuguese coast with a disposable camera sounds dreamy.",
            ),
            ("them", "It was! Half the photos came out blurry but that's the charm 📷"),
            ("them", "You're into photography too. Film or digital?"),
        ],
        2,
    ),
    (
        "Priya",
        74,
        [
            ("them", "Okay, I have to know. Is the lie that you've never seen Star Wars?"),
            ("alex", "Nope, that one's true! The lie is Mont Blanc. I only did half of it."),
            ("them", "Half counts. I'd give you partial credit 😄"),
            ("alex", "Generous. So when are you taking me climbing?"),
        ],
        0,
    ),
    ("Hazel", 5, [], 0),
    ("Leila", 2, [], 0),
]
# People who already liked Alex but aren't matched yet: they appear in "Likes you".
LIKED_ALEX = {
    "Chloe": SwipeAction.SUPER,
    "Zoe": SwipeAction.SUPER,
    "Amara": SwipeAction.LIKE,
    "Nora": SwipeAction.LIKE,
    "Talia": SwipeAction.LIKE,
    "Harper": SwipeAction.LIKE,
}
# Open reports so the moderation queue has something in it: (reporter, reported, reason, details)
REPORTS = [
    (
        "Elena",
        "Ryan",
        ReportReason.SPAM,
        "Asked me to move to WhatsApp after two messages, then pitched a crypto course.",
    ),
    ("Grace", "Ryan", ReportReason.SPAM, "Same copy-pasted investment pitch."),
    ("Ivy", "Owen", ReportReason.FAKE_PROFILE, "The photos look like a model's portfolio."),
    (
        "Nadia",
        "Henrik",
        ReportReason.HARASSMENT,
        "Kept messaging after I said I wasn't interested.",
    ),
]
# Reports a moderator already looked at and dismissed, so the Trends tab has a history.
PAST_REPORTS = 18
PAST_REASONS = [
    ReportReason.SPAM,
    ReportReason.SPAM,
    ReportReason.FAKE_PROFILE,
    ReportReason.INAPPROPRIATE,
    ReportReason.HARASSMENT,
    ReportReason.OTHER,
]


def _ascii(name: str) -> str:
    """ "Inês" -> "ines", for persona email addresses."""
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()


def _birthdate(age: int, today: date, rng: random.Random) -> date:
    return years_before(today, age) - timedelta(days=rng.randint(10, 340))


def _build_alex(password_hash: str, now: datetime, rng: random.Random) -> User:
    return User(
        email=DEMO_EMAIL,
        password_hash=password_hash,
        name="Alex",
        is_admin=True,  # so the demo can show the moderation queue
        birthdate=_birthdate(30, now.date(), rng),
        gender="man",
        interested_in=["woman"],
        age_min=24,
        age_max=36,
        bio="Product designer who'd rather be on a trail. Will cook for you, badly at first.",
        job_title="Product designer",
        city="Brooklyn, NY",
        interests=["Coffee", "Hiking", "Vinyl", "Cooking", "Film", "Dogs", "Photography"],
        photos=[unsplash("1492562080023-ab3db95bfbce")],
        prompts=[
            {
                "question": "Two truths and a lie",
                "answer": "I've hiked Mont Blanc, I make my own pasta, I've never seen Star Wars",
            },
            {
                "question": "My ideal Sunday",
                "answer": "Record shop crawl, a long walk, then cooking something ambitious",
            },
        ],
        created_at=now - timedelta(days=40),
        last_active_at=now,
    )


async def seed_demo_data(db: Database) -> bool:
    """Seed an empty database. Returns False if there was already data."""
    async with db.session() as session:
        if await session.scalar(select(User.id).limit(1)) is not None:
            return False

        rng = random.Random(7)
        now = utcnow()
        demo_hash = hash_password(DEMO_PASSWORD)
        locked_hash = hash_password(secrets.token_urlsafe(32))  # personas can't sign in

        alex = _build_alex(demo_hash, now, rng)
        session.add(alex)
        people: dict[str, User] = {}
        for index, spec in enumerate(PERSONAS):
            is_maya = spec.name == "Maya"
            user = User(
                email=SECOND_DEMO_EMAIL
                if is_maya
                else f"{_ascii(spec.name)}.{index}@personas.kindred.app",
                password_hash=demo_hash if is_maya else locked_hash,
                name=spec.name,
                birthdate=_birthdate(spec.age, now.date(), rng),
                gender=spec.gender,
                interested_in=spec.interested_in,
                age_min=max(18, spec.age - 7),
                age_max=spec.age + 8,
                bio=spec.bio,
                job_title=spec.job,
                city=spec.city,
                interests=spec.interests,
                photos=[unsplash(spec.photo)],
                prompts=[{"question": q, "answer": a} for q, a in spec.prompts],
                is_persona=not is_maya,
                created_at=now - timedelta(days=rng.randint(5, 120)),
                last_active_at=now
                - timedelta(minutes=rng.choice([2, 4, 15, 50, 130, 400, 1500, 4000])),
            )
            session.add(user)
            people[spec.name] = user
        for user in [alex, *people.values()]:
            if (coordinates := geocode(user.city)) is not None:
                user.latitude, user.longitude = coordinates
        for spec in PERSONAS:
            if spec.visiting and (coordinates := geocode(spec.visiting)) is not None:
                visitor = people[spec.name]
                visitor.travel_place = spec.visiting
                visitor.travel_latitude, visitor.travel_longitude = coordinates
                visitor.travel_until = now + timedelta(days=6)
        await session.flush()

        for name, hours_ago, lines, unread in CONVERSATIONS:
            other = people[name]
            matched_at = now - timedelta(hours=hours_ago)
            session.add_all(
                [
                    Swipe(
                        swiper_id=alex.id,
                        target_id=other.id,
                        action=SwipeAction.LIKE,
                        created_at=matched_at - timedelta(hours=3),
                    ),
                    Swipe(
                        swiper_id=other.id,
                        target_id=alex.id,
                        action=SwipeAction.LIKE,
                        created_at=matched_at,
                    ),
                ]
            )
            a_id, b_id = Match.ordered_pair(alex.id, other.id)
            match = Match(
                user_a_id=a_id, user_b_id=b_id, created_at=matched_at, last_activity_at=matched_at
            )
            session.add(match)
            await session.flush()

            sent_at = matched_at
            for position, (who, text) in enumerate(lines):
                sent_at += timedelta(minutes=rng.randint(4, 95))
                is_unread = position >= len(lines) - unread
                session.add(
                    Message(
                        match_id=match.id,
                        sender_id=alex.id if who == "alex" else other.id,
                        body=text,
                        created_at=sent_at,
                        read_at=None if is_unread else sent_at + timedelta(minutes=2),
                    )
                )
            match.last_activity_at = sent_at
            # The bell starts with the newest matches and the chat Alex hasn't read yet.
            if not lines or unread:
                session.add(
                    Notification(
                        user_id=alex.id,
                        kind=NotificationKind.MESSAGE if unread else NotificationKind.MATCH,
                        actor_id=other.id,
                        match_id=match.id,
                        body=lines[-1][1] if unread else "",
                        count=max(unread, 1),
                        created_at=sent_at,
                    )
                )

        for name, action in LIKED_ALEX.items():
            liked_at = now - timedelta(hours=rng.randint(1, 30))
            session.add(
                Swipe(
                    swiper_id=people[name].id,
                    target_id=alex.id,
                    action=action,
                    created_at=liked_at,
                )
            )
            super_like = action is SwipeAction.SUPER
            session.add(
                Notification(
                    user_id=alex.id,
                    kind=NotificationKind.SUPER_LIKE if super_like else NotificationKind.LIKE,
                    actor_id=people[name].id,
                    created_at=liked_at,
                    read_at=None if super_like else liked_at + timedelta(minutes=30),
                )
            )
        for hours_ago, (reporter, reported, reason, details) in enumerate(REPORTS, start=3):
            session.add(
                Report(
                    reporter_id=people[reporter].id,
                    reported_id=people[reported].id,
                    reason=reason,
                    details=details,
                    created_at=now - timedelta(hours=hours_ago * 5),
                )
            )
        _seed_report_history(alex, list(people.values()), now, session)
        # The man in the open harassment report kept going; moderators see the count.
        people["Henrik"].unkind_messages = 3
        for user in [alex, *people.values()]:
            user.email_verified_at = user.created_at
        _seed_answers([alex, *people.values()], session)
        _seed_verification(list(people.values()), now, session)
        await session.commit()
    return True


def _seed_verification(people: list[User], now: datetime, session: AsyncSession) -> None:
    """A third of the personas are verified, and two selfies wait in the moderation queue."""
    for index, person in enumerate(people):
        if index % 3 == 0:
            person.verified_at = person.created_at + timedelta(days=1)
    waiting = [p for i, p in enumerate(people) if i % 3 != 0][:2]
    for hours_ago, (person, pose) in enumerate(zip(waiting, ("peace", "thumbs_up"), strict=True)):
        session.add(
            VerificationRequest(
                user_id=person.id,
                pose=pose,
                selfie_url=person.photos[0],
                status=VerificationStatus.PENDING,
                created_at=now - timedelta(hours=hours_ago + 2),
                submitted_at=now - timedelta(hours=hours_ago + 1),
            )
        )


def _seed_report_history(
    moderator: User, people: list[User], now: datetime, session: AsyncSession
) -> None:
    """Three weeks of reports that were handled within a day or so, oldest first."""
    rng = random.Random(13)  # its own stream, like _seed_answers, so nothing else shifts
    for _ in range(PAST_REPORTS):
        reporter, reported = rng.sample(people, k=2)
        filed = now - timedelta(days=rng.uniform(1.5, 21), hours=rng.uniform(0, 12))
        session.add(
            Report(
                reporter_id=reporter.id,
                reported_id=reported.id,
                reason=rng.choice(PAST_REASONS),
                details="",
                status=ReportStatus.DISMISSED,
                created_at=filed,
                resolved_at=filed + timedelta(hours=rng.uniform(0.5, 30)),
                resolved_by_id=moderator.id,
            )
        )


def _seed_answers(users: list[User], session: AsyncSession) -> None:
    """Everyone answers a dozen questions, so agreement scores show up in the demo."""
    rng = random.Random(11)  # separate from the main seed so the rest of the data is unchanged
    for user in users:
        for question in rng.sample(QUESTIONS, k=12):
            answer = rng.randrange(len(question.options))
            # Most people are fine with their own answer and one either side of it.
            acceptable = sorted(
                {answer, *(i for i in (answer - 1, answer + 1) if 0 <= i < len(question.options))}
            )
            if rng.random() < 0.3:
                acceptable = [answer]
            session.add(
                QuestionAnswer(
                    user_id=user.id,
                    question_id=question.id,
                    answer=answer,
                    acceptable=acceptable,
                    importance=rng.choice([0, 1, 1, 2]),
                )
            )


async def _main(reset: bool) -> None:
    from app.config import get_settings

    db = Database(get_settings().database_url)
    if reset:
        from app import models  # noqa: F401

        async with db.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    await db.migrate()
    seeded = await seed_demo_data(db)
    await db.dispose()
    print("Seeded demo data." if seeded else "Database already has data; use --reset to reseed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop all tables first")
    asyncio.run(_main(parser.parse_args().reset))
