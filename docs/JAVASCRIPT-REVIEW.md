# JavaScript Code Review: Town Builder

> **Reviewer:** Claude (Expert JS Review)
> **Date:** 2026-03-21
> **Scope:** All application JavaScript in `static/js/` (excluding vendored Three.js)

## Overall Assessment

The codebase is reasonably well-structured with clear module boundaries and good separation of concerns. Strong fundamentals — good WASM integration, thoughtful caching (LRU + Bloom filter), accessibility support, and solid real-time multiplayer architecture. The main areas for improvement are security (XSS), hot-path allocations, and a couple of bugs that would cause runtime failures.

---

## Critical Issues

### 1. XSS Vulnerability in Notifications — `ui.js:237`

```js
toast.innerHTML = `
    <div class="d-flex">
        <div class="toast-body">${message}</div>
        ...
    </div>
`;
```

The `message` parameter comes from various sources including server responses (`network.js:79`, `network.js:85`) and user-controlled data like model names (`scene.js:468`). If a model name or SSE event contains HTML, this is exploitable. Use `textContent` or sanitize before inserting.

**File:** `static/js/ui.js:237`

### 2. XSS in Online Users List — `ui.js:545`

```js
li.innerHTML = `<i class="bi bi-person-circle me-2 text-primary"></i>${u}`;
```

The username `u` comes from SSE events (`network.js:76`) which originate from other users. A malicious user could set their name to `<img src=x onerror=alert(1)>` and execute code in all connected clients. Use `textContent` for the username portion.

**File:** `static/js/ui.js:545`

### 3. Animation Loop Blocks on WASM Every Frame — `scene.js:346`

```js
export async function animate() {
    await wasmReady;  // evaluated EVERY frame
    requestAnimationFrame(animate);
```

`await wasmReady` is evaluated every frame. While a resolved promise resolves on the next microtick, this still adds unnecessary overhead to every single animation frame. The WASM wait should happen once at startup (which it does in `main.js`), not on every frame.

**File:** `static/js/scene.js:346`

### 4. Raycaster Allocation in Hot Paths

New `THREE.Raycaster()` is created on every click (`scene.js:401`), every cursor update (`scene.js:235`), and every mousemove (`placement.js:43`). The cursor update fires every 100ms during mouse movement. These should be module-level reusable instances.

**Files:** `static/js/scene.js:235,401`, `static/js/models/placement.js:43`

---

## Bugs

### 5. `serializeObject` Double-Counts Position — `physics_wasm.js:106-117`

```js
const box = object.userData.boundingBox;
const position = object.position;

return {
    bbox: {
        minX: position.x + box.min.x,  // position added twice if box is world-space
        ...
    }
};
```

`Box3.setFromObject()` returns world-space coordinates, but the serialization adds `position.x` again. This means bounding boxes are offset by `position` twice, making WASM collision detection unreliable. Either use local-space boxes or don't add position.

**File:** `static/js/utils/physics_wasm.js:106-117`

### 6. SSE Reconnection Promise Never Resolves on Initial Failure — `network.js:63-69`

The first `connect(true)` sets `isConnecting = true`, and it's cleared in `onopen`. But if the initial connection fails, `onerror` sets `isConnecting = false` then calls `reject(err)` — the Promise is now rejected and `setupSSE` never resolves. If `setupSSE()` is called again elsewhere, a new connection won't happen because `currentEvtSource` is still checked.

**File:** `static/js/network.js:38-111`

### 7. `calcDistance` Not Defined — `car.js:170`

```js
const distanceToTarget = calcDistance(
    car.position.x, car.position.z,
    nearestTarget.position.x, nearestTarget.position.z
);
```

`calcDistance` is never imported or defined in `car.js`. This will throw a `ReferenceError` at runtime whenever a police car has a chase target, breaking chase AI entirely.

**File:** `static/js/physics/car.js:170`

### 8. Object Movement in Edit Mode is Frame-Rate Dependent — `controls.js:139-158`

Arrow key movement uses a fixed `objectMoveSpeed = 0.1` per frame regardless of `deltaTime`. At 60fps this is fine, but at 144fps objects move 2.4x faster. The `deltaTime` is stored in app-state but never used here.

**File:** `static/js/controls.js:111,139-158`

---

## Performance Issues

### 9. `findRootObject` Uses `Array.includes()` — `raycaster.js:27`

```js
while (obj.parent && !placedObjects.includes(obj)) {
    obj = obj.parent;
}
```

`Array.includes()` is O(n) on the `placedObjects` array, called for every hierarchy level of a clicked object. With hundreds of placed objects, this is slow. Use a `Set` or tag root objects with a `userData` flag.

**File:** `static/js/utils/raycaster.js:27`

### 10. `new THREE.Vector3/Spherical/Object3D` in Animation Loop

Multiple places create `new THREE.Vector3()`, `new THREE.Spherical()`, etc. inside functions called every frame:

| Location | Allocation |
|----------|-----------|
| `controls.js:57-58` | `new Vector3()` + `new Spherical()` on every mousemove |
| `car.js:18` | `new Object3D()` every animation frame |
| `car.js:39,53,167` | `new Vector3()` in chase behavior per frame |
| `car.js:88-89` | Two `new Vector3()` in driving camera per frame |
| `car.js:283` | `new Vector3()` in JS fallback physics per frame |

