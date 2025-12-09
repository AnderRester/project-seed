// server.js
// Оптимизированный WebSocket-сервер для связи PC (host) ↔ телефоны (client)
// с поддержкой сжатия, буферизации и бинарного протокола
//
// Установка:
//   npm install ws
// Запуск:
//   node server.js

const WebSocketServer = require("ws").WebSocketServer;
const parse = require("url").parse;
const zlib = require("zlib");

const PORT = 8080;
const ENABLE_COMPRESSION = true; // Сжатие данных
const FRAME_BUFFER_MS = 16; // Буфер для батчинга (60 FPS)

const wss = new WebSocketServer({
    port: PORT,
    maxPayload: 50 * 1024 * 1024, // 50 MB max message size
    perMessageDeflate: ENABLE_COMPRESSION
        ? {
              zlibDeflateOptions: {
                  chunkSize: 1024,
                  memLevel: 7,
                  level: 6, // Компромисс между скоростью и сжатием
              },
              zlibInflateOptions: {
                  chunkSize: 10 * 1024,
              },
              clientNoContextTakeover: true,
              serverNoContextTakeover: true,
              serverMaxWindowBits: 10,
              concurrencyLimit: 10,
              threshold: 256, // Минимальный размер для сжатия
          }
        : false,
});

console.log(`[WS] Optimized server listening on ws://0.0.0.0:${PORT}`);
console.log(`[WS] Compression: ${ENABLE_COMPRESSION ? "ENABLED" : "DISABLED"}`);

// Room system
const rooms = new Map(); // roomCode -> { host, clients, players, frameBuffer, frameTimer, stats }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getOrCreateRoom(roomCode) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, {
            host: null,
            clients: new Set(),
            players: new Map(),
            frameBuffer: null,
            frameTimer: null,
            stats: {
                messagesSent: 0,
                bytesSent: 0,
                messagesReceived: 0,
                bytesReceived: 0,
            },
        });
        console.log(`[Room] Created room: ${roomCode}`);
    }
    return rooms.get(roomCode);
}

function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (room && !room.host && room.clients.size === 0) {
        if (room.frameTimer) clearTimeout(room.frameTimer);
        rooms.delete(roomCode);
        console.log(`[Room] Deleted empty room: ${roomCode}`);
    }
}

// Глобальная статистика по серверу
let globalStats = {
    messagesSent: 0,
    bytesSent: 0,
    messagesReceived: 0,
    bytesReceived: 0,
};

function ensureRoomStats(room) {
    if (!room.stats) {
        room.stats = {
            messagesSent: 0,
            bytesSent: 0,
            messagesReceived: 0,
            bytesReceived: 0,
        };
    }
    return room.stats;
}

