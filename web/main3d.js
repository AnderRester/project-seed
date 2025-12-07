import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

import init, { SeedWorld } from './pkg/seed_wasm.js';

async function run() {
    try {
        // 1. Загружаем конфиг мира
        const resp = await fetch('./world-config.json');
        if (!resp.ok) {
            throw new Error('Failed to load world-config.json: ' + resp.status);
        }
        const configText = await resp.text();

        // 2. Инициализируем wasm
        await init();

        // Размер heightmap
        const reqWidth = 1536;
        const reqHeight = 768;

        const world = new SeedWorld(configText, reqWidth, reqHeight);

        const w = world.width;
        const h = world.height;
        const heights = world.heightmap_values();
        const rgba = world.worldview_rgba();

        console.log('HM size from WASM:', w, h, 'len heights:', heights.length, 'w*h:', w * h);

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

        // --------- СЦЕНА ---------
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050608);

        const TERRAIN_SIZE_X = 2600;
        const TERRAIN_SIZE_Y = 2200;
        const TERRAIN_SIZE_Z = 1600;
        const MAX_HEIGHT = 260; // вертикальный масштаб (метры условно)

        // --------- КАМЕРА ---------
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 8000);
        // Y — вверх (по умолчанию), ничего не меняем
        camera.position.set(0, MAX_HEIGHT * 3.0, TERRAIN_SIZE_Z * 0.9);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        // --------- ОРБИТАЛЬНЫЕ КОНТРОЛЫ (режим 0) ---------
        const orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.target.set(0, 0, 0);
        orbitControls.maxDistance = TERRAIN_SIZE_Z * 2.0;
        orbitControls.minDistance = TERRAIN_SIZE_Z * 0.12;
        orbitControls.enablePan = true;
        orbitControls.update();

        // --------- ГЕОМЕТРИЯ ТЕРРЕЙНА ---------
        // Плоскость XY -> повернём так, чтобы она легла в XZ, а высота была по Y
        const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE_X, TERRAIN_SIZE_Z, w - 1, h - 1);
        geometry.rotateX(-Math.PI / 2); // теперь XZ-плоскость, Y-вверх

        const positions = geometry.attributes.position;
        const posArray = positions.array;

        // Записываем высоту в Y
        for (let yi = 0; yi < h; yi++) {
            for (let xi = 0; xi < w; xi++) {
                const idx = yi * w + xi;
                const heightNorm = safeHeights[idx]; // 0..1
                const y = heightNorm * MAX_HEIGHT;

                const vertIndex = idx * 3;
                // x,z уже заданы в геометрии, меняем только высоту по Y
                posArray[vertIndex + 1] = y;
            }
        }

        positions.needsUpdate = true;
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            flatShading: false,
            wireframe: false,
        });

        const terrainMesh = new THREE.Mesh(geometry, material);
        terrainMesh.frustumCulled = false;
        scene.add(terrainMesh);

        // --------- СВЕТ ---------
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(500, 800, 500);
        scene.add(dirLight);

        const ambient = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambient);

        // --------- FPS КОНТРОЛЫ (режим 1) ---------
        const fpControls = new PointerLockControls(camera, renderer.domElement);
        scene.add(fpControls.getObject());

        const moveState = {
            forward: false,
            backward: false,
            left: false,
            right: false,
        };
        // const velocity = new THREE.Vector3();
        // const direction = new THREE.Vector3();
        const clock = new THREE.Clock();

        const WALK_SPEED = 40;
        const EYE_HEIGHT = 1.8;
        const MAX_VERTICAL_STEP = 2.0; // макс. "шаг" камеры по высоте за кадр
        const VERTICAL_SMOOTH = 0.35; // сглаживание 0..1

        // выбор высоты по world XZ (simple nearest-neighbour)
        function sampleHeightAt(worldX, worldY) {
            // Переводим мировые координаты в индексы heightmap (0..w-1, 0..h-1)
            const u = (worldX / TERRAIN_SIZE_X + 0.5) * (w - 1);
            const v = (worldY / TERRAIN_SIZE_Y + 0.5) * (h - 1);

            // Вне плоскости – считаем, что высота = 0
            if (u < 0 || v < 0 || u > w - 1 || v > h - 1) {
                return 0;
            }

            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            const x1 = Math.min(x0 + 1, w - 1);
            const y1 = Math.min(y0 + 1, h - 1);

            const fx = u - x0;
            const fy = v - y0;

            const i00 = y0 * w + x0;
            const i10 = y0 * w + x1;
            const i01 = y1 * w + x0;
            const i11 = y1 * w + x1;

            const h00 = safeHeights[i00];
            const h10 = safeHeights[i10];
            const h01 = safeHeights[i01];
            const h11 = safeHeights[i11];

            // билинейная интерполяция
            const h0 = h00 * (1 - fx) + h10 * fx;
            const h1 = h01 * (1 - fx) + h11 * fx;
            const hNorm = h0 * (1 - fy) + h1 * fy; // 0..1

            return hNorm * MAX_HEIGHT; // высота в мировых единицах (по Z)
        }

        function placePlayerAt(x, z) {
            const yGround = sampleHeightAt(x, z);
            const obj = fpControls.getObject();
            obj.position.set(x, yGround + EYE_HEIGHT, z);
        }

        // --------- ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ---------
        let mode = 'orbit'; // 'orbit' | 'fp'

        function switchToOrbit() {
            if (mode === 'orbit') return;
            mode = 'orbit';
            orbitControls.enabled = true;
            fpControls.unlock();
            console.log('Switched to ORBIT mode');
        }

        function switchToFP() {
            if (mode === 'fp') return;
            mode = 'fp';
            orbitControls.enabled = false;

            // ставим игрока в центр карты (можно потом улучшить)
            placePlayerAt(0, 0);

            fpControls.lock();
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

        // --------- ОБНОВЛЕНИЕ FPS-КОНТРОЛОВ ---------
        function updateFP(delta) {
            if (mode !== 'fp' || !fpControls.isLocked) return;

            // --- движение относительно направления камеры ---
            let moveForward = 0;
            let moveRight = 0;

            if (moveState.forward) moveForward += WALK_SPEED * delta; // W – вперёд
            if (moveState.backward) moveForward -= WALK_SPEED * delta; // S – назад
            if (moveState.right) moveRight += WALK_SPEED * delta; // D – вправо
            if (moveState.left) moveRight -= WALK_SPEED * delta; // A – влево

            if (moveForward !== 0) fpControls.moveForward(moveForward);
            if (moveRight !== 0) fpControls.moveRight(moveRight);

            // --- прилипание к рельефу по Z с мягким ограничением шага ---
            const obj = fpControls.getObject();

            const groundZ = sampleHeightAt(obj.position.x, obj.position.y);
            let targetZ = groundZ + EYE_HEIGHT;

            // ограничиваем мгновенный скачок
            const diff = targetZ - obj.position.z;
            const clampedDiff = THREE.MathUtils.clamp(diff, -MAX_VERTICAL_STEP, MAX_VERTICAL_STEP);
            const intermediateZ = obj.position.z + clampedDiff;

            // лёгкое сглаживание
            obj.position.z = THREE.MathUtils.lerp(obj.position.z, intermediateZ, VERTICAL_SMOOTH);
        }
        // --------- РЕНДЕР-ЦИКЛ ---------
        function animate() {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();

            if (mode === 'orbit') {
                orbitControls.update();
            } else {
                updateFP(delta);
            }

            renderer.render(scene, camera);
        }

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
