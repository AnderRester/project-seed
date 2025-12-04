use seed_config::{CosmosConfig, WorldConfig};
use thiserror::Error;

pub mod biome;
pub mod terrain;

pub use biome::{generate_biome_map_from_config, BiomeMap};
pub use terrain::{generate_heightmap_from_config, Heightmap};

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Config error: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug)]
pub struct World {
    pub id: String,
    pub name: String,
    pub cosmos: Cosmos,
    // TODO: environment, geology, biomes, etc.
}

#[derive(Debug)]
pub struct Cosmos {
    pub active_planet: Planet,
}

#[derive(Debug)]
pub struct Planet {
    pub id: String,
    pub name: String,
    pub radius_km: f64,
    pub gravity_ms2: f64,
    pub day_length_hours: f64,
    pub year_length_days: f64,
}

impl World {
    pub fn from_config(cfg: &WorldConfig) -> Result<Self> {
        let cosmos = Cosmos::from_config(&cfg.cosmos)?;

        Ok(World {
            id: cfg.world_id.clone(),
            name: cfg.meta.name.clone(),
            cosmos,
        })
    }
}

impl Cosmos {
    pub fn from_config(cfg: &CosmosConfig) -> Result<Self> {
        let active_id = &cfg.star_system.active_planet_id;
        let planet_cfg = cfg
            .star_system
            .planets
            .iter()
            .find(|p| &p.id == active_id)
            .ok_or_else(|| CoreError::Config(format!("Active planet '{active_id}' not found")))?;

        let planet = Planet {
            id: planet_cfg.id.clone(),
            name: planet_cfg.name.clone(),
            radius_km: planet_cfg.radius_km,
            gravity_ms2: planet_cfg.gravity_ms2,
            day_length_hours: planet_cfg.day_length_hours,
            year_length_days: planet_cfg.year_length_days,
        };

        Ok(Cosmos {
            active_planet: planet,
        })
    }
}
