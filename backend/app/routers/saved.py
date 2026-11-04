"""Save for later: set someone aside from Discover without liking or passing.

Saved people leave the deck and wait on the Likes page. Liking or passing on them clears
them (see the swipe endpoint), and putting them back returns them to the deck.
"""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, func, select

from app.deps import CurrentUser, HubDep, SessionDep
from app.models import SavedProfile, Swipe, User
from app.schemas import PublicProfile, SavedProfileOut
from app.services.matching import distance_between
from app.services.safety import hidden_ids, is_hidden

router = APIRouter(prefix="/api/saved", tags=["saved"])

# Enough to come back to; past this, deciding is kinder than hoarding.
MAX_SAVED = 50


@router.get("")
async def saved_profiles(
    user: CurrentUser, session: SessionDep, hub: HubDep
) -> list[SavedProfileOut]:
    """Everyone you saved, most recent first."""
    rows = await session.scalars(
        select(SavedProfile)
        .join(User, User.id == SavedProfile.saved_id)
        .where(
            SavedProfile.user_id == user.id,
            User.banned_at.is_(None),
            SavedProfile.saved_id.not_in(hidden_ids(user.id)),
        )
        .order_by(SavedProfile.created_at.desc(), SavedProfile.id.desc())
    )
    return [
        SavedProfileOut(
            user=PublicProfile.build(
                row.saved,
                online=hub.manager.is_online(row.saved_id),
                distance_km=distance_between(user, row.saved),
            ),
            saved_at=row.created_at,
        )
        for row in rows
    ]


@router.put("/{user_id}")
async def save_profile(
    user_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> SavedProfileOut:
    """Set someone aside. Saving them again changes nothing."""
    if user_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "You can't save yourself")
    other = await session.get(User, user_id)
    if other is None or other.banned_at is not None or await is_hidden(session, user.id, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    swiped = await session.scalar(
        select(Swipe.id).where(Swipe.swiper_id == user.id, Swipe.target_id == user_id)
    )
    if swiped is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already decided on them")

    row = await session.scalar(
        select(SavedProfile).where(
            SavedProfile.user_id == user.id, SavedProfile.saved_id == user_id
        )
    )
    if row is None:
        count = await session.scalar(
            select(func.count()).select_from(SavedProfile).where(SavedProfile.user_id == user.id)
        )
        if (count or 0) >= MAX_SAVED:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"You can save up to {MAX_SAVED} people. Decide on a few first.",
            )
        row = SavedProfile(user_id=user.id, saved_id=user_id)
        session.add(row)
        await session.commit()
    return SavedProfileOut(
        user=PublicProfile.build(
            other, online=hub.manager.is_online(user_id), distance_km=distance_between(user, other)
        ),
        saved_at=row.created_at,
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_profile(user_id: int, user: CurrentUser, session: SessionDep) -> Response:
    """Put someone back in the deck."""
    await session.execute(
        delete(SavedProfile).where(
            SavedProfile.user_id == user.id, SavedProfile.saved_id == user_id
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
