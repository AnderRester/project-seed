// main3d.js (PC / Host)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

import init, { SeedWorld } from './pkg/seed_wasm.js';
import { startHostLink } from './remote_link.js';

async function run() {
    try {
        // 1. Загружаем конфиг мира
        const resp = await fetch('./world-config.json');
        if (!resp.ok) {
            throw new Error('Failed to load world-config.json: ' + resp.status);
        }
        const configText = await resp.text();
        const config = JSON.parse(configText);

        // 2. Инициализируем wasm
        await init();

        // Размер heightmap'а
        const reqWidth = 1536;
        const reqHeight = 768;

        const world = new SeedWorld(configText, reqWidth, reqHeight);

        const w = world.width;
        const h = world.height;
        const heights = world.heightmap_values();
        const rgba = world.worldview_rgba();
        const biomeIndicesRaw = world.biome_indices(); // Vec<u8> → Uint8Array
        const biomeIndices = new Uint8Array(biomeIndicesRaw);

        console.log('HM size from WASM:', w, h, 'len heights:', heights.length, 'w*h:', w * h);
        console.log('Biome indices length:', biomeIndices.length, 'biomes in config:', config.biomes?.length);

        // --- нормализуем высоты в [0..1] ---
        const safeHeights = new Float32Array(w * h);
        let minH = Infinity;
        let maxH = -Infinity;

        for (let i = 0; i < w * h; i++) {
            let v = heights[i];
            if (!Number.isFinite(v)) v = 0.0;
            if (v < 0.0) v = 0.0;
            if (v > 1.0) v = 1.0;

            safeHeights[i] = v;
            if (v < minH) minH = v;
            if (v > maxH) maxH = v;
        }
        console.log('Heights min/max (clamped):', minH, maxH);

        // --------- ТЕКСТУРА ----------
        const texData = new Uint8Array(rgba);
        const texture = new THREE.DataTexture(texData, w, h, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;

        // --------- СЦЕНА / АТМОСФЕРА ---------
        const scene = new THREE.Scene();

        const skyColor = 0x87a7ff;
        const fogColor = 0x6b86b6;
        scene.background = new THREE.Color(skyColor);
        scene.fog = new THREE.FogExp2(fogColor, 0.00018);

        // Увеличенный мир
        const TERRAIN_SIZE_X = 8000;
        const TERRAIN_SIZE_Z = 5000;
        const MAX_HEIGHT = 320;

        const HALF_X = TERRAIN_SIZE_X * 0.5;
        const HALF_Z = TERRAIN_SIZE_Z * 0.5;

        const CELLS_X = w - 1;
        const CELLS_Z = h - 1;
        const CELL_SIZE_X = TERRAIN_SIZE_X / CELLS_X;
        const CELL_SIZE_Z = TERRAIN_SIZE_Z / CELLS_Z;

        // --------- HUD (режим + биом + линк) ---------
        const hud = document.createElement('div');
        hud.style.position = 'fixed';
        hud.style.top = '10px';
        hud.style.left = '10px';
        hud.style.padding = '6px 10px';
        hud.style.borderRadius = '6px';
        hud.style.background = 'rgba(0,0,0,0.45)';
        hud.style.color = '#fff';
        hud.style.fontFamily = 'system-ui, sans-serif';
        hud.style.fontSize = '13px';
        hud.style.zIndex = '10';
        document.body.appendChild(hud);

        let currentMode = 'orbit';
        let currentBiomeLabel = '';
        let linkStatus = 'offline';

        // === FPS overlay ===
        let showFPS = false;
        let fpsAccum = 0;
        let fpsFrames = 0;
        let fpsValue = 0;

        const fpsBox = document.createElement('div');
        fpsBox.style.position = 'fixed';
        fpsBox.style.bottom = '10px';
        fpsBox.style.left = '10px';
        fpsBox.style.padding = '4px 8px';
        fpsBox.style.borderRadius = '6px';
        fpsBox.style.background = 'rgba(0,0,0,0.6)';
        fpsBox.style.color = '#0f0';
        fpsBox.style.fontFamily = 'system-ui, monospace';
        fpsBox.style.fontSize = '11px';
        fpsBox.style.zIndex = '11';
        fpsBox.style.display = 'none';
        fpsBox.textContent = 'FPS: ---';
        document.body.appendChild(fpsBox);

        function biomeLabelFromIndex(biIdx) {
            if (biIdx === 255 || biIdx === undefined || biIdx === null) {
                return 'water / none (#255)';
            }
            const biomes = Array.isArray(config.biomes) ? config.biomes : [];
            const b = biomes[biIdx];
            if (!b) {
                return `biome#${biIdx} (no cfg)`;
            }
            const id = b.id || 'no-id';
            const name = b.displayName || b.name || '';
            if (name) return `${name} [${id}] (#${biIdx})`;
            return `${id} (#${biIdx})`;
        }

        function updateHud() {
            if (currentMode === 'orbit') {
                hud.textContent = `Mode: ORBIT (Numpad1 = FPS) | Link: ${linkStatus}`;
            } else {
                const label = currentBiomeLabel || 'unknown';
                hud.textContent = `Mode: FPS (Numpad0 = ORBIT) — Biome: ${label} | Link: ${linkStatus}`;
            }
        }

        // --------- КАМЕРА / РЕНДЕР ---------
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 30000);
        camera.position.set(0, MAX_HEIGHT * 3.0, TERRAIN_SIZE_Z * 0.9);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        // --------- ОРБИТАЛЬНЫЕ КОНТРОЛЫ ---------
        const orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.target.set(0, 0, 0);
        orbitControls.maxDistance = TERRAIN_SIZE_Z * 2.0;
        orbitControls.minDistance = TERRAIN_SIZE_Z * 0.12;
        orbitControls.enablePan = true;
        orbitControls.update();

        // ========= ЧАНКИ ТЕРРЕЙНА =========
        const CHUNK_CELLS_X = 64;
        const CHUNK_CELLS_Z = 64;

        const NUM_CHUNKS_X = Math.ceil(CELLS_X / CHUNK_CELLS_X);
        const NUM_CHUNKS_Z = Math.ceil(CELLS_Z / CHUNK_CELLS_Z);

        const chunks = [];

        function createTerrainChunks() {
            for (let cz = 0; cz < NUM_CHUNKS_Z; cz++) {
                for (let cx = 0; cx < NUM_CHUNKS_X; cx++) {
                    const cellStartX = cx * CHUNK_CELLS_X;
                    const cellStartZ = cz * CHUNK_CELLS_Z;

                    const cellEndX = Math.min(cellStartX + CHUNK_CELLS_X, CELLS_X);
                    const cellEndZ = Math.min(cellStartZ + CHUNK_CELLS_Z, CELLS_Z);

                    const segX = cellEndX - cellStartX;
                    const segZ = cellEndZ - cellStartZ;

                    if (segX <= 0 || segZ <= 0) continue;

                    const chunkWidthWorld = segX * CELL_SIZE_X;
                    const chunkDepthWorld = segZ * CELL_SIZE_Z;

                    const centerCellX = cellStartX + segX / 2;
                    const centerCellZ = cellStartZ + segZ / 2;

                    const centerWorldX = (centerCellX / CELLS_X - 0.5) * TERRAIN_SIZE_X;
                    const centerWorldZ = (centerCellZ / CELLS_Z - 0.5) * TERRAIN_SIZE_Z;

                    const geom = new THREE.PlaneGeometry(chunkWidthWorld, chunkDepthWorld, segX, segZ);
                    geom.rotateX(-Math.PI / 2);

                    const posAttr = geom.attributes.position;
                    const uvAttr = geom.attributes.uv;
                    const posArr = posAttr.array;
                    const uvArr = uvAttr.array;

                    const vertsX = segX + 1;
                    const vertsZ = segZ + 1;

                    for (let vz = 0; vz < vertsZ; vz++) {
                        for (let vx = 0; vx < vertsX; vx++) {
                            const vertIndex = vz * vertsX + vx;
                            const posIndex = vertIndex * 3;
                            const uvIndex = vertIndex * 2;

                            const globalX = cellStartX + vx;
                            const globalZ = cellStartZ + vz;

                            const hmIdx = globalZ * w + globalX;
                            const heightNorm = safeHeights[hmIdx];
                            const y = heightNorm * MAX_HEIGHT;

                            posArr[posIndex + 1] = y;

                            const u = globalX / CELLS_X;
                            const v = globalZ / CELLS_Z;
                            uvArr[uvIndex + 0] = u;
                            uvArr[uvIndex + 1] = v;
                        }
                    }

                    posAttr.needsUpdate = true;
                    uvAttr.needsUpdate = true;
                    geom.computeVertexNormals();

                    const mat = new THREE.MeshStandardMaterial({
                        map: texture,
                        flatShading: false,
                        wireframe: false,
                    });

                    const mesh = new THREE.Mesh(geom, mat);
                    mesh.position.set(centerWorldX, 0, centerWorldZ);
                    mesh.frustumCulled = false;

                    const radius = Math.sqrt((chunkWidthWorld * 0.5) ** 2 + (chunkDepthWorld * 0.5) ** 2);

                    scene.add(mesh);

                    chunks.push({
                        mesh,
                        centerX: centerWorldX,
                        centerZ: centerWorldZ,
                        radius,
                    });
                }
            }

            console.log('Terrain chunks created:', chunks.length);
        }

        createTerrainChunks();

        function updateChunksForPosition(px, pz, viewRadius) {
            const r2 = viewRadius * viewRadius;

            for (const ch of chunks) {
                const dx = ch.centerX - px;
                const dz = ch.centerZ - pz;
                const dist2 = dx * dx + dz * dz;

                ch.mesh.visible = dist2 <= r2 + ch.radius * ch.radius;
            }
        }

        // --------- Вспомогательные выборки ---------
        function sampleHeightAt(worldX, worldZ) {
            const u = (worldX / TERRAIN_SIZE_X + 0.5) * CELLS_X;
            const v = (worldZ / TERRAIN_SIZE_Z + 0.5) * CELLS_Z;

            if (u < 0 || v < 0 || u > CELLS_X || v > CELLS_Z) {
                return 0;
            }

            const x0 = Math.floor(u);
            const z0 = Math.floor(v);
            const x1 = Math.min(x0 + 1, CELLS_X);
            const z1 = Math.min(z0 + 1, CELLS_Z);

            const fx = u - x0;
            const fz = v - z0;

            const i00 = z0 * w + x0;
            const i10 = z0 * w + x1;
            const i01 = z1 * w + x0;
            const i11 = z1 * w + x1;

            const h00 = safeHeights[i00];
            const h10 = safeHeights[i10];
            const h01 = safeHeights[i01];
            const h11 = safeHeights[i11];

            const h0 = h00 * (1 - fx) + h10 * fx;
            const h1 = h01 * (1 - fx) + h11 * fx;
            const hNorm = h0 * (1 - fz) + h1 * fz;

            return hNorm * MAX_HEIGHT;
        }

        function sampleBiomeIndexAt(worldX, worldZ) {
            const u = (worldX / TERRAIN_SIZE_X + 0.5) * CELLS_X;
            const v = (worldZ / TERRAIN_SIZE_Z + 0.5) * CELLS_Z;

            if (u < 0 || v < 0 || u > CELLS_X || v > CELLS_Z) {
                return 255;
            }

            const ix = Math.round(u);
            const iz = Math.round(v);
            const idx = iz * w + ix;

            if (idx < 0 || idx >= biomeIndices.length) return 255;
            return biomeIndices[idx];
        }

        // --------- СВЕТ / АТМОСФЕРА ---------
        const dirLight = new THREE.DirectionalLight(0xfff2e0, 1.1);
        dirLight.position.set(5000, 8000, 3000);
        dirLight.castShadow = false;
        scene.add(dirLight);

        const hemiLight = new THREE.HemisphereLight(0xcfe8ff, 0x404653, 0.5);
        scene.add(hemiLight);

        const ambient = new THREE.AmbientLight(0xffffff, 0.25);
        scene.add(ambient);

        let sunTime = 0;
        function updateSun(delta) {
            sunTime += delta * 0.01;
            if (sunTime > 1) sunTime -= 1;

            const angle = sunTime * Math.PI * 2;
            const radius = 10000;

            dirLight.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 2000);
        }

        // --------- FPS КОНТРОЛЫ ---------
        const fpControls = new PointerLockControls(camera, renderer.domElement);
        scene.add(fpControls.getObject());

        const moveState = {
            forward: false,
            backward: false,
            left: false,
            right: false,
        };

        const clock = new THREE.Clock();
        const WALK_SPEED = 80;
        const EYE_HEIGHT = 1.8;

        const MAX_VERTICAL_STEP = 1.2;
        const VERTICAL_SMOOTH = 0.75;

        // --------- GAMEPAD ---------
        let gamepadIndex = null;
        let gamepadMoveForward = 0;
        let gamepadMoveRight = 0;

        window.addEventListener('gamepadconnected', (e) => {
            console.log('[Gamepad] connected:', e.gamepad.id);
            gamepadIndex = e.gamepad.index;
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('[Gamepad] disconnected:', e.gamepad.id);
            if (gamepadIndex === e.gamepad.index) {
                gamepadIndex = null;
            }
        });

        function updateGamepad(delta) {
            if (gamepadIndex == null) {
                gamepadMoveForward = 0;
                gamepadMoveRight = 0;
                return;
            }

            const pads = navigator.getGamepads();
            const gp = pads[gamepadIndex];
            if (!gp) {
                gamepadMoveForward = 0;
                gamepadMoveRight = 0;
                return;
            }

            const deadzone = 0.18;
            const axX = gp.axes[0] || 0;
            const axY = gp.axes[1] || 0;

            const aX = Math.abs(axX) > deadzone ? axX : 0;
            const aY = Math.abs(axY) > deadzone ? axY : 0;

            gamepadMoveForward = -aY * WALK_SPEED * delta;
            gamepadMoveRight = aX * WALK_SPEED * delta;

            if (mode === 'fp' && fpControls.isLocked) {
                const axRX = gp.axes[2] || 0;
                const axRY = gp.axes[3] || 0;
                const lookX = Math.abs(axRX) > deadzone ? axRX : 0;
                const lookY = Math.abs(axRY) > deadzone ? axRY : 0;

                if (lookX !== 0 || lookY !== 0) {
                    const lookSpeed = 1.5;
                    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
                    euler.y -= lookX * lookSpeed * delta;
                    euler.x -= lookY * lookSpeed * delta;
                    const maxPitch = Math.PI / 2 - 0.01;
                    euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x));
                    camera.quaternion.setFromEuler(euler);
                }
            }
        }

        // --------- ОРИЕНТАЦИЯ С ТЕЛЕФОНА ---------
        let remoteOrientation = null;
        window.__seedRemoteOrientation = (state) => {
            if (!state || !state.orientation) return;
            remoteOrientation = state.orientation;
        };

        function applyRemoteOrientation() {
            if (!remoteOrientation || mode !== 'fp' || !fpControls.isLocked) return;

            const { yaw, pitch } = remoteOrientation;
            const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
            const maxPitch = Math.PI / 2 - 0.01;
            euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x));
            camera.quaternion.setFromEuler(euler);
        }

        // --------- ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ---------
        let mode = 'orbit'; // 'orbit' | 'fp'

        function placePlayerAt(x, z) {
            const yGround = sampleHeightAt(x, z);
            const obj = fpControls.getObject();
            obj.position.set(x, yGround + EYE_HEIGHT, z);
        }

        function switchToOrbit() {
            if (mode === 'orbit') return;
            mode = 'orbit';
            currentMode = 'orbit';
            orbitControls.enabled = true;
            fpControls.unlock();
            updateHud();
            console.log('Switched to ORBIT mode');
        }

        function switchToFP() {
            if (mode === 'fp') return;
            mode = 'fp';
            currentMode = 'fps';
            orbitControls.enabled = false;

            placePlayerAt(0, 0);
            fpControls.lock();
            updateHud();
            console.log('Switched to FIRST-PERSON mode');
        }

        // --------- ОБРАБОТКА КЛАВИШ ---------
        function onKeyDown(e) {
            switch (e.code) {
                case 'Numpad0':
                    switchToOrbit();
                    break;
                case 'Numpad1':
                    switchToFP();
                    break;
                case 'Numpad3':
                    showFPS = !showFPS;
                    fpsBox.style.display = showFPS ? 'block' : 'none';
                    if (showFPS) {
                        fpsBox.textContent = `FPS: ${fpsValue.toFixed(1)}`;
                    }
                    break;

                case 'KeyW':
                case 'ArrowUp':
                    moveState.forward = true;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    moveState.backward = true;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    moveState.left = true;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    moveState.right = true;
                    break;
            }
        }

        function onKeyUp(e) {
            switch (e.code) {
                case 'KeyW':
                case 'ArrowUp':
                    moveState.forward = false;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    moveState.backward = false;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    moveState.left = false;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    moveState.right = false;
                    break;
            }
        }

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        // --------- РЕСАЙЗ ---------
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // --------- СПАВН-МАРКЕРЫ (деревья / камни / домики) ---------
        const spawnMarkers = [];
        const markerStep = 16;

        function estimateSlope(worldX, worldZ) {
            const eps = 4.0;
            const hC = sampleHeightAt(worldX, worldZ);
            const hX = sampleHeightAt(worldX + eps, worldZ);
            const hZ = sampleHeightAt(worldX, worldZ + eps);

            const dx = (hX - hC) / eps;
            const dz = (hZ - hC) / eps;
            return Math.sqrt(dx * dx + dz * dz);
        }

        function pickMarkerTypeForBiome(biIdx) {
            const biomes = Array.isArray(config.biomes) ? config.biomes : [];
            const b = biomes[biIdx];
            const id = b?.id || '';

            const r = Math.random();

            if (id.includes('forest')) {
                if (r < 0.02) return 'house';
                if (r < 0.8) return 'tree';
                return 'boulder';
            }
            if (id.includes('desert')) {
                if (r < 0.03) return 'house';
                return 'rock';
            }
            if (id.includes('mountain')) {
                if (r < 0.1) return 'house';
                return 'rock';
            }
            if (id.includes('tundra')) {
                if (r < 0.03) return 'house';
                return 'boulder';
            }

            if (r < 0.05) return 'house';
            if (r < 0.5) return 'tree';
            return 'generic';
        }

        function generateSpawnMarkers() {
            console.log('Generating spawn markers...');

            for (let j = 0; j < h; j += markerStep) {
                for (let i = 0; i < w; i += markerStep) {
                    const worldX = (i / CELLS_X - 0.5) * TERRAIN_SIZE_X;
                    const worldZ = (j / CELLS_Z - 0.5) * TERRAIN_SIZE_Z;
                    const y = sampleHeightAt(worldX, worldZ);

                    const biIdx = biomeIndices[j * w + i];
                    if (biIdx === 255) continue;

                    const slope = estimateSlope(worldX, worldZ);
                    if (slope > 0.8) continue;

                    const type = pickMarkerTypeForBiome(biIdx);

                    spawnMarkers.push({
                        x: worldX,
                        y,
                        z: worldZ,
                        biomeIndex: biIdx,
                        type,
                    });
                }
            }

            console.log('Spawn markers generated:', spawnMarkers.length);
        }

        generateSpawnMarkers();

        const markerGroup = new THREE.Group();
        scene.add(markerGroup);

        const activeMarkerMeshes = new Map();

        function createTreeMesh() {
            const group = new THREE.Group();
            const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 6, 6);
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b1e });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 3;
            group.add(trunk);

            const crownGeo = new THREE.SphereGeometry(3, 10, 10);
            const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e8033 });
            const crown = new THREE.Mesh(crownGeo, crownMat);
            crown.position.y = 7;
            group.add(crown);

            return group;
        }

        function createRockMesh() {
            const geo = new THREE.DodecahedronGeometry(3.5);
            const mat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            return mesh;
        }

        function createBoulderMesh() {
            const geo = new THREE.DodecahedronGeometry(4.5);
            const mat = new THREE.MeshStandardMaterial({ color: 0x555577, roughness: 0.95 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.scale.set(1.4, 1.0, 1.8);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            return mesh;
        }

        function createHouseMesh() {
            const group = new THREE.Group();

            const baseGeo = new THREE.BoxGeometry(8, 4, 8);
            const baseMat = new THREE.MeshStandardMaterial({ color: 0xb99a6c });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = 2;
            group.add(base);

            const roofGeo = new THREE.ConeGeometry(6, 3, 4);
            const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b3a3a });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = 5;
            roof.rotation.y = Math.PI / 4;
            group.add(roof);

            return group;
        }

        function createGenericMesh() {
            const geo = new THREE.SphereGeometry(3, 8, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xaa8844 });
            return new THREE.Mesh(geo, mat);
        }

        function createMarkerMeshByType(type) {
            switch (type) {
                case 'tree':
                    return createTreeMesh();
                case 'rock':
                    return createRockMesh();
                case 'boulder':
                    return createBoulderMesh();
                case 'house':
                    return createHouseMesh();
                default:
                    return createGenericMesh();
            }
        }

        const SPAWN_RADIUS = 900;
        const DESPAWN_RADIUS = 1150;

        function updateMarkersForPlayer(px, pz) {
            const r2Spawn = SPAWN_RADIUS * SPAWN_RADIUS;
            const r2Despawn = DESPAWN_RADIUS * DESPAWN_RADIUS;

            for (let idx = 0; idx < spawnMarkers.length; idx++) {
                const m = spawnMarkers[idx];
                const dx = m.x - px;
                const dz = m.z - pz;
                const dist2 = dx * dx + dz * dz;

                if (dist2 <= r2Spawn) {
                    if (!activeMarkerMeshes.has(idx)) {
                        const mesh = createMarkerMeshByType(m.type);
                        mesh.position.set(m.x, m.y, m.z);
                        markerGroup.add(mesh);
                        activeMarkerMeshes.set(idx, mesh);
                    }
                }
            }

            for (const [idx, mesh] of activeMarkerMeshes.entries()) {
                const m = spawnMarkers[idx];
                const dx = m.x - px;
                const dz = m.z - pz;
                const dist2 = dx * dx + dz * dz;

                if (dist2 > r2Despawn) {
                    markerGroup.remove(mesh);
                    activeMarkerMeshes.delete(idx);
                }
            }
        }

        // --------- ОБНОВЛЕНИЕ FP-КОНТРОЛОВ ---------
        function updateFP(delta) {
            if (mode !== 'fp' || !fpControls.isLocked) return;

            updateGamepad(delta);

            let moveForward = 0;
            let moveRight = 0;

            if (moveState.forward) moveForward += WALK_SPEED * delta;
            if (moveState.backward) moveForward -= WALK_SPEED * delta;
            if (moveState.right) moveRight += WALK_SPEED * delta;
            if (moveState.left) moveRight -= WALK_SPEED * delta;

            moveForward += gamepadMoveForward;
            moveRight += gamepadMoveRight;

            if (moveForward !== 0) fpControls.moveForward(moveForward);
            if (moveRight !== 0) fpControls.moveRight(moveRight);

            const obj = fpControls.getObject();

            obj.position.x = THREE.MathUtils.clamp(obj.position.x, -HALF_X * 0.98, HALF_X * 0.98);
            obj.position.z = THREE.MathUtils.clamp(obj.position.z, -HALF_Z * 0.98, HALF_Z * 0.98);

            const groundY = sampleHeightAt(obj.position.x, obj.position.z);
            const targetY = groundY + EYE_HEIGHT;

            const diff = targetY - obj.position.y;
            const clampedDiff = THREE.MathUtils.clamp(diff, -MAX_VERTICAL_STEP, MAX_VERTICAL_STEP);
            const intermediateY = obj.position.y + clampedDiff;

            obj.position.y = THREE.MathUtils.lerp(obj.position.y, intermediateY, VERTICAL_SMOOTH);

            // ориентация с телефона
            applyRemoteOrientation();

            const biIdx = sampleBiomeIndexAt(obj.position.x, obj.position.z);
            currentBiomeLabel = biomeLabelFromIndex(biIdx);
            updateHud();

            updateChunksForPosition(obj.position.x, obj.position.z, 2000);
            updateMarkersForPlayer(obj.position.x, obj.position.z);
        }

        // --------- СЕТЕВОЙ ЛИНК (HOST) + СТРИМ ---------
        const hostLink = startHostLink(
            () => {
                const pos = camera.position;
                const quat = camera.quaternion;
                return {
                    mode,
                    pos: { x: pos.x, y: pos.y, z: pos.z },
                    quat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
                };
            },
            (status) => {
                linkStatus = status;
                updateHud();
            }
        );

        let lastFrameSent = 0;
        let frameSending = false;
        const FRAME_INTERVAL = 1000 / 30; // 30 FPS по стриму

        function trySendFrame(now) {
            if (!window.__seedSendFrame || frameSending) return;
            if (now - lastFrameSent < FRAME_INTERVAL) return;

            frameSending = true;
            lastFrameSent = now;

            renderer.domElement.toBlob(
                (blob) => {
                    frameSending = false;
                    if (!blob) return;
                    try {
                        window.__seedSendFrame(blob);
                    } catch (e) {
                        console.warn('[main3d] send frame error:', e);
                    }
                },
                'image/jpeg',
                0.7
            );
        }

        // --------- РЕНДЕР-ЦИКЛ ---------
        function animate() {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();
            // === FPS counter ===
            fpsAccum += delta;
            fpsFrames += 1;
            if (fpsAccum >= 0.5) {
                // обновляем раз в полсекунды
                fpsValue = fpsFrames / fpsAccum;
                fpsAccum = 0;
                fpsFrames = 0;
                if (showFPS) {
                    fpsBox.textContent = `FPS: ${fpsValue.toFixed(1)}`;
                }
            }

            updateSun(delta);

            if (mode === 'orbit') {
                orbitControls.update();
                updateChunksForPosition(camera.position.x, camera.position.z, 8000);
            } else {
                updateFP(delta);
            }

            renderer.render(scene, camera);

            // Стримим картинку для телефона
            trySendFrame(performance.now());
        }

        updateHud();
        animate();
    } catch (err) {
        console.error(err);
        const pre = document.createElement('pre');
        pre.style.position = 'absolute';
        pre.style.top = '30px';
        pre.style.left = '10px';
        pre.style.color = 'red';
        pre.textContent = String(err);
        document.body.appendChild(pre);
    }
}

run();
