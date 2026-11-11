/**
 * Raycasting utilities for 3D object interaction
 */
import * as THREE from '../webgl2/three-shim.js';

/**
 * Convert client (CSS pixel) coordinates to normalized device coordinates.
 * Shared by mouse and touch pick paths.
 * @param {number} clientX - Client X position
 * @param {number} clientY - Client Y position
 * @param {HTMLElement} element - Canvas element
 * @returns {THREE.Vector2} Normalized coordinates (-1 to +1)
 */
export function clientToNdc(clientX, clientY, element) {
    const rect = element.getBoundingClientRect();
    const ndc = new THREE.Vector2();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return ndc;
}

/**
 * Get mouse coordinates in normalized device coordinates (-1 to +1)
 * @param {MouseEvent} event - Mouse event
 * @param {HTMLElement} element - Canvas element
 * @returns {THREE.Vector2} Normalized mouse coordinates
 */
export function getMouseCoordinates(event, element) {
    return clientToNdc(event.clientX, event.clientY, element);
}

/**
 * Find the root object in the scene hierarchy
 * @param {THREE.Object3D} obj - Child object
 * @param {Array<THREE.Object3D>} placedObjects - Array of placed objects
 * @returns {THREE.Object3D} Root object
 */
export function findRootObject(obj, placedObjects) {
    while (obj.parent && !(obj.userData && obj.userData._isPlacedRoot)) {
        obj = obj.parent;
    }
    return obj;
}

/**
 * Collect the placed-object roots currently in the scene.
 * Desktop pick paths have the placedObjects array at hand; touch paths
 * don't, so they derive the same set from the scene by traversal.
 * @param {THREE.Object3D} scene - Scene to traverse
 * @returns {Array<THREE.Object3D>} Placed-object roots
 */
export function getPlacedObjectRoots(scene) {
    const roots = [];
    scene.traverse(object => {
        if (object.userData && object.userData._isPlacedRoot) {
            roots.push(object);
        }
    });
    return roots;
}

/**
 * Pick the placed-object root under a ray. Shared by the desktop click
 * path and the mobile tap/delete paths.
 * @param {THREE.Raycaster} raycaster - Raycaster with ray already set from camera
 * @param {Array<THREE.Object3D>} roots - Placed-object roots (e.g. placedObjects)
 * @returns {THREE.Object3D|null} The root object, or null when nothing is hit
 */
export function pickPlacedObject(raycaster, roots) {
    const intersects = raycaster.intersectObjects(roots, true);
    if (intersects.length === 0) {
        return null;
    }
    return findRootObject(intersects[0].object, roots);
}

/**
 * Intersect a ray with the horizontal ground plane (y = 0).
 * @param {THREE.Raycaster} raycaster - Raycaster with ray already set from camera
 * @param {THREE.Vector3} [target] - Optional vector to write the intersection into
 * @returns {THREE.Vector3|null} Intersection point, or null when the ray misses the plane
 */
export function raycastGroundPlane(raycaster, target) {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = target || new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(groundPlane, point);
    return hit || null;
}
