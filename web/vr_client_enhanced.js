// vr_client_enhanced.js - Мобильный VR/контроллер для Rust seed-server

// Новый протокол: подключаемся напрямую к Rust WebSocket-серверу (без Node/remote_link)

async function runVRClient() {
    // ========== STATUS HUD ==========
    const statusEl = createStatusHUD();

    // ========== MOBILE CONTROLS (UI только для кнопок/джойстика) ==========
    const mobileControls = createMobileControls();

    // ========== STATE ==========
    let wsClient = null;
    let isConnected = false;
    let playerId = null;

    // Motion tracking
    let alpha = 0,
        beta = 0,
        gamma = 0;
    let smoothAlpha = 0,
        smoothBeta = 0,
        smoothGamma = 0;
    const smoothFactor = 0.7;

    // Motion prediction
    let lastOrientation = { alpha: 0, beta: 0, gamma: 0, time: 0 };
    const predictionTime = 33; // 33ms ahead

    // Player state
    let playerHP = 100;
    let playerMaxHP = 100;

    // Movement state is now managed by window.vrMoveState from joystick

    // ========== DEVICE ORIENTATION ==========
    function requestOrientationPermission() {
        if (
            typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
            // iOS 13+ требует разрешения
            DeviceOrientationEvent.requestPermission()
                .then((permissionState) => {
                    if (permissionState === "granted") {
                        startOrientationTracking();
                        console.log("[VRClient] Orientation tracking enabled");
                    } else {
                        console.warn("[VRClient] Orientation denied, video-only mode");
                        // Продолжаем работу без ориентации
                    }
                })
                .catch((err) => {
                    console.error("Orientation permission error:", err);
                    // Продолжаем работу без ориентации
                });
        } else {
            // Android и старые iOS - просто стартуем
            startOrientationTracking();
            console.log("[VRClient] Orientation tracking started (no permission needed)");
        }
    }

    function startOrientationTracking() {
        window.addEventListener(
            "deviceorientation",
            (event) => {
                if (event.alpha !== null) {
                    alpha = event.alpha || 0;
                    beta = event.beta || 0;
                    gamma = event.gamma || 0;

                    // Smoothing
                    smoothAlpha = smoothAlpha * smoothFactor + alpha * (1 - smoothFactor);
                    smoothBeta = smoothBeta * smoothFactor + beta * (1 - smoothFactor);
                    smoothGamma = smoothGamma * smoothFactor + gamma * (1 - smoothFactor);
                }
            },
            true
        );
    }

    // ========== WEBSOCKET CONNECTION (Rust seed-server) ==========
    function connectWebSocket() {
        if (wsClient) {
            console.log("[VRClient] Already have connection, skipping...");
            return;
        }

        const clientId = `vr-${Math.random().toString(36).slice(2, 8)}`;
        playerId = clientId;

        statusEl.textContent = `🔄 Connecting to Rust server as ${clientId}...`;

        wsClient = new WebSocket("ws://" + location.hostname + ":9000/ws");

        wsClient.onopen = () => {
            console.log("[VRClient] Connected to Rust server, sending join");
            const joinMsg = { type: "join", client_id: clientId, role: "vr" };
            wsClient.send(JSON.stringify(joinMsg));
            isConnected = true;
            statusEl.textContent = "✅ Connected to Rust server";
            requestOrientationPermission();
        };

        wsClient.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === "world_snapshot") {
                    // Здесь можно обрабатывать HP/состояние, если сервер будет это слать
                    // Пока просто логируем один раз
                    // console.log("[VRClient] Snapshot players:", msg.players?.length ?? 0);
                }
            } catch (_) {
                // Не JSON — можно игнорировать
            }
        };

        wsClient.onerror = (err) => {
            console.error("[VRClient] WS error", err);
            statusEl.textContent = "❌ Connection error";
        };

        wsClient.onclose = () => {
            console.warn("[VRClient] WS closed, will not auto-reconnect");
            wsClient = null;
            isConnected = false;
            statusEl.textContent = "⚠️ Disconnected";
        };
    }

    function handleMessage(msg) {
        // Обработка JSON сообщений от host
        if (msg.type === "playerState") {
            playerHP = msg.hp || 100;
            playerMaxHP = msg.maxHP || 100;
            updateHPBar();
        } else if (msg.type === "worldInfo") {
            // Информация о мире
            console.log("World info:", msg);
        }
    }

    // Вариант без видеостриминга: телефон работает как контроллер/VR-трекер,
    // поэтому никакой декодинг картинок не нужен.

    // ========== SENDING ORIENTATION & MOVEMENT ==========
    function sendOrientationAndMovement() {
        if (!wsClient || !isConnected) return;

        // Используем window.vrMoveState от джойстика
        const ms = window.vrMoveState || {};
        const movement = {
            forward: !!ms.forward,
            backward: !!ms.backward,
            left: !!ms.left,
            right: !!ms.right,
            jump: !!ms.jump,
            sprint: !!ms.sprint,
            ax: ms.ax || 0, // analog X (-1..1)
            ay: ms.ay || 0, // analog Y (-1..1, forward = +)
        };

        // Отправляем VR-позу и управление на Rust seed-server
        const head_pos = [0, 0, 0];
        const head_quat = [0, 0, 0, 1];

        const poseMsg = {
            type: "vr_pose",
            client_id: playerId,
            head_pos,
            head_quat,
        };

        // При желании можно кодировать ориентацию телефона в кватернион

        const inputMsg = {
            type: "input",
            client_id: playerId,
            dx: movement.ax,
            dy: 0,
            dz: movement.ay,
        };

        try {
            wsClient.send(JSON.stringify(poseMsg));
            wsClient.send(JSON.stringify(inputMsg));
        } catch (err) {
            console.error("Send error:", err);
            isConnected = false;
        }
    }


    // ========== HP BAR UPDATE ==========
    function updateHPBar() {
        hpSystem.updateHP(playerHP, playerMaxHP);
    }

    // ========== UPDATE LOOP ==========
    function update() {
        sendOrientationAndMovement();
        requestAnimationFrame(update);
    }

    // ========== INITIALIZATION ==========
    connectWebSocket();
    update();

    console.log("VR Client Enhanced initialized - connecting to Rust server");
}

