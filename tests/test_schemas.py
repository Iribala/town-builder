"""Tests for Pydantic schema validation."""

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    Position,
    Rotation,
    Scale,
    PlacedObject,
    SaveTownRequest,
    TownUpdateRequest,
    DeleteModelRequest,
    EditModelRequest,
    ApiResponse,
    BatchOperation,
    FilterCondition,
    QueryRequest,
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


class TestPlacedObject:

    def test_minimal(self):
        obj = PlacedObject()
        assert obj.id is None
        assert obj.model is None

    def test_full_object(self):
        obj = PlacedObject(
            id="bld-1", model="house.glb", category="buildings",
            position={"x": 10, "y": 0, "z": 5},
            rotation={"x": 0, "y": 1.57, "z": 0},
            scale={"x": 1, "y": 1, "z": 1},
        )
        assert obj.id == "bld-1"
        assert obj.model == "house.glb"

    def test_extra_fields_preserved(self):
        """Kibigia layout_data may have extra keys like 'modelName', 'color'."""
        obj = PlacedObject(id="x", modelName="house.glb", color="#ff0000")
        assert obj.model_extra["modelName"] == "house.glb"
        assert obj.model_extra["color"] == "#ff0000"

    def test_position_as_list(self):
        """Legacy format: position as [x, y, z] array."""
        obj = PlacedObject(position=[10, 0, 5])
        assert obj.position == [10, 0, 5]

    def test_position_as_dict(self):
        obj = PlacedObject(position={"x": 1.0, "y": 2.0, "z": 3.0})
        # Could be parsed as Position or dict — both are valid
        assert obj.position is not None


class TestSaveTownRequest:

    def test_accepts_dict_data(self):
        req = SaveTownRequest(data={"buildings": []})
        assert req.data == {"buildings": []}

    def test_accepts_list_data(self):
        req = SaveTownRequest(data=[{"category": "buildings"}])
        assert isinstance(req.data, list)

    def test_rejects_non_dict_non_list(self):
        """data must be dict or list, not a scalar."""
        with pytest.raises(ValidationError):
            SaveTownRequest(data="not valid")

    def test_rejects_int_data(self):
        with pytest.raises(ValidationError):
            SaveTownRequest(data=42)

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

    def test_extra_fields_preserved(self):
        """TownUpdateRequest may receive extra category keys from kibigia."""
        req = TownUpdateRequest(vehicles=[{"model": "car.glb"}])
        assert req.model_extra["vehicles"] == [{"model": "car.glb"}]


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

    def test_requires_id_or_position(self):
        """Must provide at least one identifier."""
        with pytest.raises(ValidationError, match="id.*position"):
            DeleteModelRequest(category="buildings")


class TestEditModelRequest:

    def test_requires_id_and_category(self):
        with pytest.raises(ValidationError):
            EditModelRequest(category="buildings")  # missing id

    def test_requires_at_least_one_transform(self):
        """Must provide at least one of position, rotation, or scale."""
        with pytest.raises(ValidationError, match="position.*rotation.*scale"):
            EditModelRequest(id="bld-1", category="buildings")

    def test_position_only(self):
        req = EditModelRequest(
            id="bld-1", category="buildings", position=Position(x=1, y=0, z=0)
        )
        assert req.position.x == 1.0
        assert req.rotation is None

    def test_scale_only(self):
        req = EditModelRequest(
            id="bld-1", category="buildings", scale=Scale(x=2, y=2, z=2)
        )
        assert req.scale.x == 2.0


class TestBatchOperation:

    def test_valid_ops(self):
        for op in ("create", "update", "delete", "edit"):
            batch = BatchOperation(op=op, category="buildings")
            assert batch.op == op

    def test_invalid_op_rejected(self):
        with pytest.raises(ValidationError):
            BatchOperation(op="drop_table", category="buildings")


class TestFilterCondition:

    def test_valid_operators(self):
        for op in ("eq", "ne", "gt", "lt", "gte", "lte", "contains", "in"):
            fc = FilterCondition(field="position.x", operator=op, value=10)
            assert fc.operator == op

    def test_invalid_operator_rejected(self):
        with pytest.raises(ValidationError):
            FilterCondition(field="position.x", operator="eval", value="code")

    def test_value_accepts_various_types(self):
        """Value can be string, number, or list (for 'in' operator)."""
        FilterCondition(field="model", operator="eq", value="house.glb")
        FilterCondition(field="position.x", operator="gt", value=10.5)
        FilterCondition(field="category", operator="in", value=["buildings", "trees"])


class TestQueryRequest:

    def test_sort_order_literal(self):
        q = QueryRequest(sort_order="desc")
        assert q.sort_order == "desc"

    def test_invalid_sort_order_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(sort_order="random")


class TestApiResponse:

    def test_standard_shape(self):
        resp = ApiResponse(status="success", message="Done", data={"id": 1})
        assert resp.status == "success"
        assert resp.data == {"id": 1}

    def test_minimal(self):
        resp = ApiResponse(status="error")
        assert resp.message is None
        assert resp.data is None