These cause GC pressure and potential frame stutters. Hoist to module-level reusable objects (as was correctly done for `TEMP_BOX`/`TEMP_VECTOR` in `controls.js`, but inconsistently applied elsewhere).

**Files:** `static/js/controls.js:57-58`, `static/js/physics/car.js:18,39,53,88,167,283`

### 11. `applyFrustumCulling` Copies Array Every Frame — `scene.js:268`

```js
visibleObjects = placedObjects.slice(); // Copy array
```

When below threshold, the entire array is copied every frame. Since `visibleObjects` is only used for stats, this is wasteful.

**File:** `static/js/scene.js:268`

---

## Architecture Issues

### 12. Dual Export Pattern Creates Confusion — `scene-state.js` / `scene.js`

`scene-state.js` exports mutable `let` bindings (`scene`, `camera`, etc.) that are reassigned via setter functions. These same values are re-exported from `scene.js:545`:

```js
export { scene, camera, renderer, groundPlane, placementIndicator, placedObjects, movingCars };
```

Some files import from `scene-state.js`, others from `scene.js`. This dual-export pattern creates confusion about the canonical source of truth.

**Files:** `static/js/state/scene-state.js`, `static/js/scene.js:545`

### 13. Verbose Getter/Setter Boilerplate — `app-state.js`

200 lines of trivial getters/setters for a flat state object. No validation, no side effects, no encapsulation benefit. Could be a simple object with direct property access, or use a Proxy-based store if reactivity is needed later.

**File:** `static/js/state/app-state.js`

### 14. Dead Dynamic Imports in Touch Callbacks — `scene.js:167,185`

```js
import('./network.js').then(({ broadcastSceneUpdate }) => {
    if (broadcastSceneUpdate) {
        broadcastSceneUpdate(eventData);
    }
});
```

Dynamic `import()` inside touch event callbacks. `network.js` is already statically imported at the top of the file. More importantly, `broadcastSceneUpdate` does not appear to be exported from `network.js`, meaning these callbacks silently do nothing — move and rotate events from mobile are never broadcast.

**File:** `static/js/scene.js:167-171,185-189`

### 15. Cookie Handling Without `Secure` Flag — `main.js:49`, `network.js:56`

```js
// main.js:49
document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";

// network.js:56
document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; SameSite=Strict`;
```

Neither cookie includes the `Secure` flag. In production over HTTPS, cookies should include `Secure` to prevent transmission over unencrypted connections.

**Files:** `static/js/main.js:49`, `static/js/network.js:56`

---

## Minor Issues

### 16. `disposeObject` Doesn't Dispose Textures — `disposal.js:9-22`

Materials are disposed but their textures (map, normalMap, etc.) are not. The `loader.js` version (`disposeMaterial`) correctly handles textures. The `disposal.js` version is used for scene cleanup, where texture leaks matter most.

**File:** `static/js/utils/disposal.js:9-22`

### 17. `setCurrentMode` Redundant UI Resets — `ui.js:130-178`

The drive mode's "not driving" branch (lines 161-169) sets the same values as the "not in drive mode" branch (lines 172-178). These could be collapsed into a shared default.

**File:** `static/js/ui.js:130-178`

### 18. No `removeEventListener` for Resize — `scene/scene.js:203`

```js
window.addEventListener('resize', () => onWindowResize(camera, renderer));
```

Anonymous arrow function means it can never be cleaned up if the scene is destroyed.

**File:** `static/js/scene/scene.js:203`

### 19. `updateContextHelp` Uses `innerHTML` — `ui.js:104`

```js
helpContent.innerHTML = controls.map(c => `<li>${c}</li>`).join('');
```

Currently safe since all strings are hardcoded, but sets a pattern that could become dangerous if dynamic content is added later. Consider using DOM APIs instead.

**File:** `static/js/ui.js:104`

---

## Summary

| Priority | Issue | Category | Impact |
|----------|-------|----------|--------|
| **P0** | XSS in notifications and user list (#1, #2) | Security | Arbitrary code execution |
| **P0** | `calcDistance` undefined (#7) | Bug | Runtime crash (chase AI) |
| **P0** | Double-counted position in WASM bbox (#5) | Bug | Broken collision detection |
| **P1** | Raycaster/Vector3 allocations in hot paths (#4, #10) | Performance | GC pauses, stuttering |
| **P1** | `await wasmReady` every animation frame (#3) | Performance | Unnecessary overhead |
| **P1** | Frame-rate dependent object movement (#8) | Bug | Inconsistent UX |
| **P1** | Dead mobile broadcast callbacks (#14) | Bug | Mobile edits not synced |
| **P2** | `findRootObject` O(n) lookup (#9) | Performance | Slow with many objects |
| **P2** | Texture leak in `disposeObject` (#16) | Performance | Memory leak |
| **P2** | Missing `Secure` cookie flag (#15) | Security | Cookie exposure |
| **P2** | SSE reconnection edge case (#6) | Bug | Connection failure |
| **P3** | Verbose app-state boilerplate (#13) | Maintainability | Code clarity |
| **P3** | Redundant UI state logic (#17) | Maintainability | Code clarity |
| **P3** | Dual export pattern (#12) | Architecture | Developer confusion |
| **P3** | Non-removable resize listener (#18) | Maintainability | Minor leak on teardown |
