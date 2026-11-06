'use strict';

/**
 * Frontend multiplayer sync tests for static/js/network.js.
 *
 * The frontend is plain ES modules with no bundler and no package.json, and
 * network.js imports DOM/Three.js-heavy modules (ui.js, models/loader.js,
 * state/*). Running it directly in Node would drag in a browser-only graph.
 * Instead we evaluate the two dependency-free-logic sources in a node:vm
 * context with explicit stubs. This exercises the *real* module code — only
 * its imports are replaced.
 *
 * If you add an import to network.js or utils/town-layout.js, add the
 * corresponding stub to createHarness() below; stripModule() fails loudly
 * when it encounters module syntax it cannot handle.
 *
 * Run with: ./scripts/test-js.sh   (or: node --test tests/js/)
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const JS_DIR = path.resolve(__dirname, '../../static/js');

function readSource(relativePath) {
    return fs.readFileSync(path.join(JS_DIR, relativePath), 'utf8');
}

/** Strip static imports and `export` keywords so the source can run in a vm. */
function stripModule(source, label) {
    const stripped = source
        .replace(/^import\s+[\s\S]*?from\s+'[^']+';/gm, '')
        .replace(/^import\s+'[^']+';\s*$/gm, '')
        .replace(/^export /gm, '');
    if (/^\s*(import|export)\s/m.test(stripped)) {
        throw new Error(
            `${label}: unhandled ES module syntax — update stripModule() in this test`
        );
    }
    return stripped;
}

function vec(x = 0, y = 0, z = 0) {
    return {
        x, y, z,
        set(a, b, c) { this.x = a; this.y = b; this.z = c; },
        fromArray(a) { this.x = a[0]; this.y = a[1]; this.z = a[2]; }
    };
}

/** Minimal stand-in for a THREE.Object3D root pushed into placedObjects. */
function makeObject(category, modelName, id) {
    return {
        userData: Object.assign({ category, modelName }, id ? { id } : {}),
        position: vec(),
        rotation: vec(),
        scale: vec(1, 1, 1),
        traverse(fn) { fn(this); }
    };
}

/** Build a fresh, isolated module instance for each test. */
function createHarness() {
    const state = {
        placedObjects: [],
        movingCars: [],
        notifications: [],
        userLists: [],
        cursors: [],
        nameChanges: [],
        gridRebuilds: 0,
        loadCount: 0,
        disposed: [],
        removed: [],
        dom: {
            'town-name-display': { textContent: 'My Town' },
            'town-name-input': { value: 'My Town' }
        }
    };

    const sandbox = {
        // Keep real errors visible; the dispatcher logs unknown event types at
        // debug level, which is expected in one of the tests below.
        console: {
            log: console.log, warn: console.warn, error: console.error, debug: () => {}
        },
        setTimeout,
        clearTimeout,
        // app-state
        getMyName: () => 'me',
        getToken: () => null,
        setToken: () => {},
        getBasePath: () => '',
        setBasePath: () => {},
        setCurrentTownId: () => {},
        setCurrentTownName: (name) => state.nameChanges.push(name),
        setCurrentTownDescription: () => {},
        setCurrentTownLatitude: () => {},
        setCurrentTownLongitude: () => {},
        // ui / cursors
        showNotification: (message, type) => state.notifications.push({ message, type }),
        updateOnlineUsersList: (users) => state.userLists.push(users),
        updateCursor: (...args) => state.cursors.push(args),
        // api
        apiFetch: async () => ({ json: async () => ({}) }),
        fetch: async () => ({ ok: true }),
        // scene-state
        scene: { remove: (object) => state.removed.push(object) },
        placedObjects: state.placedObjects,
        movingCars: state.movingCars,
        // model loader
        loadModel: async (_scene, placed, cars, category, modelName) => {
            state.loadCount += 1;
            const object = makeObject(category, modelName);
            placed.push(object);
            if (category === 'vehicles') cars.push(object);
            return object;
        },
        // disposal
        disposeObject: (object) => state.disposed.push(object),
        // physics wasm
        isPhysicsWasmReady: () => true,
        updateSpatialGrid: () => { state.gridRebuilds += 1; },
        // DOM / browser globals
        document: {
            getElementById: (id) => state.dom[id] || null,
            cookie: ''
        },
        window: { location: { protocol: 'http:' } },
        EventSource: function () {}
    };

    vm.createContext(sandbox);
    // town-layout.js must run first: network.js calls its exports.
    vm.runInContext(stripModule(readSource('utils/town-layout.js'), 'town-layout.js'), sandbox, {
        filename: 'town-layout.js'
    });
    vm.runInContext(stripModule(readSource('network.js'), 'network.js'), sandbox, {
        filename: 'network.js'
    });

    return { handleServerEvent: sandbox.handleServerEvent, state, sandbox };
}

