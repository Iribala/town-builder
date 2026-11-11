/**
 * Scene initialization and management
 * Enhanced with r181 features:
 * - Environment mapping for realistic reflections on vehicles and buildings
 * - Improved PBR lighting with GGX VNDF importance sampling
 * - HDR environment with PMREM generator (r181 GGX VNDF)
 * - ACESFilmic tone mapping for better color and contrast
 */
import * as THREE from 'three';
import { getEnvMapTexture, setEnvMapTexture } from '../state/app-state.js';

// In the vanilla WebGL2 renderer, PMREM/prefiltered cubemaps are replaced by
// the shim's hemisphere ambient approximation; the whole env-map block below
// is skipped. Detected the same way as everywhere else: the page URL flag.
const IS_VANILLA_RENDERER = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('renderer') === 'webgl2';

/**
 * Create an HDR-capable environment map with PMREM prefiltering
 * Uses procedural gradient enhanced for HDR range
 * Leverages r181's improved PMREMGenerator with GGX VNDF importance sampling
 * @param {THREE.WebGLRenderer} renderer - WebGL renderer for PMREM generation
 * @returns {THREE.Texture} Prefiltered environment texture
 */
function createHDREnvironmentMap(renderer) {
    const size = 512; // Higher res for better quality with PMREM
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Create HDR-style gradient for sky with higher intensity values
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#FFFFFF');     // Bright sky at zenith
    gradient.addColorStop(0.3, '#B3E5FC');   // Light sky blue
    gradient.addColorStop(0.6, '#87CEEB');   // Sky blue
    gradient.addColorStop(0.85, '#D4E8F5');  // Horizon glow
    gradient.addColorStop(1, '#F0F8FF');     // Alice blue at horizon

    const images = [];

    // Generate 6 faces with enhanced HDR-like appearance
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        // Add face-specific lighting
        if (i === 2) { // Top face (py) - brightest with sun hint
            // Add radial gradient for sun effect
            const sunGradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            sunGradient.addColorStop(0, 'rgba(255, 255, 240, 0.4)');
            sunGradient.addColorStop(0.3, 'rgba(255, 255, 220, 0.2)');
            sunGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sunGradient;
            ctx.fillRect(0, 0, size, size);
        } else if (i === 3) { // Bottom face (ny) - ground color reflection
            ctx.fillStyle = 'rgba(46, 139, 87, 0.3)';
            ctx.fillRect(0, 0, size, size);
        } else {
            // Side faces - add horizon brightness
            const horizonGradient = ctx.createLinearGradient(0, size * 0.7, 0, size);
            horizonGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            horizonGradient.addColorStop(1, 'rgba(255, 250, 230, 0.15)');
            ctx.fillStyle = horizonGradient;
            ctx.fillRect(0, 0, size, size);
        }

        images.push(canvas.toDataURL());
    }

    // Create cube texture from images
    const cubeTexture = new THREE.CubeTexture();
    cubeTexture.colorSpace = THREE.SRGBColorSpace; // Proper color space
    const loader = new THREE.ImageLoader();

    let loadedCount = 0;
    const loadPromise = new Promise((resolve) => {
        images.forEach((dataUrl, index) => {
            loader.load(dataUrl, (image) => {
                cubeTexture.images[index] = image;
                loadedCount++;
                if (loadedCount === 6) {
                    cubeTexture.needsUpdate = true;
                    resolve(cubeTexture);
                }
            });
        });
    });

    // Use PMREMGenerator for prefiltered environment map
    // This uses r181's improved GGX VNDF importance sampling
    loadPromise.then(() => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();

        const envTexture = pmremGenerator.fromCubemap(cubeTexture).texture;

        // Clean up temporary resources
        pmremGenerator.dispose();
        cubeTexture.dispose();

        // Store the prefiltered texture
        setEnvMapTexture(envTexture);
    });

    return cubeTexture;
}

/**
 * Initialize the Three.js scene with camera, renderer, lights, and ground
 * Enhanced with HDR workflow and tone mapping
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
    // three.js clears to black unless told otherwise, the shim hardcodes
    // the same color — set it explicitly so both paths agree.
    renderer.setClearColor(0x87ceeb, 1);

    // Enable HDR tone mapping (r180+ feature)
    // ACESFilmic provides film-like color and better highlight handling
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0; // Standard exposure

    container.appendChild(renderer.domElement);
    // Main canvas is the app's primary visual: announce as an image with a name
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '3D view of the town');

    // Add HDR environment map with PMREM prefiltering (enhanced in r181).
    // Skipped in vanilla mode: the shim's hemisphere ambient stands in for it.
    if (!IS_VANILLA_RENDERER) {
        const envMap = createHDREnvironmentMap(renderer);
        scene.environment = envMap;

        // After environment loads, replace with prefiltered version
        setTimeout(() => {
            const envMapTexture = getEnvMapTexture();
            if (envMapTexture) {
                scene.environment = envMapTexture;
            }
        }, 100);
    }

    // Create background
    const backgroundGeometry = new THREE.PlaneGeometry(20, 20);
    const backgroundMaterial = new THREE.MeshBasicMaterial({ color: 0x87CEEB }); // Sky blue
    const backgroundMesh = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    backgroundMesh.rotation.x = -Math.PI / 2;
    scene.add(backgroundMesh);

    // Add ground plane with enhanced material properties
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

    // Add lights with enhanced settings for better PBR
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
 * @param {THREE.Camera} camera - Three.js camera
 * @param {THREE.WebGLRenderer} renderer - Three.js renderer
 */
export function onWindowResize(camera, renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Setup window resize listener
 * @param {THREE.Camera} camera - Three.js camera
 * @param {THREE.WebGLRenderer} renderer - Three.js renderer
 */
export function setupResizeListener(camera, renderer) {
    window.addEventListener('resize', () => onWindowResize(camera, renderer));
}

/**
 * Dispose environment map texture to prevent memory leaks
 * Call this when tearing down the scene
 */
export function disposeEnvironmentMap() {
    const texture = getEnvMapTexture();
    if (texture) {
        texture.dispose();
        setEnvMapTexture(null);
    }
}
