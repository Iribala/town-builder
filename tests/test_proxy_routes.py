"""Tests for proxy pass-through routes.

Verifies that /api/proxy/towns/* correctly forwards to kibigia's /api/towns/*.
"""

from unittest.mock import AsyncMock, patch

import pytest
import respx
from httpx import Response

from app.config import settings


@pytest.fixture(autouse=True)
def _configure_api(monkeypatch):
    monkeypatch.setattr(settings, "api_url", "http://localhost:8000/api/towns/")
    monkeypatch.setattr(settings, "api_token", "test-token")
    monkeypatch.setattr(settings, "allowed_api_domains", ["localhost", "127.0.0.1"])


class TestProxyRoutes:

    @respx.mock
    async def test_get_forwards_to_kibigia(self, app_client):
        """GET /api/proxy/towns/ → GET /api/towns/."""
        route = respx.get("http://localhost:8000/api/towns/").mock(
            return_value=Response(200, json=[{"id": 1, "name": "Springfield"}])
        )
        resp = await app_client.get("/api/proxy/towns/")
        assert resp.status_code == 200
        assert route.called

    @respx.mock
    async def test_get_with_path(self, app_client):
        """GET /api/proxy/towns/42/ → GET /api/towns/42/."""
        route = respx.get("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42, "name": "Springfield"})
        )
        resp = await app_client.get("/api/proxy/towns/42/")
        assert resp.status_code == 200
        assert route.called

    @respx.mock
    async def test_post_forwards_body(self, app_client):
        """POST body is forwarded correctly."""
        route = respx.post("http://localhost:8000/api/towns/").mock(
            return_value=Response(201, json={"id": 1, "name": "Test"})
        )
        resp = await app_client.post("/api/proxy/towns", json={"name": "Test"})
        assert resp.status_code == 201
        assert route.called

    @respx.mock
    async def test_patch_with_path(self, app_client):
        """PATCH /api/proxy/towns/42/ → PATCH /api/towns/42/."""
        route = respx.patch("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42})
        )
        resp = await app_client.patch(
            "/api/proxy/towns/42/",
            json={"layout_data": {"buildings": []}},
        )
        assert resp.status_code == 200
        assert route.called

    @respx.mock
    async def test_preserves_status_code(self, app_client):
        """kibigia 404 → proxy returns 404."""
        respx.get("http://localhost:8000/api/towns/999/").mock(
            return_value=Response(404, json={"detail": "Not found."})
        )
        resp = await app_client.get("/api/proxy/towns/999/")
        assert resp.status_code == 404

    @respx.mock
    async def test_timeout_returns_504(self, app_client):
        """kibigia timeout → 504."""
        import httpx
        respx.get("http://localhost:8000/api/towns/").mock(
            side_effect=httpx.TimeoutException("timed out")
        )
        resp = await app_client.get("/api/proxy/towns/")
        assert resp.status_code == 504

    @respx.mock
    async def test_connect_error_returns_503(self, app_client):
        """kibigia unreachable → 503."""
        import httpx
        respx.get("http://localhost:8000/api/towns/").mock(
            side_effect=httpx.ConnectError("refused")
        )
        resp = await app_client.get("/api/proxy/towns/")
        assert resp.status_code == 503


class TestProxySSRFProtection:
    """SSRF protection tests — malicious paths must be rejected."""

    async def test_scheme_in_path_rejected(self, app_client):
        resp = await app_client.get("/api/proxy/towns/http://evil.com/")
        assert resp.status_code == 400

    async def test_authority_in_path_rejected(self, app_client):
        resp = await app_client.get("/api/proxy/towns/user@evil.com/")
        assert resp.status_code == 400

    async def test_traversal_rejected(self, app_client):
        """Path with '..' is rejected (sent URL-encoded to bypass FastAPI normalization)."""
        resp = await app_client.get(
            "/api/proxy/towns/%2e%2e/other-api/"
        )
        assert resp.status_code == 400

    async def test_double_slash_rejected(self, app_client):
        resp = await app_client.get("/api/proxy/towns///evil.com/steal")
        # FastAPI may normalize // but the path still reaches our handler
        assert resp.status_code in (400, 404)

    async def test_encoded_traversal_rejected(self, app_client):
        resp = await app_client.get("/api/proxy/towns/%2e%2e/secret")
        assert resp.status_code == 400

    @respx.mock
    async def test_legitimate_paths_still_work(self, app_client):
        """Normal kibigia proxy paths must not be blocked."""
        route = respx.get("http://localhost:8000/api/towns/42/").mock(
            return_value=Response(200, json={"id": 42})
        )
        resp = await app_client.get("/api/proxy/towns/42/")
        assert resp.status_code == 200
        assert route.called
