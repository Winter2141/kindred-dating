"""Planning a first date inside a chat: propose a place and time, then accept or decline."""

import asyncio
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import DateProposal, DateStatus, Match, User
from app.realtime import Hub
from app.schemas import DateOut

EARLIEST_LEAD = timedelta(minutes=30)
LATEST_LEAD = timedelta(days=60)

# A first-date idea for each interest two people share.
DATE_IDEAS: dict[str, str] = {
    "Coffee": "Coffee at a cosy café",
    "Hiking": "A morning hike with a view",
    "Cooking": "A cooking class for two",
    "Live music": "A small gig at a local venue",
    "Vinyl": "A record shop crawl",
    "Photography": "A golden-hour photo walk",
    "Yoga": "A sunrise yoga class",
    "Running": "A park run, then breakfast",
    "Climbing": "An evening at the bouldering gym",
    "Travel": "Planning a dream trip over drinks",
    "Books": "Swapping favourites at a bookshop",
    "Film": "An indie film and a debrief",
    "Art galleries": "A gallery opening",
    "Wine": "A natural wine bar",
    "Craft beer": "A brewery tasting flight",
    "Board games": "A board game café",
    "Video games": "A retro arcade",
    "Dogs": "A walk in the dog park",
    "Baking": "A pastry crawl",
    "Dancing": "A salsa night",
    "Tennis": "A friendly tennis match",
    "Cycling": "A bike ride along the water",
    "Comedy": "A stand-up comedy night",
    "Theatre": "Rush tickets to a play",
    "Brunch": "A long weekend brunch",
    "Karaoke": "A private karaoke room",
    "Museums": "A late night at a museum",
    "Sushi": "An omakase counter",
    "Astronomy": "Stargazing at the planetarium",
}
FALLBACK_IDEAS = ["Drinks somewhere with a view", "A walk and an ice cream", "Tacos and a stroll"]


class DateError(Exception):
    """A proposal or response that the rules don't allow; the message is user-facing."""

    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


def date_ideas(me: User, other: User, limit: int = 3) -> list[str]:
    shared = [i for i in other.interests if i in me.interests and i in DATE_IDEAS]
    ideas = [DATE_IDEAS[i] for i in shared]
    return (ideas + [i for i in FALLBACK_IDEAS if i not in ideas])[:limit]


def check_time(starts_at: datetime, now: datetime) -> None:
    if starts_at < now + EARLIEST_LEAD:
        raise DateError("Pick a time at least 30 minutes from now", 422)
    if starts_at > now + LATEST_LEAD:
        raise DateError("Pick a time within the next 60 days", 422)


async def _broadcast(hub: Hub, match: Match, proposal: DateProposal) -> None:
    await hub.manager.send_many(
        [match.user_a_id, match.user_b_id],
        {"type": "date.updated", "date": DateOut.model_validate(proposal)},
    )


async def propose(
    session: AsyncSession,
    hub: Hub,
    match: Match,
    proposer_id: int,
    place: str,
    starts_at: datetime,
    note: str,
) -> DateProposal:
    check_time(starts_at, utcnow())
    open_one = await session.scalar(
        select(DateProposal.id).where(
            DateProposal.match_id == match.id, DateProposal.status == DateStatus.PROPOSED
        )
    )
    if open_one is not None:
        raise DateError("There's already a date waiting for an answer in this chat")
    proposal = DateProposal(
        match_id=match.id, proposer_id=proposer_id, place=place, starts_at=starts_at, note=note
    )
    session.add(proposal)
    match.last_activity_at = utcnow()
    await session.commit()
    await _broadcast(hub, match, proposal)

    other = match.other_user(proposer_id)
    if hub.settings.demo_mode and other.is_persona:
        hub.spawn(_persona_answers(hub, proposal.id, other.id))
    return proposal


async def respond(
    session: AsyncSession,
    hub: Hub,
    match: Match,
    proposal: DateProposal,
    user_id: int,
    accept: bool,
) -> DateProposal:
    if proposal.proposer_id == user_id:
        raise DateError("Wait for them to answer your proposal", 403)
    if proposal.status != DateStatus.PROPOSED:
        raise DateError("This proposal was already answered")
    proposal.status = DateStatus.ACCEPTED if accept else DateStatus.DECLINED
    proposal.responded_at = utcnow()
    await session.commit()
    await _broadcast(hub, match, proposal)
    return proposal


async def cancel(
    session: AsyncSession, hub: Hub, match: Match, proposal: DateProposal, user_id: int
) -> DateProposal:
    """Either person can call off an accepted date; only the proposer can withdraw a pending one."""
    if proposal.status == DateStatus.PROPOSED and proposal.proposer_id != user_id:
        raise DateError("Decline it instead", 403)
    if proposal.status not in (DateStatus.PROPOSED, DateStatus.ACCEPTED):
        raise DateError("This date is already off")
    proposal.status = DateStatus.CANCELLED
    proposal.responded_at = utcnow()
    await session.commit()
    await _broadcast(hub, match, proposal)
    return proposal


async def _persona_answers(hub: Hub, proposal_id: int, persona_id: int) -> None:
    """Demo personas say yes after a short pause, and add a line in the chat."""
    from app.services.chat import send_message, typing_event

    await asyncio.sleep(random.uniform(*hub.settings.persona_read_delay))
    async with hub.db.session() as session:
        proposal = await session.get(DateProposal, proposal_id)
        if proposal is None or proposal.status != DateStatus.PROPOSED:
            return
        match = await session.get(Match, proposal.match_id)
        if match is None:
            return
        await respond(session, hub, match, proposal, persona_id, accept=True)
        human_id = match.other_id(persona_id)
        await hub.manager.send(human_id, typing_event(match.id, persona_id, True))
        await asyncio.sleep(random.uniform(*hub.settings.persona_typing_delay))
        # No weekday here: the server only knows UTC, not what day it is for the human.
        await send_message(
            session, hub, match, persona_id, f"Yes! {proposal.place} sounds perfect 😊 See you then"
        )
