"""The browsers and devices signed in to an account, and signing them out one at a time."""

from fastapi import APIRouter, HTTPException, Response, status

from app.deps import CurrentDeviceId, CurrentUser, HubDep, SessionDep
from app.realtime import CLOSE_UNAUTHORIZED
from app.schemas import DeviceSessionOut
from app.services import devices
from app.useragent import parse

router = APIRouter(prefix="/api/me/sessions", tags=["account"])


@router.get("")
async def list_sessions(
    user: CurrentUser, device_id: CurrentDeviceId, session: SessionDep
) -> list[DeviceSessionOut]:
    """Where you're signed in, most recently active first."""
    out = []
    for device in await devices.live_sessions(session, user):
        parsed = parse(device.user_agent)
        out.append(
            DeviceSessionOut(
                id=device.id,
                label=parsed.label,
                mobile=parsed.mobile,
                ip_address=device.ip_address,
                created_at=device.created_at,
                last_seen_at=device.last_seen_at,
                current=device.id == device_id,
            )
        )
    return out


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_device(
    session_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> Response:
    try:
        await devices.end(session, hub, user, session_id)
    except devices.UnknownSession:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such session") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sign-out-others", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_other_devices(
    user: CurrentUser, device_id: CurrentDeviceId, session: SessionDep, hub: HubDep
) -> Response:
    """Sign out everywhere except here, without changing anything else."""
    ended = await devices.revoke_others(session, user, keep_id=device_id)
    await session.commit()
    for ended_id in ended:
        await hub.manager.close_session(user.id, ended_id, CLOSE_UNAUTHORIZED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
