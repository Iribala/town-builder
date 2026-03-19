"""Tests for town CRUD route endpoints.

Uses FastAPI test client with mocked django_client calls.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
import respx
from httpx import Response

from app.config import settings
from tests.conftest import SAMPLE_LAYOUT_DATA_DICT, KIBIGIA_TOWN_API_RESPONSE


@pytest.fixture(autouse=True)
def _configure_api(monkeypatch):
    monkeypatch.setattr(settings, "api_url", "http://localhost:8000/api/towns/")
    monkeypatch.setattr(settings, "api_token", "test-token")
    monkeypatch.setattr(settings, "allowed_api_domains", ["localhost", "127.0.0.1"])


class TestSaveTown:

    async def test_save_with_town_id_patches(self, app_client):
        """town_id present → PATCH to kibigia."""
        with patch("app.routes.town.update_town", new_callable=AsyncMock) as mock_update:
            mock_update.return_value = {"status": "success", "town_id": 42}

            resp = await app_client.post("/api/town/save", json={
                "data": SAMPLE_LAYOUT_DATA_DICT,
                "town_id": 42,
                "townName": "Springfield",
            })

            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "success"
            assert body["town_id"] == 42
            mock_update.assert_called_once()

    async def test_save_without_id_searches_then_creates(self, app_client):
        """No town_id → search by name → POST if not found."""
        with (
            patch("app.routes.town.search_town_by_name", new_callable=AsyncMock) as mock_search,
            patch("app.routes.town.create_town", new_callable=AsyncMock) as mock_create,
        ):
            mock_search.return_value = None
            mock_create.return_value = {"status": "success", "town_id": 99, "response": {}}

            resp = await app_client.post("/api/town/save", json={
                "data": SAMPLE_LAYOUT_DATA_DICT,
                "townName": "NewTown",
            })

            assert resp.status_code == 200
            body = resp.json()
            assert body["town_id"] == 99
            mock_search.assert_called_once_with("NewTown")
            mock_create.assert_called_once()

    async def test_save_without_id_searches_then_patches(self, app_client):
        """No town_id → search by name → PATCH if found."""
        with (
            patch("app.routes.town.search_town_by_name", new_callable=AsyncMock) as mock_search,
            patch("app.routes.town.update_town", new_callable=AsyncMock) as mock_update,
        ):
            mock_search.return_value = 42
            mock_update.return_value = {"status": "success", "town_id": 42}

            resp = await app_client.post("/api/town/save", json={
                "data": SAMPLE_LAYOUT_DATA_DICT,
                "townName": "Springfield",
            })

            assert resp.status_code == 200
            body = resp.json()
            assert body["town_id"] == 42
            mock_update.assert_called_once()

    async def test_save_no_data_returns_400(self, app_client):
        """Missing data field → 400."""
        resp = await app_client.post("/api/town/save", json={
            "filename": "test.json",
        })
        assert resp.status_code == 400

    async def test_django_error_returns_success_with_warning(self, app_client):
        """kibigia 500 → town still saved locally, warning in message."""
        with patch("app.routes.town.update_town", new_callable=AsyncMock) as mock_update:
            mock_update.side_effect = Exception("Connection refused")

            resp = await app_client.post("/api/town/save", json={
                "data": SAMPLE_LAYOUT_DATA_DICT,
                "town_id": 42,
            })

            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "success"
            assert "Warning" in body["message"]


class TestLoadTownFromDjango:

    @respx.mock
    async def test_load_town_response_shape(self, app_client):
        """Response has {status, message, data, town_info}."""
        respx.get("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json=KIBIGIA_TOWN_API_RESPONSE)
        )

        resp = await app_client.get("/api/town/load-from-django/42")
        assert resp.status_code == 200

        body = resp.json()
        assert body["status"] == "success"
        assert "data" in body
        assert "town_info" in body
        assert body["town_info"]["id"] == 42
        assert body["town_info"]["name"] == "Springfield"
        assert "category_statuses" in body["town_info"]

    @respx.mock
    async def test_load_town_normalizes_layout(self, app_client):
        """Layout data is normalized before returning."""
        respx.get("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json=KIBIGIA_TOWN_API_RESPONSE)
        )

        resp = await app_client.get("/api/town/load-from-django/42")
        body = resp.json()

        # Should have all category keys
        data = body["data"]
        assert "buildings" in data
        assert "vehicles" in data
        assert "terrain" in data

    @respx.mock
    async def test_load_town_django_unreachable(self, app_client):
        """kibigia down → 500 with error message."""
        respx.get("http://localhost:8000/api/towns/42/").mock(side_effect=Exception("refused"))

        resp = await app_client.get("/api/town/load-from-django/42")
        assert resp.status_code == 500


class TestGetTown:

    async def test_returns_current_data(self, app_client):
        """GET /api/town returns current in-memory data."""
        resp = await app_client.get("/api/town")
        assert resp.status_code == 200
        body = resp.json()
        # Should have category keys from default storage
        assert isinstance(body, dict)


class TestUpdateTownEndpoint:

    async def test_update_town_name(self, app_client):
        """POST with only townName updates the name."""
        resp = await app_client.post("/api/town", json={"townName": "NewName"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

    async def test_full_data_update(self, app_client):
        """POST with full data replaces town data."""
        resp = await app_client.post("/api/town", json=SAMPLE_LAYOUT_DATA_DICT)
        assert resp.status_code == 200


class TestDeleteModel:

    async def test_delete_nonexistent_returns_404(self, app_client):
        """Deleting a model that doesn't exist → 404."""
        resp = await app_client.request(
            "DELETE", "/api/town/model",
            json={"id": "nonexistent", "category": "buildings"},
        )
        assert resp.status_code == 404


class TestEditModel:

    async def test_edit_nonexistent_returns_404(self, app_client):
        """Editing a model that doesn't exist → 404."""
        resp = await app_client.put("/api/town/model", json={
            "id": "nonexistent",
            "category": "buildings",
            "position": {"x": 1, "y": 2, "z": 3},
        })
        assert resp.status_code == 404
