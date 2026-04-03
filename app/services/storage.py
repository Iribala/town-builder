"""Storage service for town data using Redis with in-memory fallback."""

import asyncio
import copy
import json
import logging
from typing import Any, TypedDict, NotRequired

import zstandard as zstd
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.config import settings
from app.utils.normalization import CATEGORIES

logger = logging.getLogger(__name__)


class TownData(TypedDict):
    """Town data structure with category-based organization."""

    buildings: list[dict[str, Any]]
    vehicles: list[dict[str, Any]]
    trees: list[dict[str, Any]]
    props: list[dict[str, Any]]
    street: list[dict[str, Any]]
    park: list[dict[str, Any]]
    terrain: list[dict[str, Any]]
    roads: list[dict[str, Any]]
    townName: NotRequired[str]
    snapshots: NotRequired[list[dict[str, Any]]]
    history: NotRequired[list[dict[str, Any]]]


def _create_default_town_data() -> TownData:
    """Create a fresh default town data structure."""
    return TownData(**{category: [] for category in CATEGORIES})


# Async Redis client
redis_client: Redis | None = None

# In-memory town data storage (fallback)
_town_data_storage = _create_default_town_data()

# Locks are lazily initialized within the running event loop
_storage_lock: asyncio.Lock | None = None
_town_data_lock: asyncio.Lock | None = None


def get_town_data_lock() -> asyncio.Lock:
    """Get the correct lazily-instantiated route-level lock."""
    global _town_data_lock
    if _town_data_lock is None:
        _town_data_lock = asyncio.Lock()
    return _town_data_lock


async def initialize_redis() -> None:
    """Initialize the async Redis client and event loop locks."""
    global redis_client, _storage_lock, _town_data_lock
    if _storage_lock is None:
        _storage_lock = asyncio.Lock()
    if _town_data_lock is None:
        _town_data_lock = asyncio.Lock()
    
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
                def _decode() -> TownData:
                    dctx = zstd.ZstdDecompressor()
                    decompressed = dctx.decompress(data)
                    return json.loads(decompressed)
                
                return await asyncio.to_thread(_decode)
        except (RedisError, ValueError, json.JSONDecodeError, zstd.ZstdError) as e:
            logger.warning(f"Redis get failed, using in-memory storage: {e}")

    # Fallback to in-memory storage
    if _storage_lock:
        async with _storage_lock:
            return copy.deepcopy(_town_data_storage)
    else:
        return _town_data_storage


async def set_town_data(data: dict[str, Any] | TownData) -> None:
    """Set town data in both Redis and in-memory storage.

    Args:
        data: Dictionary containing town data to store
    """
    global _town_data_storage
    if _storage_lock:
        async with _storage_lock:
            _town_data_storage = copy.deepcopy(data)
    else:
        _town_data_storage = data

    if redis_client:
        try:
            def _encode() -> bytes:
                cctx = zstd.ZstdCompressor()
                return cctx.compress(json.dumps(data).encode("utf-8"))
            
            compressed_data = await asyncio.to_thread(_encode)
            await redis_client.set("town_data", compressed_data)
        except (RedisError, ValueError, TypeError, zstd.ZstdError) as e:
            logger.warning(f"Redis set failed, data saved to memory only: {e}")


def get_redis_client() -> Redis | None:
    """Get the Redis client instance.

    Returns:
        Async Redis client instance
    """
    return redis_client
