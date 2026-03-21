"""Tests for the HTTP client that talks to kibigia's REST API.

Uses respx to mock httpx calls and verify that requests sent to
kibigia have the correct shape, method, and payload.
"""

import pytest
import respx
from httpx import Response

from app.services.django_client import (
    search_town_by_name,
    create_town,
    update_town,
    proxy_request,
    _prepare_django_payload,
    _get_headers,
    _get_base_url,
)
from app.config import settings
from tests.conftest import KIBIGIA_TOWN_API_RESPONSE, SAMPLE_LAYOUT_DATA_DICT


@pytest.fixture(autouse=True)
def _configure_api(monkeypatch):
    """Set API config for all tests in this module."""
    monkeypatch.setattr(settings, "api_url", "http://localhost:8000/api/towns/")
    monkeypatch.setattr(settings, "api_token", "test-token-123")
    monkeypatch.setattr(settings, "allowed_api_domains", ["localhost", "127.0.0.1"])


class TestSearchTownByName:

    @respx.mock
    async def test_found_list_response(self):
        """Parses [{"id": 1, "name": "X"}] response."""
        respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(200, json=[{"id": 1, "name": "Springfield"}])
        )
        result = await search_town_by_name("Springfield")
        assert result == 1

    @respx.mock
    async def test_found_paginated_response(self):
        """Parses {"results": [{"id": 1}]} response (DRF pagination)."""
        respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(200, json={"results": [{"id": 5, "name": "Boston"}]})
        )
        result = await search_town_by_name("Boston")
        assert result == 5

    @respx.mock
    async def test_not_found_returns_none(self):
        """Empty results → returns None."""
        respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(200, json=[])
        )
        result = await search_town_by_name("Nonexistent")
        assert result is None

    @respx.mock
    async def test_http_error_raises(self):
        """500 from kibigia → raises HTTPStatusError (caller decides how to handle)."""
        import httpx
        respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(500, json={"error": "Internal server error"})
        )
        with pytest.raises(httpx.HTTPStatusError):
            await search_town_by_name("Springfield")

    @respx.mock
    async def test_multiple_results_returns_first(self):
        """When multiple towns match, returns the first ID."""
        respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(200, json=[
                {"id": 10, "name": "Springfield"},
                {"id": 20, "name": "Springfield"},
            ])
        )
        result = await search_town_by_name("Springfield")
        assert result == 10


class TestCreateTown:

    @respx.mock
    async def test_payload_shape(self):
        """POST body matches TownSerializer expected input."""
        route = respx.post("http://localhost:8000/api/towns/").mock(
            return_value=Response(201, json={"id": 42, "name": "Springfield"})
        )

        await create_town(
            request_payload={"latitude": 42.1, "longitude": -72.5},
            normalized_town_data=SAMPLE_LAYOUT_DATA_DICT,
            town_name="Springfield",
        )

        sent = route.calls[0].request
        import json
        body = json.loads(sent.content)
        assert body["name"] == "Springfield"
        assert "layout_data" in body
        assert body["latitude"] == 42.1
        assert body["longitude"] == -72.5

    @respx.mock
    async def test_extracts_id_from_response(self):
        """Parses {"id": 42} from kibigia's response."""
        respx.post("http://localhost:8000/api/towns/").mock(
            return_value=Response(201, json={"id": 42, "name": "Springfield"})
        )
        result = await create_town({}, SAMPLE_LAYOUT_DATA_DICT, "Springfield")
        assert result["town_id"] == 42

    @respx.mock
    async def test_http_error_raises(self):
        """Non-2xx from kibigia raises httpx.HTTPStatusError."""
        import httpx
        respx.post("http://localhost:8000/api/towns/").mock(
            return_value=Response(400, json={"name": ["This field is required."]})
        )
        with pytest.raises(httpx.HTTPStatusError):
            await create_town({}, SAMPLE_LAYOUT_DATA_DICT, None)


