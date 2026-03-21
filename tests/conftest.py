"""Shared test fixtures for town-builder tests."""

import os
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

# Set test environment before importing app modules
os.environ["DISABLE_JWT_AUTH"] = "true"
os.environ["ENVIRONMENT"] = "development"
os.environ["REDIS_URL"] = "redis://localhost:6379/15"
os.environ["TOWN_API_URL"] = "http://localhost:8000/api/towns/"
os.environ["ALLOWED_DOMAINS"] = "localhost,127.0.0.1"

from app.config import settings  # noqa: E402

TEST_JWT_SECRET = "test-secret-key-at-least-32-bytes-long!"


# ── Contract constants ──────────────────────────────────────────────
# These mirror the exact shapes kibigia produces/expects.

KIBIGIA_JWT_PAYLOAD = {
    "user_id": 1,
    "username": "testuser",
    "email": "test@example.com",
    "exp": datetime.utcnow() + timedelta(hours=8),
    "iat": datetime.utcnow(),
    "sub": "1",
    "town_id": 42,
}

SAMPLE_LAYOUT_DATA_DICT = {
    "buildings": [
        {
            "id": "bld-001",
            "model": "house.glb",
            "category": "buildings",
            "position": {"x": 10.0, "y": 0.0, "z": 5.0},
            "rotation": {"x": 0.0, "y": 1.57, "z": 0.0},
            "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
        }
    ],
    "vehicles": [],
    "trees": [],
    "props": [],
    "street": [],
    "park": [],
    "terrain": [],
    "roads": [],
    "townName": "Springfield",
}

SAMPLE_LAYOUT_DATA_ARRAY = [
    {
        "category": "buildings",
        "model": "house.glb",
        "position": [10, 0, 5],
        "rotation": [0, 1.57, 0],
        "scale": [1, 1, 1],
    },
    {
        "category": "vehicles",
        "model": "car.glb",
        "position": [20, 0, 15],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
    },
]

KIBIGIA_TOWN_API_RESPONSE = {
    "id": 42,
    "name": "Springfield",
    "description": "A test town",
    "population": 25000,
    "area": 15.5,
    "established_date": "1990-01-01",
    "town_image": None,
    "tags": ["civic", "test"],
    "latitude": 42.1015,
    "longitude": -72.5898,
    "place_type": "town",
    "full_address": "Springfield, MA",
    "layout_data": SAMPLE_LAYOUT_DATA_DICT,
    "category_statuses": [
        {
            "category_id": 1,
            "category_name": "Infrastructure",
            "status": "present",
            "status_level": 3,
            "severity": "medium",
            "notes": "Roads need repair",
        }
    ],
}

from app.utils.normalization import CATEGORIES as ALL_CATEGORIES


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def jwt_secret(monkeypatch):
    """Set a known JWT secret for testing."""
    monkeypatch.setattr(settings, "jwt_secret_key", TEST_JWT_SECRET)
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    monkeypatch.setattr(settings, "disable_jwt_auth", False)
    return TEST_JWT_SECRET


@pytest.fixture
def valid_token(jwt_secret):
    """A valid JWT matching kibigia's generate_town_builder_token() output."""
    payload = {
        "user_id": 1,
        "username": "testuser",
        "email": "test@example.com",
        "exp": datetime.utcnow() + timedelta(hours=8),
        "iat": datetime.utcnow(),
        "sub": "1",
        "town_id": 42,
    }
    return pyjwt.encode(payload, jwt_secret, algorithm="HS256")


@pytest.fixture
def expired_token(jwt_secret):
    """A JWT with exp in the past."""
    payload = {
        "username": "testuser",
        "sub": "1",
        "exp": datetime.utcnow() - timedelta(hours=1),
        "iat": datetime.utcnow() - timedelta(hours=9),
    }
    return pyjwt.encode(payload, jwt_secret, algorithm="HS256")


@pytest.fixture
def auth_headers(valid_token):
    """Authorization headers with a valid bearer token."""
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def dev_mode(monkeypatch):
    """Enable dev mode (JWT auth bypassed)."""
    monkeypatch.setattr(settings, "disable_jwt_auth", True)


@pytest.fixture
async def app_client(dev_mode):
    """AsyncClient using FastAPI test transport (no real HTTP).

    Uses dev mode by default so tests don't need auth unless testing auth.
    """
    from app.main import app
    from app.services import storage

    # Bypass Redis — use in-memory only
    storage.redis_client = None

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def sample_layout_dict():
    """Realistic layout_data in dict-of-categories format."""
    import copy
    return copy.deepcopy(SAMPLE_LAYOUT_DATA_DICT)


@pytest.fixture
def sample_layout_array():
    """Layout_data in array-of-objects format."""
    import copy
    return copy.deepcopy(SAMPLE_LAYOUT_DATA_ARRAY)


@pytest.fixture
def kibigia_town_response():
    """Response matching kibigia's TownSerializer output."""
    import copy
    return copy.deepcopy(KIBIGIA_TOWN_API_RESPONSE)
