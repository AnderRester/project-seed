// connection-client.js - Player that connects to index3d-enhanced world and streams camera view
import { startHostLink } from "./remote_link.js";
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

let scene, camera, renderer, controls;
let velocity = new THREE.Vector3();
let moveState = { forward: false, backward: false, left: false, right: false };
let isPointerLocked = false;

// World data from main host
let heightData = null;
let mapSize = 0;
let terrainMesh = null;
let terrainScale = 12000;
let heightScale = 1200;

// Connection state
let streamWs = null; // For streaming our camera view
let worldWs = null; // For receiving world updates from index3d-enhanced
let roomCode = null;
let streamingInitialized = false; // Flag to prevent duplicate streaming setup

// Chunked world_sync reception
let chunkBuffer = [];
let expectedChunks = 0;

async function init() {
    console.log("[ConnectionClient] Waiting for world room code...");

    // Setup connect button
    const connectBtn = document.getElementById("connectBtn");
    const roomCodeInput = document.getElementById("roomCodeInput");

    // Center status HUD to avoid overlapping other buttons
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.style.position = "fixed";
        statusEl.style.top = "8px";
        statusEl.style.left = "50%";
        statusEl.style.transform = "translateX(-50%)";
    }

    connectBtn.addEventListener("click", async () => {
        const worldRoomCode = roomCodeInput.value.trim().toUpperCase();
        if (!worldRoomCode || worldRoomCode.length !== 6) {
            alert("Please enter a valid 6-character room code from index3d-enhanced");
            return;
        }

        console.log(`[ConnectionClient] Connecting to world room: ${worldRoomCode}`);
        document.getElementById("roomCodePanel").style.display = "none";

        await initWorld(worldRoomCode);
    });
}

async function initWorld(worldRoomCode) {
    console.log("[ConnectionClient] Initializing player client in world:", worldRoomCode);

    // Setup Three.js scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000);
    camera.position.set(0, 500, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById("viewer").appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5000, 8000, 3000);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // FPS Controls
    controls = new PointerLockControls(camera, renderer.domElement);
    renderer.domElement.addEventListener("click", () => controls.lock());
    controls.addEventListener("lock", () => {
        isPointerLocked = true;
        console.log("[ConnectionClient] Pointer locked - WASD to move");
    });
    controls.addEventListener("unlock", () => {
        isPointerLocked = false;
    });
    scene.add(controls.getObject());

    // Keyboard
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    // Connect to world host to get terrain
    await connectToWorldHost(worldRoomCode);

    // Note: setupStreaming() will be called AFTER terrain is loaded
    // See loadWorldData() function

    // Start render
    animate();
    window.addEventListener("resize", onWindowResize);
}

function onKeyDown(event) {
    switch (event.code) {
        case "KeyW":
            moveState.forward = true;
            break;
        case "KeyS":
            moveState.backward = true;
            break;
        case "KeyA":
            moveState.left = true;
            break;
        case "KeyD":
            moveState.right = true;
            break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case "KeyW":
            moveState.forward = false;
            break;
        case "KeyS":
            moveState.backward = false;
            break;
        case "KeyA":
            moveState.left = false;
            break;
        case "KeyD":
            moveState.right = false;
            break;
    }
}

