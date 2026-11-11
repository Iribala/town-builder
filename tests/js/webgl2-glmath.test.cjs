'use strict';

/**
 * glmath.js — Euler/quaternion/matrix characterization tests.
 *
 * Three bugs were caught during Phase 2 bring-up because the vanilla
 * renderer composed matrices directly (via quaternion, which was correct)
 * while the app also reads/writes `rotation.*` (Euler), which was not:
 * setEulerFromQuaternion() implemented a y-first decomposition for the
 * 'XYZ' order, so `camera.rotation.y` disagreed with three.js after
 * lookAt() (0.785 vs the correct 0.6155 for eye (10,10,10) → origin).
 * Drive-mode camera rotation and save-scene serialization both go through
 * this path. This suite pins the decomposition to those reference values.
 *
 * The three.js stack was deleted in the renderer cutover, so the reference
 * outputs live in a fixture — tests/js/fixtures/glmath-expected.json —
 * generated from vendored Three.js r181 on 2026-11-11. Regenerate only if
 * the shim's math intentionally changes; the fixture is the
 * characterization baseline, not a target to move.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'glmath-expected.json');
const MOD = (...p) => url.pathToFileURL(path.join(ROOT, ...p)).href;

const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let modulesPromise = null;
function mods() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import(MOD('static/js/webgl2/glmath.js')),
            import(MOD('static/js/webgl2/three-shim.js')),
        ]).then(([glmath, shim]) => ({ glmath, shim }));
    }
    return modulesPromise;
}

test('shim Euler→Quaternion matches the r181 fixture across a grid of angles', async () => {
    const { glmath } = await mods();
    const { fwdAngles, eulerToQuat } = expected;
    for (const x of fwdAngles) {
        for (const y of fwdAngles) {
            for (const z of fwdAngles) {
                const b = new glmath.Quaternion().setFromEuler(new glmath.Euler(x, y, z, 'XYZ'));
                const a = eulerToQuat[`${x},${y},${z}`];
                assert.ok(a, `fixture missing Euler→Quaternion for (${x},${y},${z})`);
                for (const [i, k] of ['x', 'y', 'z', 'w'].entries()) {
                    assert.ok(Math.abs(a[i] - b[k]) < 1e-6, `quaternion.${k} for (${x},${y},${z}): fixture=${a[i]} shim=${b[k]}`);
                }
            }
        }
    }
});

test('shim Quaternion→Euler (XYZ) matches the r181 fixture across a grid of angles', async () => {
    const { glmath } = await mods();
    const { revAngles, quatToEuler } = expected;
    for (const x of revAngles) {
        for (const y of revAngles) {
            for (const z of revAngles) {
                const sq = new glmath.Quaternion().setFromEuler(new glmath.Euler(x, y, z, 'XYZ'));
                const se = new glmath.Euler();
                glmath.setEulerFromQuaternion(se, sq);
                const a = quatToEuler[`${x},${y},${z}`];
                assert.ok(a, `fixture missing Quaternion→Euler for (${x},${y},${z})`);
                for (const [i, k] of ['x', 'y', 'z'].entries()) {
                    assert.ok(Math.abs(a[i] - se[k]) < 1e-6, `euler.${k} for (${x},${y},${z}): fixture=${a[i]} shim=${se[k]}`);
                }
            }
        }
    }
});

test('the reported regression: lookAt decomposition matches the r181 fixture', async () => {
    const { shim } = await mods();
    const sCam = new shim.PerspectiveCamera(75, 1, 0.1, 1000);
    sCam.position.set(10, 10, 10);
    sCam.lookAt(0, 0, 0);

    const [rx, ry, rz] = expected.lookAt.rotation;
    assert.ok(Math.abs(ry - sCam.rotation.y) < 1e-6, `rotation.y fixture=${ry} shim=${sCam.rotation.y}`);
    assert.ok(Math.abs(rx - sCam.rotation.x) < 1e-6);
    assert.ok(Math.abs(rz - sCam.rotation.z) < 1e-6);
    // And the quaternions agree.
    for (const [i, k] of ['x', 'y', 'z', 'w'].entries()) {
        assert.ok(Math.abs(expected.lookAt.quaternion[i] - sCam.quaternion[k]) < 1e-6);
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
