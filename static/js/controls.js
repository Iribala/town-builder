import { camera, renderer, placedObjects } from './state/scene-state.js';
import * as THREE from './three.module.js';
import { showNotification, getCurrentMode } from './ui.js';
import { getJoystickInput } from './joystick.js';
import { getDrivingCar, getSelectedObject, getDeltaTime } from './state/app-state.js';
import { checkCollision, updateBoundingBox } from './models/collision.js';

let keysPressed = {};
let isRightMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;
const ORBIT_TARGET = new THREE.Vector3(0, 0, 0);
const TEMP_BOX = new THREE.Box3();
const TEMP_VECTOR = new THREE.Vector3();
const FORWARD_DIR = new THREE.Vector3();
const _orbitOffset = new THREE.Vector3();
const _orbitSpherical = new THREE.Spherical();
const _lookDir = new THREE.Vector3();
const ORBIT_DISTANCE = 20; // Distance along look direction to place orbit target
const MIN_FOV = 10;
const MAX_FOV = 120;

function setCameraFov(newFov) {
    const clamped = Math.max(MIN_FOV, Math.min(MAX_FOV, newFov));
    if (camera.fov !== clamped) {
        camera.fov = clamped;
        camera.updateProjectionMatrix();
    }
}

export function setupKeyboardControls() {
    // Keyboard listeners
    document.addEventListener('keydown', function(event) {
        keysPressed[event.key.toLowerCase()] = true;
    });

    document.addEventListener('keyup', function(event) {
        keysPressed[event.key.toLowerCase()] = false;
    });

    // Mouse wheel listener
    document.addEventListener('wheel', handleMouseWheel, { passive: false });

    // Mouse listeners for panning
    if (renderer && renderer.domElement) {
        renderer.domElement.addEventListener('mousedown', function(event) {
            if (event.button === 2) { // Right mouse button
                isRightMouseDown = true;
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;
                // Compute orbit target along camera's look direction
                camera.getWorldDirection(_lookDir);
                ORBIT_TARGET.copy(camera.position).addScaledVector(_lookDir, ORBIT_DISTANCE);
                event.preventDefault();
            }
        });

        renderer.domElement.addEventListener('mousemove', function(event) {
            // Disable orbit controls if driving a car or if camera is not available
            if (!isRightMouseDown || !camera || getDrivingCar()) {
                return;
            }
            event.preventDefault();

            const deltaX = event.clientX - lastMouseX;
            const deltaY = event.clientY - lastMouseY;

            lastMouseX = event.clientX;
            lastMouseY = event.clientY;

            const orbitSpeed = 0.005; // Adjust for sensitivity

            // Orbiting logic using Spherical Coordinates
            _orbitOffset.subVectors(camera.position, ORBIT_TARGET);
            _orbitSpherical.setFromVector3(_orbitOffset);

            _orbitSpherical.theta -= deltaX * orbitSpeed; // Azimuthal angle (horizontal)
            _orbitSpherical.phi -= deltaY * orbitSpeed;   // Polar angle (vertical)

            // Clamp polar angle to prevent flipping over
            _orbitSpherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, _orbitSpherical.phi));

            _orbitOffset.setFromSpherical(_orbitSpherical);
            camera.position.copy(ORBIT_TARGET).add(_orbitOffset);
            camera.lookAt(ORBIT_TARGET);
        });

        renderer.domElement.addEventListener('contextmenu', function(event) {
            event.preventDefault(); // Prevent context menu on right click
        });
    }

    // Mouse up listener on document to catch mouse up even if outside canvas
    document.addEventListener('mouseup', function(event) {
        if (event.button === 2) { // Right mouse button
            isRightMouseDown = false;
        }
    });
}

function handleMouseWheel(event) {
    // The model selection panel has the ID 'model-container' in index.html
    const modelPanel = document.getElementById('model-container');

    if (modelPanel && modelPanel.contains(event.target)) {
        // If the mouse is over the model panel, allow default scroll behavior
        // Do not preventDefault and do not zoom.
        return;
    }

    event.preventDefault(); // Prevent default page scroll for camera zoom

    const zoomSpeed = 0.1; // Reduced for more gradual zoom
    setCameraFov(camera.fov - event.deltaY * zoomSpeed);
}

