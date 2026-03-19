"""Tests for JWT authentication (auth.py).

These verify that tokens with kibigia's exact payload structure are
accepted, and that edge cases (expired, wrong secret, missing fields)
are properly rejected.
"""

from datetime import datetime, timedelta

import jwt as pyjwt
import pytest
from fastapi import HTTPException

from app.services.auth import verify_token_string, get_current_user, create_access_token
from tests.conftest import TEST_JWT_SECRET


class TestVerifyTokenString:
    """Tests for verify_token_string — the core decode path."""

    def test_valid_kibigia_token_accepted(self, jwt_secret):
        """Token with kibigia's full payload shape decodes successfully."""
        payload = {
            "user_id": 1,
            "username": "testuser",
            "email": "test@example.com",
            "exp": datetime.utcnow() + timedelta(hours=8),
            "iat": datetime.utcnow(),
            "sub": "1",
            "town_id": 42,
        }
        token = pyjwt.encode(payload, jwt_secret, algorithm="HS256")
        result = verify_token_string(token)

        assert result["username"] == "testuser"
        assert result["payload"]["user_id"] == 1
        assert result["payload"]["town_id"] == 42
        assert result["payload"]["email"] == "test@example.com"

    def test_username_extracted_from_username_field(self, jwt_secret):
        """When both username and sub exist, username takes priority."""
        token = pyjwt.encode(
            {"username": "alice", "sub": "99", "exp": datetime.utcnow() + timedelta(hours=1)},
            jwt_secret,
            algorithm="HS256",
        )
        result = verify_token_string(token)
        assert result["username"] == "alice"

    def test_username_falls_back_to_sub(self, jwt_secret):
        """When payload has only sub (no username), sub is used."""
        token = pyjwt.encode(
            {"sub": "bob", "exp": datetime.utcnow() + timedelta(hours=1)},
            jwt_secret,
            algorithm="HS256",
        )
        result = verify_token_string(token)
        assert result["username"] == "bob"

    def test_expired_token_rejected(self, jwt_secret):
        """Token with past exp raises 401."""
        token = pyjwt.encode(
            {"username": "x", "exp": datetime.utcnow() - timedelta(hours=1)},
            jwt_secret,
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token_string(token)
        assert exc_info.value.status_code == 401

    def test_wrong_secret_rejected(self, jwt_secret):
        """Token signed with a different key raises 401."""
        token = pyjwt.encode(
            {"username": "x", "exp": datetime.utcnow() + timedelta(hours=1)},
            "completely-different-secret-key-here!!",
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token_string(token)
        assert exc_info.value.status_code == 401

    def test_missing_username_and_sub_rejected(self, jwt_secret):
        """Token without username or sub raises 401."""
        token = pyjwt.encode(
            {"email": "x@y.com", "exp": datetime.utcnow() + timedelta(hours=1)},
            jwt_secret,
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token_string(token)
        assert exc_info.value.status_code == 401

    def test_malformed_token_rejected(self, jwt_secret):
        """Garbage string raises 401."""
        with pytest.raises(HTTPException) as exc_info:
            verify_token_string("not.a.valid.jwt.token")
        assert exc_info.value.status_code == 401


class TestGetCurrentUser:
    """Tests for the FastAPI dependency that routes use."""

    def test_dev_mode_bypass(self, monkeypatch):
        """When disable_jwt_auth=True, returns dev-user without any token."""
        from app.config import settings
        monkeypatch.setattr(settings, "disable_jwt_auth", True)

        result = get_current_user(credentials=None)
        assert result["username"] == "dev-user"

    def test_no_credentials_raises_401(self, jwt_secret):
        """No bearer token with auth enabled raises 401."""
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials=None)
        assert exc_info.value.status_code == 401


class TestCreateAccessToken:
    """Tests for the dev token generation helper."""

    def test_creates_decodable_token(self, jwt_secret, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "environment", "development")

        result = create_access_token("alice", expires_hours=1)
        assert result["token_type"] == "bearer"
        assert result["username"] == "alice"
        assert result["expires_in"] == 3600

        # Verify the token is actually valid
        decoded = pyjwt.decode(
            result["access_token"], jwt_secret, algorithms=["HS256"]
        )
        assert decoded["sub"] == "alice"

    def test_blocked_in_production(self, jwt_secret, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "environment", "production")

        with pytest.raises(HTTPException) as exc_info:
            create_access_token("alice")
        assert exc_info.value.status_code == 404
