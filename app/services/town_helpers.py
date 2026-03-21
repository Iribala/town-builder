"""Shared helpers for town data operations."""

from typing import Any

from app.services.storage import set_town_data
from app.services.events import broadcast_sse


async def save_and_broadcast(town_data: dict[str, Any], event: dict[str, Any]) -> None:
    """Save town data to storage and broadcast an SSE event.

    Args:
        town_data: The full town data to persist
        event: The SSE event payload to broadcast
    """
    await set_town_data(town_data)
    await broadcast_sse(event)
