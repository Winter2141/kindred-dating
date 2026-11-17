"""The language model behind Kindred's writing help, reached through the OpenAI API.

Everything goes through one small interface, `Writer.write_json`, which asks for an answer
in a fixed JSON shape. `OpenAIWriter` is the real one, used when KINDRED_OPENAI_API_KEY is
set; tests swap in a fake. With no key there's no writer at all, and each feature falls back
to its built-in suggestions (app.services.assistant), so the app works the same without one.

Requests ask OpenAI not to store them (`store=False`) and carry a hashed user id rather than
anything that identifies the person.
"""

import hashlib
import json
import logging
from typing import Any, Protocol

from app.config import Settings

log = logging.getLogger(__name__)


class AIUnavailable(Exception):
    """The model couldn't be reached or gave something unusable; use the fallback."""


class Writer(Protocol):
    async def write_json(
        self,
        *,
        instructions: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        user_id: int,
        max_tokens: int = 600,
    ) -> dict[str, Any]: ...


def safety_id(user_id: int, secret: str) -> str:
    """A stable stand-in for the user, so abuse can be traced without naming anyone."""
    return hashlib.sha256(f"{secret}:{user_id}".encode()).hexdigest()[:32]


class OpenAIWriter:
    def __init__(self, settings: Settings) -> None:
        # Imported here so the app (and its tests) don't need the SDK loaded to start.
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout=settings.ai_timeout_seconds,
            max_retries=1,
        )
        self._model = settings.openai_model
        self._secret = settings.secret_key

    async def write_json(
        self,
        *,
        instructions: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        user_id: int,
        max_tokens: int = 600,
    ) -> dict[str, Any]:
        from openai import OpenAIError

        try:
            response = await self._client.responses.create(
                model=self._model,
                instructions=instructions,
                input=prompt,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": name,
                        "schema": schema,
                        "strict": True,
                    }
                },
                max_output_tokens=max_tokens,
                store=False,
                safety_identifier=safety_id(user_id, self._secret),
            )
            return json.loads(response.output_text)
        except (OpenAIError, json.JSONDecodeError, TypeError) as exc:
            log.warning("OpenAI request for %s failed: %s", name, exc)
            raise AIUnavailable(str(exc)) from exc


def make_writer(settings: Settings) -> Writer | None:
    return OpenAIWriter(settings) if settings.openai_api_key else None
