import { saveSceneToServer, loadSceneFromServer } from './network.js';
import { loadModel, getActiveLoaderCount } from './models/loader.js';
import { disposeObject } from './utils/disposal.js';
import { scene, renderer, groundPlane, placementIndicator, placedObjects, movingCars } from './state/scene-state.js';
import { cleanupJoystick, initJoystick } from './joystick.js';
import {
    getSelectedObject,
    setSelectedObject,
    getDrivingCar,
    setDrivingCar,
    setPendingPlacementModelDetails,
    getCurrentTownId,
    getCurrentTownName,
    getCurrentTownDescription,
    getCurrentTownLatitude,
    getCurrentTownLongitude,
    getCurrentTownPopulation,
    getCurrentTownArea,
    getCurrentTownEstablishedDate,
    getCurrentTownPlaceType,
    getCurrentTownFullAddress,
    getCurrentTownImage,
    setCurrentTownName
} from './state/app-state.js';
import { normalizeTownItems, applyTransformToObject, loadItemsWithConcurrency } from './utils/town-layout.js';
import { getAtprotoDid, writeTownRecord } from './atproto.js';
let currentMode = 'place';

// Loading indicator element
let loadingIndicator = null;

export function getCurrentMode() { return currentMode; }

/**
 * Update the context-sensitive help panel based on current mode and state
 */
export function updateContextHelp() {
    const helpTitle = document.getElementById('help-mode-title');
    const helpContent = document.getElementById('help-content');

    if (!helpTitle || !helpContent) return;

    let title = 'Controls';
    let controls = [];

    if (getDrivingCar()) {
        // Driving mode
        title = 'Driving Mode';
        controls = [
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / Arrow keys to drive',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Click "Exit Driving Mode" to stop'
        ];
    } else if (currentMode === 'edit' && getSelectedObject()) {
        // Edit mode with selected object
        title = 'Edit Mode (Object Selected)';
        controls = [
            '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> Move object',
            '<kbd>Q</kbd><kbd>E</kbd> Move up/down',
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move camera',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Right-click drag to orbit'
        ];
    } else if (currentMode === 'edit') {
        // Edit mode without selected object
        title = 'Edit Mode';
        controls = [
            'Click an object to select it',
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move camera',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Right-click drag to orbit'
        ];
    } else if (currentMode === 'place') {
        // Place mode
        title = 'Place Mode';
        controls = [
            'Select a model from the sidebar',
            'Click to place in the scene',
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move camera',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Right-click drag to orbit'
        ];
    } else if (currentMode === 'delete') {
        // Delete mode
        title = 'Delete Mode';
        controls = [
            'Click an object to delete it',
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move camera',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Right-click drag to orbit'
        ];
    } else if (currentMode === 'drive') {
        // Drive mode waiting for selection
        title = 'Drive Mode';
        controls = [
            'Click a vehicle to start driving',
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move camera',
            '<kbd>Z</kbd><kbd>X</kbd> Zoom in/out',
            'Right-click drag to orbit'
        ];
    }

    helpTitle.textContent = title;
    helpContent.innerHTML = controls.map(c => `<li>${c}</li>`).join('');
}

