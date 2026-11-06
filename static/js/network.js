import { showNotification, updateOnlineUsersList } from './ui.js';
import { apiFetch } from './api-error-handler.js';
import { loadModel } from './models/loader.js';
import { scene, placedObjects, movingCars } from './state/scene-state.js';
import { updateCursor } from './collaborative-cursors.js';
import {
    getMyName,
    getToken,
    setToken,
    getBasePath,
    setBasePath,
    setCurrentTownId,
    setCurrentTownName,
    setCurrentTownDescription,
    setCurrentTownLatitude,
    setCurrentTownLongitude
} from './state/app-state.js';
import { normalizeTownItems, applyTransformToObject, loadItemsWithConcurrency } from './utils/town-layout.js';
import { isPhysicsWasmReady, updateSpatialGrid } from './utils/physics_wasm.js';
import { disposeObject } from './utils/disposal.js';

/**
 * Build headers object with auth token if available.
 * @param {Object} [extra] - Additional headers to merge
 * @returns {Object} Headers object
 */
function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

let currentEvtSource = null;
let isConnecting = false;

export function setupSSE() {
    let retryDelay = 1000;
    const maxDelay = 30000;
    
    return new Promise((resolve, reject) => {
        function connect(isInitial = false) {
            if (isConnecting) {
                console.debug('SSE connection already in progress');
                return;
            }
            
            isConnecting = true;
            
            const sseUrl = (getBasePath() || '') + '/events?name=' + encodeURIComponent(getMyName());
            // Set token as a cookie so EventSource sends it automatically.
            // Native EventSource does not support custom request headers.
            const token = getToken();
            if (token) {
                const secure = window.location.protocol === 'https:' ? '; Secure' : '';
                document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; SameSite=Strict${secure}`;
            }
            
            const evtSource = new EventSource(sseUrl);
            currentEvtSource = evtSource;
            
            evtSource.onopen = () => {
                retryDelay = 1000;
                isConnecting = false;
                if (isInitial) {
                    resolve(evtSource);
                } else {
                    showNotification('Reconnected to multiplayer server', 'success');
                }
            };
            
            evtSource.onmessage = function (event) {
                try {
                    // handleServerEvent is async so snapshot syncs can be awaited;
                    // attach the catch here so unexpected errors still surface.
                    handleServerEvent(JSON.parse(event.data)).catch(err => {
                        console.error('Failed to handle SSE message', err);
                    });
                } catch (err) {
                    console.error('Failed to handle SSE message', err);
                }
            };
            
            evtSource.onerror = (err) => {
                isConnecting = false;
                if (currentEvtSource) {
                    currentEvtSource.close();
                    currentEvtSource = null;
                }
                if (isInitial) {
                    // Resolve (not reject) so the app continues, then retry
                    resolve(null);
                }
                showNotification(`Connection lost, retrying in ${retryDelay / 1000}s`, 'error');
                setTimeout(() => {
                    retryDelay = Math.min(maxDelay, retryDelay * 2);
                    connect(false);
                }, retryDelay);
            };
        }
        
        connect(true);
    });
}

// Snapshot reconciliation loads models asynchronously. Serialize it so two
// `full` events arriving back-to-back cannot interleave and duplicate objects.
let snapshotChain = Promise.resolve();

function queueSnapshotSync(townData) {
    snapshotChain = snapshotChain
        .then(() => syncFromSnapshot(townData))
        .catch(err => {
            console.error('Error loading town data:', err);
            showNotification('Error loading town data', 'error');
        });
    return snapshotChain;
}

/**
 * Dispatch a server event. The backend publishes both full snapshots (`full`)
 * and granular deltas (`edit`, `delete`, `driver`, `name`) — see
 * internal/events/events.kuki. Previously only `full` was handled, so other
 * clients never saw moves or deletions and silently diverged from the editor.
 */
async function handleServerEvent(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'users':
            updateOnlineUsersList(msg.users || []);
            break;
        case 'full':
            if (msg.town) {
                await queueSnapshotSync(msg.town);
                showNotification('Town updated', 'success');
            }
            break;
        case 'cursor':
            if (msg.username && msg.username !== getMyName()) {
                updateCursor(scene, msg.username, msg.position, msg.camera_position);
            }
            break;
        case 'edit':
            handleEditEvent(msg);
            break;
        case 'delete':
            handleDeleteEvent(msg);
            break;
        case 'driver':
            handleDriverEvent(msg);
            break;
        case 'name':
            handleTownNameEvent(msg);
            break;
        case 'error':
            showNotification(msg.message || 'Server error', 'error');
            break;
        default:
            console.debug(`Unhandled SSE event: ${msg.type}`);
    }
}

/** Remove an object from the scene and every tracking array. */
function removePlacedObject(object) {
    disposeObject(object);
    if (scene) scene.remove(object);
    const placedIdx = placedObjects.indexOf(object);
    if (placedIdx > -1) placedObjects.splice(placedIdx, 1);
    const carIdx = movingCars.indexOf(object);
    if (carIdx > -1) movingCars.splice(carIdx, 1);
}

/** Look up a placed object by its server-assigned ID. */
function findPlacedObjectById(id) {
    if (!id) return null;
    return placedObjects.find(obj => obj.userData.id === id) || null;
}

/** Rebuild the WASM collision grid after any scene mutation. */
function refreshSpatialGrid() {
    if (isPhysicsWasmReady()) {
        updateSpatialGrid(placedObjects);
    }
}

/** Load and transform a batch of items that aren't in the scene yet. */
async function loadNewItems(items) {
    if (!scene || items.length === 0) return;
    await loadItemsWithConcurrency(items, async (item) => {
        const loadedModel = await loadModel(
            scene,
            placedObjects,
            movingCars,
            item.category,
            item.modelName
        );
        applyTransformToObject(loadedModel, item);
    }, {
        concurrency: 8,
        onError: (err, item) => {
            console.error(`Failed to load ${item.category} model ${item.modelName}:`, err);
        }
    });
}

/**
 * Reconcile a full town snapshot with the live scene.
 *
 * With stable server IDs we can add/update/remove incrementally. POST
 * /api/town/save currently sends id-less objects, so an id-less snapshot is
 * matched by index: when the scene has the same shape we only update transforms
 * (no churn for the local editor), otherwise we rebuild. The old add-only
 * handler duplicated every object on every save for id-less data.
 */
async function syncFromSnapshot(townData) {
    try {
        const items = normalizeTownItems(townData).filter(item => Boolean(item.modelName));
        const hasStableIds = items.length > 0 && items.every(item => item.id);

        if (hasStableIds) {
            const incomingIds = new Set(items.map(item => item.id));
            for (const obj of [...placedObjects]) {
                if (obj.userData.id && !incomingIds.has(obj.userData.id)) {
                    removePlacedObject(obj);
                }
            }
            const newItems = [];
            for (const item of items) {
                const existing = findPlacedObjectById(item.id);
                if (existing) {
                    applyTransformToObject(existing, item);
                } else {
                    newItems.push(item);
                }
            }
            await loadNewItems(newItems);
        } else {
            await syncSnapshotWithoutIds(items);
        }

        // loadModel updates the spatial grid per model before
        // applyTransformToObject runs, so those intermediate states had objects
        // at the origin. This single final rebuild uses the correct positions
        // for every object.
        refreshSpatialGrid();
    } catch (err) {
        console.error('Error loading town data:', err);
        showNotification('Error loading town data', 'error');
    }
}

/** Reconcile an id-less snapshot without duplicating or churning objects. */
async function syncSnapshotWithoutIds(items) {
    const sameShape = items.length === placedObjects.length && items.every((item, i) => {
        const obj = placedObjects[i];
        return obj && obj.userData.category === item.category &&
            obj.userData.modelName === item.modelName;
    });

    if (sameShape) {
        items.forEach((item, i) => applyTransformToObject(placedObjects[i], item));
        return;
    }

    for (const obj of [...placedObjects]) {
        removePlacedObject(obj);
    }
    await loadNewItems(items);
}

function handleEditEvent(msg) {
    const data = msg.data || msg;
    const object = findPlacedObjectById(msg.id || data.id);
    if (!object) {
        // Object isn't loaded yet (or still has no ID). The next full snapshot
        // will reconcile it.
        return;
    }
    applyTransformToObject(object, data);
    refreshSpatialGrid();
}

function handleDeleteEvent(msg) {
    let object = findPlacedObjectById(msg.id || msg.deleted_id);
    if (!object && msg.position) {
        object = findNearestPlacedObject(msg.position);
    }
    if (!object) return;
    removePlacedObject(object);
    refreshSpatialGrid();
}

/**
 * The town route can delete by position, finding the closest model within
 * geometry.DeleteProximityThreshold (2.0) — see internal/routes/town/town.kuki.
 * Mirror that here so id-less objects can still be removed on other clients.
 */
function findNearestPlacedObject(position) {
    const point = Array.isArray(position)
        ? { x: position[0], y: position[1], z: position[2] }
        : position;
    if (!point) return null;
    let nearest = null;
    let bestDistance = Infinity;
    for (const obj of placedObjects) {
        const distance = Math.hypot(
            obj.position.x - (point.x || 0),
            obj.position.y - (point.y || 0),
            obj.position.z - (point.z || 0)
        );
        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = obj;
        }
    }
    return bestDistance <= 2.0 ? nearest : null;
}

function handleDriverEvent(msg) {
    if (!msg.id) return;
    const object = findPlacedObjectById(msg.id);
    if (object) {
        object.userData.driver = msg.driver;
    }
}

/** Reflect a remote town-name change without re-saving (avoids an event loop). */
function handleTownNameEvent(msg) {
    const name = msg.townName;
    if (typeof name !== 'string') return;
    setCurrentTownName(name);
    const display = document.getElementById('town-name-display');
    const input = document.getElementById('town-name-input');
    if (display) display.textContent = name;
    if (input) input.value = name;
}

// Other network-related functions...

export async function saveSceneToServer(payloadFromUI) { // Argument changed
    // The payloadFromUI is now expected to be fully formed by ui.js
    // No re-wrapping needed here.
    const response = await apiFetch((getBasePath() || '') + '/api/town/save', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payloadFromUI)
    });
    const result = await response.json();
    // Persist returned town_id for future updates
    if (result.town_id) {
        setCurrentTownId(result.town_id);
    }
    return result;
}

export async function loadSceneFromServer() {
    const response = await apiFetch((getBasePath() || '') + '/api/town/load', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ filename: 'town_data.json' })
    });
    return response.json();
}

export async function loadTownFromDjango(townId) {
    const response = await apiFetch(`${getBasePath() || ''}/api/town/load-from-django/${townId}`, {
        method: 'GET',
        headers: authHeaders({ 'Content-Type': 'application/json' })
    });
    const result = await response.json();
    // Update current town info
    if (result.town_info) {
        setCurrentTownId(result.town_info.id);
        setCurrentTownName(result.town_info.name);
        setCurrentTownDescription(result.town_info.description);
        setCurrentTownLatitude(result.town_info.latitude);
        setCurrentTownLongitude(result.town_info.longitude);
    }
    return result;
}

/**
 * Broadcast a scene update event (object move/rotate/delete) to other clients
 * via the buildings API. No-op if the object has no server-assigned ID.
 * @param {Object} eventData - {type, category, id, position, rotation}
 */
export async function broadcastSceneUpdate(eventData) {
    if (!eventData || !eventData.id) return;

    try {
        if (eventData.type === 'edit') {
            await apiFetch(`${getBasePath() || ''}/api/buildings/${eventData.id}`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    position: eventData.position ? { x: eventData.position[0], y: eventData.position[1], z: eventData.position[2] } : undefined,
                    rotation: eventData.rotation ? { x: eventData.rotation[0], y: eventData.rotation[1], z: eventData.rotation[2] } : undefined,
                })
            });
        } else if (eventData.type === 'delete') {
            await apiFetch(`${getBasePath() || ''}/api/buildings/${eventData.id}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
        }
    } catch (err) {
        console.debug('Failed to broadcast scene update:', err);
    }
}

/**
 * Send cursor position update to server
 * @param {string} username - Current user's name
 * @param {Object} position - {x, y, z} world position where cursor is pointing
 * @param {Object} cameraPosition - {x, y, z} camera position
 */
export async function sendCursorUpdate(position, cameraPosition) {
    try {
        // username is intentionally omitted: the server derives it from the
        // authenticated JWT token (see internal/routes/cursor/cursor.kuki).
        await fetch((getBasePath() || '') + '/api/cursor/update', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                position: { x: position.x, y: position.y, z: position.z },
                camera_position: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z }
            })
        });
    } catch (err) {
        // Silently fail - cursor updates are non-critical
        console.debug('Failed to send cursor update:', err);
    }
}