wss.on("connection", (ws, req) => {
    const url = req.url || "/";
    const { query } = parse(url, true);
    const role = query.role || "client";
    const roomCode = query.room || null;

    ws.role = role;
    ws.roomCode = roomCode;
    ws.playerId = null;
    ws.connectedAt = Date.now();

    console.log(`[WS] New connection role=${role} room=${roomCode} from ${req.socket.remoteAddress}`);

    if (role === "host") {
        // Host создает или присоединяется к комнате
        let assignedRoom = roomCode;
        if (!assignedRoom) {
            assignedRoom = generateRoomCode();
        }

        const room = getOrCreateRoom(assignedRoom);

        if (room.host && room.host.readyState === ws.OPEN) {
            console.log("[WS] Closing previous host in room", assignedRoom);
            room.host.close();
        }

        room.host = ws;
        ws.roomCode = assignedRoom;

        // Send room code back to host
        ws.send(JSON.stringify({ type: "room_created", roomCode: assignedRoom }));
        console.log(`[WS] Host assigned to room: ${assignedRoom}`);
    } else {
        // Client must have room code
        if (!roomCode) {
            ws.send(JSON.stringify({ type: "error", message: "Room code required" }));
            ws.close();
            return;
        }

        const room = rooms.get(roomCode);
        if (!room || !room.host) {
            ws.send(JSON.stringify({ type: "error", message: "Room not found or host offline" }));
            ws.close();
            return;
        }

        // Generate player ID
        ws.playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        room.clients.add(ws);
        console.log(`[WS] Client joined room ${roomCode}, player ${ws.playerId}`);
        console.log(`[WS] Room ${roomCode} clients: ${room.clients.size}`);

        // Send success to client
        ws.send(
            JSON.stringify({
                type: "joined_room",
                roomCode: roomCode,
                playerId: ws.playerId,
            })
        );

        // Notify host about new player
        if (room.host && room.host.readyState === ws.OPEN) {
            room.host.send(
                JSON.stringify({
                    type: "player_joined",
                    playerId: ws.playerId,
                    totalPlayers: room.clients.size,
                })
            );
        }

        // Send cached frame immediately
        if (room.frameBuffer) {
            try {
                ws.send(room.frameBuffer, { binary: true });
                console.log("[WS] Sent cached frame to new client");
            } catch (err) {
                console.error("[WS] Error sending cached frame:", err);
            }
        }
    }

    ws.on("message", (data, isBinary) => {
        globalStats.messagesReceived++;
        globalStats.bytesReceived += data.length;

        if (ws.role === "host") {
            const room = rooms.get(ws.roomCode);
            if (!room) {
                console.warn(`[WS] Host message for non-existent room ${ws.roomCode}`);
                return;
            }

            const roomStats = ensureRoomStats(room);

            if (isBinary) {
                // Binary frame data - buffer and broadcast to room clients (room-scoped)
                room.frameBuffer = data;

                if (!room.frameTimer) {
                    room.frameTimer = setTimeout(() => {
                        const frame = room.frameBuffer;
                        room.frameBuffer = null;
                        room.frameTimer = null;

                        if (!frame) {
                            return;
                        }

                        let sentCount = 0;
                        for (const client of room.clients) {
                            if (client.readyState === client.OPEN) {
                                // Лёгкий backpressure: если буфер клиента слишком велик — пропускаем кадр
                                if (client.bufferedAmount > 2 * 1024 * 1024) {
                                    continue;
                                }
                                try {
                                    client.send(frame, { binary: true });
                                    roomStats.messagesSent++;
                                    roomStats.bytesSent += frame.length;
                                    globalStats.messagesSent++;
                                    globalStats.bytesSent += frame.length;
                                    sentCount++;
                                } catch (err) {
                                    console.error("[WS] Error sending frame to client:", err);
                                }
                            }
                        }
                        // Для снижения шума в логах кадры не логируем по умолчанию
                        // console.log(`[WS] Frame broadcast to ${sentCount}/${room.clients.size} clients in room ${ws.roomCode}`);
                    }, FRAME_BUFFER_MS);
                }
            } else {
                // Text messages (player sync, world state)
                const payload = data.toString();
                try {
                    const msg = JSON.parse(payload);

                    // Log message type received from host (except frequent state updates)
                    if (msg.type !== "state") {
                        console.log(
                            `[WS] 📨 Host message: type=${msg.type}, size=${(payload.length / 1024).toFixed(2)} KB`
                        );
                    }

                    // Handle heartbeat to keep connection alive
                    if (msg.type === "heartbeat") {
                        ws.isAlive = true;
                        console.log(`[WS] ❤️ Heartbeat received from ${ws.role} in room ${ws.roomCode}`);
                        return;
                    }

                    // Broadcast player updates to all clients in room
                    if (
                        msg.type === "player_update" ||
                        msg.type === "world_sync" ||
                        msg.type === "world_sync_start" ||
                        msg.type === "world_sync_chunk" ||
                        msg.type === "world_sync_end"
                    ) {
                        // Only log for start/end, not every chunk
                        if (msg.type !== "world_sync_chunk") {
                            console.log(
                                `[WS] 🌍 Broadcasting ${msg.type} to ${room.clients.size} clients: ${(
                                    payload.length / 1024
                                ).toFixed(2)} KB`
                            );
                        }

                        let sentCount = 0;
                        for (const client of room.clients) {
                            if (client.readyState === client.OPEN) {
                                try {
                                    client.send(payload);
                                    roomStats.messagesSent++;
                                    roomStats.bytesSent += payload.length;
                                    globalStats.messagesSent++;
                                    globalStats.bytesSent += payload.length;
                                    sentCount++;
                                } catch (err) {
                                    console.error(`[WS] Error sending ${msg.type} to client:`, err);
                                }
                            }
                        }

                        // Only log for start/end
                        if (msg.type !== "world_sync_chunk") {
                            console.log(`[WS] ✅ ${msg.type} sent to ${sentCount}/${room.clients.size} clients`);
                        }
                    }
                } catch (e) {
                    console.warn("[WS] Invalid JSON from host:", e);
                }
            }
        } else {
            // Client sends to host
            const room = rooms.get(ws.roomCode);
            if (!room || !room.host) return;

            const roomStats = ensureRoomStats(room);

            // Add player ID to message
            if (!isBinary) {
                try {
                    const msg = JSON.parse(data.toString());

                    // Handle request_world_sync from client
                    if (msg.type === "request_world_sync") {
                        console.log(`[WS] 🌍 Client ${ws.playerId} requesting world sync`);
                        msg.playerId = ws.playerId;
                        const enriched = JSON.stringify(msg);
                        if (room.host.readyState === room.host.OPEN) {
                            room.host.send(enriched);
                            roomStats.messagesSent++;
                            roomStats.bytesSent += enriched.length;
                            globalStats.messagesSent++;
                            globalStats.bytesSent += enriched.length;
                        }
                        return;
                    }

                    msg.playerId = ws.playerId;
                    const enriched = JSON.stringify(msg);

                    if (room.host.readyState === room.host.OPEN) {
                        room.host.send(enriched);
                        roomStats.messagesSent++;
                        roomStats.bytesSent += enriched.length;
                        globalStats.messagesSent++;
                        globalStats.bytesSent += enriched.length;
                    }
                } catch (e) {
                    // Not JSON, send as-is
                    if (room.host.readyState === room.host.OPEN) {
                        room.host.send(data, { binary: isBinary });
                        roomStats.messagesSent++;
                        roomStats.bytesSent += data.length;
                        globalStats.messagesSent++;
                        globalStats.bytesSent += data.length;
                    }
                }
            } else {
                if (room.host.readyState === room.host.OPEN) {
                    room.host.send(data, { binary: isBinary });
                    roomStats.messagesSent++;
                    roomStats.bytesSent += data.length;
                    globalStats.messagesSent++;
                    globalStats.bytesSent += data.length;
                }
            }
        }
    });

    ws.on("close", (code, reason) => {
        const uptime = ((Date.now() - ws.connectedAt) / 1000).toFixed(1);
        const reasonText = reason.toString() || "(empty)";
        const codeExplanation =
            {
                1000: "Normal closure",
                1001: "Going away",
                1005: "No status code (abnormal - usually browser killed connection)",
                1006: "Abnormal closure (no close frame)",
                1009: "Message too big",
                1011: "Server error",
            }[code] || "Unknown";

        console.log(
            `[WS] ❌ Connection closed role=${ws.role} room=${ws.roomCode} (uptime: ${uptime}s)\n` +
                `     Code: ${code} (${codeExplanation})\n` +
                `     Reason: ${reasonText}\n` +
                `     BufferedAmount: ${ws.bufferedAmount} bytes`
        );

        // Room cleanup
        if (ws.roomCode) {
            const room = rooms.get(ws.roomCode);
            if (room) {
                if (ws.role === "host") {
                    room.host = null;
                    if (room.frameTimer) clearTimeout(room.frameTimer);

                    // Notify all clients that host disconnected
                    for (const client of room.clients) {
                        if (client.readyState === client.OPEN) {
                            client.send(JSON.stringify({ type: "host_disconnected" }));
                        }
                    }
                } else {
                    room.clients.delete(ws);

                    // Notify host about player leaving
                    if (room.host && room.host.readyState === room.host.OPEN) {
                        room.host.send(
                            JSON.stringify({
                                type: "player_left",
                                playerId: ws.playerId,
                                totalPlayers: room.clients.size,
                            })
                        );
                    }
                }

                cleanupRoom(ws.roomCode);
            }
        }
    });

    ws.on("error", (err) => {
        console.error(
            `[WS] ⚠️ WebSocket error for role=${ws.role} room=${ws.roomCode}\n` +
                `     Error: ${err.message}\n` +
                `     Code: ${err.code || "(none)"}\n` +
                `     BufferedAmount: ${ws.bufferedAmount} bytes`
        );
    });

    // Heartbeat для отслеживания живых соединений
    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });
});

