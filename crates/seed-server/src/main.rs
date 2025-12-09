use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use anyhow::Result;
use axum::{
    body::Body,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Query, State},
    http::{Request, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use seed_config::WorldConfig;
use seed_core::{
    generate_biome_map_from_config, generate_heightmap_from_config, BiomeMap, Heightmap,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tower::util::ServiceExt;
use tower_http::services::ServeDir;
use tracing::{error, info};

#[derive(Clone)]
struct AppState {
    world: Arc<Mutex<WorldState>>,
    relay: Arc<Mutex<RelayState>>,
}

#[derive(Debug)]
struct WorldState {
    config: WorldConfig,
    heightmap: Heightmap,
    biomemap: BiomeMap,
    players: HashMap<String, PlayerState>,
    // Каналы для рассылки снапшотов всем подключённым клиентам
    clients: HashMap<String, mpsc::UnboundedSender<ServerMessage>>,
}

#[derive(Debug, Default)]
struct RelayState {
    rooms: HashMap<String, RelayRoom>,
}

#[derive(Debug)]
struct RelayRoom {
    host: Option<RelayPeer>,
    clients: HashMap<String, RelayPeer>,
}

#[derive(Debug)]
struct RelayPeer {
    sender: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlayerState {
    id: String,
    role: PlayerRole,
    x: f32,
    y: f32,
    z: f32,
    // Для VR-клиентов
    head_pos: Option<[f32; 3]>,
    head_quat: Option<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PlayerRole {
    Pc,
    Vr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "join")]
    Join {
        client_id: String,
        role: Option<PlayerRole>,
    },
    #[serde(rename = "input")]
    Input {
        client_id: String,
        dx: f32,
        dy: f32,
        dz: f32,
    },
    #[serde(rename = "vr_pose")]
    VrPose {
        client_id: String,
        head_pos: [f32; 3],
        head_quat: [f32; 4],
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "world_snapshot")]
    WorldSnapshot { players: Vec<PlayerState> },
    #[serde(rename = "joined")]
    Joined { client_id: String, role: PlayerRole },
    #[serde(rename = "error")]
    Error { message: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    // Загружаем конфиг мира из стандартного JSON в корне репозитория
    let cfg = WorldConfig::from_file("world-config.json")?;
    let width = 512;
    let height = 512;
    let hm = generate_heightmap_from_config(&cfg, width, height);
    let bm = generate_biome_map_from_config(&cfg, &hm);

    let world = WorldState {
        config: cfg,
        heightmap: hm,
        biomemap: bm,
        players: HashMap::new(),
        clients: HashMap::new(),
    };

    let state = AppState {
        world: Arc::new(Mutex::new(world)),
        relay: Arc::new(Mutex::new(RelayState::default())),
    };

    // HTTP + WebSocket:
    // - /ws  -> WebSocket для мультиплеера
    // - /relay -> WebSocket-ретранслятор видео/JSON между host (ПК) и client (телефон)
    // - всё остальное → статика из каталога web/ (index3d-enhanced.html, vr_client_enhanced.html и т.п.)
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/relay", get(relay_ws_handler))
        .fallback(static_handler)
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:9000".parse()?;
    info!("Starting seed-server on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

#[derive(Debug, Deserialize)]
struct RelayQuery {
    role: String,
    #[serde(default)]
    room: Option<String>,
}

async fn relay_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<RelayQuery>,
) -> Response {
    ws.on_upgrade(move |socket| handle_relay_socket(socket, state, params))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(e) => {
                    error!("Failed to serialize ServerMessage: {}", e);
                    continue;
                }
            };
            if sender.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    let mut client_id: Option<String> = None;

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Join {
                        client_id: cid,
                        role,
                    }) => {
                        let role = role.unwrap_or(PlayerRole::Pc);
                        info!("client {} joined as {:?}", cid, role);
                        client_id = Some(cid.clone());
                        {
                            let mut world = state.world.lock().await;
                            world.players.entry(cid.clone()).or_insert(PlayerState {
                                id: cid.clone(),
                                role: role.clone(),
                                x: 0.0,
                                y: 0.0,
                                z: 0.0,
                                head_pos: None,
                                head_quat: None,
                            });
                            // Запоминаем канал для рассылки снапшотов этому клиенту
                            world.clients.insert(cid.clone(), tx.clone());
                        }
                        let _ = tx.send(ServerMessage::Joined {
                            client_id: cid,
                            role,
                        });
                        // сразу отправляем снапшот
                        send_world_snapshot(&state).await;
                    }
                    Ok(ClientMessage::Input {
                        client_id: cid,
                        dx,
                        dy,
                        dz,
                    }) => {
                        let mut world = state.world.lock().await;
                        if let Some(p) = world.players.get_mut(&cid) {
                            p.x += dx;
                            p.y += dy;
                            p.z += dz;

                            if matches!(p.role, PlayerRole::Vr) {
                                info!(
                                    "VR input from {}: dx={:.3}, dy={:.3}, dz={:.3}",
                                    cid, dx, dy, dz
                                );
                            }
                        }
                        drop(world);
                        send_world_snapshot(&state).await;
                    }
                    Ok(ClientMessage::VrPose {
                        client_id: cid,
                        head_pos,
                        head_quat,
                    }) => {
                        let mut world = state.world.lock().await;
                        if let Some(p) = world.players.get_mut(&cid) {
                            p.head_pos = Some(head_pos);
                            p.head_quat = Some(head_quat);

                            if matches!(p.role, PlayerRole::Vr) {
                                info!(
                                    "VR pose from {}: head_pos={:?}, head_quat={:?}",
                                    cid, p.head_pos, p.head_quat
                                );
                            }
                        }
                        drop(world);
                        // VR-позы обычно часто, поэтому можно не отправлять полный снапшот каждый раз,
                        // но для простоты сейчас отправляем
                        send_world_snapshot(&state).await;
                    }
                    Err(e) => {
                        error!("Failed to parse ClientMessage: {}", e);
                        let _ = tx.send(ServerMessage::Error {
                            message: "invalid_message".into(),
                        });
                    }
                }
            }
            Message::Close(_) => {
                break;
            }
            _ => {}
        }
    }

    // Cleanup on disconnect
    if let Some(cid) = client_id {
        let mut world = state.world.lock().await;
        world.players.remove(&cid);
        world.clients.remove(&cid);
    }

    send_task.abort();
}

