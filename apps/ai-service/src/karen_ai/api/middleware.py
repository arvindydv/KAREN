"""Request-id correlation (pure ASGI so it also wraps streaming responses)."""

from __future__ import annotations

import re
import uuid
from typing import Final

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from karen_ai.contracts import REQUEST_ID_HEADER
from karen_ai.core.context import request_id_var, task_id_var, user_ref_var

_VALID_REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = next(
            (v.decode("latin-1") for k, v in scope["headers"] if k == REQUEST_ID_HEADER.encode()), None
        )
        request_id = incoming if incoming and _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        tokens = (request_id_var.set(request_id), user_ref_var.set(None), task_id_var.set(None))

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k != REQUEST_ID_HEADER.encode()]
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_var.reset(tokens[0])
            user_ref_var.reset(tokens[1])
            task_id_var.reset(tokens[2])
