'use strict';

/**
 * AABB characterization: vanilla WebGL2 shim vs the Three.js r181 oracle.
 *
 * The WASM spatial grid and the JS collision fallback both serialize the
 * world-space Box3 of every placed model (models/collision.js,
 * utils/physics_wasm.js). If the vanilla renderer's setFromObject() drifts,
 * cars "bonk" at invisible offsets.
 *
 * The three.js stack was deleted in the renderer cutover, so the parity
 * reference is now a fixture — tests/js/fixtures/aabb-expected.json —
 * generated from vendored Three.js r181 on 2026-11-11 with the same
 * non-trivial root transform applied (rotation + non-uniform scale +
 * offset). Regenerate only if the shim's transform math intentionally
 * changes; the fixture is the characterization baseline, not a target to
 * move.
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
const FIXTURE = path.join(__dirname, 'fixtures', 'aabb-expected.json');
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
const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let modulesPromise = null;
function mods() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import(MOD('static/js/webgl2/gltf-min.js')),
            import(MOD('static/js/webgl2/three-shim.js')),
        ]).then(([gltfMin, shim]) => ({ gltfMin, shim }));
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

test('model corpus is non-empty', () => {
    assert.ok(gltfFiles.length >= 75, `expected >= 75 .gltf files, found ${gltfFiles.length}`);
});

test('fixture covers every shipped asset', () => {
    for (const file of gltfFiles) {
        assert.ok(expected.assets[rel(file)], `missing fixture entry for ${rel(file)}`);
    }
});

test('vanilla setFromObject() matches the Three.js r181 fixture for every asset', async () => {
    const { gltfMin, shim } = await mods();
    const EPS = 1e-4;
    const [qx, qy, qz] = expected.transform.eulerXYZ;
    const [tx, ty, tz] = expected.transform.position;
    const [sx, sy, sz] = expected.transform.scale;

    for (const file of gltfFiles) {
        const { root: shimRoot } = parseModel(file, gltfMin);

        shimRoot.quaternion.setFromEuler(new shim.Euler(qx, qy, qz));
        shimRoot.position.set(tx, ty, tz);
        shimRoot.scale.set(sx, sy, sz);

        const shimBox = new shim.Box3().setFromObject(shimRoot);
        const truth = expected.assets[rel(file)];

        const name = rel(file);
        assert.ok(
            shimBox.max.x - shimBox.min.x + (shimBox.max.y - shimBox.min.y) + (shimBox.max.z - shimBox.min.z) > 0,
            `${name}: empty box from the vanilla loader`,
        );
        for (const [i, axis] of ['x', 'y', 'z'].entries()) {
            assert.ok(
                Math.abs(shimBox.min[axis] - truth.min[i]) < EPS,
                `${name}: min.${axis} vanilla=${shimBox.min[axis]} expected=${truth.min[i]}`,
            );
            assert.ok(
                Math.abs(shimBox.max[axis] - truth.max[i]) < EPS,
                `${name}: max.${axis} vanilla=${shimBox.max[axis]} expected=${truth.max[i]}`,
            );
        }
    }
});

test('vanilla intersectsBox() matches the inclusive slab method on 500 box pairs', async () => {
    const { shim } = await mods();
    // Deterministic pseudo-random box pairs: mix of overlapping, touching,
    // and disjoint cases. Reference implementation: textbook slab test with
    // the same inclusive-boundary semantics three.js uses.
    const slabIntersects = (a, b) =>
        a.min.x <= b.max.x && a.max.x >= b.min.x
        && a.min.y <= b.max.y && a.max.y >= b.min.y
        && a.min.z <= b.max.z && a.max.z >= b.min.z;

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
        assert.equal(shimA.intersectsBox(shimB), slabIntersects(shimA, shimB), `box pair ${i} disagrees`);
    }
});
