// server.js
// Простейший WebSocket-сервер для связи PC (host) ↔ телефоны (client)
//
// Установка:
//   npm install ws
// Запуск:
//   node server.js

// import { WebSocketServer } from 'ws';
// import { parse } from 'url';
const WebSocketServer = require('ws').WebSocketServer;
const parse = require('url').parse;

const PORT = 8080;

const wss = new WebSocketServer({ port: PORT });
console.log(`[WS] Server listening on ws://0.0.0.0:${PORT}`);

let hostSocket = null;
const clientSockets = new Set();

wss.on('connection', (ws, req) => {
    const url = req.url || '/';
    const { query } = parse(url, true);
    const role = query.role || 'client';

    ws.role = role;
    console.log(`[WS] New connection role=${role}`);

    if (role === 'host') {
        if (hostSocket && hostSocket.readyState === ws.OPEN) {
            console.log('[WS] Closing previous host connection');
            hostSocket.close();
        }
        hostSocket = ws;
    } else {
        clientSockets.add(ws);
    }

    ws.on('message', (data) => {
        // ожидаем JSON вида { type: 'state', payload: {...} } от host
        if (ws.role === 'host') {
            // шлём всем клиентам как есть
            for (const client of clientSockets) {
                if (client.readyState === client.OPEN) {
                    client.send(data);
                }
            }
        } else {
            // если в будущем захочешь слать инпут с телефона → хосту
            if (hostSocket && hostSocket.readyState === hostSocket.OPEN) {
                hostSocket.send(data);
            }
        }
    });

    ws.on('close', () => {
        console.log(`[WS] connection closed role=${ws.role}`);
        if (ws === hostSocket) {
            hostSocket = null;
        }
        if (ws.role === 'client') {
            clientSockets.delete(ws);
        }
    });

    ws.on('error', (err) => {
        console.error('[WS] error:', err);
    });
});
