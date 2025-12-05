import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import init, { SeedWorld } from "./pkg/seed_wasm.js";

async function run() {
    try {
        // 1. Загружаем конфиг мира
        const resp = await fetch("./world-config.json");
        if (!resp.ok) {
            throw new Error("Failed to load world-config.json: " + resp.status);
        }
        const configText = await resp.text();

        // 2. Инициализируем wasm
        await init();

        const width = 512;
        const height = 512;

        const world = new SeedWorld(configText, width, height);
        const heights = world.heightmap_values(); // Float32Array (через wasm-bindgen)
        const rgba = world.worldview_rgba();
        const w = world.width;
        const h = world.height;

        // текстура из worldview (RGBA)
        const texData = new Uint8Array(rgba); // из wasm-bindgen приходит Uint8Array-подобное
        const texture = new THREE.DataTexture(texData, w, h, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.magFilter = THREE.NearestFilter; // чтобы не мылить
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;

        console.log("World size:", w, h);

        // 3. Three.js сцена
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050608);

        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 4000);
        camera.position.set(0, 300, 500);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, 0);
        controls.update();

        // 4. Создаём плоскость и поднимаем вершины по высоте
        const sizeX = 2000;
        const sizeZ = 2000;
        const geometry = new THREE.PlaneGeometry(sizeX, sizeZ, w - 1, h - 1);

        const positions = geometry.attributes.position;
        const posArray = positions.array; // Float32Array [x,y,z,...]

        const maxHeight = 150;
        for (let yi = 0; yi < h; yi++) {
            for (let xi = 0; xi < w; xi++) {
                const idx = yi * w + xi;
                const heightNorm = heights[idx]; // 0..1
                const z = heightNorm * maxHeight;

                const vertIndex = idx * 3;
                // x,y заданы PlaneGeometry, меняем только "высоту"
                posArray[vertIndex + 2] = z;
            }
        }

        positions.needsUpdate = true;
        geometry.computeVertexNormals();

        // const material = new THREE.MeshStandardMaterial({
        //     color: 0x88aa55,
        //     flatShading: false,
        //     wireframe: false,
        // });

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            flatShading: false,
            wireframe: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2; // из XY в XZ
        scene.add(mesh);

        // 5. Свет
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(200, 400, 200);
        scene.add(dirLight);

        const ambient = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambient);

        // 6. Ресайз
        window.addEventListener("resize", () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // 7. Рендер-цикл
        function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }

        animate();
    } catch (err) {
        console.error(err);
        const pre = document.createElement("pre");
        pre.style.position = "absolute";
        pre.style.top = "30px";
        pre.style.left = "10px";
        pre.style.color = "red";
        pre.textContent = String(err);
        document.body.appendChild(pre);
    }
}

run();
