import { showNotification, updateOnlineUsersList } from './ui.js';
import { apiFetch } from './api-error-handler.js';
import { loadModel } from './models/loader.js';
import { scene, placedObjects, movingCars } from './state/scene-state.js';
import { updateCursor } from './collaborative-cursors.js';
import { getMyName } from './state/app-state.js';
import { normalizeTownItems, applyTransformToObject, loadItemsWithConcurrency } from './utils/town-layout.js';
import { isPhysicsWasmReady, updateSpatialGrid } from './utils/physics_wasm.js';

/**
 * Build headers object with auth token if available.
 * @param {Object} [extra] - Additional headers to merge
 * @returns {Object} Headers object
 */
function authHeaders(extra = {}) {
    const headers = { ...extra };
    if (window.__TOKEN) {
        headers['Authorization'] = `Bearer ${window.__TOKEN}`;
    }
    return headers;
}

export function setupSSE() {
    // Setup SSE connection with automatic reconnection and backoff
    let retryDelay = 1000;
    const maxDelay = 30000;
    return new Promise((resolve, reject) => {
        function connect(isInitial = false) {
            let sseUrl = (window.__BASE_PATH || '') + '/events?name=' + encodeURIComponent(getMyName());
            // EventSource doesn't support custom headers, so pass token as query param
            if (window.__TOKEN) {
                sseUrl += '&token=' + encodeURIComponent(window.__TOKEN);
            }
            const evtSource = new EventSource(sseUrl);
            evtSource.onopen = () => {
                retryDelay = 1000;
                if (isInitial) {
                    resolve(evtSource);
                } else {
                    showNotification('Reconnected to multiplayer server', 'success');
                }
            };
            evtSource.onmessage = function (event) {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'users') { // Changed 'onlineUsers' to 'users'
                        updateOnlineUsersList(msg.users); // Changed msg.payload to msg.users
                    } else if (msg.type === 'full' && msg.town) {
                        // Handle full town updates - render new buildings
                        loadTownData(msg.town);
                        showNotification('Town updated', 'success');
                    } else if (msg.type === 'cursor') {
                        // Handle cursor position updates from other users
                        if (msg.username && msg.username !== getMyName()) {
                            updateCursor(scene, msg.username, msg.position, msg.camera_position);
                        }
                    } else {
                        // Pass the whole message to showNotification for more context if needed
                        // For now, keeping it simple as before, but logging the full message might be useful for debugging other events
                        // console.log("Received SSE message:", msg); 
                        showNotification(`Event: ${msg.type}`, 'info');
                    }
                } catch (err) {
                    console.error('Failed to handle SSE message', err);
                }
            };
            evtSource.onerror = (err) => {
                evtSource.close();
                if (isInitial) {
                    reject(err);
                } else {
                    showNotification(`Connection lost, retrying in ${retryDelay / 1000}s`, 'error');
                    setTimeout(() => {
                        retryDelay = Math.min(maxDelay, retryDelay * 2);
                        connect(false);
                    }, retryDelay);
                }
            };
        }
        connect(true);
    });
}

// Load town data from SSE updates and render new buildings
async function loadTownData(townData) {
    try {
        // Get current object IDs to avoid duplicates
        const existingIds = new Set();
        placedObjects.forEach(obj => {
            if (obj.userData.id) {
                existingIds.add(obj.userData.id);
            }
        });

        const normalizedItems = normalizeTownItems(townData).filter(item => {
            if (item.id && existingIds.has(item.id)) {
                return false;
            }
            return Boolean(item.modelName);
        });

        await loadItemsWithConcurrency(normalizedItems, async (item) => {
            const loadedModel = await loadModel(
                scene,
                placedObjects,
                movingCars,
                item.category,
                item.modelName
            );
            applyTransformToObject(loadedModel, item);
            console.log(`Loaded ${item.category} model: ${item.modelName}`);
        }, {
            concurrency: 8,
            onError: (err, item) => {
                console.error(`Failed to load ${item.category} model ${item.modelName}:`, err);
            }
        });

        // Rebuild the WASM spatial grid once after all objects are loaded and
        // correctly positioned. The per-model updates inside loadModel fired
        // before applyTransformToObject ran, so those intermediate states had
        // objects at the origin. This single final rebuild uses the correct
        // positions for every object.
        if (isPhysicsWasmReady()) {
            updateSpatialGrid(placedObjects);
        }
    } catch (err) {
        console.error('Error loading town data:', err);
        showNotification('Error loading town data', 'error');
    }
}

// Other network-related functions...

export async function saveSceneToServer(payloadFromUI) { // Argument changed
    // The payloadFromUI is now expected to be fully formed by ui.js
    // No re-wrapping needed here.
    const response = await apiFetch((window.__BASE_PATH || '') + '/api/town/save', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payloadFromUI)
    });
    const result = await response.json();
    // Persist returned town_id for future updates
    if (result.town_id) {
        window.currentTownId = result.town_id;
    }
    return result;
}

export async function loadSceneFromServer() {
    const response = await apiFetch((window.__BASE_PATH || '') + '/api/town/load', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ filename: 'town_data.json' })
    });
    return response.json();
}

export async function loadTownFromDjango(townId) {
    const response = await apiFetch(`${window.__BASE_PATH || ''}/api/town/load-from-django/${townId}`, {
        method: 'GET',
        headers: authHeaders({ 'Content-Type': 'application/json' })
    });
    const result = await response.json();
    // Update current town info
    if (result.town_info) {
        window.currentTownId = result.town_info.id;
        window.currentTownName = result.town_info.name;
        window.currentTownDescription = result.town_info.description;
        window.currentTownLatitude = result.town_info.latitude;
        window.currentTownLongitude = result.town_info.longitude;
    }
    return result;
}

/**
 * Send cursor position update to server
 * @param {string} username - Current user's name
 * @param {Object} position - {x, y, z} world position where cursor is pointing
 * @param {Object} cameraPosition - {x, y, z} camera position
 */
export async function sendCursorUpdate(username, position, cameraPosition) {
    try {
        // username is intentionally omitted: the server derives it from the
        // authenticated JWT token (see app/routes/cursor.py).
        await fetch((window.__BASE_PATH || '') + '/api/cursor/update', {
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
