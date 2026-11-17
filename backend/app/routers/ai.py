"""Writing help, through the OpenAI API when it's set up (see app.ai and app.services.assistant).

Each request is something the person asked for by pressing a button; nothing is sent to the
model in the background. Without a key, bio and message ideas come from built-in templates,
and report summaries answer 503.
"""

import zlib

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.ai import AIUnavailable
from app.db import utcnow
from app.deps import AdminUser, CurrentUser, HubDep, SessionDep
from app.limits import AI
from app.models import Message, Report
from app.ratelimit import per_user
from app.routers.matches import _match_or_404
from app.schemas import BioIdeasIn, IdeasOut, ReportSummaryOut
from app.services import assistant
from app.services.assistant import CONTEXT_MESSAGES

router = APIRouter(prefix="/api", tags=["writing help"])


async def _recent_messages(session: SessionDep, match_id: int) -> list[Message]:
    rows = await session.scalars(
        select(Message)
        .where(Message.match_id == match_id)
        .order_by(Message.id.desc())
        .limit(CONTEXT_MESSAGES)
    )
    return list(reversed(rows.all()))


@router.post("/ai/bio", dependencies=[per_user(AI)])
async def suggest_bio(data: BioIdeasIn, user: CurrentUser, hub: HubDep) -> IdeasOut:
    """Three bios written from your profile (and your draft, if you have one)."""
    ideas = await assistant.bio_ideas(hub.ai, user, data.draft, data.tone, utcnow().date())
    return IdeasOut(ideas=ideas.ideas, source=ideas.source)


@router.post("/matches/{match_id}/ai/message-ideas", dependencies=[per_user(AI)])
async def suggest_messages(
    match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> IdeasOut:
    """First messages for a new chat, or replies to where the conversation has got to."""
    match = await _match_or_404(session, match_id, user.id)
    messages = await _recent_messages(session, match.id)
    # The built-in replies are shuffled per conversation and message, not per request.
    seed = zlib.crc32(f"{match.id}:{messages[-1].id if messages else 0}".encode())
    ideas = await assistant.message_ideas(
        hub.ai, user, match.other_user(user.id), messages, utcnow().date(), seed
    )
    return IdeasOut(ideas=ideas.ideas, source=ideas.source)


@router.post("/admin/reports/{report_id}/ai-summary", dependencies=[per_user(AI)])
async def summarise_report(
    report_id: int, admin: AdminUser, session: SessionDep, hub: HubDep
) -> ReportSummaryOut:
    """A neutral read of a report and the messages saved with it, with a suggested action."""
    if hub.ai is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "AI summaries need an OpenAI API key"
        )
    report = await session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    try:
        summary = await assistant.report_summary(hub.ai, admin.id, report, utcnow().date())
    except AIUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Couldn't get a summary right now; try again"
        ) from None
    return ReportSummaryOut(
        summary=summary.summary,
        concerns=summary.concerns,
        suggested_action=summary.suggested_action,
    )
