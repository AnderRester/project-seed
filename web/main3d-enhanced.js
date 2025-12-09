// main3d-enhanced.js - Улучшенная версия с шейдерами, травой, облаками и UI песочницей
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import init, { SeedWorld } from "./pkg/seed_wasm.js";
import { SandboxUI } from "./sandbox-ui.js";
import { startHostLink } from "./remote_link.js";
import {
    waterVertexShader,
    waterFragmentShader,
    grassVertexShader,
    grassFragmentShader,
    cloudVertexShader,
    cloudFragmentShader,
} from "./shaders.js";

// Global variables
let scene, camera, renderer, controls, fpControls;
let terrainMesh, waterMesh, grassSystem, cloudSystem;
let world, worldConfig;
let sandboxUI;
let clock = new THREE.Clock();

// World data
let heightData, rgbaData, mapSize;

// FPS mode state
let currentMode = "orbit"; // 'orbit' or 'fps'
let moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
};
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
const WALK_SPEED = 200;
const SPRINT_SPEED = 400;
const JUMP_VELOCITY = 300;
let verticalVelocity = 0;
const GRAVITY = -800;
let isGrounded = false;
let isSprinting = false;

// Streaming
let wsHost = null;
let remoteOrientation = null;

// Multiplayer via Rust seed-server
let worldWs = null;
let worldClientId = null;
const otherPlayers = new Map(); // id -> THREE.Object3D

async function init3DViewer() {
    // Load WASM
    await init();

    // Load config
    const response = await fetch("./world-config.json");
    worldConfig = await response.json();

    // Setup scene
    scene = new THREE.Scene();
    updateSceneAtmosphere();

    // Setup camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 50000);
    camera.position.set(0, 2000, 4000);

    // Setup renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Setup controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 20000; // Увеличен для большого мира
    controls.minDistance = 20;
    controls.target.set(0, 0, 0);
    controls.update();

    // Setup FPS controls
    fpControls = new PointerLockControls(camera, renderer.domElement);
    scene.add(fpControls.getObject());

    // Setup lighting
    setupLighting();

    // Generate initial world
    await generateWorld();

    // Create sandbox UI
    sandboxUI = new SandboxUI(
        () => generateWorld(),
        (paramName, value) => handleParamChange(paramName, value)
    );

    // Sync UI with config
    syncUIWithConfig();

    // Event handlers
    window.addEventListener("resize", onWindowResize);
    setupKeyboardControls();
    setupModeSwitch();

    // Connect to authoritative Rust server for multiplayer state
    setupWorldServerConnection();

    // Old Node.js-based streaming/remote_link integration отключен.

    // Start animation
    animate();

    console.log("3D Viewer initialized successfully");
}

function updateSceneAtmosphere() {
    const atmo = worldConfig.environment?.atmosphere || {};

    // Sky color based on temperature and scattering
    const temp = atmo.baseTemperatureC || 20;
    const scattering = atmo.scatteringIntensity || 0.3;

    let skyHue = 0.55; // Blue
    if (temp > 30) skyHue = 0.5; // Warmer sky
    if (temp < 10) skyHue = 0.58; // Colder, more blue

    const skyColor = new THREE.Color().setHSL(skyHue, 0.6, 0.7);
    const fogColor = new THREE.Color().setHSL(skyHue, 0.4, 0.6);

    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(fogColor, 0.00015 * (1 + scattering * 0.5));
}

function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Hemisphere light for sky/ground
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x545454, 0.4);
    scene.add(hemiLight);

    // Directional sun light
    const sunLight = new THREE.DirectionalLight(0xffffed, 1.2);
    sunLight.position.set(1000, 1500, 500);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 500;
    sunLight.shadow.camera.far = 4000;
    sunLight.shadow.camera.left = -1500;
    sunLight.shadow.camera.right = 1500;
    sunLight.shadow.camera.top = 1500;
    sunLight.shadow.camera.bottom = -1500;
    scene.add(sunLight);

    // Store for animation
    scene.userData.sunLight = sunLight;
}

