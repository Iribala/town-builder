"""Shared geometry utilities for spatial calculations."""

import math
from typing import Any

# Distance threshold for position-based object deletion
DELETE_PROXIMITY_THRESHOLD = 2.0


def calculate_distance(
    point1: dict[str, Any], point2: dict[str, Any]
) -> float:
    """Calculate Euclidean distance between two 3D points.

    Args:
        point1: First point with x, y, z keys
        point2: Second point with x, y, z keys

    Returns:
        Distance between points
    """
    dx = point1.get("x", 0) - point2.get("x", 0)
    dy = point1.get("y", 0) - point2.get("y", 0)
    dz = point1.get("z", 0) - point2.get("z", 0)
    return math.sqrt(dx * dx + dy * dy + dz * dz)
