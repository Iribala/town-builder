export let scene = null;
export let camera = null;
export let renderer = null;
export let groundPlane = null;
export let placementIndicator = null;

export const placedObjects = [];
export const movingCars = [];

export function setSceneContext(nextScene, nextCamera, nextRenderer, nextGroundPlane) {
    scene = nextScene;
    camera = nextCamera;
    renderer = nextRenderer;
    groundPlane = nextGroundPlane;
}

export function setPlacementIndicator(nextPlacementIndicator) {
    placementIndicator = nextPlacementIndicator;
}

