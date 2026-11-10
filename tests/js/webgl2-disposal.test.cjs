'use strict';

/**
 * WebGL2 shim — GL disposal path tests.
 *
 * The vanilla renderer (static/js/webgl2/three-shim.js) releases GPU
 * resources from the same call sites the Three.js renderer uses:
 *   geometry.dispose()  -> shim deletes its VAO + buffers (_glCache)
 *   texture.dispose()   -> shim queues the GL handle; the renderer flushes
 *                          it on the next frame (_pendingTextureDeletes)
 *   material.dispose()  -> no GL objects of its own (uniforms are per-draw,
 *                          programs are shared by material type)
 * The app reaches all three via disposeObject()/disposeModelScene(), so if
 * these paths regress, long sessions leak GPU memory.
 *
 * No real GPU is needed: a stub canvas + Proxy-based fake WebGL2 context
 * records every call.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = (rel) => pathToFileURL(path.join(__dirname, '..', '..', rel)).href;

/** Build a recording fake WebGL2 context. */
function makeFakeGL(calls) {
    const interned = new Map();
    let handleId = 0;
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string') return undefined;
            if (/^[A-Z0-9_]+$/.test(prop)) {
                if (!interned.has(prop)) interned.set(prop, 100000 + interned.size);
                return interned.get(prop);
            }
            if (prop === 'getExtension') {
                return (name) => {
                    calls.push(['getExtension', name]);
                    return { loseContext() { calls.push(['loseContext', name]); } };
                };
            }
            if (prop.startsWith('create')) {
                return (...args) => {
                    const handle = { __handle: handleId++, kind: prop };
                    calls.push([prop, ...args, handle]);
                    return handle;
                };
            }
            return (...args) => { calls.push([prop, ...args]); };
        },
    });
}

function installFakeDocument(calls) {
    const gl = makeFakeGL(calls);
    const canvas = {
        width: 0,
        height: 0,
        style: {},
        getContext(kind) { return kind === 'webgl2' ? gl : null; },
    };
    globalThis.document = { createElement: (tag) => (tag === 'canvas' ? canvas : null) };
    return { gl, canvas };
}

async function loadModules() {
    const shim = await import(MOD('static/js/webgl2/three-shim.js'));
    const { disposeObject } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'static/js/utils/disposal.js')).href);
    return { shim, disposeObject };
}

test('geometry.dispose() releases its VAO and buffers, and the next use re-creates them', async () => {
    const calls = [];
    installFakeDocument(calls);
    try {
        const { shim } = await loadModules();
        const renderer = new shim.WebGLRenderer();
        const geo = new shim.BufferGeometry();
        geo.setAttribute('position', new shim.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
        geo.setAttribute('normal', new shim.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
        geo.setAttribute('uv', new shim.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
        geo.setIndex([0, 1, 2]);

        renderer._glGeometry(geo);
        assert.equal(calls.filter(c => c[0] === 'createVertexArray').length, 1);
        const bufferCount = calls.filter(c => c[0] === 'createBuffer').length;
        assert.equal(bufferCount, 4); // position, normal, uv, index

        geo.dispose();
        assert.equal(geo._glCache, null);
        assert.equal(calls.filter(c => c[0] === 'deleteVertexArray').length, 1);
        assert.equal(calls.filter(c => c[0] === 'deleteBuffer').length, 4);

        // Three.js semantics: a disposed-then-rendered geometry re-uploads.
        renderer._glGeometry(geo);
        assert.equal(calls.filter(c => c[0] === 'createVertexArray').length, 2);
    } finally {
        delete globalThis.document;
    }
});

test('texture.dispose() defers the GL delete until the renderer flushes pending deletes', async () => {
    const calls = [];
    installFakeDocument(calls);
    try {
        const { shim } = await loadModules();
        const renderer = new shim.WebGLRenderer();
        const tex = new shim.Texture();
        tex.image = { fake: 'pixels' };
        tex.colorSpace = shim.SRGBColorSpace;

        const created = renderer._glTexture(tex);
        assert.ok(created);
        assert.equal(calls.filter(c => c[0] === 'createTexture').length, 1);

        tex.dispose();
        assert.equal(calls.filter(c => c[0] === 'deleteTexture').length, 0, 'delete is deferred, not immediate');
        assert.equal(tex._glTex, null);

        renderer._flushPendingDeletes();
        const deletes = calls.filter(c => c[0] === 'deleteTexture');
        assert.equal(deletes.length, 1);
        assert.equal(deletes[0][1], created, 'the exact GL handle must be deleted');

        // Disposing releases the upload slot; next use re-uploads.
        renderer._glTexture(tex);
        assert.equal(calls.filter(c => c[0] === 'createTexture').length, 2);
    } finally {
        delete globalThis.document;
    }
});

test('disposeObject() frees shim GL resources across a small model hierarchy', async () => {
    const calls = [];
    installFakeDocument(calls);
    try {
        const { shim, disposeObject } = await loadModules();
        const renderer = new shim.WebGLRenderer();

        const root = new shim.Group();
        for (let i = 0; i < 2; i++) {
            const geo = new shim.BufferGeometry();
            geo.setAttribute('position', new shim.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
            geo.setIndex([0, 1, 2]);
            const tex = new shim.Texture();
            tex.image = { fake: `pixels-${i}` };
            const material = new shim.MeshStandardMaterial({ map: tex });
            const mesh = new shim.Mesh(geo, material);
            renderer._glGeometry(geo);
            renderer._glTexture(tex);
            root.add(mesh);
        }

        const baselineDeletes = calls.filter(c => c[0] === 'deleteTexture').length;
        disposeObject(root);
        assert.equal(calls.filter(c => c[0] === 'deleteVertexArray').length, 2);
        assert.ok(calls.filter(c => c[0] === 'deleteBuffer').length >= 4);

        // Texture deletes flush on the next render — trigger them explicitly.
        renderer._flushPendingDeletes();
        assert.equal(calls.filter(c => c[0] === 'deleteTexture').length, baselineDeletes + 2);
    } finally {
        delete globalThis.document;
    }
});

test('material.dispose() does not release shared GL programs or geometry buffers', async () => {
    const calls = [];
    installFakeDocument(calls);
    try {
        const { shim } = await loadModules();
        const material = new shim.MeshStandardMaterial();
        material.dispose();
        assert.equal(material.disposed, true);
        assert.equal(calls.filter(c => c[0] === 'deleteProgram').length, 0);
        assert.equal(calls.filter(c => c[0] === 'deleteBuffer').length, 0);
    } finally {
        delete globalThis.document;
    }
});

test('renderer.dispose() clears cached programs and loses the context', async () => {
    const calls = [];
    installFakeDocument(calls);
    try {
        const { shim } = await loadModules();
        const renderer = new shim.WebGLRenderer();
        renderer.setSize(640, 480, false);
        assert.equal(calls.filter(c => c[0] === 'viewport').length, 1);
        renderer.dispose();
        assert.equal(renderer._gl, null);
        assert.equal(calls.filter(c => c[0] === 'loseContext').length, 1);
    } finally {
        delete globalThis.document;
    }
});
