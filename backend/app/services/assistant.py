"""Writing help: bio ideas, message ideas for a chat, and report summaries for moderators.

Each helper asks the language model (app.ai) when there is one, checks what comes back, and
otherwise falls back to suggestions built from the profiles themselves. The answer says
which it was (`source`), so the app can label model-written text as such.

Only what's needed goes into a prompt: first names, ages, jobs, cities, interests, prompts
and bios, plus the last few messages for chat help. Never emails, exact locations, photos
or anything from other conversations.
"""

import random
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from app.ai import AIUnavailable, Writer
from app.models import Message, Report, User
from app.services.matching import age_on
from app.services.personas import icebreakers

Source = Literal["ai", "basic"]
Tone = Literal["warm", "funny", "direct"]

MAX_BIO = 500
MAX_IDEA = 300
IDEAS = 3
# Enough of a conversation to reply to, without sending the whole history.
CONTEXT_MESSAGES = 12


@dataclass(frozen=True)
class Ideas:
    ideas: list[str]
    source: Source


@dataclass(frozen=True)
class ReportSummary:
    summary: str
    concerns: list[str]
    suggested_action: Literal["dismiss", "warn", "ban"]


IDEAS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"ideas": {"type": "array", "items": {"type": "string"}}},
    "required": ["ideas"],
    "additionalProperties": False,
}

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "suggested_action": {"type": "string", "enum": ["dismiss", "warn", "ban"]},
    },
    "required": ["summary", "concerns", "suggested_action"],
    "additionalProperties": False,
}

STYLE = (
    "You help people on Kindred, a dating app. Write like a real person texting: plain, "
    "specific and kind. No emoji walls, no pickup lines, no clichés like 'partner in crime', "
    "nothing sexual, and never invent facts that aren't in the profiles."
)

TONES: dict[Tone, str] = {
    "warm": "warm and sincere",
    "funny": "light and playful, with one gentle joke at most",
    "direct": "short and straightforward",
}


def describe(person: User, today: date) -> str:
    """A profile as plain text for a prompt: only what other members can already see."""
    lines = [f"{person.name}, {age_on(person.birthdate, today)}"]
    if person.job_title:
        lines.append(f"Job: {person.job_title}")
    if person.city:
        lines.append(f"Lives in: {person.city}")
    if person.interests:
        lines.append(f"Interests: {', '.join(person.interests)}")
    for prompt in person.prompts:
        lines.append(f"{prompt.get('question', '')}: {prompt.get('answer', '')}")
    if person.bio:
        lines.append(f"Bio: {person.bio}")
    return "\n".join(lines)


def transcript(messages: Sequence[Message], me: User, other: User) -> str:
    """The last few text messages, oldest first, labelled by first name."""
    lines = []
    for message in list(messages)[-CONTEXT_MESSAGES:]:
        if message.deleted_at is not None:
            continue
        who = me.name if message.sender_id == me.id else other.name
        if message.audio_url:
            text = "(voice note)"
        elif message.image_url:
            text = f"(photo) {message.body}".strip()
        elif message.call_kind:
            continue
        else:
            text = message.body
        lines.append(f"{who}: {text[:300]}")
    return "\n".join(lines)


def clean_ideas(raw: Any, limit: int = MAX_IDEA) -> list[str]:
    """Keep up to three distinct, non-empty strings, each trimmed to `limit` characters."""
    if not isinstance(raw, dict) or not isinstance(raw.get("ideas"), list):
        return []
    seen: set[str] = set()
    ideas: list[str] = []
    for item in raw["ideas"]:
        if not isinstance(item, str):
            continue
        text = " ".join(item.split()).strip().strip('"')
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        ideas.append(text if len(text) <= limit else text[: limit - 1].rstrip() + "…")
        if len(ideas) == IDEAS:
            break
    return ideas


async def _ask(
    writer: Writer | None, user_id: int, *, name: str, instructions: str, prompt: str, limit: int
) -> list[str]:
    if writer is None:
        return []
    try:
        raw = await writer.write_json(
            instructions=instructions,
            prompt=prompt,
            schema=IDEAS_SCHEMA,
            name=name,
            user_id=user_id,
        )
    except AIUnavailable:
        return []
    return clean_ideas(raw, limit)


# --- Bios ------------------------------------------------------------------------------


def basic_bio_ideas(user: User, tone: Tone) -> list[str]:
    """Bios assembled from the profile, for when there's no model to ask."""
    job = user.job_title or "Professional overthinker"
    interests = [i.lower() for i in user.interests[:3]] or ["good coffee", "long walks"]
    joined = (
        ", ".join(interests[:-1]) + f" and {interests[-1]}" if len(interests) > 1 else interests[0]
    )
    place = f" in {user.city.split(',')[0]}" if user.city else ""
    openers = {
        "warm": [
            f"{job}{place}. Happiest with {joined}, and better company over dinner than over text.",
            f"I'm into {joined}. Looking for someone curious with a favourite thing to share.",
            f"{job} by day. Weekends are for {interests[0]} and finding the best food{place}.",
        ],
        "funny": [
            f"{job}{place}. Strong opinions about {interests[0]}, none about anything else.",
            f"Will talk about {joined} for hours. You've been warned.",
            f"Looking for someone to argue with about {interests[0]}, then make up over snacks.",
        ],
        "direct": [
            f"{job}{place}. I like {joined}. Looking for something real.",
            f"{job}. {interests[0].capitalize()}, good food, honest people. Say hi.",
            f"Into {joined}. Here for a relationship, not a pen pal.",
        ],
    }
    return [idea[:MAX_BIO] for idea in openers[tone]]


