from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import User
from app.realtime import Hub
from app.security import InvalidToken, decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_hub(request: Request) -> Hub:
    return request.app.state.hub


def get_settings(hub: Annotated[Hub, Depends(get_hub)]) -> Settings:
    return hub.settings


async def get_session(hub: Annotated[Hub, Depends(get_hub)]) -> AsyncIterator[AsyncSession]:
    async with hub.db.session() as session:
        yield session


async def user_from_token(session: AsyncSession, token: str, secret: str) -> User | None:
    try:
        user_id = decode_access_token(token, secret)
    except InvalidToken:
        return None
    return await session.get(User, user_id)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    user = None
    if credentials is not None:
        user = await user_from_token(session, credentials.credentials, settings.secret_key)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not signed in or session expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
HubDep = Annotated[Hub, Depends(get_hub)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
