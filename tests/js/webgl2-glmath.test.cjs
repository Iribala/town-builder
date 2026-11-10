'use strict';

/**
 * glmath.js — Euler/quaternion/matrix parity with Three.js.
 *
 * Three bugs were caught during Phase 2 bring-up because the vanilla
 * renderer composed matrices directly (via quaternion, which was correct)
 * while the app also reads/writes `rotation.*` (Euler), which was not:
 * setEulerFromQuaternion() implemented a y-first decomposition for the
 * 'XYZ' order, so `camera.rotation.y` disagreed with Three.js after
 * lookAt() (0.785 vs the correct 0.6155 for eye (10,10,10) → origin).
 * Drive-mode camera rotation and save-scene serialization both go through
 * this path. This suite pins the decomposition to Three.js.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const path = require('node:path');
const url = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');

const MOD = (...p) => url.pathToFileURL(path.join(__dirname, '..', '..', ...p)).href;

let modulesPromise = null;
function mods() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import(MOD('static/js/three.module.js')),
            import(MOD('static/js/webgl2/glmath.js')),
            import(MOD('static/js/webgl2/three-shim.js')),
        ]).then(([three, glmath, shim]) => ({ three, glmath, shim }));
    }
    return modulesPromise;
}

test('shim Euler→Quaternion matches Three.js across a grid of angles', async () => {
    const { three: THREE, glmath } = await mods();
    const angles = [0, 0.3, 0.9, 1.5, -0.7, -2.4, 3.0];
    for (const x of angles) {
        for (const y of angles) {
            for (const z of angles) {
                const a = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
                const b = new glmath.Quaternion().setFromEuler(new glmath.Euler(x, y, z, 'XYZ'));
                for (const k of ['x', 'y', 'z', 'w']) {
                    assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `quaternion.${k} for (${x},${y},${z}): ${a[k]} vs ${b[k]}`);
                }
            }
        }
    }
});

test('shim Quaternion→Euler (XYZ) matches Three.js across a grid of angles', async () => {
    const { three: THREE, glmath } = await mods();
    const angles = [0, 0.3, 0.9, 1.4, -0.7, -2.4, 2.9];
    for (const x of angles) {
        for (const y of angles) {
            for (const z of angles) {
                const a = new THREE.Euler().setFromQuaternion(
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')), 'XYZ');
                const se = new glmath.Euler();
                const sq = new glmath.Quaternion().setFromEuler(new glmath.Euler(x, y, z, 'XYZ'));
                glmath.setEulerFromQuaternion(se, sq);
                for (const k of ['x', 'y', 'z']) {
                    assert.ok(Math.abs(a[k] - se[k]) < 1e-6, `euler.${k} for (${x},${y},${z}): three=${a[k]} shim=${se[k]}`);
                }
            }
        }
    }
});

test('the reported regression: lookAt decomposition matches Three.js', async () => {
    const { three: THREE, shim } = await mods();
    const eye = new THREE.Vector3(10, 10, 10);
    const tCam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    tCam.position.copy(eye);
    tCam.lookAt(0, 0, 0);

    const sCam = new shim.PerspectiveCamera(75, 1, 0.1, 1000);
    sCam.position.set(10, 10, 10);
    sCam.lookAt(0, 0, 0);

    assert.ok(Math.abs(tCam.rotation.y - sCam.rotation.y) < 1e-6,
        `rotation.y three=${tCam.rotation.y} shim=${sCam.rotation.y}`);
    assert.ok(Math.abs(tCam.rotation.x - sCam.rotation.x) < 1e-6);
    assert.ok(Math.abs(tCam.rotation.z - sCam.rotation.z) < 1e-6);
    // And the quaternions agree.
    for (const k of ['x', 'y', 'z', 'w']) {
        assert.ok(Math.abs(tCam.quaternion[k] - sCam.quaternion[k]) < 1e-6);
    }
});

test('shim Object3D rotation→quaternion→rotation round-trips after lookAt', async () => {
    const { shim } = await mods();
    const cam = new shim.PerspectiveCamera(75, 1, 0.1, 1000);
    cam.position.set(10, 10, 10);
    cam.lookAt(0, 0, 0);
    const snap = [cam.rotation.x, cam.rotation.y, cam.rotation.z];
    // Writing an angle through the Euler accessor must re-compose the quaternion.
    cam.rotation.y += 0.25;
    cam.rotation.y -= 0.25;
    assert.ok(Math.abs(cam.rotation.x - snap[0]) < 1e-6);
    assert.ok(Math.abs(cam.rotation.y - snap[1]) < 1e-6);
    assert.ok(Math.abs(cam.rotation.z - snap[2]) < 1e-6);
});