export function setCurrentMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-button').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    });

    // Clear selected object when switching modes (except when staying in edit mode)
    if (mode !== 'edit') {
        setSelectedObject(null);
    }

    const joystickContainer = document.getElementById('joystick-container');
    const exitDrivingBtn = document.getElementById('exit-driving-btn');
    const modelContainer = document.getElementById('model-container');
    const toolbar = document.getElementById('toolbar');
    const contextHelp = document.getElementById('context-help');
    const townNameContainer = document.getElementById('town-name-container');
    const themeToggleContainer = document.getElementById('theme-toggle-container');
    const categoryStatusLegend = document.getElementById('category-status-legend');

    const setVisible = (el, visible) => { if (el) el.classList.toggle('hidden', !visible); };

    // Default UI states
    setVisible(joystickContainer, false);
    setVisible(exitDrivingBtn, false);
    setVisible(modelContainer, true); // Show model list by default
    setVisible(toolbar, true);
    setVisible(contextHelp, true);
    setVisible(townNameContainer, true);
    setVisible(themeToggleContainer, true);
    setVisible(categoryStatusLegend, true);

    if (mode === 'drive') {
        if (getDrivingCar()) { // Actively driving a car
            setVisible(joystickContainer, true); // Or 'flex'
            setVisible(exitDrivingBtn, true);
            setVisible(modelContainer, false);
            setVisible(toolbar, false);
            setVisible(contextHelp, false);
            setVisible(townNameContainer, false);
            setVisible(themeToggleContainer, false);
            setVisible(categoryStatusLegend, false);
            showNotification(`Driving ${getDrivingCar().userData.modelName || 'car'}. Use WASD/Arrows or joystick on mobile.`, 'info');

            // Re-initialize joystick when it becomes visible
            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (typeof initJoystick === 'function') {
                        initJoystick();
                    }
                });
            });
        } else { // Entered drive mode, waiting for car selection
            setVisible(joystickContainer, false);
            setVisible(exitDrivingBtn, false); // Keep hidden until car selected
            setVisible(modelContainer, true); // Or 'none' if you prefer
            setVisible(toolbar, true);
            setVisible(contextHelp, true);
            setVisible(townNameContainer, true);
            setVisible(themeToggleContainer, true);
            setVisible(categoryStatusLegend, true);
            showNotification('Drive Mode: Click on a car in the scene to drive it.', 'info');
        }
    } else { // Not in drive mode
        setVisible(modelContainer, true);
        setVisible(toolbar, true);
        setVisible(contextHelp, true);
        setVisible(townNameContainer, true);
        setVisible(themeToggleContainer, true);
        setVisible(categoryStatusLegend, true);
        setDrivingCar(null); // Ensure drivingCar is cleared if mode changes from drive
    }


    // If switching away from place mode (or to a mode that isn't 'place'),
    // clear pending model details and hide placement indicator.
    if (mode !== 'place') {
        setPendingPlacementModelDetails(null);
        if (placementIndicator) placementIndicator.visible = false;
    }
    // If mode IS 'place', handleMouseMove in scene.js will manage placementIndicator visibility.

    // Only show generic mode notification if not handled by specific drive mode logic above
    if (!(mode === 'drive')) {
        showNotification(`Mode: ${mode}`, 'info');
    }

    // Update context-sensitive help panel
    updateContextHelp();

    // Dispatch mode change event for mobile integration
    window.dispatchEvent(new CustomEvent('mode-change', {
        detail: { mode }
    }));
}

// Call this function when a car is selected to drive
export function activateDriveModeUI(carObject) {
    setDrivingCar(carObject);
    setCurrentMode('drive'); // This will re-evaluate UI based on driving car state
}

// Call this function to stop driving
export function deactivateDriveModeUI() {
    setDrivingCar(null);
    cleanupJoystick(); // Clean up joystick event listeners
    setCurrentMode('place'); // Or your preferred default mode
}

export function showNotification(message, type = 'info') {
    // Oat's toast handles placement, stacking, variants and live regions itself.
    const variant = type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info';
    if (window.ot && typeof window.ot.toast === 'function') {
        window.ot.toast(message, '', { variant, placement: 'bottom-center', duration: 3000 });
        return;
    }
    // Defensive fallback (Oat failed to load): still announce politely to AT.
    let fallback = document.getElementById('toast-a11y-fallback');
    if (!fallback) {
        fallback = document.createElement('p');
        fallback.id = 'toast-a11y-fallback';
        fallback.className = 'visually-hidden';
        document.body.appendChild(fallback);
    }
    fallback.setAttribute('role', type === 'error' ? 'alert' : 'status');
    fallback.textContent = message;
}

/**
 * Create and initialize the loading indicator
 * Uses r179 loader tracking for accurate state
 */
