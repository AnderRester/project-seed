import init, { SeedWorld } from "./pkg/seed_wasm.js";

async function run() {
    // 1. Загружаем конфиг
    const resp = await fetch("./world-config.json");
    const configText = await resp.text();

    // 2. Инициализируем wasm-модуль
    await init();

    // 3. Создаём мир (размер — какой хочешь)
    const width = 1024;
    const height = 512;
    const world = new SeedWorld(configText, width, height);

    // 4. Получаем RGBA буфер
    const rgba = world.worldview_rgba();
    const w = world.width;
    const h = world.height;

    // 5. Рисуем в canvas
    const canvas = document.getElementById("world");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    ctx.putImageData(imgData, 0, 0);
}

run().catch((err) => {
    console.error(err);
    const pre = document.createElement("pre");
    pre.textContent = String(err);
    document.body.appendChild(pre);
});
