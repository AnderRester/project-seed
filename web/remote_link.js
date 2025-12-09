// remote_link.js
// Общий модуль связи PC ↔ телефон по WebSocket
// - host: PC (main3d.js)
// - client: телефон (vr_client.js / контроллер)

// ОБЯЗАТЕЛЬНО: mini_ws_server НЕ должен трогать payload,
// просто пробрасывать бинарные и текстовые фреймы как есть.

const WS_PORT = 8080;

function baseWsUrl(role, roomCode = null) {
    // Always use localhost for development
    const host = "localhost";
    let url = `ws://${host}:${WS_PORT}/?role=${encodeURIComponent(role)}`;
    if (roomCode) {
        url += `&room=${encodeURIComponent(roomCode)}`;
    }
    return url;
}

// ---------------- HOST LINK (PC) ----------------
//
// getStateFn() → { mode, pos: {x,y,z}, quat: {x,y,z,w} }
// onStatusChange(status: 'connected' | 'disconnected')
// roomCode (optional) - specific room to create/join
//
// ПЛЮС здесь же выставляем window.__seedSendFrame(blob),
// чтобы main3d.js мог отправлять бинарные кадры.
// Returns: { close(), roomCode }
export function startHostLink(getStateFn, onStatusChange, roomCode = null) {
    let socket = null;
    let isOpen = false;
    let shouldReconnect = false; // Disabled for host - prevents reconnection loop
    let isConnecting = false;
    let assignedRoomCode = roomCode;

    function connect() {
        if (isConnecting || (socket && socket.readyState === WebSocket.OPEN)) {
            console.log("[HostLink] Already connecting or connected, skipping...");
            return;
        }

        isConnecting = true;
        socket = new WebSocket(baseWsUrl("host", assignedRoomCode));

        socket.binaryType = "blob";

        socket.onopen = () => {
            isOpen = true;
            isConnecting = false;
            onStatusChange?.("connected");
            console.log("[HostLink] connected, waiting for room assignment...");

            // Глобальный хук для отправки кадров
            window.__seedSendFrame = (blob) => {
                if (!blob || socket.readyState !== WebSocket.OPEN) return;
                try {
                    socket.send(blob); // бинарный JPEG/WebP кадр
                } catch (e) {
                    console.warn("[HostLink] send frame error:", e);
                }
            };
        };

        socket.onclose = (event) => {
            isOpen = false;
            isConnecting = false;
            onStatusChange?.("disconnected");

            const codeExplanation =
                {
                    1000: "Normal closure",
                    1001: "Going away",
                    1005: "No status code - Browser killed connection (usually buffer overflow or network issue)",
                    1006: "Abnormal closure",
                    1009: "Message too big",
                    1011: "Server error",
                }[event.code] || "Unknown";

            console.warn(
                `[HostLink] ❌ Disconnected\n` +
                    `  Code: ${event.code} (${codeExplanation})\n` +
                    `  Reason: ${event.reason || "(empty)"}\n` +
                    `  Clean: ${event.wasClean}\n` +
                    `  BufferedAmount before close: ${socket.bufferedAmount} bytes`
            );
            console.warn("[HostLink] ⚠️ Auto-reconnect disabled - page refresh required");
        };

        socket.onerror = (e) => {
            isConnecting = false;
            console.error(
                `[HostLink] ⚠️ WebSocket Error\n` +
                    `  ReadyState: ${socket?.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)\n` +
                    `  BufferedAmount: ${socket?.bufferedAmount || 0} bytes\n` +
                    `  Error:`,
                e
            );
        };

        socket.onmessage = (ev) => {
            const data = ev.data;

            // от клиентов мы ждём только JSON (ориентация и т.п.)
            if (typeof data === "string") {
                try {
                    const msg = JSON.parse(data);

                    // Room code assignment from server
                    if (msg.type === "room_created") {
                        assignedRoomCode = msg.roomCode;
                        console.log("[HostLink] Room code assigned:", assignedRoomCode);
                        // Notify via global
                        if (window.__seedOnRoomCreated) {
                            window.__seedOnRoomCreated(assignedRoomCode);
                        }
                    }

                    // Player joined/left notifications
                    if (msg.type === "player_joined" || msg.type === "player_left") {
                        console.log(`[HostLink] ${msg.type}:`, msg.playerId, "Total:", msg.totalPlayers);
                        if (window.__seedOnPlayerUpdate) {
                            window.__seedOnPlayerUpdate(msg);
                        }
                    }

                    // Handle world sync request from client
                    if (msg.type === "request_world_sync") {
                        console.log(`[HostLink] Client ${msg.playerId} requesting world sync`);
                        if (window.__seedOnWorldSyncRequest) {
                            window.__seedOnWorldSyncRequest(msg.playerId);
                        }
                    }

                    if (msg.type === "orientation" && msg.payload && window.__seedRemoteOrientation) {
                        // payload: { yaw, pitch, roll }
                        window.__seedRemoteOrientation({
                            orientation: msg.payload,
                            movement: msg.movement,
                            playerId: msg.playerId,
                        });
                    }
                } catch (e) {
                    console.warn("[HostLink] parse client msg error:", e, "raw:", data);
                }
                return;
            }

            // бинарные данные от клиента сейчас не используем
        };
    }

    connect();

    // Manual heartbeat to keep connection alive
    let heartbeatCount = 0;
    const heartbeatId = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({ type: "heartbeat" }));
                heartbeatCount++;
                if (heartbeatCount === 1 || heartbeatCount % 10 === 0) {
                    console.log(`[HostLink] ❤️ Heartbeat #${heartbeatCount}`);
                }
            } catch (e) {
                console.warn("[HostLink] heartbeat error:", e);
            }
        }
    }, 20000); // Every 20 seconds (more frequent than server check)

    // Периодическая отправка состояния камеры
    const intervalId = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (!getStateFn) return;

        // Don't send state during world data transfer
        if (window.__pauseStateUpdates) return;

        try {
            const state = getStateFn();
            if (state && state.pos && state.quat) {
                socket.send(JSON.stringify({ type: "state", payload: state }));
            }
        } catch (e) {
            console.warn("[HostLink] send state error:", e);
        }
    }, 50); // ~20 FPS по состоянию

    return {
        close() {
            shouldReconnect = false;
            clearInterval(intervalId);
            clearInterval(heartbeatId);
            try {
                socket?.close();
            } catch (_) {}
        },
        send(data) {
            if (!socket) {
                console.warn("[HostLink] send() called but socket is null");
                return false;
            }
            if (socket.readyState !== WebSocket.OPEN) {
                console.warn(`[HostLink] send() called but socket not open, state: ${socket.readyState}`);
                return false;
            }

            // Check buffered amount to avoid overwhelming socket
            if (socket.bufferedAmount > 1024 * 1024) {
                // 1MB threshold
                console.warn(`[HostLink] ⚠️ Socket buffer full: ${(socket.bufferedAmount / 1024).toFixed(0)} KB`);
                // Still try to send, but warn
            }

            try {
                socket.send(data);
                // Only log large messages (world_sync), not every frame
                if (data.length > 100000) {
                    console.log(
                        `[HostLink] ✅ Sent large message: ${(data.length / 1024).toFixed(2)} KB, buffered: ${(
                            socket.bufferedAmount / 1024
                        ).toFixed(0)} KB`
                    );
                }
                return true;
            } catch (err) {
                console.error("[HostLink] ❌ send() error:", err);
                return false;
            }
        },
        get roomCode() {
            return assignedRoomCode;
        },
        get isConnected() {
            return socket && socket.readyState === WebSocket.OPEN;
        },
        get socket() {
            return socket; // Expose internal socket for buffer monitoring
        },
    };
}