class TestUpdateTown:

    @respx.mock
    async def test_uses_patch(self):
        """Sends PATCH to /api/towns/{id}/."""
        route = respx.patch("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42})
        )
        await update_town(42, {}, SAMPLE_LAYOUT_DATA_DICT, "Springfield")
        assert route.called

    @respx.mock
    async def test_omits_name_on_update(self):
        """PATCH payload has layout_data but no name."""
        route = respx.patch("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42})
        )
        await update_town(42, {}, SAMPLE_LAYOUT_DATA_DICT, "Springfield")

        import json
        body = json.loads(route.calls[0].request.content)
        assert "name" not in body
        assert "layout_data" in body


class TestPrepareDjangoPayload:

    def test_create_includes_name(self):
        payload = _prepare_django_payload(
            {}, SAMPLE_LAYOUT_DATA_DICT, "Springfield", is_update_operation=False
        )
        assert payload["name"] == "Springfield"

    def test_update_omits_name(self):
        payload = _prepare_django_payload(
            {}, SAMPLE_LAYOUT_DATA_DICT, "Springfield", is_update_operation=True
        )
        assert "name" not in payload

    def test_name_fallback_to_townName(self):
        """Falls back to layout_data.townName when no explicit name."""
        payload = _prepare_django_payload(
            {}, {"townName": "Shelbyville"}, None, is_update_operation=False
        )
        assert payload["name"] == "Shelbyville"

    def test_name_fallback_to_layout_name(self):
        """Falls back to layout_data.name."""
        payload = _prepare_django_payload(
            {}, {"name": "Ogdenville"}, None, is_update_operation=False
        )
        assert payload["name"] == "Ogdenville"

    def test_optional_fields_propagated(self):
        payload = _prepare_django_payload(
            {"latitude": 42.1, "description": "Nice town"},
            {},
            "X",
            is_update_operation=False,
        )
        assert payload["latitude"] == 42.1
        assert payload["description"] == "Nice town"


class TestHeaders:

    def test_includes_token_when_set(self, monkeypatch):
        monkeypatch.setattr(settings, "api_token", "my-token")
        headers = _get_headers()
        assert headers["Authorization"] == "Token my-token"

    def test_omits_token_when_empty(self, monkeypatch):
        monkeypatch.setattr(settings, "api_token", "")
        headers = _get_headers()
        assert "Authorization" not in headers

    def test_omits_token_when_none(self, monkeypatch):
        monkeypatch.setattr(settings, "api_token", None)
        headers = _get_headers()
        assert "Authorization" not in headers


class TestBaseUrlValidation:

    def test_valid_url_passes(self):
        url = _get_base_url()
        assert url == "http://localhost:8000/api/towns/"

    def test_invalid_domain_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "api_url", "http://evil.com/api/")
        with pytest.raises(ValueError, match="not allowed"):
            _get_base_url()

    def test_adds_trailing_slash(self, monkeypatch):
        monkeypatch.setattr(settings, "api_url", "http://localhost:8000/api/towns")
        url = _get_base_url()
        assert url.endswith("/")


class TestProxyRequest:

    @respx.mock
    async def test_get_forwards_correctly(self):
        route = respx.get("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42})
        )
        resp = await proxy_request("GET", "42/", {})
        assert resp.status_code == 200
        assert route.called

    @respx.mock
    async def test_post_forwards_body(self):
        route = respx.post("http://localhost:8000/api/towns/").mock(
            return_value=Response(201, json={"id": 1})
        )
        await proxy_request("POST", "", {}, data={"name": "Test"})

        import json
        body = json.loads(route.calls[0].request.content)
        assert body["name"] == "Test"

    async def test_unsupported_method_raises(self):
        with pytest.raises(ValueError, match="Unsupported HTTP method"):
            await proxy_request("OPTIONS", "", {})

    async def test_traversal_path_rejected(self):
        """Path traversal in proxy path raises ValueError."""
        with pytest.raises(ValueError, match="\\.\\."):
            await proxy_request("GET", "../../other-api/", {})

    async def test_scheme_in_path_rejected(self):
        """Full URL in proxy path raises ValueError."""
        with pytest.raises(ValueError, match="scheme"):
            await proxy_request("GET", "http://evil.com/", {})

    async def test_authority_in_path_rejected(self):
        """@ in proxy path raises ValueError."""
        with pytest.raises(ValueError, match="@"):
            await proxy_request("GET", "user@evil.com/", {})
