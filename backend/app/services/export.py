"""Everything Kindred holds about one person, as a JSON document they can download."""

from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Block,
    ChatSetting,
    DateProposal,
    Match,
    Message,
    Notification,
    QuestionAnswer,
    Report,
    Swipe,
    User,
    VerificationRequest,
)
from app.questions import BY_ID

EXPORT_VERSION = 1


def _when(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def build_export(session: AsyncSession, user: User, now: datetime) -> dict[str, Any]:
    """A plain, documented structure: no internal ids of other people, no secrets."""
    matches = (
        (
            await session.execute(
                select(Match)
                .where(or_(Match.user_a_id == user.id, Match.user_b_id == user.id))
                .order_by(Match.created_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    match_ids = [m.id for m in matches]
    messages = (
        (
            await session.scalars(
                select(Message).where(Message.match_id.in_(match_ids)).order_by(Message.id)
            )
        ).all()
        if match_ids
        else []
    )
    by_match: dict[int, list[Message]] = {}
    for message in messages:
        by_match.setdefault(message.match_id, []).append(message)

    swipes = (
        await session.scalars(
            select(Swipe).where(Swipe.swiper_id == user.id).order_by(Swipe.created_at)
        )
    ).all()
    swiped_names = {
        u.id: u.name
        for u in await session.scalars(
            select(User).where(User.id.in_([s.target_id for s in swipes]))
        )
    }
    answers = (
        await session.scalars(select(QuestionAnswer).where(QuestionAnswer.user_id == user.id))
    ).all()
    notifications = (
        await session.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at)
        )
    ).all()
    blocks = (await session.scalars(select(Block).where(Block.blocker_id == user.id))).all()
    reports = (await session.scalars(select(Report).where(Report.reporter_id == user.id))).all()
    dates = (
        (
            await session.scalars(
                select(DateProposal)
                .where(DateProposal.match_id.in_(match_ids))
                .order_by(DateProposal.created_at)
            )
        ).all()
        if match_ids
        else []
    )
    filing = {
        s.match_id: s
        for s in await session.scalars(select(ChatSetting).where(ChatSetting.user_id == user.id))
    }
    verification = (
        await session.scalars(
            select(VerificationRequest).where(VerificationRequest.user_id == user.id)
        )
    ).all()

    return {
        "format": "kindred-export",
        "version": EXPORT_VERSION,
        "exported_at": now.isoformat(),
        "account": {
            "email": user.email,
            "email_confirmed_at": _when(user.email_verified_at),
            "pending_email": user.pending_email,
            "travelling_to": user.travel_place,
            "travelling_until": _when(user.travel_until),
            "created_at": _when(user.created_at),
            "last_active_at": _when(user.last_active_at),
            "two_factor_enabled": user.totp_enabled_at is not None,
            "photo_verified_at": _when(user.verified_at),
            "is_paused": user.is_paused,
        },
        "profile": {
            "name": user.name,
            "birthdate": user.birthdate.isoformat(),
            "gender": user.gender,
            "bio": user.bio,
            "job_title": user.job_title,
            "city": user.city,
            "interests": user.interests,
            "prompts": user.prompts,
            "photos": user.photos,
        },
        "preferences": {
            "interested_in": user.interested_in,
            "age_min": user.age_min,
            "age_max": user.age_max,
            "max_distance_km": user.max_distance_km,
            "has_location": user.latitude is not None,
        },
        "question_answers": [
            {
                "question": BY_ID[a.question_id].text,
                "answer": BY_ID[a.question_id].options[a.answer],
                "would_accept": [BY_ID[a.question_id].options[i] for i in a.acceptable],
                "importance": a.importance,
            }
            for a in answers
            if a.question_id in BY_ID
        ],
        "swipes": [
            {
                "on": swiped_names.get(s.target_id, "Deleted account"),
                "action": s.action,
                "at": _when(s.created_at),
            }
            for s in swipes
        ],
        "conversations": [
            {
                "with": match.other_user(user.id).name,
                "matched_at": _when(match.created_at),
                "pinned": bool(filing.get(match.id) and filing[match.id].pinned_at),
                "archived": bool(filing.get(match.id) and filing[match.id].archived_at),
                "messages": [
                    {
                        "from": "me" if m.sender_id == user.id else "them",
                        "text": m.body,
                        "photo": m.image_url,
                        "voice_note": m.audio_url,
                        "sent_at": _when(m.created_at),
                        "read_at": _when(m.read_at),
                        "edited_at": _when(m.edited_at),
                        "unsent_at": _when(m.deleted_at),
                        "reactions": [
                            {"from": "me" if r.user_id == user.id else "them", "emoji": r.emoji}
                            for r in m.reactions
                        ],
                    }
                    for m in by_match.get(match.id, [])
                ],
                "dates": [
                    {
                        "place": d.place,
                        "starts_at": _when(d.starts_at),
                        "status": d.status,
                        "proposed_by": "me" if d.proposer_id == user.id else "them",
                    }
                    for d in dates
                    if d.match_id == match.id
                ],
            }
            for match in matches
        ],
        "notifications": [
            {"kind": n.kind, "text": n.body, "at": _when(n.created_at), "read_at": _when(n.read_at)}
            for n in notifications
        ],
        "blocked_count": len(blocks),
        "reports_filed": [
            {
                "reason": r.reason,
                "details": r.details,
                "status": r.status,
                "at": _when(r.created_at),
            }
            for r in reports
        ],
        "photo_verification": [
            {"status": v.status, "requested_at": _when(v.created_at), "note": v.note}
            for v in verification
        ],
    }
