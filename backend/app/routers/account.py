"""Account security: password changes, signing out everywhere and deleting the account."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep, SettingsDep
from app.models import Match
from app.routers.auth import token_for
from app.routers.ws import CLOSE_UNAUTHORIZED
from app.schemas import AccountDelete, PasswordChange, TokenOut
from app.security import hash_password, verify_password
from app.services.images import delete_local

router = APIRouter(prefix="/api/me", tags=["account"])


def _require_password(password: str, password_hash: str) -> None:
    if not verify_password(password, password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password isn't right")


@router.post("/password")
async def change_password(
    data: PasswordChange, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> TokenOut:
    """Set a new password. Other devices are signed out; this one gets a fresh token."""
    _require_password(data.current_password, user.password_hash)
    if data.new_password == data.current_password:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a password you haven't used here"
        )
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    await session.commit()
    return token_for(user, settings)


@router.post("/sign-out-everywhere", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_everywhere(user: CurrentUser, session: SessionDep, hub: HubDep) -> Response:
    user.token_version += 1
    await session.commit()
    await hub.manager.close_all(user.id, CLOSE_UNAUTHORIZED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    data: AccountDelete,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
    settings: SettingsDep,
) -> Response:
    """Permanently delete the account with its swipes, matches, messages and photos."""
    _require_password(data.password, user.password_hash)
    matches = (
        await session.scalars(
            select(Match).where((Match.user_a_id == user.id) | (Match.user_b_id == user.id))
        )
    ).unique()
    partners = {match.id: match.other_id(user.id) for match in matches}
    photos = list(user.photos)
    user_id = user.id

    await session.delete(user)
    await session.commit()

    for match_id, partner_id in partners.items():
        await hub.manager.send(partner_id, {"type": "match.removed", "match_id": match_id})
    await hub.manager.close_all(user_id, CLOSE_UNAUTHORIZED)
    for url in photos:
        delete_local(url, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