// ---------------- CLIENT LINK (телефон) ----------------
//
// onFrame(data) — бинарный кадр (Blob или ArrayBuffer)
// roomCode - код комнаты для подключения
// Возвращает WebSocket объект с методом send() и playerId
export function startClientLink(onFrame, roomCode = null) {
    let socket = null;
    let isConnecting = false;
    let shouldReconnect = true;
    let playerId = null;

    function connect() {
        if (isConnecting || (socket && socket.readyState === WebSocket.OPEN)) {
            console.log("[ClientLink] Already connecting or connected, skipping...");
            return;
        }

        if (!roomCode) {
            console.error("[ClientLink] Room code required!");
            return;
        }

        isConnecting = true;
        socket = new WebSocket(baseWsUrl("client", roomCode));
        socket.binaryType = "blob";

        socket.onopen = () => {
            isConnecting = false;
            console.log("[ClientLink] connected, waiting for room confirmation...");
        };

        socket.onclose = () => {
            isConnecting = false;
            console.warn("[ClientLink] disconnected");
            if (shouldReconnect) {
                setTimeout(connect, 3000);
            }
        };

        socket.onerror = (e) => {
            isConnecting = false;
            console.error("[ClientLink] error:", e);
        };

        socket.onmessage = (ev) => {
            const data = ev.data;

            // Текст → JSON state / служебная инфа
            if (typeof data === "string") {
                try {
                    const msg = JSON.parse(data);

                    // Room joined successfully
                    if (msg.type === "joined_room") {
                        playerId = msg.playerId;
                        console.log("[ClientLink] Joined room:", msg.roomCode, "Player ID:", playerId);
                        if (window.__seedOnJoinedRoom) {
                            window.__seedOnJoinedRoom(msg);
                        }
                    }

                    // Error from server
                    if (msg.type === "error") {
                        console.error("[ClientLink] Server error:", msg.message);
                        shouldReconnect = false; // Don't reconnect on error
                        if (window.__seedOnConnectionError) {
                            window.__seedOnConnectionError(msg.message);
                        }
                        socket.close(); // Close immediately
                    }

                    // Host disconnected
                    if (msg.type === "host_disconnected") {
                        console.warn("[ClientLink] Host disconnected");
                        if (window.__seedOnHostDisconnected) {
                            window.__seedOnHostDisconnected();
                        }
                    }

                    if (msg.type === "state" && msg.payload) {
                        // Можно обработать позже если нужно
                    }
                } catch (e) {
                    console.warn("[ClientLink] parse error (string):", e);
                }
                return;
            }

            // Бинарник → кадр (не парсим как JSON!)
            if (data instanceof Blob || data instanceof ArrayBuffer) {
                onFrame?.(data);
                return;
            }

            console.warn("[ClientLink] unknown message data type:", typeof data, data);
        };
    }

    connect();

    return {
        send(data) {
            if (socket?.readyState === WebSocket.OPEN) {
                try {
                    socket.send(JSON.stringify(data));
                } catch (e) {
                    console.warn("[ClientLink] send error:", e);
                }
            }
        },
        close() {
            shouldReconnect = false;
            try {
                socket?.close();
            } catch (_) {}
        },
        get playerId() {
            return playerId;
        },
        get socket() {
            return socket;
        },
    };
}