async function connectToWorldHost(worldRoomCode) {
    console.log(`[ConnectionClient] Connecting to world room: ${worldRoomCode}`);

    // Connect as CLIENT to the world room to receive world_sync messages
    worldWs = new WebSocket(`ws://localhost:8080?role=client&room=${worldRoomCode}`);

    worldWs.onopen = () => {
        console.log(`[ConnectionClient] Connected to world room ${worldRoomCode}`);
        document.getElementById(
            "status"
        ).textContent = `Connected to world ${worldRoomCode}, waiting for terrain data...`;

        // Request world data from host
        console.log("[ConnectionClient] Setting up world sync request timer...");
        setTimeout(() => {
            console.log(`[ConnectionClient] Timer fired, worldWs.readyState: ${worldWs.readyState}`);
            if (worldWs.readyState === WebSocket.OPEN) {
                try {
                    const request = JSON.stringify({ type: "request_world_sync" });
                    worldWs.send(request);
                    console.log("[ConnectionClient] ✅ Requested world data from host");
                } catch (err) {
                    console.error("[ConnectionClient] ❌ Error sending request:", err);
                }
            } else {
                console.warn(`[ConnectionClient] ❌ Cannot send request, WebSocket state: ${worldWs.readyState}`);
            }
        }, 500); // Increase timeout to 500ms
    };

    worldWs.onmessage = (event) => {
        // Check if binary (video frame) or text (world_sync)
        if (typeof event.data === "string") {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === "world_sync") {
                    console.log("[ConnectionClient] Received complete world data (legacy)");
                    loadWorldData(msg);
                } else if (msg.type === "world_sync_start") {
                    console.log(`[ConnectionClient] Receiving world data in ${msg.totalChunks} chunks...`);
                    chunkBuffer = [];
                    expectedChunks = msg.totalChunks;
                } else if (msg.type === "world_sync_chunk") {
                    chunkBuffer[msg.index] = msg.data;
                    console.log(`[ConnectionClient] Received chunk ${msg.index + 1}/${expectedChunks}`);
                } else if (msg.type === "world_sync_end") {
                    if (expectedChunks === 0) {
                        console.warn("[ConnectionClient] Received world_sync_end without start, ignoring");
                        return;
                    }
                    console.log("[ConnectionClient] Assembling world data...");
                    const fullPayload = chunkBuffer.join("");
                    try {
                        const worldData = JSON.parse(fullPayload);
                        console.log("[ConnectionClient] Received world data from host");
                        loadWorldData(worldData);
                    } catch (err) {
                        console.error("[ConnectionClient] Failed to parse assembled world data:", err);
                    }
                    chunkBuffer = [];
                    expectedChunks = 0;
                } else if (msg.type === "joined_room") {
                    console.log(`[ConnectionClient] Joined world room, player ID: ${msg.playerId}`);
                }
            } catch (e) {
                console.warn("[ConnectionClient] Failed to parse message:", e);
            }
        }
        // Ignore binary frames (those are video from index3d-enhanced, we don't need them)
    };

    worldWs.onerror = (error) => {
        console.error("[ConnectionClient] World connection error:", error);
        document.getElementById("status").textContent = "Failed to connect to world";
    };

    worldWs.onclose = () => {
        console.log("[ConnectionClient] World connection closed");
    };
}

function loadWorldData(worldData) {
    // Only load world data once
    if (heightData && heightData.length > 0) {
        console.log("[ConnectionClient] World data already loaded, ignoring duplicate");
        return;
    }

    console.log(`[ConnectionClient] Loading world: ${worldData.mapSize}x${worldData.mapSize}`);

    mapSize = worldData.mapSize;
    heightData = new Float32Array(worldData.heightData);
    terrainScale = worldData.terrainScale || 12000;
    heightScale = worldData.heightScale || 1200;

    createTerrainMesh();
    document.getElementById("status").textContent = `✅ World loaded (${mapSize}x${mapSize})`;
}

