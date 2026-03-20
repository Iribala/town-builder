"""Server-Sent Events (SSE) service for real-time updates via Redis pub/sub."""

import asyncio
import json
import logging
import time

from app.config import settings
from app.services.storage import get_redis_client, get_town_data

logger = logging.getLogger(__name__)

_connected_users: dict[str, float] = {}
_user_connection_counts: dict[str, int] = {}
_users_lock = asyncio.Lock()


async def broadcast_sse(data: dict) -> None:
    """Send data to all connected SSE clients via Redis pub/sub."""
    try:
        redis_client = get_redis_client()
        if redis_client:
            msg = json.dumps(data)
            await redis_client.publish(settings.pubsub_channel, msg)
    except Exception as e:
        logger.warning(f"Failed to broadcast SSE event (Redis unavailable): {e}")


def _cleanup_and_get_users() -> list[str]:
    """Get list of currently online user names (must be called with _users_lock held)."""
    now = time.time()
    to_remove = [
        name
        for name, ts in _connected_users.items()
        if now - ts > settings.user_activity_timeout
    ]
    for name in to_remove:
        if name in _connected_users:
            del _connected_users[name]
    return list(_connected_users.keys())


def _decrement_connection(player_name: str) -> None:
    """Decrement connection count for a user (must be called with _users_lock held)."""
    count = _user_connection_counts.get(player_name, 1) - 1
    if count <= 0:
        _user_connection_counts.pop(player_name, None)
        _connected_users.pop(player_name, None)
    else:
        _user_connection_counts[player_name] = count


async def get_online_users() -> list[str]:
    """Get list of currently online user names."""
    async with _users_lock:
        return _cleanup_and_get_users()


async def event_stream(player_name: str | None = None):
    """Generate Server-Sent Events stream for a client."""
    # Check connection limit before anything else
    if player_name:
        async with _users_lock:
            count = _user_connection_counts.get(player_name, 0)
            if count >= settings.max_sse_connections_per_user:
                logger.warning(
                    f"SSE connection limit ({settings.max_sse_connections_per_user}) "
                    f"reached for user: {player_name}"
                )
                yield f"data: {json.dumps({'type': 'error', 'message': 'Connection limit reached'})}\n\n"
                return
            _user_connection_counts[player_name] = count + 1
            _connected_users[player_name] = time.time()
            users = _cleanup_and_get_users()
        await broadcast_sse({"type": "users", "users": users})

    redis_client = get_redis_client()

    if not redis_client:
        logger.warning("Redis client not available for SSE")
        try:
            initial_town_data = await get_town_data()
            yield f"data: {json.dumps({'type': 'full', 'town': initial_town_data})}\n\n"
            while True:
                await asyncio.sleep(10)
                yield ": keepalive\n\n"
        except asyncio.CancelledError:
            if player_name:
                async with _users_lock:
                    _decrement_connection(player_name)
            raise
        return

    pubsub = redis_client.pubsub()
    await pubsub.subscribe(settings.pubsub_channel)
    logger.info(f"Subscribed to Redis channel: {settings.pubsub_channel}")

    try:
        initial_town_data = await get_town_data()
        yield f"data: {json.dumps({'type': 'full', 'town': initial_town_data})}\n\n"
        users = await get_online_users()
        yield f"data: {json.dumps({'type': 'users', 'users': users})}\n\n"

        last_keepalive = time.time()
        while True:
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True),
                    timeout=settings.sse_timeout,
                )

                if message and message["type"] == "message":
                    if isinstance(data := message["data"], bytes):
                        data = data.decode("utf-8")
                    yield f"data: {data}\n\n"

                if (
                    player_name
                    and time.time() - last_keepalive > settings.sse_keepalive_interval
                ):
                    async with _users_lock:
                        _connected_users[player_name] = time.time()
                    last_keepalive = time.time()

            except asyncio.TimeoutError:
                if player_name:
                    async with _users_lock:
                        _connected_users[player_name] = time.time()
                        users = _cleanup_and_get_users()
                    await broadcast_sse({"type": "users", "users": users})
                yield ": keepalive\n\n"
                last_keepalive = time.time()

    except asyncio.CancelledError:
        logger.info(f"SSE client {player_name or 'Unknown'} disconnected.")
        if player_name:
            async with _users_lock:
                _decrement_connection(player_name)
                users = _cleanup_and_get_users()
            await broadcast_sse({"type": "users", "users": users})
        raise
    finally:
        await pubsub.unsubscribe(settings.pubsub_channel)
        await pubsub.aclose()
        logger.info(f"Redis pubsub connection closed for {player_name or 'Unknown'}.")