function createLoadingIndicator() {
    if (loadingIndicator) return loadingIndicator;

    const indicator = document.createElement('div');
    indicator.id = 'loading-indicator';
    indicator.className = 'loading-indicator';
    indicator.setAttribute('role', 'status');

    // Decorative CSS spinner (see .spinner in app.css)
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.id = 'loading-text';
    text.textContent = 'Loading models...';

    indicator.appendChild(spinner);
    indicator.appendChild(text);
    document.body.appendChild(indicator);

    loadingIndicator = indicator;
    return indicator;
}

/**
 * Update loading indicator based on active loaders
 * Should be called periodically in animation loop
 */
export function updateLoadingIndicator() {
    const count = getActiveLoaderCount();
    const indicator = loadingIndicator || createLoadingIndicator();
    const text = document.getElementById('loading-text');

    if (count > 0) {
        indicator.dataset.visible = 'true';
        if (text) {
            text.textContent = count === 1
                ? 'Loading 1 model...'
                : `Loading ${count} models...`;
        }
    } else {
        delete indicator.dataset.visible;
    }
}

// Other UI-related functions...

export function initUI() {
    // Model-item clicks
    document.querySelectorAll('.model-item').forEach(elem => {
        elem.addEventListener('click', onModelItemClick);
    });
    // Clear, save, load buttons
    document.getElementById('clear-scene').addEventListener('click', onClearScene);
    document.getElementById('save-scene').addEventListener('click', onSaveScene);
    document.getElementById('load-scene').addEventListener('click', onLoadScene);
    // Town name display/input
    const display = document.getElementById('town-name-display');
    const input = document.getElementById('town-name-input');
    display.addEventListener('click', () => {
        display.classList.add('hidden');
        input.classList.remove('hidden');
        input.focus();
    });
    input.addEventListener('blur', onTownNameChange);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        }
    });
    // Color pickers
    document.getElementById('skyColorPicker').addEventListener('input', e => setSkyColor(e.target.value));
    document.getElementById('groundColorPicker').addEventListener('input', e => setGroundColor(e.target.value));

    // Mode button handling
    document.querySelectorAll('.mode-button').forEach(btn =>
        btn.addEventListener('click', (e) => {
            const mode = e.currentTarget.dataset.mode;
            setCurrentMode(mode); // Use the new function
        })
    );

    // Listener for Exit Driving Mode button
    const exitDrivingBtn = document.getElementById('exit-driving-btn');
    if (exitDrivingBtn) {
        exitDrivingBtn.addEventListener('click', () => {
            deactivateDriveModeUI();
        });
    }

    // Initialize context help panel
    updateContextHelp();
}

// Handler stubs
/**
 * Check if a specific model has already been placed in the scene
 * @param {string} category - The category of the model
 * @param {string} modelName - The name of the model
 * @returns {boolean} - True if the model has been placed before, false otherwise
 */
export function hasModelBeenPlaced(category, modelName) {
    return placedObjects.some(obj => 
        obj.userData && 
        obj.userData.category === category && 
        obj.userData.modelName === modelName
    );
}

function onModelItemClick(event) {
    event.preventDefault(); // Prevent default anchor behavior
    const target = event.currentTarget; // Use currentTarget to get the element with the event listener
    const category = target.dataset.category;
    const modelName = target.dataset.model;
    const displayName = target.textContent.trim(); // Get the display name from the element text

    setPendingPlacementModelDetails({ category, modelName, displayName });
    setCurrentMode('place'); // Switch to place mode

    // Only show the notification if this model hasn't been placed before
    if (!hasModelBeenPlaced(category, modelName)) {
        showNotification(`Click on the ground to place ${displayName}`, 'info');
    }

    // Dispatch model-selected event for mobile integration
    window.dispatchEvent(new CustomEvent('model-selected', {
        detail: { category, modelName }
    }));

    // The actual model loading will now happen in scene.js's onCanvasClick when in 'place' mode
}

