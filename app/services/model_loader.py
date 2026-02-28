"""Service for discovering and loading 3D models from the file system."""

import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


def get_available_models() -> dict[str, list[str]]:
    """Scan the models directory and return available models by category.

    For buildings category, filters out models with '_withoutBase' suffix to avoid duplicates.

    Returns:
        Dictionary mapping category names to lists of model filenames

    Example:
        {
            "buildings": ["house.glb", "office.gltf"],
            "vehicles": ["car.glb", "truck.glb"],
            "trees": ["oak.glb", "pine.glb"]
        }
    """
    models = {}
    try:
        models_dir = Path(settings.models_path)
        for category_dir in models_dir.iterdir():
            if category_dir.is_dir():
                category = category_dir.name
                models[category] = []
                for model_path in category_dir.iterdir():
                    if model_path.suffix in (".gltf", ".glb"):
                        model_file = model_path.name
                        # For buildings category, filter out models with '_withoutBase' suffix
                        if category == "buildings" and "_withoutBase" in model_file:
                            logger.debug(
                                f"Skipping building model without base: {category}/{model_file}"
                            )
                            continue

                        models[category].append(model_file)
                        logger.debug(f"Found model: {category}/{model_file}")

        logger.info(
            f"Loaded {sum(len(models[cat]) for cat in models)} models from {len(models)} categories"
        )
    except Exception as e:
        logger.error(f"Error loading models: {e}")
    return models
