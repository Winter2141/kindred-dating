from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import SessionDep, SettingsDep
from app.models import User
from app.schemas import LoginIn, MeOut, RegisterIn, TokenOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_for(user: User, settings: SettingsDep) -> TokenOut:
    token = create_access_token(user.id, settings.secret_key, settings.access_token_ttl_minutes)
    return TokenOut(access_token=token, user=MeOut.build(user))


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, session: SessionDep, settings: SettingsDep) -> TokenOut:
    email = data.email.lower()
    if await session.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")

    user = User(
        email=email,
        password_hash=hash_password(data.password),
        name=data.name,
        birthdate=data.birthdate,
        gender=data.gender,
        interested_in=list(data.interested_in),
        age_min=data.age_min,
        age_max=data.age_max,
        bio=data.bio,
        job_title=data.job_title,
        city=data.city,
        interests=data.interests,
        prompts=[p.model_dump() for p in data.prompts],
        photos=[],
    )
    session.add(user)
    await session.commit()
    return _token_for(user, settings)


@router.post("/login")
async def login(data: LoginIn, session: SessionDep, settings: SettingsDep) -> TokenOut:
    user = await session.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    return _token_for(user, settings)
