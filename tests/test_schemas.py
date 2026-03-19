"""Tests for Pydantic schema validation."""

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    Position,
    Rotation,
    Scale,
    SaveTownRequest,
    TownUpdateRequest,
    DeleteModelRequest,
    EditModelRequest,
    ApiResponse,
    BatchOperation,
)


class TestPositionDefaults:

    def test_defaults_to_zero(self):
        pos = Position()
        assert pos.x == 0.0
        assert pos.y == 0.0
        assert pos.z == 0.0

    def test_accepts_floats(self):
        pos = Position(x=1.5, y=-2.3, z=100.0)
        assert pos.x == 1.5


class TestScaleDefaults:

    def test_defaults_to_one(self):
        scale = Scale()
        assert scale.x == 1.0
        assert scale.y == 1.0
        assert scale.z == 1.0


class TestSaveTownRequest:

    def test_accepts_dict_data(self):
        req = SaveTownRequest(data={"buildings": []})
        assert req.data == {"buildings": []}

    def test_accepts_list_data(self):
        req = SaveTownRequest(data=[{"category": "buildings"}])
        assert isinstance(req.data, list)

    def test_all_fields_optional_except_defaults(self):
        req = SaveTownRequest()
        assert req.filename == "town_data.json"
        assert req.data is None
        assert req.town_id is None

    def test_town_id_is_int(self):
        req = SaveTownRequest(town_id=42)
        assert req.town_id == 42


class TestTownUpdateRequest:

    def test_all_fields_optional(self):
        req = TownUpdateRequest()
        assert req.townName is None
        assert req.buildings is None

    def test_accepts_buildings_list(self):
        req = TownUpdateRequest(buildings=[{"model": "house.glb"}])
        assert len(req.buildings) == 1


class TestDeleteModelRequest:

    def test_id_based_delete(self):
        req = DeleteModelRequest(id="bld-1", category="buildings")
        assert req.id == "bld-1"

    def test_position_based_delete(self):
        req = DeleteModelRequest(category="buildings", position=Position(x=1, y=0, z=1))
        assert req.position.x == 1.0

    def test_category_required(self):
        with pytest.raises(ValidationError):
            DeleteModelRequest(id="bld-1")


class TestEditModelRequest:

    def test_requires_id_and_category(self):
        with pytest.raises(ValidationError):
            EditModelRequest(category="buildings")  # missing id

    def test_position_rotation_scale_optional(self):
        req = EditModelRequest(id="bld-1", category="buildings")
        assert req.position is None
        assert req.rotation is None
        assert req.scale is None


class TestApiResponse:

    def test_standard_shape(self):
        resp = ApiResponse(status="success", message="Done", data={"id": 1})
        assert resp.status == "success"
        assert resp.data == {"id": 1}

    def test_minimal(self):
        resp = ApiResponse(status="error")
        assert resp.message is None
        assert resp.data is None
