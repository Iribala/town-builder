/**
 * WASM initialization utilities
 * Promise-based readiness signal to avoid race conditions
 */

let wasmResolve;
let wasmReject;

/**
 * Promise that resolves when WASM is ready
 * Exported as a thenable for easy awaiting
 */
export const wasmReady = new Promise((resolve, reject) => {
    wasmResolve = resolve;
    wasmReject = reject;
});

/**
 * Initialize WASM readiness tracking
 * Call this when WASM functions become available
 */
export function markWasmReady() {
    if (wasmResolve) {
        wasmResolve();
    }
}

/**
 * Check if WASM is ready synchronously
 */
export function isWasmReadySync() {
    return typeof window.wasmUpdateSpatialGrid === 'function';
}
