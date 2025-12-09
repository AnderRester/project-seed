// host.js - VR Streaming Host (simplified 3D viewer)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { startHostLink } from "./remote_link.js";

// ========== GLOBAL STATE ==========
let scene, camera, renderer, controls, fpControls, clock;
let terrainMesh, waterMesh, skyMesh;
let heightData, mapSize;
let worldConfig = null;

// Player state
let currentMode = "orbit"; // "orbit" or "fps"
let moveState = { forward: false, backward: false, left: false, right: false };
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let verticalVelocity = 0;
let isGrounded = false;
let isSprinting = false;

// Streaming
let wsHost = null;
let connectedPlayers = new Map();

// UI Elements
const statusEl = document.getElementById("status");
const roomCodeEl = document.getElementById("roomCode");
const playerCountEl = document.getElementById("playerCount");
const playerListEl = document.getElementById("playerList");
const roomCodePanel = document.getElementById("roomCodePanel");

async function init3DViewer() {
    // Load WASM
    statusEl.textContent = "⏳ Loading world...";
    const { default: init, SeedWorld } = await import("./pkg/seed_wasm.js");
    await init();

    // Load world config
    const configRes = await fetch("world-config.json");
    worldConfig = await configRes.json();

    // Generate terrain
    const worldSeed = worldConfig.seed || 256454;
    const seaLevel = worldConfig.seaLevel || 0.11;
    const resolution = 1024;

    worldConfig.worldSeed = worldSeed;
    const configJson = JSON.stringify(worldConfig);

    const startTime = performance.now();
    const world = new SeedWorld(configJson, resolution, resolution);
    heightData = world.heightmap_values();
    mapSize = resolution;

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[WASM] Heightmap generated in ${elapsed}s`);

    // Setup Three.js
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.00003);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100000);
    camera.position.set(0, 3000, 8000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById("viewer").appendChild(renderer.domElement);

    // Enhanced lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5000, 8000, 3000);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 100;
    dirLight.shadow.camera.far = 50000;
    scene.add(dirLight);

    // Hemisphere light for better ambient
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.4);
    scene.add(hemiLight);

    // Enable shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Create terrain mesh
    createTerrainMesh();

    // Water plane
    createWaterPlane();

    // Sky dome
    createSkyDome();

    // Controls
    clock = new THREE.Clock();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 50000;
    controls.minDistance = 100;

    fpControls = new PointerLockControls(camera, renderer.domElement);
    scene.add(fpControls.getObject());

    setupControls();
    setupModeSwitch();
    setupStreaming();

    // Animation loop
    animate();

    statusEl.textContent = "✅ Streaming active";

    window.addEventListener("resize", onWindowResize);
}

function createTerrainMesh() {
    const terrainScale = 12000;
    const heightScale = 1200;
    const segments = mapSize - 1;

    const geometry = new THREE.PlaneGeometry(terrainScale, terrainScale, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    for (let i = 0; i < heightData.length; i++) {
        positions[i * 3 + 1] = heightData[i] * heightScale;
    }

    geometry.computeVertexNormals();

    // Enhanced terrain material with height-based coloring
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: false,
        roughness: 0.85,
        metalness: 0.05,
    });

    // Add vertex colors based on height
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < heightData.length; i++) {
        const height = heightData[i];
        let r, g, b;

        if (height < 0.1) {
            // Beach sand
            r = 0.87;
            g = 0.82;
            b = 0.65;
        } else if (height < 0.3) {
            // Grass
            r = 0.29;
            g = 0.49;
            b = 0.35;
        } else if (height < 0.6) {
            // Mountain
            r = 0.45;
            g = 0.42;
            b = 0.38;
        } else {
            // Snow peaks
            r = 0.95;
            g = 0.95;
            b = 0.98;
        }

        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
}

function createWaterPlane() {
    const waterGeo = new THREE.PlaneGeometry(50000, 50000, 200, 200);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x0077be,
        transparent: true,
        opacity: 0.75,
        roughness: 0.05,
        metalness: 0.9,
        emissive: 0x001122,
        emissiveIntensity: 0.1,
    });

    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = 0;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
}

function createSkyDome() {
    const skyGeo = new THREE.SphereGeometry(80000, 32, 32);
    const skyMat = new THREE.MeshBasicMaterial({
        color: 0x87ceeb,
        side: THREE.BackSide,
        fog: false,
    });
    skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
}

function setupControls() {
    window.addEventListener("keydown", (e) => {
        if (currentMode !== "fps") return;

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
                    verticalVelocity = 300;
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
    fpControls.addEventListener("unlock", () => {
        if (currentMode === "fps") {
            switchToOrbit();
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.code === "Numpad0") {
            e.preventDefault();
            switchToOrbit();
        } else if (e.code === "Numpad1") {
            e.preventDefault();
            switchToFPS();
        }
    });
}

function switchToFPS() {
    currentMode = "fps";
    controls.enabled = false;
    fpControls.lock();
    camera.position.y = 200;
    console.log("[Mode] Switched to FPS");
}

function switchToOrbit() {
    currentMode = "orbit";
    fpControls.unlock();
    controls.enabled = true;
    moveState = { forward: false, backward: false, left: false, right: false };
    verticalVelocity = 0;
    console.log("[Mode] Switched to Orbit");
}

function updateFPSMovement(delta) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    const speed = isSprinting ? 400 : 200;

    if (moveState.forward || moveState.backward) velocity.z -= direction.z * speed * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * speed * delta;

    verticalVelocity += -800 * delta;

    const obj = fpControls.getObject();
    obj.position.y += verticalVelocity * delta;

    const groundHeight = sampleHeightAt(obj.position.x, obj.position.z) + 10;
    if (obj.position.y <= groundHeight) {
        obj.position.y = groundHeight;
        verticalVelocity = 0;
        isGrounded = true;
    } else {
        isGrounded = false;
    }

    fpControls.moveRight(-velocity.x * delta);
    fpControls.moveForward(-velocity.z * delta);
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

function setupStreaming() {
    if (wsHost) {
        console.log("[Streaming] Already connected, skipping...");
        return;
    }

    wsHost = startHostLink(
        () => {
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
            console.log("[Streaming] Status:", status);
            if (status === "disconnected") {
                wsHost = null;
            }
        }
    );

    // Room created callback
    window.__seedOnRoomCreated = (roomCode) => {
        console.log("[Host] Room created:", roomCode);
        roomCodeEl.textContent = roomCode;

        // Hide panel after 5 seconds
        setTimeout(() => {
            roomCodePanel.style.opacity = "0";
            roomCodePanel.style.transition = "opacity 0.5s";
            setTimeout(() => {
                roomCodePanel.style.display = "none";
            }, 500);
        }, 5000);
    };

    // Player updates callback
    window.__seedOnPlayerUpdate = (msg) => {
        console.log("[Host] Player update:", msg);

        if (msg.type === "player_joined") {
            connectedPlayers.set(msg.playerId, {
                id: msg.playerId,
                joinedAt: Date.now(),
            });
        } else if (msg.type === "player_left") {
            connectedPlayers.delete(msg.playerId);
        }

        updatePlayerList();
    };

    // Start streaming frames
    let framesSent = 0;
    setInterval(() => {
        if (window.__seedSendFrame && wsHost) {
            renderer.domElement.toBlob(
                (blob) => {
                    if (blob) {
                        framesSent++;
                        if (framesSent === 1) {
                            console.log(`[Host] 🌟 Streaming started: ${blob.size} bytes, type: ${blob.type}`);
                        }
                        window.__seedSendFrame(blob);
                    } else {
                        console.warn("[Host] toBlob returned null!");
                    }
                },
                "image/jpeg",
                0.75
            );
        } else {
            if (framesSent === 0) {
                console.warn("[Host] Cannot stream: __seedSendFrame or wsHost not ready");
            }
        }
    }, 33); // ~30 FPS
}

function updatePlayerList() {
    playerCountEl.textContent = connectedPlayers.size;

    playerListEl.innerHTML = "";

    if (connectedPlayers.size === 0) {
        playerListEl.innerHTML = '<div style="color: #666; font-size: 12px; padding: 10px;">No players connected</div>';
        return;
    }

    connectedPlayers.forEach((player, playerId) => {
        const item = document.createElement("div");
        item.className = "player-item";
        item.innerHTML = `
            <div class="player-status"></div>
            <div>${playerId.substring(0, 20)}...</div>
        `;
        playerListEl.appendChild(item);
    });
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (currentMode === "orbit") {
        controls.update();
    } else if (currentMode === "fps") {
        updateFPSMovement(delta);
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initialize
init3DViewer().catch(console.error);
