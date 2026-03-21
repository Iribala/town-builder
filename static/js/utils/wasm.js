/**
 * WASM initialization utilities
 * Promise-based readiness signal to avoid race conditions
 *
 * The Go WASM loading code in index.html calls window.__markWasmReady()
 * or window.__markWasmFailed() to signal when the Go module finishes
 * loading (or fails), which resolves/rejects the wasmReady promise.
 */

let wasmResolve;
let wasmReject;

/**
 * Promise that resolves when the Go WASM runtime has started
 * and registered its functions on window.
 * Resolved by window.__markWasmReady() called from index.html.
 */
export const wasmReady = new Promise((resolve, reject) => {
    wasmResolve = resolve;
    wasmReject = reject;
});

/**
 * Signal that the Go WASM module has loaded and registered its functions.
 * Called from the WASM loading script in index.html.
 */
export function markWasmReady() {
    if (wasmResolve) {
        wasmResolve();
    }
}

/**
 * Signal that the Go WASM module failed to load.
 * Called from the WASM loading script in index.html.
 */
export function markWasmFailed(error) {
    if (wasmReject) {
        wasmReject(error);
    }
}

// Expose on window so the non-module WASM loading script in index.html can call them
window.__markWasmReady = markWasmReady;
window.__markWasmFailed = markWasmFailed;

/**
 * Check if WASM is ready synchronously
 */
export function isWasmReadySync() {
    return typeof window.wasmUpdateSpatialGrid === 'function';
}