function createTerrainMesh() {
    if (!heightData || mapSize === 0) {
        console.warn("[ConnectionClient] Cannot create terrain: no height data");
        return;
    }

    if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh.material.dispose();
    }

    const geometry = new THREE.PlaneGeometry(terrainScale, terrainScale, mapSize - 1, mapSize - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    for (let i = 0; i < heightData.length; i++) {
        positions[i * 3 + 1] = heightData[i] * heightScale;
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        color: 0x4a8f3a,
        roughness: 0.8,
        metalness: 0.2,
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    // Keep terrain centered at origin (PlaneGeometry is already centered)
    terrainMesh.position.set(0, 0, 0);

    scene.add(terrainMesh);
    console.log("[ConnectionClient] Terrain mesh created with bounds:", {
        x: [-terrainScale / 2, terrainScale / 2],
        z: [-terrainScale / 2, terrainScale / 2],
    });

    // Position camera above terrain at center
    const centerHeight = sampleHeightAt(0, 0);
    const playerHeight = 20;
    camera.position.set(0, centerHeight + playerHeight, 0);
    console.log(`[ConnectionClient] Camera positioned at height: ${centerHeight + playerHeight}`);

    // Now that terrain is loaded, setup streaming (only once)
    if (!streamingInitialized) {
        streamingInitialized = true;
        setupStreaming();
    } else {
        console.log("[ConnectionClient] Streaming already initialized, skipping...");
    }
}

function sampleHeightAt(worldX, worldZ) {
    if (!heightData || mapSize === 0) return 0;

    // Terrain is offset by -terrainScale/2, adjust world position
    const adjustedX = worldX + terrainScale / 2;
    const adjustedZ = worldZ + terrainScale / 2;

    const normalizedX = adjustedX / terrainScale;
    const normalizedZ = adjustedZ / terrainScale;

    const x = Math.floor(normalizedX * mapSize);
    const z = Math.floor(normalizedZ * mapSize);

    if (x < 0 || x >= mapSize || z < 0 || z >= mapSize) return 0;

    const idx = z * mapSize + x;
    return heightData[idx] * heightScale;
}

async function setupStreaming() {
    console.log("[ConnectionClient] Setting up streaming as HOST");

    try {
        let roomCodeSet = false;

        // startHostLink expects: (getStateFn, onStatusChange, roomCode)
        streamWs = startHostLink(
            () => {
                // getStateFn - return player state
                return {
                    mode: "fps",
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
                console.log("[ConnectionClient] Stream status:", status);
            }
        );

        // Listen for room code via global callback
        window.__seedOnRoomCreated = (code) => {
            if (!roomCodeSet) {
                roomCode = code;
                roomCodeSet = true;
                console.log("[ConnectionClient] 🎮 Stream room created:", code);
                document.getElementById("status").textContent = `Room: ${code} - Streaming active`;
            }
        };

        console.log("[ConnectionClient] Streaming at 25 FPS (downscaled)");

        // Downscale and compress frames to cut latency/bandwidth
        const streamCanvas = document.createElement("canvas");
        const streamCtx = streamCanvas.getContext("2d", { desynchronized: true });

        const sendFrame = () => {
            if (!renderer || !window.__seedSendFrame) return;
            const src = renderer.domElement;

            streamCanvas.width = Math.floor(src.width * 0.6);
            streamCanvas.height = Math.floor(src.height * 0.6);
            streamCtx.drawImage(src, 0, 0, streamCanvas.width, streamCanvas.height);

            const buffered = streamWs?.socket?.bufferedAmount || 0;
            if (buffered > 1024 * 1024) {
                return; // back off when buffer is high
            }

            const finish = (blob) => {
                if (blob) {
                    window.__seedSendFrame(blob);
                }
            };

            if (streamCanvas.convertToBlob) {
                streamCanvas
                    .convertToBlob({ type: "image/webp", quality: 0.55 })
                    .then(finish)
                    .catch(() => {});
            } else {
                streamCanvas.toBlob(finish, "image/webp", 0.55);
            }
        };

        setInterval(sendFrame, 40); // ~25 FPS
    } catch (error) {
        console.error("[ConnectionClient] Failed to setup streaming:", error);
    }
}

function updateMovement(delta) {
    if (!isPointerLocked) return;

    const speed = 100.0;
    const damping = 5.0;

    const direction = new THREE.Vector3();
    controls.getObject().getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();

    const targetVelocity = new THREE.Vector3();

    if (moveState.forward) targetVelocity.add(direction.clone().multiplyScalar(speed));
    if (moveState.backward) targetVelocity.add(direction.clone().multiplyScalar(-speed));
    if (moveState.left) targetVelocity.add(right.clone().multiplyScalar(-speed));
    if (moveState.right) targetVelocity.add(right.clone().multiplyScalar(speed));

    velocity.lerp(targetVelocity, delta * damping);

    const cameraObject = controls.getObject();
    cameraObject.position.x += velocity.x * delta;
    cameraObject.position.z += velocity.z * delta;

    const groundHeight = sampleHeightAt(cameraObject.position.x, cameraObject.position.z);
    const playerHeight = 20;
    cameraObject.position.y = groundHeight + playerHeight;
}

function animate() {
    requestAnimationFrame(animate);
    const delta = 0.016;
    updateMovement(delta);
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