async fn send_world_snapshot(state: &AppState) {
    let (players, clients) = {
        let world = state.world.lock().await;
        let players: Vec<PlayerState> = world.players.values().cloned().collect();
        let clients: Vec<mpsc::UnboundedSender<ServerMessage>> =
            world.clients.values().cloned().collect();
        (players, clients)
    };

    let msg = ServerMessage::WorldSnapshot { players };
    for tx in clients {
        let _ = tx.send(msg.clone());
    }
}

async fn static_handler(
    req: Request<Body>,
) -> Result<impl axum::response::IntoResponse, (StatusCode, String)> {
    let res = ServeDir::new("web").oneshot(req).await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Internal server error: {}", err),
        )
    })?;

    Ok(res)
}

async fn handle_relay_socket(socket: WebSocket, state: AppState, params: RelayQuery) {
    // Разделяем WebSocket на приёмник и отправитель
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Создаём отдельный канал для отправки сообщений этому пиру
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Фоновой таск, который шлёт в сокет всё, что приходит в tx
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let role = params.role.to_lowercase();
    let mut room_code = params.room.clone();
    let mut player_id: Option<String> = None;

    // Регистрация в состоянии
    {
        let mut relay = state.relay.lock().await;

        if role == "host" {
            // Создаём или берём комнату
            let code = room_code.take().unwrap_or_else(|| generate_room_code());
            room_code = Some(code.clone());

            let room = relay
                .rooms
                .entry(code.clone())
                .or_insert_with(|| RelayRoom {
                    host: None,
                    clients: HashMap::new(),
                });

            room.host = Some(RelayPeer { sender: tx.clone() });

            // Сообщаем хосту код комнаты
            let msg = serde_json::json!({
                "type": "room_created",
                "roomCode": code,
            });
            let _ = tx.send(Message::Text(msg.to_string()));
        } else {
            // client
            let code = match room_code.clone() {
                Some(c) => c,
                None => {
                    let err = serde_json::json!({
                        "type": "error",
                        "message": "Room code required",
                    });
                    let _ = tx.send(Message::Text(err.to_string()));
                    return;
                }
            };

            let room = match relay.rooms.get_mut(&code) {
                Some(r) => r,
                None => {
                    let err = serde_json::json!({
                        "type": "error",
                        "message": "Room not found or host offline",
                    });
                    let _ = tx.send(Message::Text(err.to_string()));
                    return;
                }
            };

            if room.host.is_none() {
                let err = serde_json::json!({
                    "type": "error",
                    "message": "Room not found or host offline",
                });
                let _ = tx.send(Message::Text(err.to_string()));
                return;
            }

            let pid = format!(
                "player_{}_{}",
                chrono::Utc::now().timestamp_millis(),
                rand::random::<u32>()
            );
            player_id = Some(pid.clone());

            room.clients
                .insert(pid.clone(), RelayPeer { sender: tx.clone() });

            // Уведомляем клиента, что он подключился
            let joined = serde_json::json!({
                "type": "joined_room",
                "roomCode": code,
                "playerId": pid,
            });
            let _ = tx.send(Message::Text(joined.to_string()));

            // Уведомляем хоста о новом игроке
            if let Some(host) = &room.host {
                let info = serde_json::json!({
                    "type": "player_joined",
                    "playerId": player_id,
                    "totalPlayers": room.clients.len(),
                });
                let _ = host.sender.send(Message::Text(info.to_string()));
            }
        }
    }

    // Основной цикл приёма сообщений от этого пира и маршрутизация
    let room_code_final = room_code.clone();
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Binary(data) => {
                // Бинарные кадры от host → всем клиентам в комнате
                if role == "host" {
                    if let Some(code) = &room_code_final {
                        let mut relay = state.relay.lock().await;
                        if let Some(room) = relay.rooms.get_mut(code) {
                            let frame = data.clone();
                            for client in room.clients.values() {
                                let _ = client.sender.send(Message::Binary(frame.clone()));
                            }
                        }
                    }
                }
            }
            Message::Text(text) => {
                // Текстовые сообщения пробрасываем: host→клиенты, client→host
                if role == "host" {
                    if let Some(code) = &room_code_final {
                        let mut relay = state.relay.lock().await;
                        if let Some(room) = relay.rooms.get_mut(code) {
                            for client in room.clients.values() {
                                let _ = client.sender.send(Message::Text(text.clone()));
                            }
                        }
                    }
                } else {
                    if let Some(code) = &room_code_final {
                        let mut relay = state.relay.lock().await;
                        if let Some(room) = relay.rooms.get_mut(code) {
                            if let Some(host) = &room.host {
                                let _ = host.sender.send(Message::Text(text.clone()));
                            }
                        }
                    }
                }
            }
            Message::Close(_) => {
                break;
            }
            _ => {}
        }
    }

    // Очистка при отключении
    {
        let mut relay = state.relay.lock().await;
        if let Some(code) = room_code {
            if let Some(room) = relay.rooms.get_mut(&code) {
                if role == "host" {
                    // Уведомляем всех клиентов, что хост ушёл
                    let msg = serde_json::json!({
                        "type": "host_disconnected",
                    });
                    for client in room.clients.values() {
                        let _ = client.sender.send(Message::Text(msg.to_string()));
                    }
                    room.host = None;
                } else if let Some(pid) = player_id {
                    room.clients.remove(&pid);
                    // Опционально уведомляем хоста
                    if let Some(host) = &room.host {
                        let info = serde_json::json!({
                            "type": "player_left",
                            "playerId": pid,
                            "totalPlayers": room.clients.len(),
                        });
                        let _ = host.sender.send(Message::Text(info.to_string()));
                    }
                }

                if room.host.is_none() && room.clients.is_empty() {
                    relay.rooms.remove(&code);
                }
            }
        }
    }

    send_task.abort();
}

fn generate_room_code() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| {
            let idx = rng.gen_range(0..ALPHABET.len());
            ALPHABET[idx] as char
        })
        .collect()
}
