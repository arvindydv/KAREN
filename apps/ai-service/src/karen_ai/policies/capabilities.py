"""Provider capability gate: the LLM can never unlock an action a provider does not support.

A search-only provider integration can never be asked to book, whatever the model proposes.
This mirrors the action-plane rule (architecture §0, §10) for the evaluation harness and any
agent planning step; the API/Temporal action plane enforces it again independently.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Literal

ProviderAction = Literal["search", "quote", "book", "cancel", "pay", "send_message"]


def is_action_supported(provider_capabilities: Collection[str], action: ProviderAction) -> bool:
    return action in provider_capabilities
