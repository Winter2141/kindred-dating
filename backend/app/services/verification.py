"""Photo verification: copy a random pose in a selfie, and a moderator checks it's you.

The pose is chosen by the server when you start, so an old photo of you won't pass: it has
to show the pose you were asked for. Moderators see the selfie next to the profile photos.
"""

import random
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import NotificationKind, User, VerificationRequest, VerificationStatus
from app.realtime import Hub
from app.services import audit
from app.services.images import delete_local
from app.services.notifications import notify


@dataclass(frozen=True)
class Pose:
    id: str
    emoji: str
    text: str


POSES: tuple[Pose, ...] = (
    Pose("peace", "✌️", "Hold up a peace sign next to your face"),
    Pose("thumbs_up", "👍", "Give a thumbs up"),
    Pose("wave", "👋", "Wave at the camera"),
    Pose("point_up", "☝️", "Point up with one finger"),
    Pose("chin", "🤔", "Rest your chin on your hand"),
    Pose("ok", "👌", "Make an OK sign"),
    Pose("salute", "🫡", "Salute the camera"),
    Pose("cover_eye", "🙈", "Cover one eye with your hand"),
)
POSES_BY_ID = {pose.id: pose for pose in POSES}


class VerificationError(Exception):
    pass


async def latest(session: AsyncSession, user_id: int) -> VerificationRequest | None:
    return await session.scalar(
        select(VerificationRequest)
        .where(VerificationRequest.user_id == user_id)
        .order_by(VerificationRequest.id.desc())
        .limit(1)
    )


async def start(
    session: AsyncSession, user: User, rng: random.Random | None = None
) -> VerificationRequest:
    """Hand out a pose. Asking again before sending a selfie gives a different one."""
    if user.verified_at is not None:
        raise VerificationError("You're already verified")
    if not user.photos:
        raise VerificationError("Add a profile photo first, so there's something to compare")
    current = await latest(session, user.id)
    if current is not None and current.status == VerificationStatus.PENDING:
        raise VerificationError("Your selfie is already waiting for review")

    rng = rng or random.Random()
    previous = current.pose if current is not None else None
    pose = rng.choice([p for p in POSES if p.id != previous])
    if current is not None and current.status == VerificationStatus.AWAITING_PHOTO:
        current.pose = pose.id
        current.created_at = utcnow()
        request = current
    else:
        request = VerificationRequest(user_id=user.id, pose=pose.id)
        session.add(request)
    await session.commit()
    return request


async def submit(session: AsyncSession, user: User, selfie_url: str) -> VerificationRequest:
    current = await latest(session, user.id)
    if current is None or current.status != VerificationStatus.AWAITING_PHOTO:
        raise VerificationError("Start verification to get a pose first")
    current.selfie_url = selfie_url
    current.status = VerificationStatus.PENDING
    current.submitted_at = utcnow()
    await session.commit()
    return current


async def review(
    session: AsyncSession,
    hub: Hub,
    request: VerificationRequest,
    moderator: User,
    *,
    approve: bool,
    note: str,
) -> VerificationRequest:
    """Approve (the person gets a badge) or reject with a reason they'll see."""
    if request.status != VerificationStatus.PENDING:
        raise VerificationError("This request was already reviewed")
    now = utcnow()
    request.status = VerificationStatus.APPROVED if approve else VerificationStatus.REJECTED
    request.note = note
    request.reviewed_at = now
    request.reviewed_by_id = moderator.id
    if approve:
        request.user.verified_at = now
    audit.record(
        session,
        moderator.id,
        audit.AuditAction.VERIFICATION_APPROVED
        if approve
        else audit.AuditAction.VERIFICATION_REJECTED,
        target_user_id=request.user_id,
        detail=note,
    )
    # The selfie has done its job either way; don't keep a face photo around for nothing.
    selfie, request.selfie_url = request.selfie_url, None
    await session.commit()
    delete_local(selfie, hub.settings)
    await notify(
        session,
        hub,
        request.user_id,
        NotificationKind.VERIFIED if approve else NotificationKind.VERIFICATION_REJECTED,
        body=note,
    )
    return request
