from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from app.deps import CurrentUser, HubDep, SessionDep, SettingsDep
from app.limits import MESSAGES, PHOTOS, VOICE_NOTES
from app.models import Match, Message
from app.ratelimit import per_user
from app.schemas import (
    ChatSettingsIn,
    ChatSettingsOut,
    MatchOut,
    MessageEdit,
    MessageIn,
    MessageOut,
    ReactionIn,
)
from app.services import chat, chat_settings
from app.services.audio import MAX_VOICE_MS, MIN_VOICE_MS, clean_waveform, save_voice
from app.services.images import CHAT_PHOTO_SIDE, save_upload
from app.services.personas import icebreakers

router = APIRouter(prefix="/api/matches", tags=["matches"])


async def _match_or_404(session: SessionDep, match_id: int, user_id: int) -> Match:
    match = await chat.get_match(session, match_id, user_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found")
    return match


def _reply_gone() -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, "The message you're replying to is gone"
    )


@router.get("")
async def list_matches(user: CurrentUser, session: SessionDep, hub: HubDep) -> list[MatchOut]:
    summaries = await chat.list_matches(session, user.id)
    return [
        MatchOut.build(
            s.match,
            user.id,
            online=hub.manager.is_online(s.match.other_id(user.id)),
            last_message=s.last_message,
            unread_count=s.unread_count,
            filing=s.filing,
        )
        for s in summaries
    ]


