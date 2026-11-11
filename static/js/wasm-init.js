// Physics WASM bootstrap — externalized from templates/index.html so the CSP
// can drop 'unsafe-inline' scripts. Reads the versioned WASM URL from the
// same #server-embed JSON blob (embed.js only republishes the values other
// modules use). Classic script, ordered after wasm_exec.js.
(function () {
    var embed = {};
    try {
        var blob = document.getElementById('server-embed');
        if (blob && blob.textContent) embed = JSON.parse(blob.textContent);
    } catch (err) {
        console.error('WASM: server-embed parse failed:', err);
    }
    var wasmUrl = embed.WasmURL || '/static/wasm/physics_greentea.wasm';

    var go = new Go();
    WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject).then(function (result) {
        go.run(result.instance);
        console.log('\u2713 Physics WASM loaded (Go 1.25+ with GreenTea GC experimental)');
        // Signal readiness to main.js (breaks deadlock)
        if (typeof window.__markWasmReady === 'function') {
            window.__markWasmReady();
        } else {
            // Fallback in case the main application loads slower -
            // functions will be checked again in main.js init loop
            console.warn('WASM signal function not yet on window - will retry in 100ms');
            setTimeout(function () {
                if (typeof window.__markWasmReady === 'function') window.__markWasmReady();
            }, 100);
        }
    }).catch(function (err) {
        console.error('Failed to load physics WASM:', err);
        if (typeof window.__markWasmFailed === 'function') window.__markWasmFailed(err);
    });
})();
