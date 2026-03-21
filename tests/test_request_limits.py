"""Tests for request limits: body size, batch cap, SSE connection limit."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.services import storage


@pytest.fixture(autouse=True)
async def _reset_storage():
    """Reset storage to defaults for each test."""
    storage.redis_client = None
    storage._town_data_storage = storage._create_default_town_data()
    yield
    storage._town_data_storage = storage._create_default_town_data()


@pytest.fixture
async def app_client(dev_mode):
    from app.main import app

    storage.redis_client = None
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ── Request Body Size Limit ─────────────────────────────────────────


class TestRequestBodyLimit:

    async def test_small_request_accepted(self, app_client):
        """Normal-sized requests pass through."""
        payload = {"townName": "TestTown"}
        resp = await app_client.post("/api/town", json=payload)
        assert resp.status_code == 200

    async def test_large_request_rejected(self, app_client, monkeypatch):
        """Requests exceeding the body limit get 413."""
        # Set a tiny limit for testing
        monkeypatch.setattr(settings, "max_request_body_bytes", 100)
        payload = {"data": "x" * 200}
        resp = await app_client.post(
            "/api/town",
            content=json.dumps(payload),
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 413
        assert "too large" in resp.json()["message"].lower()


# ── Batch Operations Cap ────────────────────────────────────────────


class TestBatchOperationsCap:

    @patch("app.services.town_helpers.broadcast_sse", new_callable=AsyncMock)
    async def test_within_limit_accepted(self, mock_sse, app_client):
        """Batch request with operations within limit succeeds."""
        ops = [
            {"op": "create", "category": "buildings", "data": {
                "model": "house.glb",
                "position": {"x": float(i), "y": 0, "z": 0},
            }}
            for i in range(5)
        ]
        resp = await app_client.post(
            "/api/batch/operations",
            json={"operations": ops},
        )
        assert resp.status_code == 200

    async def test_exceeds_limit_rejected(self, app_client, monkeypatch):
        """Batch request exceeding max operations gets 422 validation error."""
        # The Field(max_length=100) on the schema enforces this via Pydantic
        ops = [
            {"op": "create", "category": "buildings", "data": {
                "model": "house.glb",
                "position": {"x": float(i), "y": 0, "z": 0},
            }}
            for i in range(101)
        ]
        resp = await app_client.post(
            "/api/batch/operations",
            json={"operations": ops},
        )
        assert resp.status_code == 422

    async def test_exactly_at_limit_accepted(self, app_client, monkeypatch):
        """Batch request at exactly the max operations is accepted."""
        ops = [
            {"op": "create", "category": "buildings", "data": {
                "model": "house.glb",
                "position": {"x": float(i), "y": 0, "z": 0},
            }}
            for i in range(100)
        ]
        resp = await app_client.post(
            "/api/batch/operations",
            json={"operations": ops},
        )
        # Should not get 422 — Pydantic allows exactly max_length
        assert resp.status_code != 422


# ── SSE Connection Limit ────────────────────────────────────────────


class TestSSEConnectionLimit:

    @pytest.fixture(autouse=True)
    async def _reset_sse_state(self):
        """Reset SSE connection tracking state."""
        from app.services import events
        async with events._users_lock:
            events._connected_users.clear()
            events._user_connection_counts.clear()
        yield
        async with events._users_lock:
            events._connected_users.clear()
            events._user_connection_counts.clear()

    async def test_connection_count_tracked(self):
        """SSE connections are counted per user."""
        from app.services.events import (
            _user_connection_counts,
            _users_lock,
            event_stream,
        )

        # Start a connection
        gen = event_stream("testuser")
        # Read the initial full-town message
        msg = await gen.__anext__()
        assert "full" in msg

        async with _users_lock:
            assert _user_connection_counts.get("testuser") == 1

        # Clean up — athrow CancelledError simulates client disconnect
        with pytest.raises(asyncio.CancelledError):
            await gen.athrow(asyncio.CancelledError)

        async with _users_lock:
            assert _user_connection_counts.get("testuser", 0) == 0

    async def test_excess_connections_rejected(self, monkeypatch):
        """Connections beyond the limit get an error event and stop."""
        from app.services.events import (
            _user_connection_counts,
            _users_lock,
            event_stream,
        )

        monkeypatch.setattr(settings, "max_sse_connections_per_user", 1)

        # First connection succeeds
        gen1 = event_stream("testuser")
        msg1 = await gen1.__anext__()
        assert "full" in msg1

        # Second connection gets rejected
        gen2 = event_stream("testuser")
        msg2 = await gen2.__anext__()
        assert "error" in msg2
        assert "limit" in msg2.lower()

        # Verify the generator ends
        with pytest.raises(StopAsyncIteration):
            await gen2.__anext__()

        # Clean up first connection
        try:
            await gen1.athrow(asyncio.CancelledError)
        except (asyncio.CancelledError, StopAsyncIteration):
            pass
