"""Small rule-based conversation engine for the seeded demo personas, plus icebreakers.

Nothing here calls an external model: replies are picked from hand-written pools based on
what the other person said, the interests both people share and the persona's own prompts.
"""

import random
import re
from collections.abc import Sequence
from typing import Protocol

from app.models import Message


class _Profile(Protocol):
    name: str
    city: str
    job_title: str
    interests: list[str]
    prompts: list[dict[str, str]]


INTEREST_TALK: dict[str, tuple[str, str]] = {
    # interest: (something the persona says about it, a question to ask back)
    "Coffee": (
        "I have a slightly embarrassing pour-over setup at home",
        "what's your order? I judge gently",
    ),
    "Hiking": (
        "I did Breakneck Ridge last month and my legs are still filing complaints",
        "what's the best trail you've done?",
    ),
    "Cooking": (
        "I've been on a handmade pasta kick lately",
        "what's your signature dish?",
    ),
    "Live music": (
        "the best night of my year so far was a tiny show in a basement bar",
        "who's the last band you saw live?",
    ),
    "Vinyl": (
        "I spent way too long in a record shop on Saturday",
        "what's the record you'd save in a fire?",
    ),
    "Photography": (
        "I shoot film, mostly street stuff, mostly out of focus",
        "do you shoot film or digital?",
    ),
    "Yoga": (
        "morning yoga is the only reason I'm a functional person",
        "are you a flow person or a hold-it-forever person?",
    ),
    "Running": (
        "I'm training for a half right now, so I'm 40% electrolytes",
        "do you run with music or podcasts?",
    ),
    "Climbing": (
        "I'm stuck on the same purple V4 at my gym and it's personal now",
        "bouldering or ropes?",
    ),
    "Travel": (
        "Lisbon is still my favourite trip, the custard tarts changed me",
        "where's next on your list?",
    ),
    "Books": (
        "I'm halfway through a novel I keep recommending to strangers",
        "what are you reading right now?",
    ),
    "Film": (
        "I'll watch anything at the little repertory cinema near me",
        "what's a movie you could rewatch forever?",
    ),
    "Wine": (
        "I'm slowly learning that I like orange wine, which feels like a personality now",
        "red, white or orange?",
    ),
    "Board games": (
        "I take board game night more seriously than I'd admit on a first date",
        "what's your go-to game?",
    ),
    "Dogs": (
        "I stop for every dog on the street, it makes me late to everything",
        "do you have a dog or just a dream dog?",
    ),
    "Cats": (
        "my cat runs the household, I'm just staff",
        "are you a cat person too?",
    ),
    "Baking": (
        "my sourdough starter is called Doughlores and she's thriving",
        "what do you love to bake?",
    ),
    "Dancing": (
        "I took a salsa class on a whim and now I'm hooked",
        "would you rather dance or watch?",
    ),
    "Brunch": (
        "brunch is my love language, specifically anything with hollandaise",
        "sweet or savoury brunch?",
    ),
    "Karaoke": (
        "my karaoke song is a power ballad and I commit fully",
        "what's your karaoke song?",
    ),
    "Museums": (
        "I could spend a whole day in the Met and still miss half of it",
        "favourite museum?",
    ),
    "Sushi": (
        "I found an omakase spot that ruined all other sushi for me",
        "what's your sushi order?",
    ),
    "Astronomy": (
        "I drove two hours to see a meteor shower and it was worth it",
        "have you ever seen the Milky Way properly?",
    ),
}

GREETINGS = re.compile(r"\b(hi|hey|hello|hiya|yo|howdy|good (morning|evening|afternoon))\b", re.I)
TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "work": ("work", "job", "do for", "career", "office"),
    "place": ("where", "live", "from", "neighborhood", "neighbourhood", "area"),
    "weekend": ("weekend", "sunday", "saturday", "plans", "tonight", "friday"),
    "date": ("drink", "date", "meet", "grab", "coffee sometime", "this week"),
}

REACTIONS = [
    "Ha, I love that.",
    "Okay, that's a great answer.",
    "Wait, same!",
    "That's honestly so charming.",
    "Noted, and approved.",
    "You're making a very good case for yourself.",
]
GENERIC_QUESTIONS = [
    "What's something you're excited about this month?",
    "What's the best thing you've eaten lately?",
    "What does a perfect day look like for you?",
    "What's your most controversial food opinion?",
    "What's a small thing that always makes your day better?",
]


def _cap(text: str) -> str:
    """Capitalise the first letter only (str.capitalize lowercases the rest)."""
    return text[:1].upper() + text[1:]