async def bio_ideas(
    writer: Writer | None, user: User, draft: str, tone: Tone, today: date
) -> Ideas:
    prompt = (
        f"Profile:\n{describe(user, today)}\n\n"
        + (f"Their draft bio, to improve:\n{draft}\n\n" if draft.strip() else "")
        + f"Write three different bios for this person, each under 300 characters, in a "
        f"{TONES[tone]} tone, written in the first person. Use details from the profile."
    )
    ideas = await _ask(
        writer,
        user.id,
        name="bio_ideas",
        instructions=STYLE,
        prompt=prompt,
        limit=MAX_BIO,
    )
    return Ideas(ideas, "ai") if ideas else Ideas(basic_bio_ideas(user, tone), "basic")


# --- Messages ----------------------------------------------------------------------------


def basic_reply_ideas(last_from_them: str, other: User, seed: int) -> list[str]:
    """Generic but friendly follow-ups, for when there's no model to ask."""
    question = last_from_them.rstrip().endswith("?")
    ideas = (
        [
            "Good question! Honestly, it depends on the day. What about you?",
            "Ha, I was hoping you'd ask. Tell you over coffee?",
            "Okay, my answer might surprise you. You first though!",
        ]
        if question
        else [
            "That's amazing, tell me more!",
            f"Okay {other.name}, now I'm curious. How did that happen?",
            "Ha! I love that. What's next on your list?",
        ]
    )
    if other.interests:
        ideas.append(f"Random question: how did you get into {other.interests[0].lower()}?")
    random.Random(seed).shuffle(ideas)
    return ideas[:IDEAS]


async def message_ideas(
    writer: Writer | None,
    me: User,
    other: User,
    messages: Sequence[Message],
    today: date,
    seed: int = 0,
) -> Ideas:
    """Openers for an empty chat, or replies to where the conversation is."""
    chat = transcript(messages, me, other)
    if chat:
        task = (
            f"Here's the conversation so far, oldest first:\n{chat}\n\n"
            f"Suggest three different next messages {me.name} could send. Reply to what "
            f"{other.name} last said, keep each to one or two sentences, and end at least one "
            "with a question."
        )
    else:
        task = (
            f"They just matched and haven't talked yet. Suggest three different first "
            f"messages {me.name} could send, each picking up something specific from "
            f"{other.name}'s profile, one or two sentences each."
        )
    prompt = (
        f"{me.name}'s profile:\n{describe(me, today)}\n\n"
        f"{other.name}'s profile:\n{describe(other, today)}\n\n{task}"
    )
    ideas = await _ask(
        writer,
        me.id,
        name="message_ideas",
        instructions=STYLE,
        prompt=prompt,
        limit=MAX_IDEA,
    )
    if ideas:
        return Ideas(ideas, "ai")
    if not chat:
        return Ideas(icebreakers(me, other), "basic")
    theirs = [m.body for m in messages if m.sender_id == other.id and m.deleted_at is None]
    return Ideas(basic_reply_ideas(theirs[-1] if theirs else "", other, seed), "basic")


# --- Moderation --------------------------------------------------------------------------

MODERATOR = (
    "You help a dating app's moderators triage reports. Summarise neutrally and briefly, "
    "quote only what's needed, and don't speculate beyond the evidence. Suggest 'ban' only "
    "for threats, harassment that continued after being asked to stop, scams, minors or "
    "clearly fake profiles; 'warn' for rude or pushy behaviour; 'dismiss' when the evidence "
    "doesn't support the report. A human makes the decision."
)


def evidence_transcript(report: Report) -> str:
    """The messages saved with a report, labelled by first name, oldest first."""
    names = {"reporter": report.reporter.name, "reported": report.reported.name}
    return "\n".join(
        f"{names.get(line.get('from', ''), 'Someone')}: {line.get('text', '')[:300]}"
        for line in (report.evidence or [])[-CONTEXT_MESSAGES:]
    )


async def report_summary(
    writer: Writer, moderator_id: int, report: Report, today: date
) -> ReportSummary:
    """A short, neutral read of a report for the moderator. Raises AIUnavailable."""
    reported = report.reported
    chat = evidence_transcript(report) or "(They had no conversation.)"
    prompt = (
        f"Report reason: {report.reason}\n"
        f"Reporter's note: {report.details or '(none)'}\n"
        f"Messages they've sent that read as insults: {reported.unkind_messages}\n\n"
        f"Reported profile:\n{describe(reported, today)}\n\n"
        f"Their conversation, oldest first:\n{chat}\n\n"
        "Write a two or three sentence summary, list up to three specific concerns (empty if "
        "none), and suggest an action."
    )
    raw = await writer.write_json(
        instructions=MODERATOR,
        prompt=prompt,
        schema=SUMMARY_SCHEMA,
        name="report_summary",
        user_id=moderator_id,
        max_tokens=500,
    )
    summary = raw.get("summary") if isinstance(raw, dict) else None
    action = raw.get("suggested_action") if isinstance(raw, dict) else None
    if (
        not isinstance(summary, str)
        or not summary.strip()
        or action not in ("dismiss", "warn", "ban")
    ):
        raise AIUnavailable("unusable summary")
    concerns = [
        c.strip()[:200] for c in raw.get("concerns", []) if isinstance(c, str) and c.strip()
    ]
    return ReportSummary(summary.strip()[:800], concerns[:3], action)