async function generateWorld() {
    console.log("Generating world...");

    // Clear previous meshes
    if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh.material.dispose();
    }
    if (waterMesh) {
        scene.remove(waterMesh);
        waterMesh.geometry.dispose();
        waterMesh.material.dispose();
    }
    if (grassSystem) {
        scene.remove(grassSystem);
        grassSystem.geometry.dispose();
        grassSystem.material.dispose();
    }
    if (cloudSystem) {
        scene.remove(cloudSystem);
        cloudSystem.geometry.dispose();
        cloudSystem.material.dispose();
    }

    // Update config from UI
    const params = sandboxUI?.getParams() || {};
    worldConfig.seaLevel = params.seaLevel || 0.11;
    worldConfig.geology.heightmap.continentalScaleKm = params.continentalScale || 4000;
    worldConfig.geology.heightmap.mountainAmplitudeMeters = params.mountainHeight || 4000;
    worldConfig.worldSeed = params.worldSeed || 256454;
    worldConfig.environment.atmosphere.baseTemperatureC = params.temperature || 25;
    worldConfig.environment.atmosphere.humidityGlobalMean = params.humidity || 0.5;

    const configJson = JSON.stringify(worldConfig);

    // Generate world
    mapSize = params.mapResolution || 1024; // Увеличено для детализации
    world = new SeedWorld(configJson, mapSize, mapSize);

    heightData = world.heightmap_values();
    rgbaData = world.worldview_rgba();

    // Create terrain
    terrainMesh = createTerrainMesh();
    scene.add(terrainMesh);

    // Create water
    waterMesh = createWaterMesh();
    scene.add(waterMesh);

    // Create grass
    grassSystem = createGrassSystem();
    scene.add(grassSystem);

    // Create clouds
    cloudSystem = createCloudSystem();
    scene.add(cloudSystem);

    // Update atmosphere
    updateSceneAtmosphere();

    console.log("World generated successfully");
}

