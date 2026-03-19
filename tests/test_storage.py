"""Tests for storage service (Redis/in-memory fallback)."""

import pytest

from app.services import storage


@pytest.fixture(autouse=True)
async def _reset_storage():
    """Reset in-memory storage and disable Redis for each test."""
    storage.redis_client = None
    storage._town_data_storage = storage._create_default_town_data()
    yield
    storage._town_data_storage = storage._create_default_town_data()


class TestInMemoryStorage:

    async def test_set_and_get_roundtrip(self):
        data = {"buildings": [{"id": "1", "model": "house.glb"}], "vehicles": []}
        await storage.set_town_data(data)
        result = await storage.get_town_data()
        assert result["buildings"][0]["id"] == "1"

    async def test_get_returns_deepcopy(self):
        """Modifying returned data doesn't affect stored data."""
        data = {"buildings": [{"id": "1"}]}
        await storage.set_town_data(data)

        result = await storage.get_town_data()
        result["buildings"].append({"id": "2"})

        fresh = await storage.get_town_data()
        assert len(fresh["buildings"]) == 1

    async def test_empty_initial_state(self):
        """Default state has empty category lists."""
        result = await storage.get_town_data()
        assert result["buildings"] == []
        assert result["vehicles"] == []
        assert result["terrain"] == []

    async def test_fallback_when_redis_unavailable(self):
        """With redis_client=None, in-memory is used without error."""
        assert storage.redis_client is None
        await storage.set_town_data({"buildings": [{"id": "x"}]})
        result = await storage.get_town_data()
        assert result["buildings"][0]["id"] == "x"

    async def test_overwrite_replaces_data(self):
        await storage.set_town_data({"buildings": [{"id": "1"}]})
        await storage.set_town_data({"buildings": [{"id": "2"}]})
        result = await storage.get_town_data()
        assert len(result["buildings"]) == 1
        assert result["buildings"][0]["id"] == "2"
