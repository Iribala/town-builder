import './api-error-handler.js';
import { initializeScene, animate, loadModelToScene, placedObjects } from './scene.js';
import { handleAtprotoCallback, getAtprotoDid, signInWithBluesky } from './atproto.js';
import { setupSSE, loadTownFromDjango } from './network.js';
import { setupKeyboardControls } from './controls.js';
import { showNotification, initUI } from './ui.js';
import { initPhysicsWasm } from './utils/physics_wasm.js';
import { markWasmReady, wasmReady } from './utils/wasm.js';
import { applyCategoryStatuses, createStatusLegend } from './category_status.js';
import { normalizeTownItems, applyTransformToObject, loadItemsWithConcurrency } from './utils/town-layout.js';
import {
    setMyName,
    getCurrentTownId,
    setBasePath,
    setToken,
    getBasePath
} from './state/app-state.js';
import { isMobile } from './utils/device-detect.js';
import mobileUI from './mobile/mobile-ui.js';
import mobileSettings from './mobile/settings.js';
import tutorial from './mobile/tutorial.js';
import mobileIntegration from './mobile/integration.js';

// Wait for Go WASM module to be ready (resolved by index.html loading script)
async function waitForWasm() {
    // wasmReady is resolved when window.__markWasmReady() is called from the
    // WASM loading script in index.html after go.run() completes.
    // Add a timeout so the app can start even if WASM fails.
    const WASM_TIMEOUT_MS = 10000;
    try {
        await Promise.race([
            wasmReady,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('WASM load timed out')), WASM_TIMEOUT_MS)
            )
        ]);
        console.log('Go WASM runtime started, initializing physics...');
    } catch (err) {
        console.warn('WASM not available, continuing without physics:', err.message);
    }
    await initPhysicsWasm();
    return true;
}

// Cookie helper functions
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + "=" + (value || "")  + expires + "; path=/; SameSite=Lax" + secure;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

let userName = getCookie("userName");
if (!userName) {
    // Generate a random guest name rather than blocking page load with prompt().
    // Users can change their display name via the settings panel.
    userName = `Player${Math.floor(Math.random() * 9000) + 1000}`;
    setCookie("userName", userName, 30); // Remember for 30 days
}
setMyName(userName);

// Restore base path / auth token embedded by the server template.
if (window.__BASE_PATH) setBasePath(window.__BASE_PATH);
if (window.__TOKEN) setToken(window.__TOKEN);
// Handle an ATProto OAuth callback if present.
handleAtprotoCallback().catch(() => {});


