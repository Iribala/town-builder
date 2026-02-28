"""Storage service for town data using Redis with in-memory fallback."""

import copy
import json
import logging
from typing import Any, TypedDict

import compression.zstd as zstd
from redis.asyncio import Redis

from app.config import settings

logger = logging.getLogger(__name__)


class TownData(TypedDict, total=False):
    """Town data structure with category-based organization."""

    buildings: list[dict[str, Any]]
    vehicles: list[dict[str, Any]]
    trees: list[dict[str, Any]]
    props: list[dict[str, Any]]
    street: list[dict[str, Any]]
    park: list[dict[str, Any]]
    terrain: list[dict[str, Any]]
    roads: list[dict[str, Any]]
    townName: str
    snapshots: list[dict[str, Any]]
    history: list[dict[str, Any]]


def _create_default_town_data() -> TownData:
    """Create a fresh default town data structure.

    Must match _CATEGORIES in app/utils/normalization.py.
    """
    return TownData(
        buildings=[],
        vehicles=[],
        trees=[],
        props=[],
        street=[],
        park=[],
        terrain=[],
        roads=[],
    )


# Async Redis client
redis_client: Redis | None = None

# In-memory town data storage (fallback)
_town_data_storage = _create_default_town_data()


async def initialize_redis() -> None:
    """Initialize the async Redis client."""
    global redis_client
    try:
        redis_client = Redis.from_url(settings.redis_url, decode_responses=False)
        ping_result = await redis_client.ping()
        if ping_result:
            logger.info("Redis client initialized successfully")
    except Exception as e:
        redis_client = None
        logger.warning(f"Redis initialization failed, using in-memory storage: {e}")


async def close_redis() -> None:
    """Close the async Redis client."""
    global redis_client
    if redis_client:
        await redis_client.aclose()
        logger.info("Redis client closed")


async def get_town_data() -> TownData:
    """Get town data from Redis with fallback to in-memory storage.

    Returns:
        Dictionary containing town data (buildings, terrain, roads, props)
    """
    if redis_client:
        try:
            data = await redis_client.get("town_data")
            if data:
                # Decompress if it's bytes (zstd compressed)
                if isinstance(data, bytes):
                    data = zstd.decompress(data)
                return json.loads(data)
        except Exception as e:
            logger.warning(f"Redis get failed, using in-memory storage: {e}")

    # Fallback to in-memory storage
    return copy.deepcopy(_town_data_storage)


async def set_town_data(data: dict[str, Any]) -> None:
    """Set town data in both Redis and in-memory storage.

    Args:
        data: Dictionary containing town data to store
    """
    global _town_data_storage
    _town_data_storage = copy.deepcopy(data) if isinstance(data, dict) else data

    if redis_client:
        try:
            # Compress using zstd for efficiency
            compressed_data = zstd.compress(json.dumps(data).encode("utf-8"))
            await redis_client.set("town_data", compressed_data)
        except Exception as e:
            logger.warning(f"Redis set failed, data saved to memory only: {e}")


def get_redis_client() -> Redis | None:
    """Get the Redis client instance.

    Returns:
        Async Redis client instance
    """
    return redis_client