def _talk(interest: str | None) -> tuple[str, str] | None:
    return INTEREST_TALK.get(interest) if interest else None


def _prompt_answer(profile: _Profile, question: str) -> str | None:
    for prompt in profile.prompts:
        if prompt.get("question") == question:
            return prompt.get("answer")
    return None


def _topic(text: str) -> str | None:
    for topic, words in TOPIC_KEYWORDS.items():
        if any(word in text for word in words):
            return topic
    return None


def compose_reply(
    persona: _Profile,
    human: _Profile,
    history: Sequence[Message],
    persona_id: int,
    rng: random.Random | None = None,
) -> str:
    """Pick a persona's next message given the conversation so far."""
    rng = rng or random.Random()
    persona_turns = sum(1 for m in history if m.sender_id == persona_id)
    since_persona = []
    for message in reversed(history):
        if message.sender_id == persona_id:
            break
        since_persona.append(message.body)
    incoming = " ".join(reversed(since_persona)).lower()

    shared = [i for i in persona.interests if i in human.interests]
    talkable = [i for i in shared if _talk(i)] or [i for i in persona.interests if _talk(i)]
    topic = _topic(incoming)

    if topic == "date" or persona_turns >= 5:
        spot = "coffee" if "Coffee" in shared else "a drink"
        return rng.choice(
            [
                f"Honestly, I'm enjoying this. Want to grab {spot} this week? Thursday works?",
                f"Okay {human.name}, you passed the vibe check. {_cap(spot)} on Saturday?",
            ]
        )

    if persona_turns == 0 and (GREETINGS.search(incoming) or len(incoming) < 25):
        if talkable:
            interest = rng.choice(talkable)
            said, asked = _talk(interest)  # type: ignore[misc]
            also = " too" if interest in shared else ""
            return f"Hey {human.name}! 😊 I see you're into {interest.lower()}{also}. {_cap(asked)}"
        return f"Hey {human.name}! Thanks for saying hi 😊 {rng.choice(GENERIC_QUESTIONS)}"

    if "?" in incoming:
        if topic == "work" and persona.job_title:
            answer = (
                f"I'm a {persona.job_title.lower()}, which is more fun than it sounds most days."
            )
        elif topic == "place" and persona.city:
            answer = (
                f"I'm in {persona.city}. Big fan of the neighbourhood, terrible parking though."
            )
        elif topic == "weekend" and (sunday := _prompt_answer(persona, "My ideal Sunday")):
            answer = f"Ideally? {sunday}"
        else:
            mentioned = [i for i in persona.interests if i.lower() in incoming and _talk(i)]
            pick = mentioned[0] if mentioned else (rng.choice(talkable) if talkable else None)
            talk = _talk(pick)
            if talk:
                answer = f"Ha, good question. {_cap(talk[0])}."
            else:
                answer = "Good question! I'd say I'm part homebody, part spontaneous adventurer."
        return f"{answer} What about you?"

    follow_up = rng.choice(GENERIC_QUESTIONS)
    if talkable and rng.random() < 0.6:
        interest = rng.choice(talkable)
        said, asked = _talk(interest)  # type: ignore[misc]
        follow_up = f"Also, {said}. {_cap(asked)}"
    return f"{rng.choice(REACTIONS)} {follow_up}"


def likes_back(persona_id: int, human_id: int) -> bool:
    """Deterministic ~60% chance that a persona returns a like, stable per pair."""
    return (persona_id * 7919 + human_id * 104_729) % 10 < 6


def icebreakers(viewer: _Profile, other: _Profile, limit: int = 3) -> list[str]:
    """Conversation starters based on shared interests and the other person's prompts."""
    ideas: list[str] = []
    shared = [i for i in other.interests if i in viewer.interests]
    for interest in shared:
        pair = _talk(interest)
        if pair:
            ideas.append(f"We both love {interest.lower()}! {_cap(pair[1])}")
        else:
            ideas.append(f"Fellow {interest.lower()} fan! How did you get into it?")
        if len(ideas) == 2:
            break
    for prompt in other.prompts:
        answer = prompt.get("answer", "")
        snippet = answer if len(answer) <= 60 else answer[:57].rstrip() + "…"
        ideas.append(f'"{snippet}" — okay, I need the full story behind this.')
        if len(ideas) >= limit:
            break
    for fallback in (
        f"Hi {other.name}! What's the best thing that happened to you this week?",
        "Quick, two truths and a lie. Go!",
        "What's your ideal first date: coffee, a walk or something chaotic?",
    ):
        if len(ideas) >= limit:
            break
        ideas.append(fallback)
    return ideas[:limit]
