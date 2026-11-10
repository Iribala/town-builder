'use strict';

/**
 * AABB parity: vanilla WebGL2 shim vs the vendored Three.js r181.
 *
 * The WASM spatial grid and the JS collision fallback both serialize the
 * world-space Box3 of every placed model (models/collision.js,
 * utils/physics_wasm.js). If the vanilla renderer's setFromObject() drifts
 * from Three.js's, cars "bonk" at invisible offsets only on the vanilla
 * path. This suite parses every shipped .gltf with the vanilla loader,
 * mirrors the resulting node hierarchy into Three.js, applies the same
 * non-trivial root transform (rotation + non-uniform scale + offset), and
 * asserts the two world-space AABBs agree.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const MODELS_DIR = path.join(ROOT, 'static', 'models');
const MOD = (...p) => url.pathToFileURL(path.join(ROOT, ...p)).href;

function collectGltfFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...collectGltfFiles(full));
        else if (entry.name.toLowerCase().endsWith('.gltf')) files.push(full);
    }
    return files;
}

const gltfFiles = collectGltfFiles(MODELS_DIR);
const rel = (p) => path.relative(ROOT, p);

let modulesPromise = null;
function mods() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import(MOD('static/js/three.module.js')),
            import(MOD('static/js/webgl2/gltf-min.js')),
            import(MOD('static/js/webgl2/three-shim.js')),
        ]).then(([three, gltfMin, shim]) => ({ three, gltfMin, shim }));
    }
    return modulesPromise;
}

function parseModel(file, gltfMin) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const buffers = (json.buffers || []).map(buf => {
        const bufPath = path.join(path.dirname(file), buf.uri);
        const bytes = fs.readFileSync(bufPath);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    });
    return gltfMin.parseGLTF(json, buffers, rel(file));
}

/** Mirror a shim node hierarchy into a Three.js one (positions-only geometry is enough for AABBs). */
function mirrorIntoThree(shimNode, THREE) {
    let node;
    if (shimNode.isMesh) {
        const geometry = new THREE.BufferGeometry();
        const pos = shimNode.geometry.getAttribute('position');
        geometry.setAttribute('position', new THREE.BufferAttribute(pos.array.slice(), 3));
        node = new THREE.Mesh(geometry);
    } else {
        node = new THREE.Group();
    }
    node.position.set(shimNode.position.x, shimNode.position.y, shimNode.position.z);
    node.quaternion.set(shimNode.quaternion.x, shimNode.quaternion.y, shimNode.quaternion.z, shimNode.quaternion.w);
    node.scale.set(shimNode.scale.x, shimNode.scale.y, shimNode.scale.z);
    for (const child of shimNode.children) node.add(mirrorIntoThree(child, THREE));
    return node;
}

test('model corpus is non-empty', () => {
    assert.ok(gltfFiles.length >= 75, `expected >= 75 .gltf files, found ${gltfFiles.length}`);
});

test('vanilla setFromObject() matches Three.js Box3.setFromObject() for every asset', async () => {
    const { three: THREE, gltfMin, shim } = await mods();
    const EPS = 1e-4;

    for (const file of gltfFiles) {
        const { root: shimRoot } = parseModel(file, gltfMin);
        const threeRoot = mirrorIntoThree(shimRoot, THREE);

        // Same non-trivial world transform on both: rotation, non-uniform
        // scale, translation — catches row/column and corner-order bugs.
        shimRoot.quaternion.setFromEuler(new shim.Euler(0.3, 0.9, -0.25));
        shimRoot.position.set(2.5, 0.4, -1.5);
        shimRoot.scale.set(1.6, 0.7, 2.3);

        threeRoot.quaternion.setFromEuler(new THREE.Euler(0.3, 0.9, -0.25));
        threeRoot.position.set(2.5, 0.4, -1.5);
        threeRoot.scale.set(1.6, 0.7, 2.3);

        const shimBox = new shim.Box3().setFromObject(shimRoot);
        const threeBox = new THREE.Box3().setFromObject(threeRoot);

        const name = rel(file);
        assert.ok(
            shimBox.max.x - shimBox.min.x + (shimBox.max.y - shimBox.min.y) + (shimBox.max.z - shimBox.min.z) > 0,
            `${name}: empty box from the vanilla loader`,
        );
        for (const axis of ['x', 'y', 'z']) {
            assert.ok(
                Math.abs(shimBox.min[axis] - threeBox.min[axis]) < EPS,
                `${name}: min.${axis} vanilla=${shimBox.min[axis]} three=${threeBox.min[axis]}`,
            );
            assert.ok(
                Math.abs(shimBox.max[axis] - threeBox.max[axis]) < EPS,
                `${name}: max.${axis} vanilla=${shimBox.max[axis]} three=${threeBox.max[axis]}`,
            );
        }
    }
});

test('vanilla Ray/AABB intersectsBox() agrees with Three.js on overlap outcomes', async () => {
    const { three: THREE, shim } = await mods();
    // Deterministic pseudo-random box pairs: mix of overlapping, touching,
    // and disjoint cases. Both implementations use the same inclusive-slab
    // comparison, so they must agree exactly.
    let seed = 0x5eed;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    for (let i = 0; i < 500; i++) {
        const makeBox = () => {
            const cx = rand() * 10 - 5, cy = rand() * 10 - 5, cz = rand() * 10 - 5;
            const hx = rand() * 2, hy = rand() * 2, hz = rand() * 2;
            return { cx, cy, cz, hx, hy, hz };
        };
        const a = makeBox(), b = makeBox();
        const shimA = new shim.Box3(new shim.Vector3(a.cx - a.hx, a.cy - a.hy, a.cz - a.hz), new shim.Vector3(a.cx + a.hx, a.cy + a.hy, a.cz + a.hz));
        const shimB = new shim.Box3(new shim.Vector3(b.cx - b.hx, b.cy - b.hy, b.cz - b.hz), new shim.Vector3(b.cx + b.hx, b.cy + b.hy, b.cz + b.hz));
        const threeA = new THREE.Box3(new THREE.Vector3(a.cx - a.hx, a.cy - a.hy, a.cz - a.hz), new THREE.Vector3(a.cx + a.hx, a.cy + a.hy, a.cz + a.hz));
        const threeB = new THREE.Box3(new THREE.Vector3(b.cx - b.hx, b.cy - b.hy, b.cz - b.hz), new THREE.Vector3(b.cx + b.hx, b.cy + b.hy, b.cz + b.hz));
        assert.equal(shimA.intersectsBox(shimB), threeA.intersectsBox(threeB), `box pair ${i} disagrees`);
    }
});