/** A layout item as emitted by POST /api/town/save (or the buildings API). */
function item(id, category, modelName, x = 0) {
    return Object.assign(
        { category, modelName },
        id ? { id } : {},
        {
            position: { x, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    );
}

const full = (town) => ({ type: 'full', town });

const threeIdlessItems = () => [
    item(null, 'buildings', 'house.gltf', 1),
    item(null, 'trees', 'tree_A.gltf', 2),
    item(null, 'vehicles', 'car_A.gltf', 3)
];

const threeIdItems = () => [
    item('a', 'buildings', 'house.gltf', 5),
    item('b', 'buildings', 'house.gltf', 10),
    item('c', 'vehicles', 'car_A.gltf', 15)
];

const byId = (state, id) => state.placedObjects.find(obj => obj.userData.id === id);

test('full snapshot with id-less items loads objects and applies transforms', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdlessItems()));

    assert.equal(state.placedObjects.length, 3);
    assert.equal(state.movingCars.length, 1, 'vehicles are registered for driving');
    assert.equal(state.placedObjects[0].position.x, 1);
    assert.ok(state.gridRebuilds > 0, 'WASM spatial grid is rebuilt');
});

test('repeating an id-less snapshot does not duplicate objects', async () => {
    const { handleServerEvent, state } = createHarness();
    const items = threeIdlessItems();
    await handleServerEvent(full(items));
    await handleServerEvent(full(items));

    assert.equal(state.placedObjects.length, 3);
    assert.equal(state.loadCount, 3, 'no models are reloaded on an identical snapshot');
});

test('id-less snapshot with a moved object updates transforms in place', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdlessItems()));
    const first = state.placedObjects[0];

    const moved = threeIdlessItems();
    moved[0].position.x = 42;
    await handleServerEvent(full(moved));

    assert.equal(state.placedObjects.length, 3);
    assert.strictEqual(state.placedObjects[0], first, 'the same object instance is kept');
    assert.equal(first.position.x, 42);
    assert.equal(state.loadCount, 3, 'no churn for the local editor');
});

test('id-less snapshot with a changed shape rebuilds instead of duplicating', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdlessItems()));
    await handleServerEvent(full([item(null, 'props', 'bench.gltf', 9)]));

    assert.equal(state.placedObjects.length, 1);
    assert.equal(state.placedObjects[0].userData.modelName, 'bench.gltf');
    assert.equal(state.placedObjects[0].position.x, 9);
});

test('empty full snapshot clears the scene', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdlessItems()));
    await handleServerEvent(full([]));

    assert.equal(state.placedObjects.length, 0);
    assert.equal(state.movingCars.length, 0);
    assert.equal(state.disposed.length, 3, 'removed objects are disposed');
    assert.equal(state.removed.length, 3, 'removed objects are detached from the scene');
});

test('id-bearing snapshot stamps server IDs onto userData', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));

    assert.equal(state.placedObjects.length, 3);
    assert.ok(state.placedObjects.every(obj => obj.userData.id));
});

test('edit delta applies a remote move', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));
    await handleServerEvent({
        type: 'edit',
        id: 'b',
        data: item('b', 'buildings', 'house.gltf', 99)
    });

    assert.equal(byId(state, 'b').position.x, 99);
    assert.equal(state.placedObjects.length, 3);
});

test('edit delta for an unknown ID is a no-op', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));
    await handleServerEvent({ type: 'edit', id: 'missing', data: item('missing', 'buildings', 'house.gltf', 7) });

    assert.equal(state.placedObjects.length, 3);
    assert.equal(byId(state, 'b').position.x, 10, 'other objects are untouched');
});