async function init() {
    // Wait for Go WASM module to load
    await waitForWasm();

    // Initialize the scene. In the vanilla WebGL2 path the shim can throw
    // (e.g. WebGL2 unavailable or a loader/render bug) — fall back to the
    // default renderer once per session rather than leaving a blank page.
    try {
        initializeScene();
    } catch (err) {
        if (new URLSearchParams(window.location.search).get('renderer') === 'webgl2'
            && !sessionStorage.getItem('webgl2-fell-back')) {
            sessionStorage.setItem('webgl2-fell-back', '1');
            console.warn('Vanilla renderer failed to initialize, falling back to default:', err);
            const params = new URLSearchParams(window.location.search);
            params.delete('renderer');
            window.location.replace(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
            return;
        }
        throw err;
    }
    animate();

    // Wire up keyboard listeners
    setupKeyboardControls();
    initUI();

    // Bluesky sign-in wiring
    const bsBtn = document.getElementById('blueskySignIn');
    if (bsBtn) {
        bsBtn.addEventListener('click', signInWithBluesky);
    }
    const bsStatus = document.getElementById('blueskyStatus');
    const did = getAtprotoDid();
    if (bsStatus && did) bsStatus.textContent = did;

    // get-your-own-town landing modal for anonymous first-time visitors.
    const bp = getBasePath() || '';
    const previewBtn = document.getElementById('landingPreview');
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            const handle = (document.getElementById('landingHandle').value || '').trim();
            const status = document.getElementById('landingPreviewStatus');
            if (!handle) return;
            if (status) status.textContent = 'Resolving handle...';
            try {
                const res = await fetch(`${bp}/atproto/identity/${encodeURIComponent(handle)}`);
                if (!res.ok) throw new Error('handle not found');
                const ident = await res.json();
                const res2 = await fetch(`${bp}/atproto/towns/${encodeURIComponent(ident.did)}`);
                const towns = res2.ok ? await res2.json() : { count: 0 };
                if (status) status.textContent = `${ident.did}: ${towns.count || 0} town(s).`;
            } catch (e) {
                if (status) status.textContent = 'Could not resolve handle.';
            }
        });
    }
    const playAnon = document.getElementById('landingPlayAnonymous');
    if (playAnon) {
        playAnon.addEventListener('click', () => {
            try { localStorage.setItem('landingSeen', '1'); } catch (e) {}
            const modalEl = document.getElementById('landingModal');
            if (modalEl && window.bootstrap) {
                const m = window.bootstrap.Modal.getInstance(modalEl) || new window.bootstrap.Modal(modalEl);
                m.hide();
            }
        });
    }
    // Show landing modal once for anonymous visitors with no town id.
    try {
        const currentTownId = getCurrentTownId();
        if (!currentTownId && !localStorage.getItem('landingSeen') && window.bootstrap) {
            const modalEl = document.getElementById('landingModal');
            if (modalEl) {
                const m = new window.bootstrap.Modal(modalEl);
                m.show();
            }
        }
    } catch (e) {}
    // Initialize mobile modules if on mobile device
    if (isMobile()) {
        console.log('Mobile device detected - initializing mobile UI');
        mobileUI.init();
        mobileSettings.init();
        tutorial.init();
        mobileIntegration.init();

        // Touch controls and interactions are initialized in scene.js
        // after camera and canvas are available
    }

    // Joystick will be initialized when entering drive mode (see ui.js)

    // Auto-load town data if town_id is present
    const currentTownId = getCurrentTownId();
    if (currentTownId) {
        console.log(`Auto-loading town ${currentTownId} from Django...`);
        try {
            const result = await loadTownFromDjango(currentTownId);
            console.log("Town loaded:", result);

            // Update town name display
            const townNameDisplay = document.getElementById('town-name-display');
            const townNameInput = document.getElementById('town-name-input');
            if (result.town_info && result.town_info.name) {
                if (townNameDisplay) townNameDisplay.textContent = result.town_info.name;
                if (townNameInput) townNameInput.value = result.town_info.name;
            }

            // Load scene objects if layout_data exists
            if (result.data) {
                const itemsToLoad = normalizeTownItems(result.data);

                if (itemsToLoad.length > 0) {
                    console.log(`Loading ${itemsToLoad.length} objects into scene...`);
                    await loadItemsWithConcurrency(itemsToLoad, async (item) => {
                        const obj = await loadModelToScene(item.category, item.modelName);
                        if (obj) {
                            applyTransformToObject(obj, item);
                        }
                    }, {
                        concurrency: 8,
                        onError: (err, item) => {
                            console.error(`Error loading model ${item.category}/${item.modelName}:`, err);
                        }
                    });
                    showNotification(`Town "${result.town_info.name}" loaded successfully`, 'success');
                } else {
                    showNotification(`Town "${result.town_info.name}" loaded (no saved layout)`, 'info');
                }
            } else {
                showNotification(`Town "${result.town_info.name}" loaded (no saved layout)`, 'info');
            }
            if (result.town_info && result.town_info.category_statuses) {
                console.log(`Applying ${result.town_info.category_statuses.length} category statuses...`);
                applyCategoryStatuses(result.town_info.category_statuses, placedObjects);

                // Create and display status legend
                const legend = createStatusLegend(result.town_info.category_statuses);
                document.body.appendChild(legend);

                showNotification('Category statuses applied', 'success');
            }
        } catch (error) {
            console.error("Error auto-loading town:", error);
            showNotification("Error loading town data", "error");
        }
    }

    // Connect SSE after scene is initialized
    setTimeout(() => {
        setupSSE().catch(error => {
            console.error("Error setting up SSE:", error);
            showNotification("Error setting up multiplayer connection", "error");
        });
    }, 0);
}

// Start the application
init();
