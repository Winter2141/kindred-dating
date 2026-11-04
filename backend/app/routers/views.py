"""Who viewed your profile.

A view is recorded when someone opens your full profile (the app waits a few seconds on
Discover, so swiping past doesn't count). People can browse privately: their looks aren't
recorded, and in return they can't see who looked at them.
"""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import utcnow
from app.deps import CurrentUser, HubDep, SessionDep
from app.models import ProfileView, Swipe, SwipeAction, User
from app.schemas import PublicProfile, ViewerOut, ViewersOut
from app.services.matching import distance_between
from app.services.safety import hidden_ids, is_hidden

router = APIRouter(prefix="/api", tags=["views"])

VIEWS_WINDOW_DAYS = 30
MAX_VIEWERS = 50


@router.post("/users/{user_id}/view", status_code=status.HTTP_204_NO_CONTENT)
async def record_view(user_id: int, user: CurrentUser, session: SessionDep) -> Response:
    """Note that you opened someone's full profile. Quietly does nothing when browsing privately."""
    done = Response(status_code=status.HTTP_204_NO_CONTENT)
    other = await session.get(User, user_id)
    if other is None or other.banned_at is not None or await is_hidden(session, user.id, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user_id == user.id or user.browse_privately:
        return done

    now = utcnow()
    view = await session.scalar(
        select(ProfileView).where(
            ProfileView.viewer_id == user.id, ProfileView.viewed_id == user_id
        )
    )
    if view is None:
        session.add(
            ProfileView(viewer_id=user.id, viewed_id=user_id, first_viewed_at=now, viewed_at=now)
        )
    else:
        if view.viewed_at.date() != now.date():
            view.times += 1
        view.viewed_at = now
    try:
        await session.commit()
    except IntegrityError:  # two tabs recorded the first view at once; one row is enough
        await session.rollback()
    return done


@router.get("/me/viewers")
async def my_viewers(user: CurrentUser, session: SessionDep, hub: HubDep) -> ViewersOut:
    """People who opened your profile in the last 30 days, most recent first."""
    if user.browse_privately:
        return ViewersOut(private=True, viewers=[])
    since = utcnow() - timedelta(days=VIEWS_WINDOW_DAYS)
    views = (
        await session.scalars(
            select(ProfileView)
            .join(User, User.id == ProfileView.viewer_id)
            .where(
                ProfileView.viewed_id == user.id,
                ProfileView.viewed_at >= since,
                User.banned_at.is_(None),
                ProfileView.viewer_id.not_in(hidden_ids(user.id)),
            )
            .order_by(ProfileView.viewed_at.desc())
            .limit(MAX_VIEWERS)
        )
    ).all()
    likers = set(
        await session.scalars(
            select(Swipe.swiper_id).where(
                Swipe.target_id == user.id,
                Swipe.action != SwipeAction.PASS,
                Swipe.swiper_id.in_([v.viewer_id for v in views]),
            )
        )
    )
    return ViewersOut(
        private=False,
        viewers=[
            ViewerOut(
                user=PublicProfile.build(
                    view.viewer,
                    online=hub.manager.is_online(view.viewer_id),
                    distance_km=distance_between(user, view.viewer),
                ),
                viewed_at=view.viewed_at,
                times=view.times,
                liked_you=view.viewer_id in likers,
            )
            for view in views
        ],
    )
