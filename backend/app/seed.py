"""Demo data: a signed-in demo user, a second real account and ~45 personas.

Run `python -m app.seed --reset` to wipe the database and seed again.
"""

import argparse
import asyncio
import random
import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.db import Base, Database, utcnow
from app.models import Match, Message, Swipe, SwipeAction, User
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


def _birthdate(age: int, today: date, rng: random.Random) -> date:
    return years_before(today, age) - timedelta(days=rng.randint(10, 340))


def _build_alex(password_hash: str, now: datetime, rng: random.Random) -> User:
    return User(
        email=DEMO_EMAIL,
        password_hash=password_hash,
        name="Alex",
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
                else f"{spec.name.lower()}.{index}@personas.kindred.app",
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

        for name, action in LIKED_ALEX.items():
            session.add(
                Swipe(
                    swiper_id=people[name].id,
                    target_id=alex.id,
                    action=action,
                    created_at=now - timedelta(hours=rng.randint(1, 30)),
                )
            )
        await session.commit()
    return True


async def _main(reset: bool) -> None:
    from app.config import get_settings

    db = Database(get_settings().database_url)
    if reset:
        from app import models  # noqa: F401

        async with db.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    await db.create_all()
    seeded = await seed_demo_data(db)
    await db.dispose()
    print("Seeded demo data." if seeded else "Database already has data; use --reset to reseed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop all tables first")
    asyncio.run(_main(parser.parse_args().reset))