@router.get("/{match_id}")
async def read_match(
    match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> MatchOut:
    match = await _match_or_404(session, match_id, user.id)
    setting = await chat_settings.setting_for(session, user.id, match.id)
    return MatchOut.build(
        match,
        user.id,
        online=hub.manager.is_online(match.other_id(user.id)),
        filing=chat_settings.describe(setting),
    )


@router.patch("/{match_id}/settings")
async def update_chat_settings(
    match_id: int, data: ChatSettingsIn, user: CurrentUser, session: SessionDep, hub: HubDep
) -> ChatSettingsOut:
    """Pin (up to three), archive, or mute this chat for you. The other person can't tell."""
    match = await _match_or_404(session, match_id, user.id)
    try:
        setting = await chat_settings.update(
            session,
            hub,
            user.id,
            match,
            pinned=data.pinned,
            archived=data.archived,
            mute=data.mute,
        )
    except chat_settings.TooManyPinned as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    return ChatSettingsOut(match_id=match.id, **chat_settings.describe(setting))


@router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unmatch(match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep) -> Response:
    match = await _match_or_404(session, match_id, user.id)
    other_id = match.other_id(user.id)
    await session.delete(match)
    await session.commit()
    await hub.manager.send_many(
        [user.id, other_id], {"type": "match.removed", "match_id": match_id}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{match_id}/messages")
async def list_messages(
    match_id: int,
    user: CurrentUser,
    session: SessionDep,
    before: int | None = Query(default=None, description="Only messages with a smaller id"),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[MessageOut]:
    """A page of messages, oldest first. Pass `before` to page further back."""
    await _match_or_404(session, match_id, user.id)
    query = select(Message).where(Message.match_id == match_id)
    if before is not None:
        query = query.where(Message.id < before)
    newest_first = (await session.scalars(query.order_by(Message.id.desc()).limit(limit))).all()
    return [MessageOut.model_validate(m) for m in reversed(newest_first)]


@router.post(
    "/{match_id}/messages",
    status_code=status.HTTP_201_CREATED,
    dependencies=[per_user(MESSAGES)],
)
async def post_message(
    match_id: int, data: MessageIn, user: CurrentUser, session: SessionDep, hub: HubDep
) -> MessageOut:
    """REST fallback for sending; the web client sends over the WebSocket."""
    match = await _match_or_404(session, match_id, user.id)
    try:
        message = await chat.send_message(
            session, hub, match, user.id, data.body, reply_to_id=data.reply_to_id
        )
    except chat.MessageNotFound:
        raise _reply_gone() from None
    return MessageOut.model_validate(message)


@router.post(
    "/{match_id}/photos", status_code=status.HTTP_201_CREATED, dependencies=[per_user(PHOTOS)]
)
async def post_photo(
    match_id: int,
    file: UploadFile,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
    settings: SettingsDep,
    caption: Annotated[str, Form(max_length=500)] = "",
    reply_to_id: Annotated[int | None, Form()] = None,
) -> MessageOut:
    """Send a photo, with an optional caption. It's delivered live like any message."""
    match = await _match_or_404(session, match_id, user.id)
    if reply_to_id is not None:  # check before storing the upload
        try:
            await chat.reply_target(session, match, reply_to_id)
        except chat.MessageNotFound:
            raise _reply_gone() from None
    url = await save_upload(file, settings, CHAT_PHOTO_SIDE)
    message = await chat.send_message(
        session, hub, match, user.id, caption.strip(), image_url=url, reply_to_id=reply_to_id
    )
    return MessageOut.model_validate(message)


@router.post(
    "/{match_id}/voice", status_code=status.HTTP_201_CREATED, dependencies=[per_user(VOICE_NOTES)]
)
async def post_voice_note(
    match_id: int,
    file: UploadFile,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
    settings: SettingsDep,
    duration_ms: Annotated[int, Form(ge=MIN_VOICE_MS, le=MAX_VOICE_MS)],
    waveform: Annotated[
        str, Form(max_length=20_000, description="JSON list of 0-100 peaks")
    ] = "[]",
    reply_to_id: Annotated[int | None, Form()] = None,
) -> MessageOut:
    """Send a recorded voice note (WebM/Opus, Ogg, MP4/AAC or MP3), up to two minutes."""
    try:
        levels = TypeAdapter(list[float]).validate_json(waveform)
    except ValidationError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "waveform must be a JSON list of numbers"
        ) from None
    match = await _match_or_404(session, match_id, user.id)
    if reply_to_id is not None:
        try:
            await chat.reply_target(session, match, reply_to_id)
        except chat.MessageNotFound:
            raise _reply_gone() from None
    url = await save_voice(file, settings)
    message = await chat.send_message(
        session,
        hub,
        match,
        user.id,
        "",
        reply_to_id=reply_to_id,
        audio=(url, duration_ms, clean_waveform(levels)),
    )
    return MessageOut.model_validate(message)


@router.delete("/{match_id}/messages/{message_id}")
async def unsend_message(
    match_id: int, message_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> MessageOut:
    """Unsend one of your messages within a few minutes of sending it."""
    match = await _match_or_404(session, match_id, user.id)
    try:
        message = await chat.unsend(session, hub, match, message_id, user.id)
    except chat.MessageNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found") from None
    except chat.CannotUnsend as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from None
    return MessageOut.model_validate(message)


@router.patch("/{match_id}/messages/{message_id}")
async def edit_message(
    match_id: int,
    message_id: int,
    data: MessageEdit,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
) -> MessageOut:
    """Fix a typo in one of your messages within a few minutes of sending it."""
    match = await _match_or_404(session, match_id, user.id)
    try:
        message = await chat.edit(session, hub, match, message_id, user.id, data.body)
    except chat.MessageNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found") from None
    except chat.CannotEdit as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from None
    return MessageOut.model_validate(message)


@router.put("/{match_id}/messages/{message_id}/reaction")
async def react(
    match_id: int,
    message_id: int,
    data: ReactionIn,
    user: CurrentUser,
    session: SessionDep,
    hub: HubDep,
) -> MessageOut:
    """React to a message. Sending your current emoji again (or null) removes it."""
    match = await _match_or_404(session, match_id, user.id)
    try:
        message = await chat.set_reaction(session, hub, match, message_id, user.id, data.emoji)
    except chat.MessageNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found") from None
    return MessageOut.model_validate(message)


@router.post("/{match_id}/read")
async def mark_read(
    match_id: int, user: CurrentUser, session: SessionDep, hub: HubDep
) -> dict[str, int]:
    match = await _match_or_404(session, match_id, user.id)
    return {"marked": await chat.mark_read(session, hub, match, user.id)}


@router.get("/{match_id}/icebreakers")
async def match_icebreakers(match_id: int, user: CurrentUser, session: SessionDep) -> list[str]:
    match = await _match_or_404(session, match_id, user.id)
    return icebreakers(user, match.other_user(user.id))
