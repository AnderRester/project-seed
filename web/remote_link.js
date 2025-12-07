// remote_link.js
// Общий модуль связи PC ↔ телефон по WebSocket
// - host: PC (main3d.js)
// - client: телефон (vr_client.js / контроллер)

// ОБЯЗАТЕЛЬНО: mini_ws_server НЕ должен трогать payload,
// просто пробрасывать бинарные и текстовые фреймы как есть.

const WS_PORT = 8080;

function baseWsUrl(role) {
    const host = location.hostname || 'localhost';
    return `ws://${host}:${WS_PORT}/?role=${encodeURIComponent(role)}`;
}

// ---------------- HOST LINK (PC) ----------------
//
// getStateFn() → { mode, pos: {x,y,z}, quat: {x,y,z,w} }
// onStatusChange(status: 'connected' | 'disconnected')
//
// ПЛЮС здесь же выставляем window.__seedSendFrame(blob),
// чтобы main3d.js мог отправлять бинарные кадры.
export function startHostLink(getStateFn, onStatusChange) {
    let socket = null;
    let isOpen = false;

    function connect() {
        socket = new WebSocket(baseWsUrl('host'));

        socket.binaryType = 'blob';

        socket.onopen = () => {
            isOpen = true;
            onStatusChange?.('connected');
            console.log('[HostLink] connected');

            // Глобальный хук для отправки кадров
            window.__seedSendFrame = (blob) => {
                if (!blob || socket.readyState !== WebSocket.OPEN) return;
                try {
                    socket.send(blob); // бинарный JPEG/WebP кадр
                } catch (e) {
                    console.warn('[HostLink] send frame error:', e);
                }
            };
        };

        socket.onclose = () => {
            isOpen = false;
            onStatusChange?.('disconnected');
            console.warn('[HostLink] disconnected, retrying in 3s...');
            setTimeout(connect, 3000);
        };

        socket.onerror = (e) => {
            console.error('[HostLink] error:', e);
        };

        socket.onmessage = (ev) => {
            const data = ev.data;

            // от клиентов мы ждём только JSON (ориентация и т.п.)
            if (typeof data === 'string') {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'orientation' && msg.payload && window.__seedRemoteOrientation) {
                        // payload: { yaw, pitch, roll }
                        window.__seedRemoteOrientation({ orientation: msg.payload });
                    }
                } catch (e) {
                    console.warn('[HostLink] parse client msg error:', e, 'raw:', data);
                }
                return;
            }

            // бинарные данные от клиента сейчас не используем
        };
    }

    connect();

    // Периодическая отправка состояния камеры
    const intervalId = setInterval(() => {
        if (!isOpen || !getStateFn) return;
        try {
            const state = getStateFn();
            socket.send(JSON.stringify({ type: 'state', payload: state }));
        } catch (e) {
            console.warn('[HostLink] send state error:', e);
        }
    }, 50); // ~20 FPS по состоянию

    return {
        close() {
            clearInterval(intervalId);
            try {
                socket?.close();
            } catch (_) {}
        },
    };
}

// ---------------- CLIENT LINK (телефон) ----------------
//
// onState(payload) — приходит state от PC
// onStatusChange(status)
// onFrame(data) — бинарный кадр (Blob или ArrayBuffer)
export function startClientLink(onState, onStatusChange, onFrame) {
    let socket = null;

    function connect() {
        socket = new WebSocket(baseWsUrl('client'));
        socket.binaryType = 'blob';

        socket.onopen = () => {
            onStatusChange?.('connected');
            console.log('[ClientLink] connected');
        };

        socket.onclose = () => {
            onStatusChange?.('disconnected');
            console.warn('[ClientLink] disconnected, retrying in 3s...');
            setTimeout(connect, 3000);
        };

        socket.onerror = (e) => {
            console.error('[ClientLink] error:', e);
        };

        socket.onmessage = (ev) => {
            const data = ev.data;

            // Текст → JSON state / служебная инфа
            if (typeof data === 'string') {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'state' && msg.payload) {
                        onState?.(msg.payload);
                    }
                } catch (e) {
                    console.warn('[ClientLink] parse error (string):', e, 'raw:', data);
                }
                return;
            }

            // Бинарник → кадр (не парсим как JSON!)
            if (data instanceof Blob || data instanceof ArrayBuffer) {
                onFrame?.(data);
                return;
            }

            console.warn('[ClientLink] unknown message data type:', typeof data, data);
        };
    }

    connect();

    return {
        send(data) {
            if (socket?.readyState === WebSocket.OPEN) {
                try {
                    socket.send(JSON.stringify(data));
                } catch (e) {
                    console.warn('[ClientLink] send error:', e);
                }
            }
        },
        close() {
            try {
                socket?.close();
            } catch (_) {}
        },
    };
}