async function onClearScene() {
    if (window.confirm("Are you sure you want to clear the entire scene? This action cannot be undone.")) {
        placedObjects.forEach(obj => {
            disposeObject(obj);
            scene.remove(obj);
        });
        placedObjects.length = 0;
        movingCars.length = 0; // Also clear the movingCars array
        showNotification('Scene cleared', 'success');
    } else {
        showNotification('Clear scene cancelled', 'info');
    }
}

async function onSaveScene() {
    try {
        const sceneDataArray = placedObjects.map(obj => ({
            category: obj.userData.category,
            modelName: obj.userData.modelName,
            position: obj.position.toArray(),
            rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
            scale: obj.scale.toArray()
        }));

        const townNameDisplay = document.getElementById('town-name-display');
        const currentTownName = townNameDisplay ? townNameDisplay.textContent : "Unnamed Town";

        // Construct the payload for app.py, including all relevant Django fields
        const payloadForAppPy = {
            data: sceneDataArray, // For layout_data
            town_id: getCurrentTownId() || null,
            owner_did: getAtprotoDid() || null,
            townName: currentTownName, // For Django's 'name' field, or search by name

            // Add other Django fields. Assumes these are available in global scope or UI.
            // If not available, they will be sent as null.
            latitude: getCurrentTownLatitude() || null,
            longitude: getCurrentTownLongitude() || null,
            description: getCurrentTownDescription() || null,
            population: getCurrentTownPopulation() || null,
            area: getCurrentTownArea() || null,
            established_date: getCurrentTownEstablishedDate() || null, // Expected format "YYYY-MM-DD"
            place_type: getCurrentTownPlaceType() || null,
            full_address: getCurrentTownFullAddress() || null,
            town_image: getCurrentTownImage() || null, // Expected as URL string or similar
        };
        
        // filename is optional for local save in app.py, can be added if needed:
        // payloadForAppPy.filename = "my_town.json";

        const saveResult = await saveSceneToServer(payloadForAppPy); // Pass the fully constructed payload
        const townId = saveResult && saveResult.town_id ? saveResult.town_id : getCurrentTownId();
        if (townId) writeTownRecord(townId).catch(() => {});
        showNotification('Scene saved successfully', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

async function onLoadScene() {
    try {
        const response = await loadSceneFromServer();
        const rawData = response.data || response;

        const itemsToLoad = normalizeTownItems(rawData);

        // Clear existing scene objects
        placedObjects.forEach(obj => {
            disposeObject(obj);
            scene.remove(obj);
        });
        placedObjects.length = 0;
        movingCars.length = 0;

        await loadItemsWithConcurrency(itemsToLoad, async (item) => {
            const obj = await loadModel(scene, placedObjects, movingCars, item.category, item.modelName);
            applyTransformToObject(obj, item);
        }, {
            concurrency: 8,
            onError: (err, item) => {
                console.error(`Error loading model ${item.category}/${item.modelName}:`, err);
            }
        });
        showNotification('Scene loaded successfully', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

async function onTownNameChange() {
    const input = document.getElementById('town-name-input');
    const newName = input.value.trim() || 'Unnamed Town';
    setCurrentTownName(newName);
    // Update display
    const display = document.getElementById('town-name-display');
    if (display) {
        display.textContent = newName;
        display.classList.remove('hidden');
        input.classList.add('hidden');
    }
    await onSaveScene(); // Automatically save the scene when the town name changes
}

function setSkyColor(color) {
    renderer.setClearColor(color);
}

function setGroundColor(color) {
    groundPlane.material.color.set(color);
}

export function updateOnlineUsersList(users) {
    const ul = document.getElementById('user-list-ul');
    ul.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.className = 'user-item';
        const icon = document.createElement('i');
        icon.className = 'bi bi-person-circle me-2';
        li.appendChild(icon);
        li.appendChild(document.createTextNode(u));
        ul.appendChild(li);
    });
}
