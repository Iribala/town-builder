"""Tests for batch operations service."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.batch_operations import BatchOperationsManager
from app.services import storage


@pytest.fixture(autouse=True)
async def _reset_storage():
    """Set up initial town data for batch tests."""
    storage.redis_client = None
    initial_data = {
        "buildings": [
            {"id": "bld-1", "model": "house.glb", "position": {"x": 0, "y": 0, "z": 0}},
            {"id": "bld-2", "model": "shop.glb", "position": {"x": 10, "y": 0, "z": 10}},
        ],
        "vehicles": [],
        "trees": [],
        "props": [],
        "street": [],
        "park": [],
        "terrain": [],
        "roads": [],
    }
    await storage.set_town_data(initial_data)
    yield
    storage._town_data_storage = storage._create_default_town_data()


@pytest.fixture
def manager():
    return BatchOperationsManager()


class TestBatchCreate:

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_create_adds_object(self, mock_sse, manager):
        ops = [{"op": "create", "category": "vehicles", "data": {"model": "car.glb"}}]
        results, ok, failed = await manager.execute_operations(ops)

        assert ok == 1
        assert failed == 0
        assert results[0]["success"] is True

        data = await storage.get_town_data()
        assert len(data["vehicles"]) == 1
        assert data["vehicles"][0]["model"] == "car.glb"
        assert "id" in data["vehicles"][0]  # auto-generated

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_create_missing_category_fails(self, mock_sse, manager):
        ops = [{"op": "create", "data": {"model": "car.glb"}}]
        results, ok, failed = await manager.execute_operations(ops)
        assert failed == 1
        assert results[0]["success"] is False


class TestBatchDelete:

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_delete_by_id(self, mock_sse, manager):
        ops = [{"op": "delete", "category": "buildings", "id": "bld-1"}]
        results, ok, failed = await manager.execute_operations(ops)

        assert ok == 1
        data = await storage.get_town_data()
        assert len(data["buildings"]) == 1
        assert data["buildings"][0]["id"] == "bld-2"

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_delete_by_position(self, mock_sse, manager):
        ops = [{
            "op": "delete",
            "category": "buildings",
            "position": {"x": 0, "y": 0, "z": 0},
        }]
        results, ok, failed = await manager.execute_operations(ops)

        assert ok == 1
        data = await storage.get_town_data()
        assert len(data["buildings"]) == 1

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_delete_nonexistent_fails(self, mock_sse, manager):
        ops = [{"op": "delete", "category": "buildings", "id": "nonexistent"}]
        results, ok, failed = await manager.execute_operations(ops)
        assert failed == 1


class TestBatchEdit:

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_edit_position(self, mock_sse, manager):
        ops = [{
            "op": "edit",
            "category": "buildings",
            "id": "bld-1",
            "position": {"x": 99, "y": 0, "z": 99},
        }]
        results, ok, failed = await manager.execute_operations(ops)

        assert ok == 1
        data = await storage.get_town_data()
        assert data["buildings"][0]["position"] == {"x": 99, "y": 0, "z": 99}


class TestBatchAtomicity:

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_failure_rolls_back_all(self, mock_sse, manager):
        """One failing op → changes from successful ops are NOT saved."""
        ops = [
            {"op": "create", "category": "vehicles", "data": {"model": "car.glb"}},
            {"op": "delete", "category": "buildings", "id": "nonexistent"},
        ]
        results, ok, failed = await manager.execute_operations(ops)

        assert failed > 0
        # Vehicles should NOT have the new car (rollback)
        data = await storage.get_town_data()
        assert len(data["vehicles"]) == 0

    @patch("app.services.batch_operations.broadcast_sse", new_callable=AsyncMock)
    async def test_unknown_op_type_fails(self, mock_sse, manager):
        ops = [{"op": "teleport", "category": "buildings", "id": "bld-1"}]
        results, ok, failed = await manager.execute_operations(ops)
        assert failed == 1
        assert "Unknown" in results[0]["message"]
