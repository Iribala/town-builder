/**
 * Scene initialization and management
 * The vanilla WebGL2 renderer has no PMREM/prefiltered cubemap path — the
 * shim's hemisphere ambient stands in for image-based lighting.
 * - ACESFilmic tone mapping for better color and contrast
 */
import * as THREE from '../webgl2/three-shim.js';

/**
 * Initialize the scene with camera, renderer, lights, and ground
 * ACESFilmic tone mapping for better color and contrast
 * @param {HTMLElement} container - Container element for the canvas
 * @returns {Object} Scene components
 */
export function initScene(container) {
    // Create scene
    const scene = new THREE.Scene();

    // Create camera
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);

    // Create renderer with HDR support
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x for performance
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Match the sky color picker's default (#skyColorPicker value=#87ceeb);
    // the shim hardcodes the same color — set it explicitly so the value
    // is deliberate, not incidental.
    renderer.setClearColor(0x87ceeb, 1);

    // ACESFilmic provides film-like color and better highlight handling
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0; // Standard exposure

    container.appendChild(renderer.domElement);
    // Main canvas is the app's primary visual: announce as an image with a name
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '3D view of the town');

    // Create background
    const backgroundGeometry = new THREE.PlaneGeometry(20, 20);
    const backgroundMaterial = new THREE.MeshBasicMaterial({ color: 0x87CEEB }); // Sky blue
    const backgroundMesh = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    backgroundMesh.rotation.x = -Math.PI / 2;
    scene.add(backgroundMesh);

    // Add ground plane
    const planeGeometry = new THREE.PlaneGeometry(20, 20);
    const planeMaterial = new THREE.MeshStandardMaterial({
        color: 0x2E8B57, // Dark green
        roughness: 0.8,  // Slightly rough for grass/ground
        metalness: 0.0,  // Not metallic
        envMapIntensity: 0.3 // Subtle environment reflections
    });
    const groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    scene.add(groundPlane);

    // Real-place context grid: immutable backdrop reference for the ground
    // plane (existing/proposed layer distinction lives on top of this).
    const groundGrid = new THREE.GridHelper(20, 20, 0x1f5f3f, 0x3a8c5a);
    groundGrid.position.y = 0.01;
    scene.add(groundGrid);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Slightly brighter ambient
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2); // Brighter directional
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = false; // Shadows disabled for performance
    scene.add(directionalLight);

    return {
        scene,
        camera,
        renderer,
        groundPlane
    };
}

/**
 * Handle window resize events
 * @param {THREE.Camera} camera - Scene camera
 * @param {THREE.WebGLRenderer} renderer - Scene renderer
 */
export function onWindowResize(camera, renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Setup window resize listener
 * @param {THREE.Camera} camera - Scene camera
 * @param {THREE.WebGLRenderer} renderer - Scene renderer
 */
export function setupResizeListener(camera, renderer) {
    window.addEventListener('resize', () => onWindowResize(camera, renderer));
}

