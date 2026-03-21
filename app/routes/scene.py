"""Routes for scene description and analysis."""
import logging

from fastapi import APIRouter, Depends

from app.services.auth import get_current_user
from app.services.storage import get_town_data
from app.services.scene_description import generate_scene_description
from app.utils.normalization import CATEGORIES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scene", tags=["Scene"])


@router.get("/description")
async def get_scene_description(
    current_user: dict = Depends(get_current_user)
):
    """Get a comprehensive description of the current scene.

    Returns a natural language description along with detailed analysis
    of all objects, categories, and scene bounds.

    Args:
        current_user: Authenticated user

    Returns:
        Dictionary with description and analysis data
    """
    town_data = await get_town_data()
    result = generate_scene_description(town_data)

    logger.info(f"Scene description requested by {current_user.get('username', 'unknown')}")

    return {
        "status": "success",
        "data": result
    }


@router.get("/stats")
async def get_scene_stats(
    current_user: dict = Depends(get_current_user)
):
    """Get quick statistics about the scene.

    Args:
        current_user: Authenticated user

    Returns:
        Dictionary with scene statistics
    """
    town_data = await get_town_data()

    # Count objects in each category (driven by CATEGORIES constant)
    stats = {"town_name": town_data.get('townName', 'Unnamed Town')}
    for category in CATEGORIES:
        stats[category] = len(town_data.get(category, []))
    stats['total'] = sum(stats[cat] for cat in CATEGORIES)

    logger.info(f"Scene stats requested: {stats['total']} total objects")

    return {
        "status": "success",
        "data": stats
    }
