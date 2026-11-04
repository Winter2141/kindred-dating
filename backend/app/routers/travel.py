"""Travel mode: match with people somewhere else for a while, ahead of a trip or during one.

While a trip lasts, the traveller's deck and distances are measured from the place they're
visiting, people there can find them, and their profile says "Visiting Lisbon". It ends on
its own after the last day, so nobody is left matching from a city they've gone home from.
"""

from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, HTTPException, status

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.places import canonical, geocode
from app.schemas import MeOut, TravelIn

router = APIRouter(prefix="/api/me/travel", tags=["travel"])

# Far enough ahead to plan a trip, near enough that it isn't a way to live somewhere else.
MAX_TRIP_DAYS = 30


@router.put("")
async def start_trip(data: TravelIn, user: CurrentUser, session: SessionDep) -> MeOut:
    """Set (or change) where you're travelling and the last day you'll be there."""
    place = canonical(data.place)
    coords = geocode(place) if place else None
    if place is None or coords is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "We can't measure distances from there yet. Pick a place from the list.",
        )
    if place == canonical(user.city):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's where you live")
    today = utcnow().date()
    if data.until < today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That day has already gone")
    if data.until > today + timedelta(days=MAX_TRIP_DAYS):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Trips can last up to {MAX_TRIP_DAYS} days from today",
        )

    user.travel_place = place
    user.travel_latitude, user.travel_longitude = coords
    # The trip covers the whole of its last day.
    user.travel_until = datetime.combine(data.until + timedelta(days=1), time.min, tzinfo=UTC)
    await session.commit()
    return MeOut.build(user)


@router.delete("")
async def end_trip(user: CurrentUser, session: SessionDep) -> MeOut:
    """Go back to matching from home."""
    user.travel_place = user.travel_latitude = user.travel_longitude = None
    user.travel_until = None
    await session.commit()
    return MeOut.build(user)
