from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import utcnow
from app.models import DeviceSession, User
from app.realtime import Hub
from app.security import InvalidToken, decode_access_token
from app.services import devices

bearer = HTTPBearer(auto_error=False)


def get_hub(request: Request) -> Hub:
    return request.app.state.hub


def get_settings(hub: Annotated[Hub, Depends(get_hub)]) -> Settings:
    return hub.settings


async def get_session(hub: Annotated[Hub, Depends(get_hub)]) -> AsyncIterator[AsyncSession]:
    async with hub.db.session() as session:
        yield session


@dataclass(frozen=True)
class Authenticated:
    user: User
    device: DeviceSession | None


async def authenticate(
    session: AsyncSession, token: str, secret: str, address: str = ""
) -> Authenticated | None:
    try:
        claims = decode_access_token(token, secret)
    except InvalidToken:
        return None
    user = await session.get(User, claims.user_id)
    if user is None or user.token_version != claims.version or user.banned_at is not None:
        return None  # deleted, banned, or signed out everywhere since this token was issued
    if claims.session_id is None:
        return Authenticated(user, None)
    device = await session.get(DeviceSession, claims.session_id)
    now = utcnow()
    if device is None or not devices.is_live(device, user, now):
        return None  # that device was signed out
    await devices.touch(session, device, address, now)
    return Authenticated(user, device)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    auth = None
    if credentials is not None:
        auth = await authenticate(
            session,
            credentials.credentials,
            settings.secret_key,
            devices.client_address(request),
        )
    request.state.device_session_id = auth.device.id if auth and auth.device else None
    user = auth.user if auth else None
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not signed in or session expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_device_session_id(
    request: Request, _user: Annotated[User, Depends(get_current_user)]
) -> int | None:
    """The signed-in device making this request, if its token names one."""
    return request.state.device_session_id


async def get_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Moderators only")
    return user


SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_admin)]
CurrentDeviceId = Annotated[int | None, Depends(get_device_session_id)]
HubDep = Annotated[Hub, Depends(get_hub)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
