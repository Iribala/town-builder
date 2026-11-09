'use strict';

/**
 * gltf-min.js tests: the vanilla WebGL2 renderer parses every asset in
 * static/models/ with its own minimal glTF loader. This suite runs the real
 * parser against every shipped .gltf and fails loudly if an asset drifts out
 * of the supported subset (extensions, sparse accessors, GLB, matrix nodes)
 * instead of silently rendering garbage in the browser.
 *
 * parseGLTF is deliberately GL-free, so no WebGL context is needed.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const MODELS_DIR = path.join(ROOT, 'static', 'models');
const GLTF_DIR = path.join(ROOT, 'static', 'js', 'webgl2');

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

async function parseModel(file) {
    const { parseGLTF } = await import(path.join(GLTF_DIR, 'gltf-min.js'));
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const buffers = (json.buffers || []).map(buf => {
        assert.ok(buf.uri, `${rel(file)}: buffer without uri (GLB unsupported)`);
        const bufPath = path.join(path.dirname(file), buf.uri);
        const bytes = fs.readFileSync(bufPath);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    });
    return { json, parsed: parseGLTF(json, buffers, rel(file)) };
}

test('model corpus is non-empty and covers the catalog', () => {
    assert.ok(gltfFiles.length >= 75, `expected >= 75 .gltf files, found ${gltfFiles.length}`);
});

test('every asset stays inside the supported subset', async () => {
    for (const file of gltfFiles) {
        const { json, parsed } = await parseModel(file);

        // No extensions, no animation/skin/sparse — the parser enforces these,
        // but assert the *cause* for clarity when one slips in later.
        assert.equal(json.extensionsUsed?.length ?? 0, 0, `${rel(file)}: extensionsUsed`);
        assert.equal(json.animations?.length ?? 0, 0, `${rel(file)}: animations`);
        assert.equal(json.skins?.length ?? 0, 0, `${rel(file)}: skins`);

        assert.ok(parsed.stats.primitives >= 1, `${rel(file)}: no primitives`);
        assert.ok(parsed.stats.triangles > 0, `${rel(file)}: no triangles`);

        // Every sampled prim must have position + either NORMAL or generated flat normals
        // (the parser generates flat normals; reached here only on success).
        let meshCount = 0;
        parsed.root.traverse(node => { if (node.isMesh) meshCount += 1; });
        assert.ok(meshCount >= 1, `${rel(file)}: no meshes built`);

        // Material texture references must resolve to in-range images
        const images = json.images || [];
        parsed.root.traverse(node => {
            const mat = node.material;
            if (!mat) return;
            const info = mat.userData?.baseColorTextureIndex;
            if (!info) return;
            const tex = json.textures?.[info.texture];
            assert.ok(tex, `${rel(file)}: material references missing texture ${info.texture}`);
            assert.ok(tex.source < images.length, `${rel(file)}: texture references missing image ${tex.source}`);
        });

        // Every external image file the scene depends on must exist on disk
        for (const req of parsed.textureRequests) {
            const imgPath = path.join(path.dirname(file), req.uri);
            assert.ok(fs.existsSync(imgPath), `${rel(file)}: missing image ${req.uri}`);
        }
    }
});

test('parser rejects unsupported constructs with GltfMinError', async () => {
    const { parseGLTF, GltfMinError } = await import(path.join(GLTF_DIR, 'gltf-min.js'));
    const base = { asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, type: 'VEC3', count: 3, bufferView: 0 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36, uri: 'x.bin' }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
    const buffers = [new ArrayBuffer(36)];

    assert.throws(() => parseGLTF({ ...base, extensionsUsed: ['KHR_materials_unlit'] }, buffers, 'x'), GltfMinError);
    assert.throws(() => parseGLTF({ ...base, animations: [{}] }, buffers, 'x'), GltfMinError);
    assert.throws(() => parseGLTF({ ...base, skins: [{}] }, buffers, 'x'), GltfMinError);
    assert.throws(() => parseGLTF({ ...base, meshes: [{ primitives: [{ attributes: { POSITION: 1 }, mode: 5 }] }], accessors: [{ componentType: 5126, type: 'VEC3', count: 3, bufferView: 0, ...{} }, { componentType: 5126, type: 'VEC3', count: 3, bufferView: 0 }] }, buffers, 'x'), /mode 5/);
    assert.throws(() => parseGLTF({ ...base, asset: { version: '1.0' } }, buffers, 'x'), GltfMinError);
});

test('euler/quaternion and matrix composition agree', async () => {
    const shim = await import(path.join(GLTF_DIR, 'three-shim.js'));
    const { Euler, Quaternion, Matrix4, Vector3 } = shim;
    // Quaternion built from Euler and matrix built from quaternion must
    // rotate a vector identically.
    const e = new Euler(0.3, 1.2, -0.4);
    const q = new Quaternion().setFromEuler(e);
    const v = new Vector3(0.3, -0.7, 0.9);
    const viaQuat = v.clone().applyQuaternion(q);
    const m = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, 1));
    const viaMatrix = v.clone().applyMatrix4(m);
    assert.ok(viaQuat.distanceTo(viaMatrix) < 1e-6,
        `rotation mismatch: (${viaQuat.toArray()}) vs (${viaMatrix.toArray()})`);

    // slerp by fraction 1 lands exactly on the target quaternion
    const target = new Quaternion().setFromEuler(new Euler(-0.5, 0.7, 0.9));
    const start = new Quaternion().setFromEuler(new Euler(0.1, -0.2, 0.3));
    start.slerp(target, 1);
    assert.ok(Math.abs(start.x - target.x) < 1e-6 && Math.abs(start.w - target.w) < 1e-6,
        'slerp(t=1) did not land on target');
});

test('AABB setFromObject matches geometry bounds', async () => {
    const shim = await import(path.join(GLTF_DIR, 'three-shim.js'));
    const { BoxGeometry, Box3, Mesh, Object3D } = shim;
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new shim.MeshBasicMaterial());
    mesh.position.set(5, 0, 0);
    const root = new Object3D();
    root.add(mesh);
    const box = new Box3().setFromObject(root);
    assert.ok(Math.abs(box.min.x - 4) < 1e-6 && Math.abs(box.max.x - 6) < 1e-6, `x bounds: ${box.min.x}..${box.max.x}`);
    assert.ok(Math.abs(box.min.y - -1) < 1e-6 && Math.abs(box.max.y - 1) < 1e-6, `y bounds: ${box.min.y}..${box.max.y}`);
});