// Периодическая проверка живых соединений
const heartbeatInterval = setInterval(() => {
    console.log(`[WS] 🔍 Heartbeat check - Active rooms: ${rooms.size}`);

    // Проверяем хосты в комнатах
    for (const [roomCode, room] of rooms) {
        if (room.host) {
            console.log(`[WS] Room ${roomCode} - Host isAlive: ${room.host.isAlive}`);
            if (room.host.isAlive === false) {
                console.log(`[WS] Host timeout in room ${roomCode}, terminating`);
                room.host.terminate();
                continue;
            }
            room.host.isAlive = false;
            room.host.ping();
        }

        // Проверяем клиентов в комнате
        for (const client of room.clients) {
            if (client.isAlive === false) {
                console.log(`[WS] Client timeout in room ${roomCode}, terminating`);
                room.clients.delete(client);
                client.terminate();
                continue;
            }
            client.isAlive = false;
            client.ping();
        }
    }

    // Note: Backward compatibility removed - all connections now use room system
}, 120000); // каждые 120 секунд

// Периодический вывод статистики
setInterval(() => {
    if (globalStats.messagesSent > 0 || globalStats.messagesReceived > 0) {
        const mbSent = (globalStats.bytesSent / 1024 / 1024).toFixed(2);
        const mbReceived = (globalStats.bytesReceived / 1024 / 1024).toFixed(2);
        console.log(
            `[STATS] Sent: ${globalStats.messagesSent} msgs (${mbSent} MB), Received: ${globalStats.messagesReceived} msgs (${mbReceived} MB)`
        );

        for (const [roomCode, room] of rooms) {
            const s = room.stats || { messagesSent: 0, bytesSent: 0, messagesReceived: 0, bytesReceived: 0 };
            if (s.messagesSent || s.messagesReceived) {
                const rSent = (s.bytesSent / 1024 / 1024).toFixed(2);
                const rRecv = (s.bytesReceived / 1024 / 1024).toFixed(2);
                console.log(
                    `[STATS][Room ${roomCode}] Sent: ${s.messagesSent} msgs (${rSent} MB), Received: ${
                        s.messagesReceived
                    } msgs (${rRecv} MB), Clients: ${room.clients.size}, Host: ${
                        room.host ? "connected" : "disconnected"
                    }`
                );

                // Обнуляем room-статистику
                room.stats = {
                    messagesSent: 0,
                    bytesSent: 0,
                    messagesReceived: 0,
                    bytesReceived: 0,
                };
            }
        }

        // Сброс глобальной статистики
        globalStats = {
            messagesSent: 0,
            bytesSent: 0,
            messagesReceived: 0,
            bytesReceived: 0,
        };
    }
}, 60000); // каждую минуту

wss.on("close", () => {
    clearInterval(heartbeatInterval);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n[WS] Shutting down gracefully...");
    clearInterval(heartbeatInterval);
    wss.close(() => {
        console.log("[WS] Server closed");
        process.exit(0);
    });
});
