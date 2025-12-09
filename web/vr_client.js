// vr_client.js (телефон / client)
import { startClientLink } from './remote_link.js';

function createHPSystem() {
    const svgNS = 'http://www.w3.org/2000/svg';

    const hudRoot = document.createElement('div');
    hudRoot.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 25;
    `;

    // ===== HP BAR (SAO-STYLE using SVG clip-paths) =====
    const hpWrapper = document.createElement('div');
    hpWrapper.style.cssText = `
        position: absolute;
        top: 2%;
        left: 1.5%;
        width: 411px;
        max-width: 65vw;
        aspect-ratio: 411 / 65;
    `;

    const clipSvg = document.createElementNS(svgNS, 'svg');
    clipSvg.setAttribute('width', '0');
    clipSvg.setAttribute('height', '0');
    clipSvg.style.position = 'absolute';

    const defs = document.createElementNS(svgNS, 'defs');

    const bgClipPath = document.createElementNS(svgNS, 'clipPath');
    bgClipPath.setAttribute('id', 'hpBgClip');
    bgClipPath.setAttribute('clipPathUnits', 'objectBoundingBox');
    const bgPath = document.createElementNS(svgNS, 'path');
    bgPath.setAttribute(
        'd',
        'M0.000325 0.04755 C-0.000118 0.02068 0.00317 -0.00123 0.00742 0.000537 C0.0625 0.01671 0.399 0.11792 0.472 0.12854 C0.545 0.13925 0.93 0.23398 0.992 0.24946 C0.998 0.25059 1.001 0.27855 0.999 0.30631 L0.974 0.96128 C0.973 0.98287 0.970 0.99743 0.967 0.99714 C0.917 0.99615 0.548 0.92823 0.439 0.92085 C0.332 0.91346 0.056 0.82291 0.00996 0.80769 C0.00617 0.80633 0.00334 0.77177 0.00321 0.75524 L0.00282 0.65657 C0.00271 0.63073 0.00590 0.60914 0.00993 0.60881 L0.0195 0.60682 L0.0272 0.60572 L0.0366 0.60398 C0.0405 0.60321 0.0436 0.60125 0.0436 0.57366 L0.0443 0.26264 C0.0443 0.23782 0.0413 0.21713 0.0375 0.21598 L0.00746 0.20667 C0.00365 0.20550 0.000629 0.18599 0.000518 0.16473 L0.000325 0.04755 Z'
    );
    bgClipPath.appendChild(bgPath);
    defs.appendChild(bgClipPath);

    const fillClipPath = document.createElementNS(svgNS, 'clipPath');
    fillClipPath.setAttribute('id', 'hpFillClip');
    fillClipPath.setAttribute('clipPathUnits', 'objectBoundingBox');
    const fillPath = document.createElementNS(svgNS, 'path');
    fillPath.setAttribute(
        'd',
        'M0.524 0.970 L0.538 0.756 C0.539 0.726 0.542 0.728 0.546 0.728 L0.745 0.754 L0.966 0.790 C0.968 0.792 0.972 0.780 0.973 0.762 L0.998 0.312 C1.000 0.279 0.996 0.240 0.993 0.239 C0.922 0.227 0.478 0.150 0.376 0.126 C0.279 0.103 0.048 0.016 0.00665 0.00006 C0.00303 -0.00131 0 0.022 0 0.051 L0 0.795 C0 0.822 0.00261 0.844 0.00599 0.846 C0.0344 0.858 0.160 0.909 0.280 0.946 C0.390 0.979 0.489 0.996 0.518 0.997 C0.521 0.997 0.523 0.987 0.524 0.970 Z'
    );
    fillClipPath.appendChild(fillPath);
    defs.appendChild(fillClipPath);

    clipSvg.appendChild(defs);
    hpWrapper.appendChild(clipSvg);

    const hpBgContainer = document.createElement('div');
    hpBgContainer.style.cssText = `
        position: absolute;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg,
            rgba(10,20,35,0.95) 0%,
            rgba(15,30,45,0.90) 50%,
            rgba(20,35,50,0.92) 100%);
        clip-path: url(#hpBgClip);
        border: 1px solid rgba(100,180,255,0.5);
        filter: drop-shadow(0 6px 18px rgba(0,0,0,0.9))
                drop-shadow(0 0 20px rgba(80,160,255,0.4));
    `;

    hpWrapper.appendChild(hpBgContainer);

    const hpFillContainer = document.createElement('div');
    hpFillContainer.style.cssText = `
        position: absolute;
        left: 22%;
        top: 20%;
        width: 76%;
        height: 60%;
        overflow: hidden;
    `;

    const hpFillInner = document.createElement('div');
    hpFillInner.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg,
            #44D600 0%,
            #3BC800 40%,
            #32BA00 70%,
            #2AAC00 100%);
        clip-path: url(#hpFillClip);
        filter: drop-shadow(0 0 12px rgba(68,214,0,0.8));
        transition: background 0.3s, filter 0.3s;
    `;
    hpFillContainer.appendChild(hpFillInner);
    hpBgContainer.appendChild(hpFillContainer);

    const contentOverlay = document.createElement('div');
    contentOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    `;

    const playerName = document.createElement('div');
    playerName.textContent = 'PLAYER';
    playerName.style.cssText = `
        position: absolute;
        left: 18px;
        top: 8px;
        font-family: 'Arial', 'Helvetica', sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.25em;
        color: #D8F0FF;
        text-shadow:
            0 0 14px rgba(120, 200, 255, 1),
            0 0 28px rgba(80, 160, 255, 0.6),
            0 2px 4px rgba(0,0,0,1);
        text-transform: uppercase;
    `;
    contentOverlay.appendChild(playerName);

    const levelText = document.createElement('div');
    levelText.textContent = 'LV: 45';
    levelText.style.cssText = `
        position: absolute;
        left: 18px;
        top: 22px;
        font-family: 'Courier New', 'Consolas', monospace;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.20em;
        color: rgba(216, 240, 255, 0.9);
        text-shadow:
            0 0 10px rgba(120, 200, 255, 0.85),
            0 2px 3px rgba(0,0,0,0.95);
    `;
    contentOverlay.appendChild(levelText);

    const hpText = document.createElement('div');
    hpText.textContent = '915.8 M/2.0 G';
    hpText.style.cssText = `
        position: absolute;
        right: 15px;
        top: 50%;
        transform: translateY(-50%);
        font-family: 'Courier New', 'Consolas', monospace;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #EEFFFF;
        text-shadow:
            0 0 12px rgba(120, 200, 255, 1),
            0 0 24px rgba(80, 160, 255, 0.7),
            0 2px 4px rgba(0,0,0,1);
    `;
    contentOverlay.appendChild(hpText);

    hpBgContainer.appendChild(contentOverlay);
    hudRoot.appendChild(hpWrapper);

    // TIME PANEL
    const timePanel = document.createElement('div');
    timePanel.style.cssText = `
        position: absolute;
        bottom: 3%;
        right: 3%;
        width: 220px;
        height: 75px;
        background: linear-gradient(135deg,
            rgba(0,0,0,0.85) 0%,
            rgba(20,20,30,0.75) 100%);
        border: 2px solid rgba(120, 200, 255, 0.4);
        border-radius: 6px;
        box-shadow:
            0 0 20px rgba(0, 150, 255, 0.3),
            inset 0 0 20px rgba(0, 100, 200, 0.2);
        filter: drop-shadow(0 4px 10px rgba(0,0,0,0.7));
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        clip-path: polygon(
            0% 0%, 95% 0%, 100% 10%, 100% 100%,
            5% 100%, 0% 90%
        );
    `;

    const timeText = document.createElement('div');
    timeText.style.cssText = `
        font-family: 'Courier New', monospace;
        font-size: 26px;
        font-weight: bold;
        letter-spacing: 0.15em;
        color: #E0F4FF;
        text-shadow:
            0 0 10px rgba(100, 200, 255, 0.9),
            0 2px 4px rgba(0,0,0,0.9);
    `;
    timePanel.appendChild(timeText);

    const dateText = document.createElement('div');
    dateText.style.cssText = `
        margin-top: 4px;
        font-family: 'Arial', sans-serif;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.2em;
        color: rgba(224, 244, 255, 0.85);
        text-shadow:
            0 0 8px rgba(100, 200, 255, 0.7),
            0 2px 3px rgba(0,0,0,0.8);
    `;
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
    setInterval(updateClock, 30000);

    hudRoot.appendChild(timePanel);
    document.body.appendChild(hudRoot);

    return {
        container: hudRoot,
        updateHP(current, max) {
            const percentage = Math.max(0, Math.min(100, (current / max) * 100));
            hpFillContainer.style.width = percentage + '%';

            const currentMB = (current * 9.158).toFixed(1);
            const maxGB = (max / 100).toFixed(1);
            hpText.textContent = `${currentMB} M/${maxGB} G`;

            if (percentage > 60) {
                hpFillInner.style.background =
                    'linear-gradient(90deg, #44D600 0%, #3BC800 40%, #32BA00 70%, #2AAC00 100%)';
                hpFillInner.style.filter = 'drop-shadow(0 0 12px rgba(68,214,0,0.8))';
            } else if (percentage > 30) {
                hpFillInner.style.background = 'linear-gradient(90deg, #FFA500 0%, #FF8C00 50%, #FF7700 100%)';
                hpFillInner.style.filter = 'drop-shadow(0 0 12px rgba(255,165,0,0.8))';
            } else {
                hpFillInner.style.background = 'linear-gradient(90deg, #FF4444 0%, #DD0000 50%, #CC0000 100%)';
                hpFillInner.style.filter = 'drop-shadow(0 0 12px rgba(255,68,68,0.8))';
            }
        },
    };
}

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

    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
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

    // Режим отображения: по умолчанию одиночный кадр,
    // по запросу пользователя — VR (стерео, разделённый экран)
    let isStereo = false;

    const vrToggleBtn = document.createElement('button');
    vrToggleBtn.textContent = 'VR';
    vrToggleBtn.style.position = 'fixed';
    vrToggleBtn.style.bottom = '5%';
    vrToggleBtn.style.left = '50%';
    vrToggleBtn.style.transform = 'translateX(-50%)';
    vrToggleBtn.style.padding = '8px 14px';
    vrToggleBtn.style.borderRadius = '999px';
    vrToggleBtn.style.border = '1px solid rgba(255,255,255,0.4)';
    vrToggleBtn.style.background = 'rgba(0,0,0,0.6)';
    vrToggleBtn.style.color = '#fff';
    vrToggleBtn.style.fontFamily = 'system-ui, sans-serif';
    vrToggleBtn.style.fontSize = '13px';
    vrToggleBtn.style.zIndex = '40';
    vrToggleBtn.style.cursor = 'pointer';
    vrToggleBtn.style.pointerEvents = 'auto';
    document.body.appendChild(vrToggleBtn);

    function updateVrButtonLabel() {
        vrToggleBtn.textContent = isStereo ? 'Exit VR' : 'Enter VR';
    }

    async function enableVrMode() {
        isStereo = true;
        updateVrButtonLabel();

        // Пытаемся развернуть на весь экран и заблокировать ориентацию.
        // Если браузер не даёт — просто игнорируем ошибку.
        try {
            if (!document.fullscreenElement && canvas.requestFullscreen) {
                await canvas.requestFullscreen();
            }
        } catch (e) {
            console.warn('Fullscreen request failed:', e);
        }

        try {
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape');
            }
        } catch (e) {
            // На iOS и без HTTPS часто не работает — это нормально.
            console.warn('Orientation lock failed:', e);
        }
    }

    function disableVrMode() {
        isStereo = false;
        updateVrButtonLabel();
    }

    vrToggleBtn.addEventListener('click', () => {
        if (!isStereo) {
            enableVrMode();
        } else {
            disableVrMode();
        }
    });

    updateVrButtonLabel();

    function resizeCanvas() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.width = w;
        canvas.height = h;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ---------- HUD (HP/TIME, как во vr_client_enhanced) ----------
    const hpSystem = createHPSystem();

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

    // Инициализируем HP/Time HUD
    // Пока HP статичен (100/100), но визуальный стиль такой же,
    // как в vr_client_enhanced.
    if (hpSystem && typeof hpSystem.updateHP === 'function') {
        hpSystem.updateHP(100, 100);
    }

    // ---------- REMOTE STATE ----------
    let remoteState = {
        mode: 'orbit',
        pos: { x: 0, y: 1000, z: 0 },
        quat: { x: 0, y: 0, z: 0, w: 1 },
    };

    // ---------- FRAME QUEUE ----------
    let nextFrameData = null; // Blob / ArrayBuffer
    let currentFrameBitmap = null; // ImageBitmap или HTMLImageElement
    let decoding = false;
    let receivedFrameCount = 0;

    // Предсказание движения для уменьшения latency
    let lastOrientation = { yaw: 0, pitch: 0, roll: 0 };
    let orientationVelocity = { yaw: 0, pitch: 0, roll: 0 };
    let lastOrientationTime = performance.now();

    function handleFrame(data) {
        // всегда держим только последний кадр
        nextFrameData = data;
        receivedFrameCount++;
        if (receivedFrameCount <= 5 || receivedFrameCount % 60 === 0) {
            console.log(
                '[VRClient] received frame #',
                receivedFrameCount,
                'type=',
                data instanceof Blob ? 'Blob' : data instanceof ArrayBuffer ? 'ArrayBuffer' : typeof data
            );
        }
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

            // Не на всех мобильных браузерах есть createImageBitmap (например, iOS Safari)
            if (typeof createImageBitmap === 'function') {
                const bitmap = await createImageBitmap(blob, {
                    imageOrientation: 'none',
                    premultiplyAlpha: 'none',
                    colorSpaceConversion: 'none',
                    resizeQuality: 'low',
                });

                if (currentFrameBitmap && typeof currentFrameBitmap.close === 'function') {
                    currentFrameBitmap.close();
                }
                currentFrameBitmap = bitmap;
                console.log('[VRClient] frame decoded via createImageBitmap:', bitmap.width, 'x', bitmap.height);
            } else {
                // Fallback: используем обычный Image
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    if (currentFrameBitmap && typeof currentFrameBitmap.close === 'function') {
                        currentFrameBitmap.close();
                    }
                    currentFrameBitmap = img;
                    URL.revokeObjectURL(url);
                    console.log('[VRClient] frame decoded via Image():', img.width, 'x', img.height);
                };
                img.onerror = (e) => {
                    console.warn('[VRClient] image decode error (fallback):', e);
                    URL.revokeObjectURL(url);
                };
                img.src = url;
            }
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
        const iw = currentFrameBitmap.width;
        const ih = currentFrameBitmap.height;

        // Debug-log размеров, но не слишком часто
        if (receivedFrameCount <= 5 || receivedFrameCount % 60 === 0) {
            console.log('[VRClient] drawFrame canvas=', w, 'x', h, 'image=', iw, 'x', ih);
        }

        ctx.clearRect(0, 0, w, h);

        if (!isStereo) {
            // Обычный режим: один кадр на весь экран, с сохранением пропорций
            const scale = Math.min(w / iw, h / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            const dx = (w - dw) / 2;
            const dy = (h - dh) / 2;
            ctx.drawImage(currentFrameBitmap, 0, 0, iw, ih, dx, dy, dw, dh);
        } else {
            // VR-режим: показываем одно и то же изображение в двух "глазах"
            // (левая и правая половины экрана).
            const halfW = w / 2;

            const scale = Math.min(halfW / iw, h / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            const offsetX = (halfW - dw) / 2;
            const dy = (h - dh) / 2;

            // Левый глаз
            ctx.drawImage(currentFrameBitmap, 0, 0, iw, ih, offsetX, dy, dw, dh);

            // Правый глаз
            ctx.drawImage(currentFrameBitmap, 0, 0, iw, ih, halfW + offsetX, dy, dw, dh);
        }
    }

    // ---------- LINK TO PC ----------
    // Берём код комнаты из query-параметра ?room=ABC123
    const params = new URLSearchParams(window.location.search);
    const roomCode = (params.get('room') || '').trim().toUpperCase();

    if (!roomCode) {
        setStatus('No room code (?room=ABC123)');
        console.error('[VRClient] Missing ?room=CODE in URL');
    }

    const link = roomCode ? startClientLink(handleFrame, roomCode) : null;

    // Глобальные колбэки, которые вызывает remote_link.js
    // при успешном подключении / ошибках / отключении хоста.
    window.__seedOnJoinedRoom = (msg) => {
        setStatus(`Connected to room ${msg.roomCode} as ${msg.playerId}`);
    };

    window.__seedOnConnectionError = (message) => {
        setStatus(`Error: ${message}`);
    };

    window.__seedOnHostDisconnected = () => {
        setStatus('Host disconnected');
    };

    // ---------- ORIENTATION TO PC ----------
    let lastOrientationSend = 0;
    const ORIENT_INTERVAL = 1000 / 60; // 60 Hz для более плавного отклика

    function sendOrientation(yaw, pitch, roll) {
        if (!link) return;
        const now = performance.now();
        if (now - lastOrientationSend < ORIENT_INTERVAL) return;
        lastOrientationSend = now;

        // Вычисляем скорость изменения ориентации для предсказания
        const dt = (now - lastOrientationTime) / 1000;
        if (dt > 0) {
            orientationVelocity.yaw = (yaw - lastOrientation.yaw) / dt;
            orientationVelocity.pitch = (pitch - lastOrientation.pitch) / dt;
            orientationVelocity.roll = (roll - lastOrientation.roll) / dt;
        }

        lastOrientation = { yaw, pitch, roll };
        lastOrientationTime = now;

        // Отправляем текущую ориентацию + скорость для предсказания на сервере
        link.send({
            type: 'orientation',
            payload: {
                yaw,
                pitch,
                roll,
                vyaw: orientationVelocity.yaw,
                vpitch: orientationVelocity.pitch,
                vroll: orientationVelocity.roll,
                timestamp: now,
            },
        });
    }

    function handleDeviceOrientation(ev) {
        const alpha = ((ev.alpha || 0) * Math.PI) / 180;
        const beta = ((ev.beta || 0) * Math.PI) / 180;
        const gamma = ((ev.gamma || 0) * Math.PI) / 180;

        // Применяем фильтр для сглаживания шумов датчика
        const smoothing = 0.7; // 0 = нет сглаживания, 1 = максимальное
        const yaw = lastOrientation.yaw * smoothing + alpha * (1 - smoothing);
        const pitch = lastOrientation.pitch * smoothing + beta * (1 - smoothing);
        const roll = lastOrientation.roll * smoothing + gamma * (1 - smoothing);

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
    let lastLoopTime = performance.now();

    function animate() {
        requestAnimationFrame(animate);

        const now = performance.now();
        const deltaTime = (now - lastLoopTime) / 1000;
        lastLoopTime = now;

        // Предсказываем следующую позицию для компенсации latency
        if (orientationVelocity.yaw !== 0 || orientationVelocity.pitch !== 0 || orientationVelocity.roll !== 0) {
            const predictTime = 0.033; // 33ms предсказание (~2 кадра при 60fps)

            // Используем экстраполяцию для предсказания будущей ориентации
            // Это компенсирует задержку сети и рендеринга
            const predictedYaw = lastOrientation.yaw + orientationVelocity.yaw * predictTime;
            const predictedPitch = lastOrientation.pitch + orientationVelocity.pitch * predictTime;
            const predictedRoll = lastOrientation.roll + orientationVelocity.roll * predictTime;

            // TODO: Применить предсказанную ориентацию к рендерингу
            // (требует передачи matrix transformation в rendering pipeline)
        }

        decodeNextFrame();
        drawFrame();
        updateFps();

        // Автоматическое обновление HP из remoteState
        if (remoteState && remoteState.hp !== undefined) {
            setHpFraction(remoteState.hp);
        }
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
