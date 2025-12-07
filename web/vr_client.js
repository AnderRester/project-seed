// vr_client.js (телефон / client)
import { startClientLink } from './remote_link.js';

async function runVRClient() {
    // ---------- STATUS ----------
    let statusEl = document.getElementById('status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'status';
        statusEl.style.position = 'fixed';
        statusEl.style.top = '10px';
        statusEl.style.right = '10px';
        statusEl.style.padding = '6px 10px';
        statusEl.style.borderRadius = '6px';
        statusEl.style.background = 'rgba(0,0,0,0.5)';
        statusEl.style.color = '#fff';
        statusEl.style.fontFamily = 'system-ui, sans-serif';
        statusEl.style.fontSize = '12px';
        statusEl.style.zIndex = '30';
        statusEl.style.pointerEvents = 'none';
        document.body.appendChild(statusEl);
    }

    // ---------- CANVAS (STEREO FRAME) ----------
    let canvas = document.getElementById('vrCanvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'vrCanvas';
        document.body.appendChild(canvas);
    }
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '0';
    canvas.style.display = 'block';

    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.backgroundColor = '#000';
    document.documentElement.style.backgroundColor = '#000';

    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.width = w;
        canvas.height = h;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ---------- SAO-HUD ROOT ----------
    const hudRoot = document.createElement('div');
    hudRoot.style.position = 'fixed';
    hudRoot.style.inset = '0';
    hudRoot.style.pointerEvents = 'none';
    hudRoot.style.zIndex = '20';
    document.body.appendChild(hudRoot);

    // ===== HP BAR (SAO-STYLE) =====
    const hpWrapper = document.createElement('div');
    hpWrapper.style.position = 'absolute';
    hpWrapper.style.top = '4%';
    hpWrapper.style.left = '3%';

    // фикс. размер + адаптация под ширину экрана
    hpWrapper.style.width = '320px';
    hpWrapper.style.maxWidth = '50vw';
    hpWrapper.style.aspectRatio = '6 / 1'; // держим форму
    hpWrapper.style.height = 'auto';

    hpWrapper.style.display = 'flex';
    hpWrapper.style.alignItems = 'center';
    hpWrapper.style.pointerEvents = 'none';
    hudRoot.appendChild(hpWrapper);

    // Фон HP (SVG)
    const hpBg = document.createElement('div');
    hpBg.style.position = 'relative';
    hpBg.style.width = '100%';
    hpBg.style.height = '100%';
    hpBg.style.backgroundImage = "url('./ui/HP_bg.svg')";
    hpBg.style.backgroundSize = '100% 100%';
    hpBg.style.backgroundRepeat = 'no-repeat';
    hpBg.style.filter = 'drop-shadow(0 0 6px rgba(0,0,0,0.6))';
    hpWrapper.appendChild(hpBg);

    // Имя игрока
    const hpName = document.createElement('div');
    hpName.textContent = 'Player';
    hpName.style.position = 'absolute';
    hpName.style.left = '30px';
    hpName.style.top = '42%';
    hpName.style.transform = 'translateY(-50%)';
    hpName.style.fontFamily = 'system-ui, sans-serif';
    hpName.style.fontSize = '14px';
    hpName.style.rotate = '1.3deg';
    hpName.style.letterSpacing = '0.06em';
    hpName.style.color = '#ffffff';
    hpName.style.textShadow = '0 0 4px rgba(0,0,0,0.6)';
    hpBg.appendChild(hpName);

    // Внутренний контейнер под заливку HP:
    // подгоняем под «прямую» часть внутри SVG
    const hpFillContainer = document.createElement('div');
    hpFillContainer.style.position = 'absolute';
    hpFillContainer.style.top = '28%';
    hpFillContainer.style.bottom = '22%';
    hpFillContainer.style.left = '90px';
    hpFillContainer.style.right = '18px';
    hpFillContainer.style.overflow = 'hidden';
    hpBg.appendChild(hpFillContainer);

    // Сама заливка HP (SVG), скейлим по X, но с запасом
    const hpFill = document.createElement('div');
    hpFill.style.position = 'absolute';
    hpFill.style.left = '0';
    hpFill.style.top = '0';
    hpFill.style.width = '100%';
    hpFill.style.height = '100%';
    hpFill.style.backgroundImage = "url('./ui/HP.svg')";
    hpFill.style.backgroundSize = '100% 100%';
    hpFill.style.backgroundRepeat = 'no-repeat';
    hpFill.style.rotate = '0.3deg';
    hpFill.style.transformOrigin = 'left center';
    hpFill.style.transform = 'scaleX(1)';
    hpFillContainer.appendChild(hpFill);

    let hpValue = 1.0;

    function setHpFraction(frac) {
        const f = Math.min(1, Math.max(0, frac));
        hpValue = f;
        // не даём заполнению упираться в край, оставляем небольшой внутренний отступ
        const visible = 0.06 + f * 0.9; // 6% пусто слева+справа
        hpFill.style.transform = `scaleX(${visible})`;
    }

    setHpFraction(1.0);
    // ===== TIME PANEL (SAO-STYLE) =====

    // ===== TIME PANEL (SAO-STYLE) =====
    const timePanel = document.createElement('div');
    timePanel.style.position = 'absolute';
    timePanel.style.bottom = '4%';
    timePanel.style.right = '4%';
    timePanel.style.width = '210px';
    timePanel.style.height = '70px';
    timePanel.style.backgroundImage = "url('./ui/Time.svg')";
    timePanel.style.backgroundSize = '100% 100%';
    timePanel.style.backgroundRepeat = 'no-repeat';
    timePanel.style.display = 'flex';
    timePanel.style.flexDirection = 'column';
    timePanel.style.justifyContent = 'center';
    timePanel.style.alignItems = 'flex-end';
    timePanel.style.paddingRight = '22px';
    timePanel.style.filter = 'drop-shadow(0 0 5px rgba(0,0,0,0.7))';
    hudRoot.appendChild(timePanel);

    const timeText = document.createElement('div');
    timeText.style.fontFamily = 'system-ui, sans-serif';
    timeText.style.fontSize = '22px';
    timeText.style.letterSpacing = '0.12em';
    timeText.style.color = '#ffffff';
    timeText.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
    timePanel.appendChild(timeText);

    const dateText = document.createElement('div');
    dateText.style.marginTop = '2px';
    dateText.style.fontFamily = 'system-ui, sans-serif';
    dateText.style.fontSize = '12px';
    dateText.style.letterSpacing = '0.18em';
    dateText.style.color = 'rgba(255,255,255,0.78)';
    dateText.style.textShadow = '0 0 4px rgba(0,0,0,0.8)';
    timePanel.appendChild(dateText);

    function updateClock() {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const yyyy = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        timeText.textContent = `${hh}:${mm}`;
        dateText.textContent = `${yyyy}/${mo}/${dd}`;
    }
    updateClock();
    setInterval(updateClock, 1000 * 30);

    // ===== FPS (телефон) =====
    const fpsEl = document.createElement('div');
    fpsEl.style.position = 'fixed';
    fpsEl.style.bottom = '4%';
    fpsEl.style.left = '4%';
    fpsEl.style.padding = '4px 8px';
    fpsEl.style.borderRadius = '6px';
    fpsEl.style.background = 'rgba(0,0,0,0.5)';
    fpsEl.style.color = '#fff';
    fpsEl.style.fontFamily = 'system-ui, sans-serif';
    fpsEl.style.fontSize = '11px';
    fpsEl.style.zIndex = '25';
    fpsEl.style.pointerEvents = 'none';
    document.body.appendChild(fpsEl);

    let lastFrameTime = performance.now();
    let fpsAccum = 0;
    let fpsCount = 0;
    let fpsDisplayed = 0;

    function updateFps() {
        const now = performance.now();
        const dt = now - lastFrameTime;
        lastFrameTime = now;
        const fps = dt > 0 ? 1000 / dt : 0;
        fpsAccum += fps;
        fpsCount++;
        if (fpsCount >= 10) {
            fpsDisplayed = fpsAccum / fpsCount;
            fpsAccum = 0;
            fpsCount = 0;
            fpsEl.textContent = `FPS: ${fpsDisplayed.toFixed(1)}`;
        }
    }

    // ---------- REMOTE STATE ----------
    let remoteState = {
        mode: 'orbit',
        pos: { x: 0, y: 1000, z: 0 },
        quat: { x: 0, y: 0, z: 0, w: 1 },
    };

    // ---------- FRAME QUEUE ----------
    let nextFrameData = null; // Blob / ArrayBuffer
    let currentFrameBitmap = null;
    let decoding = false;

    function handleFrame(data) {
        // всегда держим только последний кадр
        nextFrameData = data;
    }

    async function decodeNextFrame() {
        if (decoding || !nextFrameData) return;
        decoding = true;

        const data = nextFrameData;
        nextFrameData = null;

        try {
            let blob;
            if (data instanceof Blob) {
                blob = data;
            } else if (data instanceof ArrayBuffer) {
                blob = new Blob([data], { type: 'image/jpeg' });
            } else {
                decoding = false;
                return;
            }

            const bitmap = await createImageBitmap(blob);
            if (currentFrameBitmap) currentFrameBitmap.close();
            currentFrameBitmap = bitmap;
        } catch (e) {
            console.warn('[VRClient] decode frame error:', e);
        } finally {
            decoding = false;
        }
    }

    function drawFrame() {
        if (!currentFrameBitmap) return;

        const w = canvas.width;
        const h = canvas.height;
        const halfW = w / 2;

        const iw = currentFrameBitmap.width;
        const ih = currentFrameBitmap.height;

        const targetHalfW = halfW;
        const targetH = h;

        const scale = Math.min(targetHalfW / iw, targetH / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (targetHalfW - dw) / 2;
        const dy = (targetH - dh) / 2;

        ctx.clearRect(0, 0, w, h);

        // левый глаз
        ctx.drawImage(currentFrameBitmap, 0, 0, iw, ih, dx, dy, dw, dh);
        // правый глаз — та же картинка
        ctx.drawImage(currentFrameBitmap, 0, 0, iw, ih, halfW + dx, dy, dw, dh);
    }

    // ---------- LINK TO PC ----------
    let link = startClientLink(
        (payload) => {
            if (payload) remoteState = payload;
        },
        (status) => {
            statusEl.textContent = `Link: ${status}`;
        },
        handleFrame
    );

    // ---------- ORIENTATION TO PC ----------
    let lastOrientationSend = 0;
    const ORIENT_INTERVAL = 1000 / 30;

    function sendOrientation(yaw, pitch, roll) {
        if (!link) return;
        const now = performance.now();
        if (now - lastOrientationSend < ORIENT_INTERVAL) return;
        lastOrientationSend = now;

        link.send({
            type: 'orientation',
            payload: { yaw, pitch, roll },
        });
    }

    function handleDeviceOrientation(ev) {
        const alpha = ((ev.alpha || 0) * Math.PI) / 180;
        const beta = ((ev.beta || 0) * Math.PI) / 180;
        const gamma = ((ev.gamma || 0) * Math.PI) / 180;

        const yaw = alpha;
        const pitch = beta;
        const roll = gamma;

        sendOrientation(yaw, pitch, roll);
    }

    async function initOrientation() {
        if (
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
            const btn = document.createElement('button');
            btn.textContent = 'Enable VR';
            btn.style.position = 'fixed';
            btn.style.bottom = '20px';
            btn.style.left = '50%';
            btn.style.transform = 'translateX(-50%)';
            btn.style.padding = '10px 16px';
            btn.style.background = 'rgba(0,0,0,0.7)';
            btn.style.color = '#fff';
            btn.style.border = 'none';
            btn.style.borderRadius = '8px';
            btn.style.fontSize = '14px';
            btn.style.zIndex = '40';
            btn.style.pointerEvents = 'auto';
            document.body.appendChild(btn);

            btn.onclick = async () => {
                try {
                    const res = await DeviceOrientationEvent.requestPermission();
                    if (res === 'granted') {
                        window.addEventListener('deviceorientation', handleDeviceOrientation, true);
                        document.body.removeChild(btn);
                    } else {
                        btn.textContent = 'Permission denied';
                    }
                } catch (e) {
                    console.error(e);
                    btn.textContent = 'Error requesting permission';
                }
            };
        } else {
            window.addEventListener('deviceorientation', handleDeviceOrientation, true);
        }
    }

    initOrientation();

    // ---------- MAIN LOOP ----------
    function animate() {
        requestAnimationFrame(animate);
        decodeNextFrame();
        drawFrame();
        updateFps();
        // hpValue пока фиксированный; потом можно получать из стейта
    }

    animate();
}

runVRClient().catch((err) => {
    console.error(err);
    const pre = document.createElement('pre');
    pre.style.position = 'absolute';
    pre.style.top = '30px';
    pre.style.left = '10px';
    pre.style.color = 'red';
    pre.textContent = String(err);
    document.body.appendChild(pre);
});