test('delete delta removes an object by ID', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));
    await handleServerEvent({ type: 'delete', id: 'a', category: 'buildings' });

    assert.equal(state.placedObjects.length, 2);
    assert.equal(byId(state, 'a'), undefined);
    assert.equal(state.disposed.length, 1);
});

test('delete-by-position delta mirrors the backend proximity threshold', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdlessItems()));

    // geometry.DeleteProximityThreshold = 2.0
    await handleServerEvent({ type: 'delete', category: 'trees', position: { x: 2, y: 0, z: 0 } });
    assert.equal(state.placedObjects.length, 2, 'nearest object inside the radius is removed');

    await handleServerEvent({ type: 'delete', category: 'trees', position: { x: 500, y: 0, z: 0 } });
    assert.equal(state.placedObjects.length, 2, 'objects beyond the radius are kept');
});

test('full snapshot removes absent IDs and updates remaining transforms', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));
    await handleServerEvent(full([
        item('b', 'buildings', 'house.gltf', 7),
        item('c', 'vehicles', 'car_A.gltf', 8)
    ]));

    assert.equal(state.placedObjects.length, 2);
    assert.equal(byId(state, 'a'), undefined);
    assert.equal(byId(state, 'b').position.x, 7);
    assert.equal(state.loadCount, 3, 'existing objects are reused, not reloaded');
});

test('driver delta sets userData.driver', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full(threeIdItems()));
    await handleServerEvent({ type: 'driver', category: 'vehicles', id: 'c', driver: 'police' });

    assert.equal(byId(state, 'c').userData.driver, 'police');
});

test('name delta updates app state and both DOM controls without re-saving', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent({ type: 'name', townName: 'Riverside' });

    assert.deepEqual(state.nameChanges, ['Riverside']);
    assert.equal(state.dom['town-name-display'].textContent, 'Riverside');
    assert.equal(state.dom['town-name-input'].value, 'Riverside');
});

test('error event surfaces its message as an error notification', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent({ type: 'error', message: 'Connection limit reached' });

    assert.ok(state.notifications.some(n => n.message === 'Connection limit reached' && n.type === 'error'));
});

test('users event tolerates a missing users array', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent({ type: 'users', users: ['alice'] });
    await assert.doesNotReject(handleServerEvent({ type: 'users' }));

    assert.equal(state.userLists.length, 2);
    assert.deepEqual(state.userLists[0], ['alice']);
    // `msg.users || []` creates the empty array inside the vm realm, so its
    // prototype differs from the host realm's — compare contents, not identity.
    assert.equal(state.userLists[1].length, 0);
});

test('cursor events are ignored for the local user and forwarded for others', async () => {
    const { handleServerEvent, state } = createHarness();
    const position = { x: 1, y: 2, z: 3 };
    await handleServerEvent({ type: 'cursor', username: 'me', position });
    await handleServerEvent({ type: 'cursor', username: 'alice', position });

    assert.equal(state.cursors.length, 1);
    assert.equal(state.cursors[0][1], 'alice');
});

test('map-shaped town data is normalized before reconciliation', async () => {
    const { handleServerEvent, state } = createHarness();
    await handleServerEvent(full({
        buildings: [{ id: 'x', model: 'house.gltf', position: { x: 3, y: 0, z: 0 } }],
        trees: [{ model: 'tree_A.gltf', position: { x: 4, y: 0, z: 0 } }]
    }));

    assert.equal(state.placedObjects.length, 2);
    assert.equal(state.placedObjects[0].userData.id, 'x');
    assert.equal(state.placedObjects[0].position.x, 3);
});

test('back-to-back full snapshots are serialized and do not duplicate', async () => {
    const { handleServerEvent, state } = createHarness();
    const first = handleServerEvent(full([item(null, 'buildings', 'house.gltf', 1)]));
    const second = handleServerEvent(full([item(null, 'buildings', 'house.gltf', 2)]));
    await Promise.all([first, second]);

    assert.equal(state.placedObjects.length, 1);
    assert.equal(state.placedObjects[0].position.x, 2);
    assert.equal(state.loadCount, 1, 'the second snapshot reuses the loaded object');
});

test('unknown event types are logged, not thrown', async () => {
    const { handleServerEvent, state } = createHarness();
    await assert.doesNotReject(handleServerEvent({ type: 'something-new' }));
    assert.equal(state.placedObjects.length, 0);
});
