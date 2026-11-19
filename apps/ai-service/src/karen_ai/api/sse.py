"""Server-sent event framing for contract stream events."""

from __future__ import annotations

from collections.abc import AsyncIterator

from karen_ai.contracts import StreamEvent


def encode_event(event: StreamEvent) -> bytes:
    return f"event: {event.event}\ndata: {event.model_dump_json()}\n\n".encode()


async def encode_stream(events: AsyncIterator[StreamEvent]) -> AsyncIterator[bytes]:
    async for event in events:
        yield encode_event(event)
