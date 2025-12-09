use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("I/O error while reading config: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, ConfigError>;

/// Корневой конфиг мира (строго под наш world-config.json)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldConfig {
    pub seed_version: String,
    pub world_id: String,

    pub meta: MetaConfig,
    pub scale: ScaleConfig,
    pub cosmos: CosmosConfig,
    pub environment: EnvironmentConfig,
    pub geology: GeologyConfig,
    pub materials: Vec<MaterialConfig>,
    pub biomes: Vec<BiomeConfig>,
    pub interaction: InteractionConfig,
    pub ecosystems: EcosystemsConfig,
    pub catastrophes: CatastrophesConfig,
    pub civilizations: CivilizationsConfig,
    pub narrative_director: NarrativeDirectorConfig,
    pub simulation: SimulationConfig,
    pub world_seed: u64,
    pub sea_level: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetaConfig {
    pub name: String,
    pub description: String,
    pub author: String,
    pub created_at: String, // ISO-строка
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScaleConfig {
    pub mode: String, // "region" | "planet" | "system"
    pub region_size_km: f64,
    pub planet_radius_km: f64,
    pub coordinate_system: String, // "spherical"
    pub chunk_size_meters: f64,
    pub max_detail_meters: f64,
    pub max_simulation_distance_km: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CosmosConfig {
    pub star_system: StarSystemConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StarSystemConfig {
    pub stars: Vec<StarConfig>,
    pub planets: Vec<PlanetConfig>,
    pub active_planet_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StarConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub star_type: String,
    pub luminosity: f64,
    pub color: [f32; 3],
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanetConfig {
    pub id: String,
    pub name: String,
    pub radius_km: f64,
    pub mass_earths: f64,
    pub gravity_ms2: f64,
    pub day_length_hours: f64,
    pub year_length_days: f64,
    pub axial_tilt_degrees: f64,
    pub orbit: OrbitConfig,
    pub moons: Vec<MoonConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrbitConfig {
    pub star_id: String,
    pub semi_major_axis_au: f64,
    pub eccentricity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoonConfig {
    pub id: String,
    pub name: String,
    pub radius_km: f64,
    pub orbit_distance_km: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentConfig {
    pub atmosphere: AtmosphereConfig,
    pub climate_model: ClimateModelConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AtmosphereConfig {
    pub composition: HashMap<String, f64>, // N2, O2 и т.д.
    pub pressure_k_pa: f64,
    pub base_temperature_c: f64,
    pub humidity_global_mean: f64,
    pub scattering_intensity: f32,
    pub fog_density_base: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClimateModelConfig {
    pub model_type: String,
    pub sea_level_meters: f64,
    pub temperature_lapse_rate_c_per_km: f64,
    pub precipitation_scale: f64,
    pub wind_global_pattern: String,
    pub storm_frequency: f32,
    pub storm_intensity_mean: f32,
    pub seasonality: SeasonalityConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeasonalityConfig {
    pub enabled: bool,
    pub season_count: u32,
    pub season_length_days: u32,
}

// ---------- Geology ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeologyConfig {
    pub heightmap: HeightmapConfig,
    pub material_layers: Vec<MaterialLayerConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeightmapConfig {
    pub generation_mode: String, // "tectonic_erosion" | "noise" | ...
    pub base_seed: u64,
    pub continental_scale_km: f64,
    pub mountain_amplitude_meters: f64,
    pub erosion_iterations: u32,
    pub river_density: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MaterialLayerConfig {
    pub id: String,
    pub name: String,
    pub r#type: String, // "rock" | "loose" и т.п.
    pub depth_range_meters: [f64; 2],
}

// ---------- Materials ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MaterialConfig {
    pub id: String,
    pub category: String,
    pub display_name: String,
    pub density_kg_m3: f64,
    pub static_friction: f32,
    pub dynamic_friction: f32,
    pub hardness: f32,
    pub brittleness: f32,
    pub plasticity: f32,
    pub thermal_conductivity: f32,
    pub melting_point_c: f32,
    pub erosion_resistance: f32,
    pub supports_footprints: bool,
    pub footprint_persistence: Option<f32>,
    pub visual_profile: String,
}

// ---------- Biomes ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiomeConfig {
    pub id: String,
    pub display_name: String,
    pub climate_range: BiomeClimateRangeConfig,
    pub precipitation_range_mm_per_year: [f64; 2],
    pub base_material_id: Option<String>,
    pub overlay_material_ids: Option<Vec<String>>,
    pub dominant_materials: Vec<String>,
    pub vegetation_density: f32,
    pub fauna_profiles: Vec<String>,
    pub allow_settlements: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiomeClimateRangeConfig {
    pub temperature_c: [f64; 2],
    pub humidity: [f64; 2],
    pub elevation_meters: [f64; 2],
}

// ---------- Interaction ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InteractionConfig {
    pub footprints: FootprintsConfig,
    pub surface_deformation: SurfaceDeformationConfig,
    pub object_interaction: ObjectInteractionConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FootprintsConfig {
    pub enabled: bool,
    pub max_decals_per_chunk: u32,
    pub deformation_resolution_meters: f32,
    pub fade_over_time: bool,
    pub fade_time_seconds: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceDeformationConfig {
    pub enabled: bool,
    pub support_materials: Vec<String>, // "soil", "snow", "sand"
    pub max_deformation_depth_meters: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInteractionConfig {
    pub leave_tracks: bool,
    pub track_types: Vec<String>, // "drag_marks", "wheel_tracks"
}

// ---------- Ecosystems ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EcosystemsConfig {
    pub simulation_scale: String, // "local" | "regional" | "global"
    pub time_step_minutes: u32,
    pub species_definitions: Vec<SpeciesConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesConfig {
    pub id: String,
    pub trophic_level: String, // "herbivore", "carnivore"...
    pub preferred_biomes: Vec<String>,
    pub population_density_per_km2: f64,
    pub migration_enabled: bool,
}

// ---------- Catastrophes ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatastrophesConfig {
    pub global_controls: GlobalCatastropheControlsConfig,
    pub event_types: Vec<CatastropheEventTypeConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlobalCatastropheControlsConfig {
    pub enabled: bool,
    pub max_concurrent_events: u32,
    pub allow_planet_destroying_events: bool,
    pub base_randomness: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatastropheEventTypeConfig {
    pub id: String,
    pub display_name: String,
    pub trigger_model: String,
    pub base_frequency_per_year: f64,

    // Далее опциональные поля для разных типов событий:
    pub max_magnitude: Option<f64>,
    pub affected_radius_km_range: Option<[f64; 2]>,
    pub can_trigger_tsunami: Option<bool>,
    pub ash_cloud_global_impact: Option<f64>,
    pub climate_cooling_c_max: Option<f64>,
    pub crater_radius_km_range: Option<[f64; 2]>,
    pub global_extinction_risk: Option<f64>,
}

// ---------- Civilizations ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CivilizationsConfig {
    pub enabled: bool,
    pub faction_presets: Vec<FactionPresetConfig>,
    pub history_simulation: HistorySimulationConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FactionPresetConfig {
    pub id: String,
    pub name: String,
    pub tech_level: String,
    pub preferred_biomes: Vec<String>,
    pub starting_population: i64,
    pub capital_location_hint: CapitalLocationHintConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapitalLocationHintConfig {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistorySimulationConfig {
    pub enabled: bool,
    pub years_to_simulate: u32,
    pub war_likelihood: f32,
    pub trade_importance: f32,
    pub catastrophe_impact_on_history: f32,
}

// ---------- Narrative Director (Cardinal-like) ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeDirectorConfig {
    pub enabled: bool,
    pub id: String,
    pub aggressiveness: f32,
    pub player_danger_bias: f32,
    pub world_stability_bias: f32,
    pub can_trigger_global_catastrophes: bool,
    pub quest_generation: QuestGenerationConfig,
    pub event_policies: EventPoliciesConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuestGenerationConfig {
    pub enabled: bool,
    pub max_active_quests_per_player: u32,
    pub use_real_world_state: bool,
    pub preferred_quest_types: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EventPoliciesConfig {
    pub allow_city_destruction: bool,
    pub allow_permanent_biome_changes: bool,
    pub max_players_killed_by_system_event: f32,
}

// ---------- Simulation ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationConfig {
    pub time: SimulationTimeConfig,
    pub physics: SimulationPhysicsConfig,
    pub lod: SimulationLodConfig,
    pub network: SimulationNetworkConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationTimeConfig {
    pub time_scale: f32,
    pub allow_time_acceleration: bool,
    pub max_time_scale_in_hub: f32,
    pub max_time_scale_in_background_sim: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationPhysicsConfig {
    pub solver_accuracy: String, // "low" | "medium" | "high"
    pub max_substeps: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationLodConfig {
    pub terrain_lod_levels: u32,
    pub object_lod_levels: u32,
    pub destruction_lod_levels: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationNetworkConfig {
    pub authoritative_mode: String, // "server"
    pub tick_rate_hz: u32,
    pub max_latency_ms: u32,
    pub region_radius_km_active: f64,
    pub region_radius_km_background: f64,
    pub state_sync_strategy: String, // "delta_compressed"
}

// ---------- Загрузка ----------

impl WorldConfig {
    pub fn from_str(s: &str) -> Result<Self> {
        let cfg = serde_json::from_str::<WorldConfig>(s)?;
        Ok(cfg)
    }

    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let data = fs::read_to_string(path)?;
        Self::from_str(&data)
    }
}