export function updateControls() {
    const cameraRotateSpeed = 0.02;
    const moveSpeed = 0.15;
    const dt = getDeltaTime() || 1 / 60;
    const objectMoveSpeed = 6.0 * dt; // ~0.1 at 60fps, frame-rate independent

    // Handle Z key zoom
    if (keysPressed['z']) {
        setCameraFov(camera.fov - 2);
    }
    if (keysPressed['x']) {
        setCameraFov(camera.fov + 2);
    }

    // Handle edit mode - move selected object with arrow keys
    const currentMode = getCurrentMode();
    if (currentMode === 'edit' && getSelectedObject()) {
        const obj = getSelectedObject();

        // Arrow keys move the object left/right/forward/back
        if (keysPressed['arrowup']) {
            obj.position.z -= objectMoveSpeed; // Move forward (negative Z)
        }
        if (keysPressed['arrowdown']) {
            obj.position.z += objectMoveSpeed; // Move back (positive Z)
        }
        if (keysPressed['arrowleft']) {
            obj.position.x -= objectMoveSpeed; // Move left (negative X)
        }
        if (keysPressed['arrowright']) {
            obj.position.x += objectMoveSpeed; // Move right (positive X)
        }

        // Q and E keys move object up and down
        if (keysPressed['q']) {
            obj.position.y += objectMoveSpeed; // Move up (positive Y)
        }
        if (keysPressed['e']) {
            obj.position.y -= objectMoveSpeed; // Move down (negative Y)
        }

        // Update bounding box if it exists
        if (obj.userData.boundingBox) {
            obj.userData.boundingBox.setFromObject(obj);
        }

        // WASD still controls camera in edit mode
        if (keysPressed['w']) camera.translateZ(-moveSpeed);
        if (keysPressed['s']) camera.translateZ(moveSpeed);
        if (keysPressed['a']) camera.translateX(-moveSpeed);
        if (keysPressed['d']) camera.translateX(moveSpeed);

        return; // Skip other controls when in edit mode with selected object
    }

    if (getDrivingCar()) {
        const car = getDrivingCar();

        // Initialize collision cooldown if it doesn't exist
        if (car.userData.collisionCooldown === undefined) {
            car.userData.collisionCooldown = 0;
        }

        // Decrement cooldown each frame
        if (car.userData.collisionCooldown > 0) {
            car.userData.collisionCooldown--;
        }

        // Debug: log cooldown when it's active
        if (car.userData.collisionCooldown > 0 && car.userData.collisionCooldown % 30 === 0) {
            console.log(`Collision cooldown: ${car.userData.collisionCooldown} frames remaining`);
        }

        // --- Check if Go WASM module is loaded ---
        if (typeof window.wasmUpdateCarPhysics === 'function') {
            // --- Go WASM-Powered Car Physics ---
            // Initialize velocities if they don't exist
            if (car.userData.velocity_x === undefined) {
                car.userData.velocity_x = 0;
                car.userData.velocity_z = 0;
            }

            // Prepare car state
            const carState = {
                x: car.position.x,
                z: car.position.z,
                rotation_y: car.rotation.y,
                velocity_x: car.userData.velocity_x,
                velocity_z: car.userData.velocity_z,
            };

            // Prepare input state - check both keyboard and joystick
            const joystickInput = getJoystickInput();
            const inputState = {
                forward: !!(keysPressed['w'] || keysPressed['arrowup'] || joystickInput.forward > 0.1),
                backward: !!(keysPressed['s'] || keysPressed['arrowdown'] || joystickInput.backward > 0.1),
                left: !!(keysPressed['a'] || keysPressed['arrowleft'] || joystickInput.left > 0.1),
                right: !!(keysPressed['d'] || keysPressed['arrowright'] || joystickInput.right > 0.1),
            };

            // Read old position for collision detection
            const oldX = carState.x;
            const oldZ = carState.z;

            // Call Go WASM function with delta time for frame-independent physics
            const dt = getDeltaTime() || 1 / 60;
            const newState = window.wasmUpdateCarPhysics(carState, inputState, dt);

            // Update the velocity on the JS object for the next frame
            car.userData.velocity_x = newState.velocity_x;
            car.userData.velocity_z = newState.velocity_z;

            const attemptedMoveVector = new THREE.Vector3(
                newState.x - oldX,
                0,
                newState.z - oldZ
            );

            // Use centralized collision detection
            TEMP_VECTOR.set(newState.x, car.position.y, newState.z);
            TEMP_BOX.setFromObject(car);
            TEMP_BOX.translate(attemptedMoveVector);

            let collisionDetected = false;
            FORWARD_DIR.set(0, 0, 1).applyQuaternion(car.quaternion);

            if (checkCollision(TEMP_BOX, placedObjects, car)) {
                if (attemptedMoveVector.dot(FORWARD_DIR) > 0) {
                    collisionDetected = true;
                    if (car.userData.collisionCooldown === 0) {
                        showNotification("Bonk!", "error");
                        car.userData.collisionCooldown = 90;
                    }
                    car.userData.velocity_x = 0;
                    car.userData.velocity_z = 0;
                }
            }

            if (!collisionDetected) {
                car.position.copy(TEMP_VECTOR);
                car.rotation.y = newState.rotation_y;
            }

        } else {
            // --- Fallback to JavaScript Physics ---
            if (car.userData.velocity === undefined) {
                car.userData.velocity = new THREE.Vector3(0, 0, 0);
                car.userData.acceleration = 0.005;
                car.userData.maxSpeed = 0.2;
                car.userData.friction = 0.98;
                car.userData.brakePower = 0.01;
                car.userData.carRotateSpeed = 0.04;
            }

            const { acceleration, maxSpeed, friction, brakePower, carRotateSpeed } = car.userData;

            // Check both keyboard and joystick for rotation
            const joystickInput = getJoystickInput();
            if (keysPressed['a'] || keysPressed['arrowleft'] || joystickInput.left > 0.1) {
                car.rotation.y += carRotateSpeed;
            }
            if (keysPressed['d'] || keysPressed['arrowright'] || joystickInput.right > 0.1) {
                car.rotation.y -= carRotateSpeed;
            }
            
            FORWARD_DIR.set(0, 0, 1).applyQuaternion(car.quaternion);
            const forward = FORWARD_DIR;
            if (keysPressed['w'] || keysPressed['arrowup'] || joystickInput.forward > 0.1) {
                car.userData.velocity.add(forward.clone().multiplyScalar(acceleration));
            }
            if (keysPressed['s'] || keysPressed['arrowdown'] || joystickInput.backward > 0.1) {
                // Reverse acceleration when pressing backward
                car.userData.velocity.add(forward.clone().multiplyScalar(-acceleration));
            }
            
            car.userData.velocity.multiplyScalar(friction);
            if (car.userData.velocity.length() > maxSpeed) car.userData.velocity.normalize().multiplyScalar(maxSpeed);
            if (car.userData.velocity.length() < 0.001) car.userData.velocity.set(0, 0, 0);

            const attemptedMoveVector = car.userData.velocity;
            if (attemptedMoveVector.lengthSq() > 0) {
                TEMP_VECTOR.copy(car.position).add(attemptedMoveVector);
                TEMP_BOX.setFromObject(car);
                TEMP_BOX.translate(attemptedMoveVector);

                let collisionDetected = checkCollision(TEMP_BOX, placedObjects, car);

                if (collisionDetected && car.userData.collisionCooldown === 0) {
                    showNotification("Bonk!", "error");
                    car.userData.collisionCooldown = 90;
                    car.userData.velocity.set(0, 0, 0);
                }

                if (!collisionDetected) {
                    car.position.copy(TEMP_VECTOR);
                }
            }
        }
    } else {
        // Default camera controls
        if (keysPressed['w']) camera.translateZ(-moveSpeed);
        if (keysPressed['s']) camera.translateZ(moveSpeed);
        if (keysPressed['a']) camera.translateX(-moveSpeed);
        if (keysPressed['d']) camera.translateX(moveSpeed);
        if (!isRightMouseDown) {
            if (keysPressed['arrowleft']) camera.rotation.y += cameraRotateSpeed;
            if (keysPressed['arrowright']) camera.rotation.y -= cameraRotateSpeed;
        }
    }
}
