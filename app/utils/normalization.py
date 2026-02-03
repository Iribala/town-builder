"""Helpers for normalizing town layout data shapes."""
from typing import Any, Dict, List


_CATEGORIES = ["buildings", "vehicles", "trees", "props", "street", "park", "terrain", "roads"]


def _vec_from_array(values: Any, default: Dict[str, float]) -> Dict[str, float]:
    if isinstance(values, (list, tuple)) and len(values) >= 3:
        return {"x": float(values[0]), "y": float(values[1]), "z": float(values[2])}
    if isinstance(values, dict):
        return {
            "x": float(values.get("x", default["x"])),
            "y": float(values.get("y", default["y"])),
            "z": float(values.get("z", default["z"])),
        }
    return default.copy()


def normalize_layout_data(layout_data: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Normalize layout data into canonical dict-of-categories shape."""
    if isinstance(layout_data, dict):
        normalized: Dict[str, List[Dict[str, Any]]] = {}
        for category in _CATEGORIES:
            items = layout_data.get(category, [])
            normalized[category] = _normalize_objects_list(items, category)
        # Preserve extra top-level keys (e.g., townName)
        for key, value in layout_data.items():
            if key not in normalized:
                normalized[key] = value
        return normalized

    if isinstance(layout_data, list):
        normalized = {category: [] for category in _CATEGORIES}
        for item in layout_data:
            if not isinstance(item, dict):
                continue
            category = item.get("category")
            if category not in normalized:
                continue
            normalized[category].append(_normalize_object(item, category))
        return normalized

    return {category: [] for category in _CATEGORIES}


def denormalize_to_layout_list(town_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert canonical dict-of-categories into list layout_data shape.

    NOTE: This function is currently unused. It's kept for potential future use
    if Django or other consumers need the flat list format with array vectors
    instead of the dict-of-categories format with {x,y,z} dict vectors.

    The output format is:
    [
        {"category": "buildings", "modelName": "...", "position": [x, y, z], ...},
        {"category": "vehicles", "modelName": "...", "position": [x, y, z], ...},
        ...
    ]
    """
    results: List[Dict[str, Any]] = []
    if not isinstance(town_data, dict):
        return results

    for category in _CATEGORIES:
        items = town_data.get(category, [])
        if not isinstance(items, list):
            continue
        for obj in items:
            if not isinstance(obj, dict):
                continue
            results.append({
                "category": category,
                "modelName": obj.get("model"),
                "position": _array_from_vec(obj.get("position"), [0.0, 0.0, 0.0]),
                "rotation": _array_from_vec(obj.get("rotation"), [0.0, 0.0, 0.0]),
                "scale": _array_from_vec(obj.get("scale"), [1.0, 1.0, 1.0]),
                "id": obj.get("id"),
            })
    return results


def _normalize_objects_list(items: Any, category: str) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [_normalize_object(item, category) for item in items if isinstance(item, dict)]


def _normalize_object(item: Dict[str, Any], category: str) -> Dict[str, Any]:
    model = item.get("model") or item.get("modelName")
    return {
        **item,
        "category": category,
        "model": model,
        "position": _vec_from_array(item.get("position"), {"x": 0.0, "y": 0.0, "z": 0.0}),
        "rotation": _vec_from_array(item.get("rotation"), {"x": 0.0, "y": 0.0, "z": 0.0}),
        "scale": _vec_from_array(item.get("scale"), {"x": 1.0, "y": 1.0, "z": 1.0}),
    }


def _array_from_vec(values: Any, default: List[float]) -> List[float]:
    if isinstance(values, (list, tuple)) and len(values) >= 3:
        return [float(values[0]), float(values[1]), float(values[2])]
    if isinstance(values, dict):
        return [
            float(values.get("x", default[0])),
            float(values.get("y", default[1])),
            float(values.get("z", default[2])),
        ]
    return list(default)
