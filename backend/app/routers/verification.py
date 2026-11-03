"""Photo verification for members, and the review queue for moderators."""

from fastapi import APIRouter, HTTPException, Query, UploadFile, status
from sqlalchemy import select

from app.deps import AdminUser, CurrentUser, HubDep, SessionDep, SettingsDep
from app.limits import PHOTOS
from app.models import VerificationRequest, VerificationStatus
from app.ratelimit import per_user
from app.schemas import (
    PoseOut,
    PublicProfile,
    VerificationOut,
    VerificationReviewIn,
    VerificationReviewOut,
)
from app.services import verification
from app.services.images import CHAT_PHOTO_SIDE, save_upload

router = APIRouter(prefix="/api", tags=["verification"])


def _pose(pose_id: str) -> PoseOut:
    pose = verification.POSES_BY_ID[pose_id]
    return PoseOut(id=pose.id, emoji=pose.emoji, text=pose.text)


def _mine(request: VerificationRequest | None, verified: bool) -> VerificationOut:
    if verified:
        return VerificationOut(status="approved", verified=True)
    if request is None:
        return VerificationOut(status="none", verified=False)
    return VerificationOut(
        status=VerificationStatus(request.status),
        verified=False,
        pose=_pose(request.pose) if request.status == VerificationStatus.AWAITING_PHOTO else None,
        note=request.note,
    )


@router.get("/me/verification")
async def my_verification(user: CurrentUser, session: SessionDep) -> VerificationOut:
    return _mine(await verification.latest(session, user.id), user.verified_at is not None)


@router.post("/me/verification")
async def start_verification(user: CurrentUser, session: SessionDep) -> VerificationOut:
    """Get a pose to copy. Call again for a different one if it's awkward."""
    try:
        request = await verification.start(session, user)
    except verification.VerificationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    return _mine(request, verified=False)


@router.post("/me/verification/selfie", dependencies=[per_user(PHOTOS)])
async def send_selfie(
    file: UploadFile, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> VerificationOut:
    """Send the selfie copying your pose. A moderator will compare it with your photos."""
    current = await verification.latest(session, user.id)
    if current is None or current.status != VerificationStatus.AWAITING_PHOTO:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start verification to get a pose first")
    url = await save_upload(file, settings, CHAT_PHOTO_SIDE)
    request = await verification.submit(session, user, url)
    return _mine(request, verified=False)


@router.get("/admin/verifications")
async def verification_queue(
    _: AdminUser,
    session: SessionDep,
    status_filter: VerificationStatus = Query(default=VerificationStatus.PENDING, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[VerificationReviewOut]:
    """Selfies to review, oldest first, each with the pose that was asked for."""
    order = (
        VerificationRequest.submitted_at.asc()
        if status_filter is VerificationStatus.PENDING
        else VerificationRequest.reviewed_at.desc()
    )
    requests = await session.scalars(
        select(VerificationRequest)
        .where(VerificationRequest.status == status_filter)
        .order_by(order)
        .limit(limit)
    )
    return [_review_out(r) for r in requests]


@router.post("/admin/verifications/{request_id}/review")
async def review_verification(
    request_id: int,
    data: VerificationReviewIn,
    admin: AdminUser,
    session: SessionDep,
    hub: HubDep,
) -> VerificationReviewOut:
    request = await session.get(VerificationRequest, request_id)
    if request is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Verification request not found")
    if not data.approve and not data.note:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Tell them why, so they can try again"
        )
    try:
        request = await verification.review(
            session, hub, request, admin, approve=data.approve, note=data.note
        )
    except verification.VerificationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    return _review_out(request)


def _review_out(request: VerificationRequest) -> VerificationReviewOut:
    return VerificationReviewOut(
        id=request.id,
        user=PublicProfile.build(request.user),
        pose=_pose(request.pose),
        selfie_url=request.selfie_url,
        status=VerificationStatus(request.status),
        note=request.note,
        submitted_at=request.submitted_at,
        reviewed_at=request.reviewed_at,
    )