function createTerrainMesh() {
    const terrainScale = 12000; // Увеличен в 4 раза для континента
    const heightScale = 1200; // Увеличена высота для масштабности

    const geometry = new THREE.PlaneGeometry(terrainScale, terrainScale, mapSize - 1, mapSize - 1);

    const vertices = geometry.attributes.position.array;
    const colors = new Float32Array(vertices.length);

    for (let i = 0; i < mapSize; i++) {
        for (let j = 0; j < mapSize; j++) {
            const idx = i * mapSize + j;
            const vertIdx = idx * 3;

            // Height
            vertices[vertIdx + 2] = heightData[idx] * heightScale;

            // Color from RGBA
            const rgbaIdx = idx * 4;
            colors[vertIdx] = rgbaData[rgbaIdx] / 255;
            colors[vertIdx + 1] = rgbaData[rgbaIdx + 1] / 255;
            colors[vertIdx + 2] = rgbaData[rgbaIdx + 2] / 255;
        }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = true;

    return mesh;
}

function createWaterMesh() {
    const params = sandboxUI?.getParams() || {};
    const terrainScale = 12500; // Соответствует новому масштабу terrain

    const geometry = new THREE.PlaneGeometry(terrainScale, terrainScale, 128, 128);

    const material = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms: {
            time: { value: 0 },
            waveHeight: { value: params.waterWaveHeight || 2.0 },
            waveFrequency: { value: 0.04 },
            waterColor: { value: new THREE.Color(0x1e90ff) },
            deepWaterColor: { value: new THREE.Color(0x001a4d) },
            opacity: { value: params.waterOpacity || 0.7 },
            sunDirection: { value: new THREE.Vector3(1, 1, 0.5).normalize() },
            cameraPos: { value: camera.position },
        },
        transparent: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = (worldConfig.seaLevel || 0.11) * 1200 - 50; // Обновлено под новый heightScale

    return mesh;
}

function createGrassSystem() {
    const params = sandboxUI?.getParams() || {};
    const density = params.grassDensity || 0.3;

    if (density < 0.05) return new THREE.Group(); // Skip if too low

    const grassCount = Math.floor(mapSize * mapSize * density * 0.08);
    const grassGeometry = new THREE.PlaneGeometry(3, 12, 1, 5);

    const offsets = [];
    const scales = [];
    const phases = [];
    const grassTypes = [];

    const terrainScale = 12000; // Обновлено
    const heightScale = 1200; // Обновлено

    for (let i = 0; i < grassCount; i++) {
        const x = (Math.random() - 0.5) * terrainScale;
        const z = (Math.random() - 0.5) * terrainScale;

        // Sample height
        const u = (x / terrainScale + 0.5) * (mapSize - 1);
        const v = (z / terrainScale + 0.5) * (mapSize - 1);
        const iu = Math.floor(u);
        const iv = Math.floor(v);
        const heightIdx = iv * mapSize + iu;

        if (heightIdx >= 0 && heightIdx < heightData.length) {
            const y = heightData[heightIdx] * heightScale;

            // Grass only above water
            if (y > (worldConfig.seaLevel || 0.11) * heightScale + 10) {
                offsets.push(x, y, z);
                scales.push(0.7 + Math.random() * 0.6);
                phases.push(Math.random() * Math.PI * 2);
                grassTypes.push(Math.random() > 0.7 ? 1.0 : 0.0);
            }
        }
    }

    const instancedGeometry = new THREE.InstancedBufferGeometry().copy(grassGeometry);
    instancedGeometry.instanceCount = offsets.length / 3;

    instancedGeometry.setAttribute("offset", new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    instancedGeometry.setAttribute("scale", new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
    instancedGeometry.setAttribute("phase", new THREE.InstancedBufferAttribute(new Float32Array(phases), 1));
    instancedGeometry.setAttribute("grassType", new THREE.InstancedBufferAttribute(new Float32Array(grassTypes), 1));

    const windPattern = worldConfig.environment?.climate?.windGlobalPattern || "westerlies";
    let windDir = new THREE.Vector3(1, 0, 0);
    if (windPattern === "trade-winds") windDir.set(1, 0, -0.5).normalize();
    if (windPattern === "polar-easterlies") windDir.set(-1, 0, 0.3).normalize();

    const material = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader,
        fragmentShader: grassFragmentShader,
        uniforms: {
            time: { value: 0 },
            windStrength: { value: 0.8 },
            windDirection: { value: windDir },
        },
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(instancedGeometry, material);
    return mesh;
}

function createCloudSystem() {
    const params = sandboxUI?.getParams() || {};
    const density = params.cloudDensity || 0.5;

    if (density < 0.05) return new THREE.Group(); // Skip if too low

    const cloudCount = Math.floor(30 * density);
    const cloudGeometry = new THREE.PlaneGeometry(250, 150);

    const offsets = [];
    const scales = [];
    const phases = [];

    for (let i = 0; i < cloudCount; i++) {
        const x = (Math.random() - 0.5) * 4000;
        const y = 700 + Math.random() * 300;
        const z = (Math.random() - 0.5) * 4000;

        offsets.push(x, y, z);
        scales.push(0.8 + Math.random() * 1.2);
        phases.push(Math.random() * Math.PI * 2);
    }

    const instancedGeometry = new THREE.InstancedBufferGeometry().copy(cloudGeometry);
    instancedGeometry.instanceCount = offsets.length / 3;

    instancedGeometry.setAttribute("offset", new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    instancedGeometry.setAttribute("scale", new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
    instancedGeometry.setAttribute("phase", new THREE.InstancedBufferAttribute(new Float32Array(phases), 1));

    const windPattern = worldConfig.environment?.climate?.windGlobalPattern || "westerlies";
    let windDir = new THREE.Vector3(1, 0, 0);
    if (windPattern === "trade-winds") windDir.set(1, 0, -0.5).normalize();

    const material = new THREE.ShaderMaterial({
        vertexShader: cloudVertexShader,
        fragmentShader: cloudFragmentShader,
        uniforms: {
            time: { value: 0 },
            density: { value: density },
            sunDirection: { value: scene.userData.sunLight.position.clone().normalize() },
            windDirection: { value: windDir },
            windSpeed: { value: 15.0 },
        },
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(instancedGeometry, material);
    return mesh;
}

function handleParamChange(paramName, value) {
    // Immediate visual updates (no regeneration needed)
    if (paramName === "cloudDensity" && cloudSystem && cloudSystem.material.uniforms) {
        cloudSystem.material.uniforms.density.value = value;
    }

    if (paramName === "waterWaveHeight" && waterMesh && waterMesh.material.uniforms) {
        waterMesh.material.uniforms.waveHeight.value = value;
    }

    if (paramName === "waterOpacity" && waterMesh && waterMesh.material.uniforms) {
        waterMesh.material.uniforms.opacity.value = value;
    }

    if (paramName === "triggerCatastrophe") {
        console.log(`Catastrophe triggered: ${value}`);
        triggerCatastrophe(value);
    }
}

function triggerCatastrophe(type) {
    if (!terrainMesh || !terrainMesh.geometry) {
        console.warn("[Catastrophe] No terrain mesh available");
        return;
    }

    const positions = terrainMesh.geometry.attributes.position.array;
    const vertexCount = positions.length / 3;

    // Random epicenter
    const epicenterX = Math.random() * 2 - 1;
    const epicenterZ = Math.random() * 2 - 1;

    console.log(`[Catastrophe] ${type} at (${epicenterX.toFixed(2)}, ${epicenterZ.toFixed(2)})`);

    switch (type) {
        case "earthquake":
            // Deform terrain in waves from epicenter
            for (let i = 0; i < vertexCount; i++) {
                const x = positions[i * 3];
                const z = positions[i * 3 + 2];

                const dx = x - epicenterX * 50000;
                const dz = z - epicenterZ * 50000;
                const dist = Math.sqrt(dx * dx + dz * dz);

                // Wave effect with distance falloff
                const wave = Math.sin(dist * 0.0002) * 200;
                const falloff = Math.exp(-dist * 0.00005);

                positions[i * 3 + 1] += wave * falloff;
            }
            console.log("[Catastrophe] Earthquake waves applied");
            break;

        case "volcano":
            // Create volcanic cone at epicenter
            for (let i = 0; i < vertexCount; i++) {
                const x = positions[i * 3];
                const z = positions[i * 3 + 2];

                const dx = x - epicenterX * 50000;
                const dz = z - epicenterZ * 50000;
                const dist = Math.sqrt(dx * dx + dz * dz);

                // Cone shape
                const maxRadius = 5000;
                if (dist < maxRadius) {
                    const height = (1 - dist / maxRadius) * 3000;
                    positions[i * 3 + 1] += height;
                }
            }
            console.log("[Catastrophe] Volcano created");
            break;

        case "meteor":
            // Create impact crater
            for (let i = 0; i < vertexCount; i++) {
                const x = positions[i * 3];
                const z = positions[i * 3 + 2];

                const dx = x - epicenterX * 50000;
                const dz = z - epicenterZ * 50000;
                const dist = Math.sqrt(dx * dx + dz * dz);

                // Crater with raised rim
                const craterRadius = 3000;
                const rimRadius = 5000;

                if (dist < craterRadius) {
                    // Inner crater depression
                    const depth = (1 - dist / craterRadius) * -1500;
                    positions[i * 3 + 1] += depth;
                } else if (dist < rimRadius) {
                    // Raised rim
                    const rimHeight = (1 - (dist - craterRadius) / (rimRadius - craterRadius)) * 800;
                    positions[i * 3 + 1] += rimHeight;
                }
            }
            console.log("[Catastrophe] Meteor crater formed");
            break;
    }

    // Update geometry
    terrainMesh.geometry.attributes.position.needsUpdate = true;
    terrainMesh.geometry.computeVertexNormals();

    // Visual feedback
    const message = {
        earthquake: "💥 Earthquake! Terrain trembles and shifts",
        volcano: "🌋 Volcanic eruption! New mountain formed",
        meteor: "☄️ Meteor impact! Massive crater created",
    };

    console.log(`[Catastrophe] ${message[type]}`);
}

function syncUIWithConfig() {
    if (!sandboxUI) return;

    sandboxUI.updateParam("seaLevel", worldConfig.seaLevel || 0.11);
    sandboxUI.updateParam("continentalScale", worldConfig.geology?.heightmap?.continentalScaleKm || 4000);
    sandboxUI.updateParam("mountainHeight", worldConfig.geology?.heightmap?.mountainAmplitudeMeters || 4000);
    sandboxUI.updateParam("temperature", worldConfig.environment?.atmosphere?.baseTemperatureC || 25);
    sandboxUI.updateParam("humidity", worldConfig.environment?.atmosphere?.humidityGlobalMean || 0.5);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    const timeScale = sandboxUI?.getParams().timeScale || 1.0;
    const scaledTime = elapsed * timeScale;

    // Update water animation
    if (waterMesh && waterMesh.material.uniforms) {
        waterMesh.material.uniforms.time.value = scaledTime;
        waterMesh.material.uniforms.cameraPos.value.copy(camera.position);
    }

    // Update grass animation
    if (grassSystem && grassSystem.material.uniforms) {
        grassSystem.material.uniforms.time.value = scaledTime;
    }

    // Update clouds animation
    if (cloudSystem && cloudSystem.material.uniforms) {
        cloudSystem.material.uniforms.time.value = scaledTime * 0.5;
    }

    // Update sun position (day/night cycle - very slow)
    if (scene.userData.sunLight) {
        const sunAngle = scaledTime * 0.05;
        const radius = 2000;
        scene.userData.sunLight.position.set(
            Math.cos(sunAngle) * radius,
            Math.max(Math.sin(sunAngle) * radius, 100),
            500
        );

        if (cloudSystem && cloudSystem.material.uniforms) {
            cloudSystem.material.uniforms.sunDirection.value.copy(scene.userData.sunLight.position.clone().normalize());
        }

        if (waterMesh && waterMesh.material.uniforms) {
            waterMesh.material.uniforms.sunDirection.value.copy(scene.userData.sunLight.position.clone().normalize());
        }
    }

    // Update FPS movement
    if (currentMode === "fps" && fpControls.isLocked) {
        updateFPSMovement(delta);
    }

    // Update other players' avatars if any
    updateOtherPlayers(delta);

    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== FPS CONTROLS ==========
function setupKeyboardControls() {
    window.addEventListener("keydown", (e) => {
        if (currentMode !== "fps" || !fpControls.isLocked) return;

        switch (e.code) {
            case "KeyW":
            case "ArrowUp":
                moveState.forward = true;
                break;
            case "KeyS":
            case "ArrowDown":
                moveState.backward = true;
                break;
            case "KeyA":
            case "ArrowLeft":
                moveState.left = true;
                break;
            case "KeyD":
            case "ArrowRight":
                moveState.right = true;
                break;
            case "Space":
                if (isGrounded) {
                    // Dynamic jump height from sandbox UI
                    const params = sandboxUI?.getParams() || {};
                    const jumpHeight = params.jumpHeight || 5.0;
                    verticalVelocity = jumpHeight * 60; // Convert to velocity
                    isGrounded = false;
                }
                break;
            case "ShiftLeft":
            case "ShiftRight":
                isSprinting = true;
                break;
        }
    });

    window.addEventListener("keyup", (e) => {
        if (currentMode !== "fps") return;

        switch (e.code) {
            case "KeyW":
            case "ArrowUp":
                moveState.forward = false;
                break;
            case "KeyS":
            case "ArrowDown":
                moveState.backward = false;
                break;
            case "KeyA":
            case "ArrowLeft":
                moveState.left = false;
                break;
            case "KeyD":
            case "ArrowRight":
                moveState.right = false;
                break;
            case "ShiftLeft":
            case "ShiftRight":
                isSprinting = false;
                break;
        }
    });
}

function setupModeSwitch() {
    // ESC для выхода из FPS
    fpControls.addEventListener("unlock", () => {
        if (currentMode === "fps") {
            switchToOrbit();
        }
    });

    // Numpad для переключения режимов
    window.addEventListener("keydown", (e) => {
        if (e.code === "Numpad0") {
            e.preventDefault();
            switchToOrbit();
        } else if (e.code === "Numpad1") {
            e.preventDefault();
            switchToFPS();
        }
    });

    console.log("[Controls] Mode switch: Numpad0=Orbit, Numpad1=FPS");
}

function switchToFPS() {
    currentMode = "fps";
    controls.enabled = false;
    fpControls.lock();

    // Позиционируем камеру на земле
    const startHeight = 200;
    camera.position.y = startHeight;

    console.log("Switched to FPS mode");
}

function switchToOrbit() {
    currentMode = "orbit";
    fpControls.unlock();
    controls.enabled = true;

    // Reset movement
    moveState = { forward: false, backward: false, left: false, right: false };
    verticalVelocity = 0;

    console.log("Switched to Orbit mode");
}

function updateFPSMovement(delta) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    // Get dynamic parameters from sandbox UI
    const params = sandboxUI?.getParams() || {};
    const baseSpeed = params.moveSpeed || 20.0;
    const sprintMult = params.sprintMultiplier || 2.0;
    const jumpHeight = params.jumpHeight || 5.0;
    const gravity = params.gravity || 9.8;

    // Convert to Three.js units (multiply by scale factor)
    const speedScale = 10;
    const speed = isSprinting ? baseSpeed * sprintMult * speedScale : baseSpeed * speedScale;

    if (moveState.forward || moveState.backward) velocity.z -= direction.z * speed * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * speed * delta;

    // Dynamic gravity
    verticalVelocity += -gravity * 100 * delta;

    const obj = fpControls.getObject();
    obj.position.y += verticalVelocity * delta;

    // Ground collision
    const groundHeight = sampleHeightAt(obj.position.x, obj.position.z) + 10; // EYE_HEIGHT
    if (obj.position.y <= groundHeight) {
        obj.position.y = groundHeight;
        verticalVelocity = 0;
        isGrounded = true;
    } else {
        isGrounded = false;
    }

    fpControls.moveRight(-velocity.x * delta);
    fpControls.moveForward(-velocity.z * delta);

    // Sync our movement intent to Rust server
    sendOwnInputToWorldServer(delta);
}

function sampleHeightAt(worldX, worldZ) {
    if (!heightData || !mapSize) return 0;

    const terrainScale = 12000;
    const heightScale = 1200;

    const u = (worldX / terrainScale + 0.5) * (mapSize - 1);
    const v = (worldZ / terrainScale + 0.5) * (mapSize - 1);

    if (u < 0 || v < 0 || u >= mapSize || v >= mapSize) return 0;

    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, mapSize - 1);
    const z1 = Math.min(z0 + 1, mapSize - 1);

    const fx = u - x0;
    const fz = v - z0;

    const i00 = z0 * mapSize + x0;
    const i10 = z0 * mapSize + x1;
    const i01 = z1 * mapSize + x0;
    const i11 = z1 * mapSize + x1;

    const h00 = heightData[i00] || 0;
    const h10 = heightData[i10] || 0;
    const h01 = heightData[i01] || 0;
    const h11 = heightData[i11] || 0;

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    const hNorm = h0 * (1 - fz) + h1 * fz;

    return hNorm * heightScale;
}

// ========== WORLD SERVER (Rust seed-server) INTEGRATION ==========

function setupWorldServerConnection() {
    if (worldWs && worldWs.readyState === WebSocket.OPEN) {
        console.log("[WorldServer] Already connected");
        return;
    }

    worldClientId = `pc-${Math.random().toString(36).slice(2, 8)}`;
    console.log("[WorldServer] Connecting as", worldClientId);

    worldWs = new WebSocket("ws://localhost:9000/ws");

    worldWs.onopen = () => {
        console.log("[WorldServer] Connected, sending join");
        const joinMsg = {
            type: "join",
            client_id: worldClientId,
            role: "pc",
        };
        worldWs.send(JSON.stringify(joinMsg));
    };

    worldWs.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "joined") {
                console.log("[WorldServer] Joined acknowledged as", msg.client_id, "role", msg.role);
            } else if (msg.type === "world_snapshot") {
                handleWorldSnapshot(msg);
            } else if (msg.type === "error") {
                console.warn("[WorldServer] Error:", msg.message);
            }
        } catch (e) {
            console.warn("[WorldServer] Failed to parse message:", e, event.data);
        }
    };

    worldWs.onerror = (err) => {
        console.error("[WorldServer] WebSocket error", err);
    };

    worldWs.onclose = () => {
        console.warn("[WorldServer] Disconnected, will retry in 3s");
        worldWs = null;
        setTimeout(setupWorldServerConnection, 3000);
    };
}

function sendOwnInputToWorldServer(delta) {
    if (!worldWs || worldWs.readyState !== WebSocket.OPEN || !worldClientId) return;

    // Отправляем намерение движения (WASD) как дельты, сервер накапливает позицию
    const move = {
        x: (Number(moveState.right) - Number(moveState.left)) * delta,
        z: (Number(moveState.forward) - Number(moveState.backward)) * delta,
    };

    if (move.x === 0 && move.z === 0) return;

    const msg = {
        type: "input",
        client_id: worldClientId,
        dx: move.x * 1000,
        dy: 0,
        dz: move.z * 1000,
    };

    try {
        worldWs.send(JSON.stringify(msg));
    } catch (e) {
        console.warn("[WorldServer] Failed to send input:", e);
    }
}

function handleWorldSnapshot(snapshot) {
    if (!snapshot.players) return;

    // Обновляем/создаём аватары для всех игроков, кроме нас
    const seenIds = new Set();

    for (const p of snapshot.players) {
        if (!p.id || p.id === worldClientId) continue;
        seenIds.add(p.id);

        let obj = otherPlayers.get(p.id);
        if (!obj) {
            const geom = new THREE.BoxGeometry(40, 80, 40);
            const mat = new THREE.MeshStandardMaterial({ color: p.role === "vr" ? 0xff8800 : 0x00aaff });
            obj = new THREE.Mesh(geom, mat);
            obj.castShadow = true;
            obj.receiveShadow = true;
            scene.add(obj);
            otherPlayers.set(p.id, obj);
        }

        obj.position.set(p.x, p.y, p.z);

        if (p.head_pos && p.head_quat) {
            // Если это VR-клиент, используем head_pose
            obj.position.set(p.head_pos[0], p.head_pos[1], p.head_pos[2]);
            const q = new THREE.Quaternion(p.head_quat[0], p.head_quat[1], p.head_quat[2], p.head_quat[3]);
            obj.quaternion.copy(q);
        }
    }

    // Удаляем аватары, которых больше нет в снапшоте
    for (const [id, obj] of otherPlayers.entries()) {
        if (!seenIds.has(id)) {
            scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            otherPlayers.delete(id);
        }
    }
}

function updateOtherPlayers(_delta) {
    // Пока ничего сложного не делаем — позиции приходят напрямую из снапшотов
}

// ========== STREAMING ==========
let roomInfoPanel = null;

function createRoomInfoPanel() {
    const panel = document.createElement("div");
    panel.id = "roomInfoPanel";
    panel.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 280px;
        background: linear-gradient(135deg, rgba(20, 25, 35, 0.95), rgba(30, 35, 45, 0.95));
        backdrop-filter: blur(10px);
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        color: #e0e0e0;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        z-index: 50;
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    panel.innerHTML = `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 12px; color: #888; margin-bottom: 5px;">🎮 Room Code</div>
            <div id="roomCode" style="font-size: 28px; font-weight: 700; letter-spacing: 3px; color: #00d4ff; text-shadow: 0 0 10px rgba(0,212,255,0.5);">
                ----
            </div>
        </div>
        <div>
            <div style="font-size: 12px; color: #888; margin-bottom: 8px;">👥 Connected Players</div>
            <div id="playerCount" style="font-size: 20px; font-weight: 600; color: #4CAF50;">
                0
            </div>
            <div id="playerList" style="margin-top: 10px; font-size: 12px; color: #aaa; max-height: 150px; overflow-y: auto;">
            </div>
        </div>
    `;

    document.body.appendChild(panel);
    return panel;
}

function updateRoomInfo(roomCode, playerCount) {
    if (!roomInfoPanel) {
        roomInfoPanel = createRoomInfoPanel();
    }

    const roomCodeEl = document.getElementById("roomCode");
    const playerCountEl = document.getElementById("playerCount");

    if (roomCode && roomCodeEl) {
        roomCodeEl.textContent = roomCode;
    }

    if (playerCountEl) {
        playerCountEl.textContent = playerCount || 0;
    }
}

// Track if we're currently transferring world data (global scope)
let isTransferringWorldData = false;

function setupStreaming() {
    console.log("[Streaming] setupStreaming called, wsHost=", wsHost);

    if (wsHost) {
        console.log("[Streaming] Already connected, skipping...");
        return;
    }

    console.log("[Streaming] Creating new host connection...");

    wsHost = startHostLink(
        () => {
            // getStateFn - return camera state
            return {
                mode: currentMode,
                pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                quat: {
                    x: camera.quaternion.x,
                    y: camera.quaternion.y,
                    z: camera.quaternion.z,
                    w: camera.quaternion.w,
                },
            };
        },
        (status) => {
            // onStatusChange
            console.log("[Streaming] Host status:", status);
            if (status === "disconnected") {
                if (isTransferringWorldData) {
                    console.error("[Main3D] ❌ Connection lost DURING world data transfer - DO NOT RECONNECT");
                    isTransferringWorldData = false;
                    wsHost = null;
                    return;
                }
                console.warn("[Main3D] WebSocket disconnected, attempting reconnect in 2s...");
                wsHost = null; // Reset reference
                // Reconnect after delay
                setTimeout(() => {
                    if (!wsHost) {
                        console.log("[Main3D] Reconnecting to streaming server...");
                        setupStreaming();
                    }
                }, 2000);
            }
        }
    );

    // Global callback for room created
    window.__seedOnRoomCreated = (roomCode) => {
        console.log("[Main3D] 🎮 Room created:", roomCode);
        updateRoomInfo(roomCode, 0);
    };

    // Global callback for player updates
    window.__seedOnPlayerUpdate = (msg) => {
        console.log("[Main3D] Player update:", msg);
        updateRoomInfo(wsHost.roomCode, msg.totalPlayers);
    };

    // Global callback for world sync requests
    window.__seedOnWorldSyncRequest = (playerId) => {
        console.log(`[Main3D] Client ${playerId} requested world sync`);
        if (heightData && wsHost) {
            sendWorldDataToPlayers();
        } else {
            console.warn("[Main3D] Cannot send world sync - data not ready");
        }
    };

    console.log("[Streaming] Host connection created, wsHost=", wsHost);

    // Send frames to clients at 30 FPS (skip when world data is in-flight or buffer is high)
    setInterval(() => {
        if (!window.__seedSendFrame || !renderer || !renderer.domElement) return;

        // Avoid pushing video frames while world data is transferring or socket is saturated
        if (isTransferringWorldData || window.__pauseFrameStreaming) return;

        const buffered = wsHost?.socket?.bufferedAmount || 0;
        if (buffered > 800 * 1024) {
            // Skip one frame to let buffer drain
            return;
        }

        renderer.domElement.toBlob(
            (blob) => {
                if (blob) {
                    window.__seedSendFrame(blob);
                }
            },
            "image/jpeg",
            0.75
        );
    }, 33); // ~30 FPS
}

function handleClientMessage(msg) {
    if (msg.type === "orientation" && msg.payload) {
        // Обработка ориентации от мобильного клиента
        remoteOrientation = msg.payload;
    }

    // Update movement from mobile controls
    if (msg.movement && currentMode === "fps") {
        moveState.forward = msg.movement.forward || false;
        moveState.backward = msg.movement.backward || false;
        moveState.left = msg.movement.left || false;
        moveState.right = msg.movement.right || false;

        if (msg.movement.jump && isGrounded) {
            verticalVelocity = JUMP_VELOCITY;
            isGrounded = false;
        }

        isSprinting = msg.movement.sprint || false;
    }
}

function sendFrameToClients() {
    if (!window.__seedSendFrame) return;

    renderer.domElement.toBlob(
        (blob) => {
            if (blob) {
                console.log(`[Streaming] Sending frame blob: ${blob.size} bytes`);
                window.__seedSendFrame(blob);
            } else {
                console.warn("[Streaming] toBlob returned null");
            }
        },
        "image/jpeg",
        0.75
    );
}

function sendWorldDataToPlayers() {
    if (!wsHost || !heightData) {
        console.warn("[Main3D] Cannot send world data: wsHost or heightData missing");
        return;
    }

    const worldSync = {
        type: "world_sync",
        mapSize: mapSize,
        heightData: Array.from(heightData),
        terrainScale: 12000,
        heightScale: 1200,
        worldConfig: worldConfig,
    };

    const payload = JSON.stringify(worldSync);
    console.log(`[Main3D] Sending world data: ${(payload.length / 1024).toFixed(2)} KB (full ${mapSize}x${mapSize})`);

    if (!wsHost.isConnected) {
        console.warn("[Main3D] ❌ Failed to send - connection not ready");
        return;
    }

    // Split into minimal number of chunks (large to reduce overhead, still under server limit)
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
    const chunks = [];
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        chunks.push(payload.substring(i, i + CHUNK_SIZE));
    }

    console.log(`[Main3D] Splitting into ${chunks.length} chunks (${(CHUNK_SIZE / 1024).toFixed(0)}KB each)...`);

    // Set flag to prevent reconnection during transfer
    isTransferringWorldData = true;
    window.__pauseStateUpdates = true; // Stop sending camera state during world transfer
    window.__pauseFrameStreaming = true; // Stop sending video frames during transfer to keep buffer low
    console.log("[Main3D] 🔒 Transfer started - reconnection disabled");

    // Send start message
    wsHost.send(
        JSON.stringify({
            type: "world_sync_start",
            totalChunks: chunks.length,
            totalSize: payload.length,
        })
    );

    // Send chunks quickly (no artificial pauses)
    let chunkIndex = 0;
    const sendNextChunk = () => {
        // Check if connection still alive
        if (!wsHost || !wsHost.isConnected) {
            console.error("[Main3D] ❌ Connection lost during chunk transfer");
            isTransferringWorldData = false;
            window.__pauseStateUpdates = false; // Resume camera state updates
            window.__pauseFrameStreaming = false; // Resume video frames
            return;
        }

        if (chunkIndex >= chunks.length) {
            // All chunks sent, now send end message
            wsHost.send(JSON.stringify({ type: "world_sync_end" }));
            // Keep socket warm right after transfer finishes
            try {
                wsHost.send(JSON.stringify({ type: "heartbeat" }));
            } catch (err) {
                console.warn("[Main3D] Post-transfer heartbeat failed:", err);
            }

            // Wait for buffer to flush before resuming normal operation
            const waitForBufferFlush = () => {
                if (!wsHost || !wsHost.isConnected || !wsHost.socket) {
                    console.warn("[Main3D] ⚠️ Connection lost during final flush");
                    isTransferringWorldData = false;
                    window.__pauseStateUpdates = false; // Resume camera state updates
                    window.__pauseFrameStreaming = false; // Resume video frames
                    return;
                }

                const bufferRemaining = wsHost.socket.bufferedAmount || 0;
                if (bufferRemaining > 10 * 1024) {
                    // More than 10KB remaining - wait for complete flush
                    console.log(
                        `[Main3D] ⏳ Waiting for buffer to flush: ${(bufferRemaining / 1024).toFixed(1)}KB remaining...`
                    );
                    setTimeout(waitForBufferFlush, 200);
                } else {
                    isTransferringWorldData = false;
                    window.__pauseStateUpdates = false; // Resume camera state updates
                    window.__pauseFrameStreaming = false; // Resume video frames
                    console.log(
                        `[Main3D] ✅ World data sent successfully - buffer flushed (${(bufferRemaining / 1024).toFixed(
                            1
                        )}KB remaining) - reconnection re-enabled`
                    );
                }
            };

            waitForBufferFlush();
            return;
        }

        const chunk = chunks[chunkIndex];

        // Send heartbeat periodically to keep connection alive during long transfer
        if (chunkIndex % 5 === 0 && chunkIndex > 0) {
            try {
                wsHost.send(JSON.stringify({ type: "heartbeat" }));
                console.log(`[Main3D] 💓 Heartbeat sent during transfer (chunk ${chunkIndex}/${chunks.length})`);
            } catch (err) {
                console.warn("[Main3D] Failed to send heartbeat:", err);
            }
        }

        try {
            wsHost.send(
                JSON.stringify({
                    type: "world_sync_chunk",
                    index: chunkIndex,
                    data: chunk,
                })
            );

            console.log(
                `[Main3D] Chunk ${chunkIndex + 1}/${chunks.length}: ${(chunk.length / 1024).toFixed(1)}KB sent`
            );
        } catch (err) {
            console.error(`[Main3D] ❌ Error sending chunk ${chunkIndex}:`, err);
            isTransferringWorldData = false;
            window.__pauseStateUpdates = false; // Resume camera state updates
            window.__pauseFrameStreaming = false; // Resume video frames
            return;
        }

        chunkIndex++;
        // Fast path, but back off if socket buffer grows too large to avoid 1005 closes
        const buffered = wsHost.socket?.bufferedAmount || 0;
        if (buffered > 8 * 1024 * 1024) {
            console.warn(
                `[Main3D] Buffer high (${(buffered / 1024 / 1024).toFixed(1)}MB) - brief backoff before next chunk`
            );
            setTimeout(sendNextChunk, 10);
        } else {
            setTimeout(sendNextChunk, 0);
        }
    };

    sendNextChunk();
} // Initialize
init3DViewer().catch(console.error);
