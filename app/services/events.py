"""Server-Sent Events (SSE) service for real-time updates via Redis pub/sub."""

import asyncio
import json
import logging
import time

from app.config import settings
from app.services.storage import get_redis_client, get_town_data

logger = logging.getLogger(__name__)

_connected_users: dict[str, float] = {}


async def broadcast_sse(data: dict) -> None:
    """Send data to all connected SSE clients via Redis pub/sub."""
    try:
        redis_client = get_redis_client()
        if redis_client:
            msg = json.dumps(data)
            await redis_client.publish(settings.pubsub_channel, msg)
    except Exception as e:
        logger.warning(f"Failed to broadcast SSE event (Redis unavailable): {e}")


def get_online_users() -> list[str]:
    """Get list of currently online user names."""
    now = time.time()
    to_remove = [name for name, ts in _connected_users.items() if now - ts > 30]
    for name in to_remove:
        if name in _connected_users:
            del _connected_users[name]
    return list(_connected_users.keys())


async def event_stream(player_name: str | None = None):
    """Generate Server-Sent Events stream for a client."""
    redis_client = get_redis_client()

    if not redis_client:
        logger.warning("Redis client not available for SSE")
        initial_town_data = await get_town_data()
        yield f"data: {json.dumps({'type': 'full', 'town': initial_town_data})}\n\n"
        while True:
            await asyncio.sleep(10)
            yield ": keepalive\n\n"
        return

    pubsub = redis_client.pubsub()
    await pubsub.subscribe(settings.pubsub_channel)
    logger.info(f"Subscribed to Redis channel: {settings.pubsub_channel}")

    if player_name:
        _connected_users[player_name] = time.time()
        await broadcast_sse({"type": "users", "users": get_online_users()})

    try:
        initial_town_data = await get_town_data()
        yield f"data: {json.dumps({'type': 'full', 'town': initial_town_data})}\n\n"
        yield f"data: {json.dumps({'type': 'users', 'users': get_online_users()})}\n\n"

        last_keepalive = time.time()
        while True:
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True), timeout=10.0
                )

                if message and message["type"] == "message":
                    if isinstance(data := message["data"], bytes):
                        data = data.decode("utf-8")
                    yield f"data: {data}\n\n"

                if player_name and time.time() - last_keepalive > 10:
                    _connected_users[player_name] = time.time()
                    last_keepalive = time.time()

            except asyncio.TimeoutError:
                if player_name:
                    _connected_users[player_name] = time.time()
                    await broadcast_sse({"type": "users", "users": get_online_users()})
                yield ": keepalive\n\n"
                last_keepalive = time.time()

    except asyncio.CancelledError:
        logger.info(f"SSE client {player_name or 'Unknown'} disconnected.")
        if player_name and player_name in _connected_users:
            del _connected_users[player_name]
            await broadcast_sse({"type": "users", "users": get_online_users()})
        raise
    finally:
        await pubsub.unsubscribe(settings.pubsub_channel)
        await pubsub.aclose()
        logger.info(f"Redis pubsub connection closed for {player_name or 'Unknown'}.")
