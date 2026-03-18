// Mobile Joystick Implementation
// Handles touch-based controls for driving cars on mobile devices

let joystickActive = false;
let joystickBase = null;
let joystickStick = null;
let joystickRadius = 0;
let joystickStickRadius = 0;
let isInitialized = false;

// Current joystick input state
let joystickInput = {
    forward: 0,
    backward: 0,
    left: 0,
    right: 0
};

// Cleanup function to remove event listeners
export function cleanupJoystick() {
    if (!joystickBase) return;

    joystickBase.removeEventListener('touchstart', handleJoystickTouchStart);
    joystickBase.removeEventListener('touchmove', handleJoystickTouchMove);
    joystickBase.removeEventListener('touchend', handleJoystickTouchEnd);
    joystickBase.removeEventListener('touchcancel', handleJoystickTouchEnd);
    joystickBase.removeEventListener('mousedown', handleJoystickMouseDown);
    document.removeEventListener('mousemove', handleJoystickMouseMove);
    document.removeEventListener('mouseup', handleJoystickMouseUp);
    document.removeEventListener('keydown', handleJoystickKeyDown);
    document.removeEventListener('keyup', handleJoystickKeyUp);

    isInitialized = false;
}

// Initialize joystick when it becomes visible
export function initJoystick() {
    const joystickContainer = document.getElementById('joystick-container');
    if (!joystickContainer) return;

    joystickBase = document.getElementById('joystick-base');
    joystickStick = document.getElementById('joystick-stick');

    if (!joystickBase || !joystickStick) return;

    // Clean up any existing listeners first
    if (isInitialized) {
        cleanupJoystick();
    }

    // Get dimensions (not positions - we'll calculate those on each touch)
    joystickRadius = joystickBase.offsetWidth / 2;
    joystickStickRadius = joystickStick.offsetWidth / 2;

    // Add touch event listeners
    joystickBase.addEventListener('touchstart', handleJoystickTouchStart, { passive: false });
    joystickBase.addEventListener('touchmove', handleJoystickTouchMove, { passive: false });
    joystickBase.addEventListener('touchend', handleJoystickTouchEnd, { passive: false });
    joystickBase.addEventListener('touchcancel', handleJoystickTouchEnd, { passive: false });

    // Also handle mouse events for testing on desktop
    // Note: mousemove and mouseup are on document to handle dragging outside the joystick
    joystickBase.addEventListener('mousedown', handleJoystickMouseDown);
    document.addEventListener('mousemove', handleJoystickMouseMove);
    document.addEventListener('mouseup', handleJoystickMouseUp);

    // Add keyboard accessibility (WASD/Arrow keys)
    document.addEventListener('keydown', handleJoystickKeyDown);
    document.addEventListener('keyup', handleJoystickKeyUp);

    // Add ARIA attributes for accessibility
    joystickBase.setAttribute('role', 'slider');
    joystickBase.setAttribute('aria-label', 'Driving controls - use WASD or arrow keys');
    joystickBase.setAttribute('aria-valuemin', '-1');
    joystickBase.setAttribute('aria-valuemax', '1');
    joystickBase.setAttribute('aria-valuenow', '0');
    joystickBase.setAttribute('tabindex', '0');

    isInitialized = true;
    console.log('Joystick initialized');
}

function handleJoystickTouchStart(event) {
    if (event.touches.length > 0) {
        event.preventDefault(); // Prevent scrolling
        joystickActive = true;
        updateJoystickPosition(event.touches[0]);
    }
}

function handleJoystickTouchMove(event) {
    if (event.touches.length > 0 && joystickActive) {
        event.preventDefault(); // Prevent scrolling
        updateJoystickPosition(event.touches[0]);
    }
}

function handleJoystickTouchEnd(event) {
    event.preventDefault();
    joystickActive = false;
    resetJoystickPosition();
}

function handleJoystickMouseDown(event) {
    event.preventDefault();
    joystickActive = true;
    updateJoystickPosition({ clientX: event.clientX, clientY: event.clientY });
}

function handleJoystickMouseMove(event) {
    if (joystickActive) {
        updateJoystickPosition({ clientX: event.clientX, clientY: event.clientY });
    }
}

function handleJoystickMouseUp(event) {
    joystickActive = false;
    resetJoystickPosition();
}