// ========== UI CREATION FUNCTIONS ==========
function createRoomCodeInput() {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed;
            const quat = eulerToQuaternion(smoothAlpha, smoothBeta, smoothGamma);

            const poseMsg = {
                type: "vr_pose",
                client_id: playerId,
                head_pos: [0, 0, 0],
                head_quat: quat,
            };
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    const title = document.createElement("h1");
    title.textContent = "🎮 Join VR Session";
    title.style.cssText = `
        color: #fff;
        margin-bottom: 30px;
        font-size: 32px;
        text-shadow: 0 2px 20px rgba(0,200,255,0.5);
    `;


        // Convert DeviceOrientation (alpha, beta, gamma in degrees) to quaternion [x, y, z, w]
        // alpha: 0..360 (z axis), beta: -180..180 (x axis), gamma: -90..90 (y axis)
        function eulerToQuaternion(alphaDeg, betaDeg, gammaDeg) {
            const deg2rad = Math.PI / 180;

            const alpha = alphaDeg * deg2rad; // yaw (z)
            const beta = betaDeg * deg2rad;   // pitch (x)
            const gamma = gammaDeg * deg2rad; // roll (y)

            const c1 = Math.cos(alpha / 2);
            const s1 = Math.sin(alpha / 2);
            const c2 = Math.cos(beta / 2);
            const s2 = Math.sin(beta / 2);
            const c3 = Math.cos(gamma / 2);
            const s3 = Math.sin(gamma / 2);

            // Z * X * Y intrinsic rotation order
            const w = c1 * c2 * c3 - s1 * s2 * s3;
            const x = s2 * c1 * c3 + c2 * s1 * s3;
            const y = c2 * s1 * c3 - s2 * c1 * s3;
            const z = c2 * c3 * s1 + s2 * s3 * c1;

            return [x, y, z, w];
        }
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter Room Code";
    input.maxLength = 6;
    input.style.cssText = `
        width: 280px;
        padding: 18px 24px;
        font-size: 24px;
        text-align: center;
        text-transform: uppercase;
        border: 2px solid rgba(0,200,255,0.3);
        border-radius: 12px;
        background: rgba(255,255,255,0.1);
        backdrop-filter: blur(10px);
        color: #fff;
        font-weight: 600;
        letter-spacing: 4px;
        margin-bottom: 20px;
        transition: all 0.3s;
    `;

    input.addEventListener("focus", () => {
        input.style.borderColor = "rgba(0,200,255,0.8)";
        input.style.boxShadow = "0 0 20px rgba(0,200,255,0.3)";
    });

    input.addEventListener("blur", () => {
        input.style.borderColor = "rgba(0,200,255,0.3)";
        input.style.boxShadow = "none";
    });

    const button = document.createElement("button");
    button.textContent = "Connect";
    button.style.cssText = `
        padding: 16px 48px;
        font-size: 18px;
        font-weight: 600;
        background: linear-gradient(135deg, #00d4ff 0%, #0099ff 100%);
        border: none;
        border-radius: 12px;
        color: #fff;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 20px rgba(0,200,255,0.4);
    `;

    button.addEventListener("mousedown", () => {
        button.style.transform = "scale(0.95)";
    });

    button.addEventListener("mouseup", () => {
        button.style.transform = "scale(1)";
    });

    const errorMsg = document.createElement("div");
    errorMsg.style.cssText = `
        color: #ff4444;
        margin-top: 15px;
        font-size: 14px;
        opacity: 0;
        transition: opacity 0.3s;
    `;

    overlay.appendChild(title);
    overlay.appendChild(input);
    overlay.appendChild(button);
    overlay.appendChild(errorMsg);
    document.body.appendChild(overlay);

    return {
        show() {
            overlay.style.display = "flex";
            input.focus();
        },
        hide() {
            console.log("[RoomCodeUI] Hiding overlay...");
            overlay.style.display = "none";
            console.log("[RoomCodeUI] Overlay hidden, display:", overlay.style.display);
        },
        onConnect(callback) {
            const handleConnect = () => {
                const code = input.value.trim().toUpperCase();
                if (code.length >= 4) {
                    callback(code);
                } else {
                    errorMsg.textContent = "⚠️ Code must be at least 4 characters";
                    errorMsg.style.opacity = "1";
                    setTimeout(() => {
                        errorMsg.style.opacity = "0";
                    }, 3000);
                }
            };

            button.addEventListener("click", handleConnect);
            input.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    handleConnect();
                }
            });
        },
        showError(message) {
            errorMsg.textContent = "❌ " + message;
            errorMsg.style.opacity = "1";
        },
    };
}

