"""Helpers for normalizing town layout data shapes."""

from typing import Any

CATEGORIES = [
    "buildings",
    "vehicles",
    "trees",
    "props",
    "street",
    "park",
    "terrain",
    "roads",
]


def _vec_from_array(values: Any, default: dict[str, float]) -> dict[str, float]:
    if isinstance(values, (list, tuple)) and len(values) >= 3:
        return {"x": float(values[0]), "y": float(values[1]), "z": float(values[2])}
    if isinstance(values, dict):
        return {
            "x": float(values.get("x", default["x"])),
            "y": float(values.get("y", default["y"])),
            "z": float(values.get("z", default["z"])),
        }
    return default.copy()


def normalize_layout_data(layout_data: Any) -> dict[str, list[dict[str, Any]]]:
    """Normalize layout data into canonical dict-of-categories shape."""
    if isinstance(layout_data, dict):
        normalized: dict[str, list[dict[str, Any]]] = {}
        for category in CATEGORIES:
            items = layout_data.get(category, [])
            normalized[category] = _normalize_objects_list(items, category)
        # Preserve extra top-level keys (e.g., townName)
        for key, value in layout_data.items():
            if key not in normalized:
                normalized[key] = value
        return normalized

    if isinstance(layout_data, list):
        normalized = {category: [] for category in CATEGORIES}
        for item in layout_data:
            if not isinstance(item, dict):
                continue
            category = item.get("category")
            if category not in normalized:
                continue
            normalized[category].append(_normalize_object(item, category))
        return normalized

    return {category: [] for category in CATEGORIES}


def _normalize_objects_list(items: Any, category: str) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [
        _normalize_object(item, category) for item in items if isinstance(item, dict)
    ]


def _normalize_object(item: dict[str, Any], category: str) -> dict[str, Any]:
    model = item.get("model") or item.get("modelName")
    return {
        **item,
        "category": category,
        "model": model,
        "position": _vec_from_array(
            item.get("position"), {"x": 0.0, "y": 0.0, "z": 0.0}
        ),
        "rotation": _vec_from_array(
            item.get("rotation"), {"x": 0.0, "y": 0.0, "z": 0.0}
        ),
        "scale": _vec_from_array(item.get("scale"), {"x": 1.0, "y": 1.0, "z": 1.0}),
    }