// Keyboard event handlers for accessibility
function handleJoystickKeyDown(event) {
    if (!joystickBase) return;

    const key = event.key.toLowerCase();
    let handled = false;

    switch (key) {
        case 'w':
        case 'arrowup':
            joystickInput.forward = 1;
            joystickInput.backward = 0;
            handled = true;
            break;
        case 's':
        case 'arrowdown':
            joystickInput.forward = 0;
            joystickInput.backward = 1;
            handled = true;
            break;
        case 'a':
        case 'arrowleft':
            joystickInput.left = 1;
            joystickInput.right = 0;
            handled = true;
            break;
        case 'd':
        case 'arrowright':
            joystickInput.left = 0;
            joystickInput.right = 1;
            handled = true;
            break;
    }

    if (handled) {
        event.preventDefault();
        joystickActive = true;
        updateJoystickAriaValues();
    }
}

function handleJoystickKeyUp(event) {
    if (!joystickBase) return;

    const key = event.key.toLowerCase();
    let handled = false;

    switch (key) {
        case 'w':
        case 'arrowup':
            joystickInput.forward = 0;
            handled = true;
            break;
        case 's':
        case 'arrowdown':
            joystickInput.backward = 0;
            handled = true;
            break;
        case 'a':
        case 'arrowleft':
            joystickInput.left = 0;
            handled = true;
            break;
        case 'd':
        case 'arrowright':
            joystickInput.right = 0;
            handled = true;
            break;
    }

    if (handled) {
        event.preventDefault();
        // Check if all inputs are released
        if (joystickInput.forward === 0 && joystickInput.backward === 0 &&
            joystickInput.left === 0 && joystickInput.right === 0) {
            joystickActive = false;
        }
        updateJoystickAriaValues();
    }
}

function updateJoystickAriaValues() {
    if (!joystickBase) return;

    // Calculate normalized values for ARIA
    const forwardBack = joystickInput.forward - joystickInput.backward;
    const leftRight = joystickInput.right - joystickInput.left;

    joystickBase.setAttribute('aria-valuenow', forwardBack.toFixed(2));
    joystickBase.setAttribute('aria-valuetext', `Forward/Back: ${forwardBack.toFixed(2)}, Left/Right: ${leftRight.toFixed(2)}`);
}

function updateJoystickPosition(touch) {
    if (!joystickBase || !joystickStick) return;

    // Get fresh center position in case joystick moved or page scrolled
    const baseRect = joystickBase.getBoundingClientRect();
    const joystickCenterX = baseRect.left + baseRect.width / 2;
    const joystickCenterY = baseRect.top + baseRect.height / 2;

    const touchX = touch.clientX;
    const touchY = touch.clientY;

    // Calculate distance from center
    const dx = touchX - joystickCenterX;
    const dy = touchY - joystickCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Limit position to joystick radius
    let limitedX = dx;
    let limitedY = dy;

    if (distance > joystickRadius) {
        limitedX = (dx / distance) * joystickRadius;
        limitedY = (dy / distance) * joystickRadius;
    }

    // Update stick position (relative to parent)
    // Center of base is at (joystickRadius, joystickRadius) in parent coordinates
    const stickX = joystickRadius + limitedX - joystickStickRadius;
    const stickY = joystickRadius + limitedY - joystickStickRadius;

    joystickStick.style.left = stickX + 'px';
    joystickStick.style.top = stickY + 'px';

    // Calculate input values (normalized)
    const normalizedX = limitedX / joystickRadius;
    const normalizedY = limitedY / joystickRadius;

    // Convert to game input (Y axis is inverted for forward/backward)
    joystickInput.forward = Math.max(0, -normalizedY);
    joystickInput.backward = Math.max(0, normalizedY);
    joystickInput.left = Math.max(0, -normalizedX);
    joystickInput.right = Math.max(0, normalizedX);

    // Debug output
    // console.log('Joystick:', { forward: joystickInput.forward, backward: joystickInput.backward, left: joystickInput.left, right: joystickInput.right });
}

function resetJoystickPosition() {
    if (!joystickStick) return;

    // Reset stick to center (relative to parent)
    joystickStick.style.left = (joystickRadius - joystickStickRadius) + 'px';
    joystickStick.style.top = (joystickRadius - joystickStickRadius) + 'px';

    // Reset input values
    joystickInput.forward = 0;
    joystickInput.backward = 0;
    joystickInput.left = 0;
    joystickInput.right = 0;

    // Reset ARIA values
    updateJoystickAriaValues();
}

// Get current joystick input state
export function getJoystickInput() {
    return joystickInput;
}

// Check if joystick is active
export function isJoystickActive() {
    return joystickActive;
}