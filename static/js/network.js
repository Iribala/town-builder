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
            
            let sseUrl = (getBasePath() || '') + '/events?name=' + encodeURIComponent(getMyName());
            const token = getToken();
            if (token) {
                sseUrl += '&token=' + encodeURIComponent(token);
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
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'users') {
                        updateOnlineUsersList(msg.users);
                    } else if (msg.type === 'full' && msg.town) {
                        loadTownData(msg.town);
                        showNotification('Town updated', 'success');
                    } else if (msg.type === 'cursor') {
                        if (msg.username && msg.username !== getMyName()) {
                            updateCursor(scene, msg.username, msg.position, msg.camera_position);
                        }
                    } else {
                        showNotification(`Event: ${msg.type}`, 'info');
                    }
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
 * Send cursor position update to server
 * @param {string} username - Current user's name
 * @param {Object} position - {x, y, z} world position where cursor is pointing
 * @param {Object} cameraPosition - {x, y, z} camera position
 */
export async function sendCursorUpdate(username, position, cameraPosition) {
    try {
        // username is intentionally omitted: the server derives it from the
        // authenticated JWT token (see app/routes/cursor.py).
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
