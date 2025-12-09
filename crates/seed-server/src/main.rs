use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use anyhow::Result;
use axum::{extract::ws::{WebSocket, WebSocketUpgrade, Message}, extract::State, response::Response, routing::get, Router};
use futures_util::{StreamExt, SinkExt};
use seed_config::WorldConfig;
use seed_core::{generate_heightmap_from_config, generate_biome_map_from_config, Heightmap, BiomeMap};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, mpsc};
use tracing::{info, error};

#[derive(Clone)]
struct AppState {
    world: Arc<Mutex<WorldState>>,
}

#[derive(Debug)]
struct WorldState {
    config: WorldConfig,
    heightmap: Heightmap,
    biomemap: BiomeMap,
    players: HashMap<String, PlayerState>,
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
    Join { client_id: String, role: Option<PlayerRole> },
    #[serde(rename = "input")]
    Input { client_id: String, dx: f32, dy: f32, dz: f32 },
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
    WorldSnapshot {
        players: Vec<PlayerState>,
    },
    #[serde(rename = "joined")]
    Joined { client_id: String, role: PlayerRole },
    #[serde(rename = "error")]
    Error { message: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

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
    };

    let state = AppState { world: Arc::new(Mutex::new(world)) };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:9000".parse()?;
    info!("Starting seed-server on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
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
                    Ok(ClientMessage::Join { client_id: cid, role }) => {
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
                        }
                        let _ = tx.send(ServerMessage::Joined { client_id: cid, role });
                        // сразу отправляем снапшот
                        send_world_snapshot(&state, &tx).await;
                    }
                    Ok(ClientMessage::Input { client_id: cid, dx, dy, dz }) => {
                        let mut world = state.world.lock().await;
                        if let Some(p) = world.players.get_mut(&cid) {
                            p.x += dx;
                            p.y += dy;
                            p.z += dz;
                        }
                        drop(world);
                        send_world_snapshot(&state, &tx).await;
                    }
                    Ok(ClientMessage::VrPose { client_id: cid, head_pos, head_quat }) => {
                        let mut world = state.world.lock().await;
                        if let Some(p) = world.players.get_mut(&cid) {
                            p.head_pos = Some(head_pos);
                            p.head_quat = Some(head_quat);
                        }
                        drop(world);
                        // VR-позы обычно часто, поэтому можно не отправлять полный снапшот каждый раз,
                        // но для простоты сейчас отправляем
                        send_world_snapshot(&state, &tx).await;
                    }
                    Err(e) => {
                        error!("Failed to parse ClientMessage: {}", e);
                        let _ = tx.send(ServerMessage::Error { message: "invalid_message".into() });
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
    }

    send_task.abort();
}

async fn send_world_snapshot(state: &AppState, tx: &mpsc::UnboundedSender<ServerMessage>) {
    let world = state.world.lock().await;
    let players: Vec<PlayerState> = world.players.values().cloned().collect();
    drop(world);

    let _ = tx.send(ServerMessage::WorldSnapshot { players });
}