function createStatusHUD() {
    const statusEl = document.createElement("div");
    statusEl.id = "status";
    statusEl.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 8px 12px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        color: #fff;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        z-index: 30;
        pointer-events: none;
    `;
    statusEl.textContent = "⚡ Initializing...";
    document.body.appendChild(statusEl);
    return statusEl;
}

function setupCanvas() {
    let canvas = document.getElementById("vrCanvas");
    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "vrCanvas";
        document.body.insertBefore(canvas, document.body.firstChild); // Insert as first child
    }

    canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        display: block;
        touch-action: none;
        background: #000;
    `;

    document.body.style.cssText = `
        margin: 0;
        padding: 0;
        background-color: #000;
        overflow: hidden;
    `;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) {
        console.error("[VRClient] ❌ Failed to get 2D context!");
        return null;
    }

    let onResize = null;

    function resizeCanvas() {
        // Use logical pixels for simplicity
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        console.log(`[VRClient] Canvas resized: ${canvas.width}x${canvas.height}`);

        // Re-render after resize to prevent blank canvas
        if (onResize) {
            onResize();
        }
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Force canvas to front after DOM is ready
    setTimeout(() => {
        canvas.style.zIndex = "1";
        console.log(`[VRClient] Canvas z-index forced: ${canvas.style.zIndex}`);
    }, 100);

    return {
        canvas,
        ctx,
        setResizeCallback: (callback) => {
            onResize = callback;
        },
    };
}

