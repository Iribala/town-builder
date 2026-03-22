/**
 * Utilities for disposing 3D objects and freeing memory
 */

// Texture properties to dispose when cleaning up materials
const TEXTURE_PROPERTIES = ['map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
                            'envMap', 'alphaMap', 'aoMap', 'displacementMap',
                            'emissiveMap', 'gradientMap', 'metalnessMap', 'roughnessMap'];

/**
 * Dispose a single material and all its textures
 * @param {THREE.Material} material - Material to dispose
 */
function disposeMaterial(material) {
    TEXTURE_PROPERTIES.forEach(prop => {
        if (material[prop] && material[prop].dispose) {
            material[prop].dispose();
        }
    });
    material.dispose();
}

/**
 * Dispose of a 3D object and all its children, freeing GPU memory
 * @param {THREE.Object3D} object - The object to dispose
 */
export function disposeObject(object) {
    object.traverse(child => {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => disposeMaterial(mat));
            } else {
                disposeMaterial(child.material);
            }
        }
    });
}
