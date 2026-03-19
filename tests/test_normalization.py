"""Tests for layout data normalization.

These verify that all layout_data shapes kibigia might store in
Town.layout_data survive normalization correctly.
"""

from app.utils.normalization import normalize_layout_data
from tests.conftest import ALL_CATEGORIES


class TestNormalizeDictInput:
    """Dict-of-categories input (the canonical format)."""

    def test_canonical_dict_passthrough(self, sample_layout_dict):
        """Already-canonical data is preserved (categories, vectors, extra keys)."""
        result = normalize_layout_data(sample_layout_dict)

        assert len(result["buildings"]) == 1
        bld = result["buildings"][0]
        assert bld["model"] == "house.glb"
        assert bld["position"] == {"x": 10.0, "y": 0.0, "z": 5.0}
        assert bld["rotation"] == {"x": 0.0, "y": 1.57, "z": 0.0}
        assert bld["scale"] == {"x": 1.0, "y": 1.0, "z": 1.0}

    def test_all_categories_present_in_output(self, sample_layout_dict):
        """Output always has all 8 category keys."""
        result = normalize_layout_data(sample_layout_dict)
        for cat in ALL_CATEGORIES:
            assert cat in result, f"Missing category: {cat}"

    def test_extra_top_level_keys_preserved(self, sample_layout_dict):
        """townName and custom keys survive normalization."""
        sample_layout_dict["customField"] = "custom_value"
        sample_layout_dict["version"] = 2

        result = normalize_layout_data(sample_layout_dict)
        assert result["townName"] == "Springfield"
        assert result["customField"] == "custom_value"
        assert result["version"] == 2

    def test_empty_dict_returns_empty_categories(self):
        result = normalize_layout_data({})
        for cat in ALL_CATEGORIES:
            assert result[cat] == []


class TestNormalizeArrayInput:
    """Array-of-objects input (legacy format)."""

    def test_array_to_dict_conversion(self, sample_layout_array):
        """[{category: "buildings", ...}, ...] → dict shape."""
        result = normalize_layout_data(sample_layout_array)

        assert len(result["buildings"]) == 1
        assert len(result["vehicles"]) == 1
        assert result["buildings"][0]["model"] == "house.glb"
        assert result["vehicles"][0]["model"] == "car.glb"

    def test_unknown_categories_ignored(self):
        """Objects with unrecognized categories are dropped."""
        data = [{"category": "dragons", "model": "dragon.glb", "position": [0, 0, 0]}]
        result = normalize_layout_data(data)
        for cat in ALL_CATEGORIES:
            assert result[cat] == []

    def test_non_dict_items_skipped(self):
        """Non-dict items in the array are silently ignored."""
        data = [
            {"category": "buildings", "model": "house.glb"},
            "not a dict",
            42,
            None,
        ]
        result = normalize_layout_data(data)
        assert len(result["buildings"]) == 1


class TestVectorNormalization:
    """Position/rotation/scale vector format handling."""

    def test_position_array_to_dict(self):
        """[x, y, z] array → {x, y, z} dict."""
        data = {"buildings": [{"model": "h.glb", "position": [1, 2, 3]}]}
        result = normalize_layout_data(data)
        assert result["buildings"][0]["position"] == {"x": 1.0, "y": 2.0, "z": 3.0}

    def test_position_dict_preserved(self):
        """Already-dict vectors pass through."""
        data = {"buildings": [{"model": "h.glb", "position": {"x": 5, "y": 6, "z": 7}}]}
        result = normalize_layout_data(data)
        assert result["buildings"][0]["position"] == {"x": 5.0, "y": 6.0, "z": 7.0}

    def test_missing_position_defaults_zero(self):
        """Missing position → {x: 0, y: 0, z: 0}."""
        data = {"buildings": [{"model": "h.glb"}]}
        result = normalize_layout_data(data)
        assert result["buildings"][0]["position"] == {"x": 0.0, "y": 0.0, "z": 0.0}

    def test_missing_scale_defaults_one(self):
        """Missing scale → {x: 1, y: 1, z: 1}."""
        data = {"buildings": [{"model": "h.glb"}]}
        result = normalize_layout_data(data)
        assert result["buildings"][0]["scale"] == {"x": 1.0, "y": 1.0, "z": 1.0}

    def test_modelName_normalized_to_model(self):
        """modelName key gets mapped to model."""
        data = {"buildings": [{"modelName": "house.glb"}]}
        result = normalize_layout_data(data)
        assert result["buildings"][0]["model"] == "house.glb"


class TestEdgeCases:

    def test_none_returns_empty(self):
        result = normalize_layout_data(None)
        for cat in ALL_CATEGORIES:
            assert result[cat] == []

    def test_int_returns_empty(self):
        result = normalize_layout_data(42)
        for cat in ALL_CATEGORIES:
            assert result[cat] == []

    def test_string_returns_empty(self):
        result = normalize_layout_data("not valid")
        for cat in ALL_CATEGORIES:
            assert result[cat] == []