function createMobileControls() {
    const container = document.createElement("div");
    container.id = "mobileControls";
    container.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 220px;
        z-index: 25;
        pointer-events: auto;
    `;
    document.body.appendChild(container);

    // Virtual Joystick (Left)
    const joystickContainer = document.createElement("div");
    joystickContainer.style.cssText = `
        position: absolute;
        bottom: 30px;
        left: 30px;
        width: 120px;
        height: 120px;
        background: radial-gradient(circle, rgba(255,255,255,0.15), rgba(255,255,255,0.05));
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 50%;
        touch-action: none;
    `;

    const joystick = document.createElement("div");
    joystick.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        width: 50px;
        height: 50px;
        background: radial-gradient(circle, rgba(255,255,255,0.6), rgba(255,255,255,0.3));
        border: 2px solid rgba(255,255,255,0.5);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        transition: all 0.1s;
        pointer-events: none;
    `;
    joystickContainer.appendChild(joystick);
    container.appendChild(joystickContainer);

    // Joystick logic
    let joystickActive = false;
    let joystickStartX = 0,
        joystickStartY = 0;

    function handleJoystickStart(e) {
        e.preventDefault();
        joystickActive = true;
        const rect = joystickContainer.getBoundingClientRect();
        joystickStartX = rect.left + rect.width / 2;
        joystickStartY = rect.top + rect.height / 2;
    }

    function handleJoystickMove(e) {
        if (!joystickActive) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - joystickStartX;
        const dy = touch.clientY - joystickStartY;

        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = 35; // pixels

        if (distance > maxDistance) {
            const angle = Math.atan2(dy, dx);
            joystick.style.left = `${50 + Math.cos(angle) * maxDistance}px`;
            joystick.style.top = `${50 + Math.sin(angle) * maxDistance}px`;
        } else {
            joystick.style.left = `${50 + dx}px`;
            joystick.style.top = `${50 + dy}px`;
        }

        // Update movement state
        const threshold = 10;
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.forward = dy < -threshold;
        moveState.backward = dy > threshold;
        moveState.left = dx < -threshold;
        moveState.right = dx > threshold;
        // Analog axes for smoother movement
        moveState.ax = Math.max(-1, Math.min(1, dx / maxDistance));
        moveState.ay = Math.max(-1, Math.min(1, -dy / maxDistance));
    }

    function handleJoystickEnd(e) {
        if (!joystickActive) return;
        e.preventDefault();
        joystickActive = false;
        joystick.style.left = "50%";
        joystick.style.top = "50%";

        // Reset movement
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.forward = false;
        moveState.backward = false;
        moveState.left = false;
        moveState.right = false;
        moveState.ax = 0;
        moveState.ay = 0;
    }

    joystickContainer.addEventListener("touchstart", handleJoystickStart);
    joystickContainer.addEventListener("touchmove", handleJoystickMove);
    joystickContainer.addEventListener("touchend", handleJoystickEnd);
    joystickContainer.addEventListener("mousedown", handleJoystickStart);
    document.addEventListener("mousemove", handleJoystickMove);
    document.addEventListener("mouseup", handleJoystickEnd);

    // Action Buttons (Right side)
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
        position: absolute;
        bottom: 30px;
        right: 30px;
        display: flex;
        flex-direction: column;
        gap: 15px;
    `;

    // Jump Button
    const jumpBtn = createActionButton("⬆", "#4CAF50");
    jumpBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.jump = true;
        jumpBtn.style.transform = "scale(0.9)";
    });
    jumpBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.jump = false;
        jumpBtn.style.transform = "scale(1)";
    });
    buttonsContainer.appendChild(jumpBtn);

    // Sprint Button
    const sprintBtn = createActionButton("⚡", "#FF9800");
    sprintBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.sprint = true;
        sprintBtn.style.transform = "scale(0.9)";
    });
    sprintBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        const moveState = window.vrMoveState || (window.vrMoveState = {});
        moveState.sprint = false;
        sprintBtn.style.transform = "scale(1)";
    });
    buttonsContainer.appendChild(sprintBtn);

    container.appendChild(buttonsContainer);

    return { container, joystickContainer, buttonsContainer };
}

function createActionButton(icon, color) {
    const btn = document.createElement("div");
    btn.style.cssText = `
        width: 60px;
        height: 60px;
        background: ${color};
        border: 3px solid rgba(255,255,255,0.5);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: white;
        cursor: pointer;
        user-select: none;
        transition: all 0.1s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        touch-action: none;
    `;
    btn.textContent = icon;
    return btn;
}

function createHPSystem() {
    const svgNS = "http://www.w3.org/2000/svg";

    const hudRoot = document.createElement("div");
    hudRoot.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 25;
    `;

    // ===== HP BAR (SAO-STYLE using SVG clip-paths) =====
    const hpWrapper = document.createElement("div");
    hpWrapper.style.cssText = `
        position: absolute;
        top: 2%;
        left: 1.5%;
        width: 411px;
        max-width: 65vw;
        aspect-ratio: 411 / 65;
    `;

    // Create inline SVG with clip-path definitions
    const clipSvg = document.createElementNS(svgNS, "svg");
    clipSvg.setAttribute("width", "0");
    clipSvg.setAttribute("height", "0");
    clipSvg.style.position = "absolute";

    const defs = document.createElementNS(svgNS, "defs");

    // HP Background clip path (from HP_bg.svg)
    const bgClipPath = document.createElementNS(svgNS, "clipPath");
    bgClipPath.setAttribute("id", "hpBgClip");
    bgClipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    const bgPath = document.createElementNS(svgNS, "path");
    // Normalize HP_bg.svg path to 0-1 range
    bgPath.setAttribute(
        "d",
        "M0.000325 0.04755 C-0.000118 0.02068 0.00317 -0.00123 0.00742 0.000537 C0.0625 0.01671 0.399 0.11792 0.472 0.12854 C0.545 0.13925 0.93 0.23398 0.992 0.24946 C0.998 0.25059 1.001 0.27855 0.999 0.30631 L0.974 0.96128 C0.973 0.98287 0.970 0.99743 0.967 0.99714 C0.917 0.99615 0.548 0.92823 0.439 0.92085 C0.332 0.91346 0.056 0.82291 0.00996 0.80769 C0.00617 0.80633 0.00334 0.77177 0.00321 0.75524 L0.00282 0.65657 C0.00271 0.63073 0.00590 0.60914 0.00993 0.60881 L0.0195 0.60682 L0.0272 0.60572 L0.0366 0.60398 C0.0405 0.60321 0.0436 0.60125 0.0436 0.57366 L0.0443 0.26264 C0.0443 0.23782 0.0413 0.21713 0.0375 0.21598 L0.00746 0.20667 C0.00365 0.20550 0.000629 0.18599 0.000518 0.16473 L0.000325 0.04755 Z"
    );
    bgClipPath.appendChild(bgPath);
    defs.appendChild(bgClipPath);

    // HP Fill clip path (from HP.svg)
    const fillClipPath = document.createElementNS(svgNS, "clipPath");
    fillClipPath.setAttribute("id", "hpFillClip");
    fillClipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    const fillPath = document.createElementNS(svgNS, "path");
    // Normalize HP.svg path to 0-1 range
    fillPath.setAttribute(
        "d",
        "M0.524 0.970 L0.538 0.756 C0.539 0.726 0.542 0.728 0.546 0.728 L0.745 0.754 L0.966 0.790 C0.968 0.792 0.972 0.780 0.973 0.762 L0.998 0.312 C1.000 0.279 0.996 0.240 0.993 0.239 C0.922 0.227 0.478 0.150 0.376 0.126 C0.279 0.103 0.048 0.016 0.00665 0.00006 C0.00303 -0.00131 0 0.022 0 0.051 L0 0.795 C0 0.822 0.00261 0.844 0.00599 0.846 C0.0344 0.858 0.160 0.909 0.280 0.946 C0.390 0.979 0.489 0.996 0.518 0.997 C0.521 0.997 0.523 0.987 0.524 0.970 Z"
    );
    fillClipPath.appendChild(fillPath);
    defs.appendChild(fillClipPath);

    clipSvg.appendChild(defs);
    hpWrapper.appendChild(clipSvg);

    // HP Background container
    const hpBgContainer = document.createElement("div");
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

    // HP Fill container (clips with width, not scale)
    const hpFillContainer = document.createElement("div");
    hpFillContainer.style.cssText = `
        position: absolute;
        left: 22%;
        top: 20%;
        width: 76%;
        height: 60%;
        overflow: hidden;
    `;

    const hpFillInner = document.createElement("div");
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

    // Content overlay (text, labels)
    const contentOverlay = document.createElement("div");
    contentOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    `;

    // Player name
    const playerName = document.createElement("div");
    playerName.textContent = "PLAYER";
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

    // Level text
    const levelText = document.createElement("div");
    levelText.textContent = "LV: 45";
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

    // HP value text
    const hpText = document.createElement("div");
    hpText.textContent = "915.8 M/2.0 G";
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

    // ===== TIME PANEL (SAO-STYLE) =====
    const timePanel = document.createElement("div");
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

    const timeText = document.createElement("div");
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

    const dateText = document.createElement("div");
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
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const yyyy = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");

        timeText.textContent = `${hh}:${mm}`;
        dateText.textContent = `${yyyy}/${mo}/${dd}`;
    }
    updateClock();
    setInterval(updateClock, 30000);

    hudRoot.appendChild(timePanel);
    document.body.appendChild(hudRoot);

    return {
        container: hudRoot,
        fillContainer: hpFillContainer,
        fillInner: hpFillInner,
        text: hpText,
        updateHP(current, max) {
            const percentage = Math.max(0, Math.min(100, (current / max) * 100));

            // Изменяем width, а не scale - форма не деформируется!
            hpFillContainer.style.width = percentage + "%";

            // Format as MB/GB style (SAO reference)
            const currentMB = (current * 9.158).toFixed(1);
            const maxGB = (max / 100).toFixed(1);
            hpText.textContent = `${currentMB} M/${maxGB} G`;

            // Color based on HP percentage
            if (percentage > 60) {
                hpFillInner.style.background =
                    "linear-gradient(90deg, #44D600 0%, #3BC800 40%, #32BA00 70%, #2AAC00 100%)";
                hpFillInner.style.filter = "drop-shadow(0 0 12px rgba(68,214,0,0.8))";
            } else if (percentage > 30) {
                hpFillInner.style.background = "linear-gradient(90deg, #FFA500 0%, #FF8C00 50%, #FF7700 100%)";
                hpFillInner.style.filter = "drop-shadow(0 0 12px rgba(255,165,0,0.8))";
            } else {
                hpFillInner.style.background = "linear-gradient(90deg, #FF4444 0%, #DD0000 50%, #CC0000 100%)";
                hpFillInner.style.filter = "drop-shadow(0 0 12px rgba(255,68,68,0.8))";
            }
        },
    };
}

// ========== START ==========
runVRClient().catch(console.error);
