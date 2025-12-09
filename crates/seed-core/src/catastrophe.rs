use noise::{NoiseFn, Perlin};
use seed_config::{CatastrophesConfig, WorldConfig};
use crate::terrain::Heightmap;
use std::f64::consts::PI;

#[derive(Debug, Clone)]
pub struct Catastrophe {
    pub id: String,
    pub catastrophe_type: CatastropheType,
    pub position: (f64, f64),  // lat, lon
    pub magnitude: f64,
    pub radius_km: f64,
    pub timestamp: f64,
    pub duration_hours: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatastropheType {
    Earthquake,
    VolcanicEruption,
    MeteorImpact,
    Tsunami,
    Tornado,
    Hurricane,
}

/// Генерирует список катастроф для симуляции мира
pub fn generate_catastrophes(
    cfg: &WorldConfig,
    simulation_years: f64,
    seed: u64,
) -> Vec<Catastrophe> {
    let mut catastrophes = Vec::new();
    
    if !cfg.catastrophes.global_controls.enabled {
        return catastrophes;
    }
    
    let noise = Perlin::new(seed as u32);
    
    for event_type in &cfg.catastrophes.event_types {
        let frequency = event_type.base_frequency_per_year;
        let expected_count = (frequency * simulation_years) as usize;
        
        for i in 0..expected_count {
            let time_offset = (i as f64 / expected_count as f64) * simulation_years;
            
            // Случайная позиция с учётом шума
            let noise_x = noise.get([time_offset * 0.1, i as f64 * 0.5]);
            let noise_y = noise.get([time_offset * 0.2, i as f64 * 0.7 + 100.0]);
            
            let lat = noise_x * 180.0 - 90.0;  // -90 .. 90
            let lon = noise_y * 360.0 - 180.0; // -180 .. 180
            
            let magnitude_noise = noise.get([lat * 0.01, lon * 0.01]);
            let magnitude = match event_type.id.as_str() {
                "earthquake" => {
                    let max_mag = event_type.max_magnitude.unwrap_or(9.0);
                    5.0 + (magnitude_noise * 0.5 + 0.5) * (max_mag - 5.0)
                }
                "volcanic_eruption" => {
                    (magnitude_noise * 0.5 + 0.5) * 10.0 // VEI 0-10
                }
                "meteor_impact" => {
                    (magnitude_noise * 0.5 + 0.5) * 100.0 // энергия в мегатоннах
                }
                _ => 1.0,
            };
            
            let radius_km = match event_type.id.as_str() {
                "earthquake" => {
                    if let Some(range) = &event_type.affected_radius_km_range {
                        range[0] + (magnitude_noise * 0.5 + 0.5) * (range[1] - range[0])
                    } else {
                        magnitude * 20.0 // примерная оценка
                    }
                }
                "volcanic_eruption" => 50.0 + magnitude * 10.0,
                "meteor_impact" => {
                    if let Some(range) = &event_type.crater_radius_km_range {
                        range[0] + (magnitude_noise * 0.5 + 0.5) * (range[1] - range[0])
                    } else {
                        magnitude * 0.5
                    }
                }
                _ => 10.0,
            };
            
            let cat_type = match event_type.id.as_str() {
                "earthquake" => CatastropheType::Earthquake,
                "volcanic_eruption" => CatastropheType::VolcanicEruption,
                "meteor_impact" => CatastropheType::MeteorImpact,
                _ => continue,
            };
            
            catastrophes.push(Catastrophe {
                id: format!("{}_{}", event_type.id, i),
                catastrophe_type: cat_type,
                position: (lat, lon),
                magnitude,
                radius_km,
                timestamp: time_offset,
                duration_hours: match cat_type {
                    CatastropheType::Earthquake => 0.05, // ~3 минуты
                    CatastropheType::VolcanicEruption => 24.0 * magnitude, // дни
                    CatastropheType::MeteorImpact => 0.01, // мгновенно
                    _ => 1.0,
                },
            });
        }
    }
    
    catastrophes
}

/// Применяет катастрофу к карте высот
pub fn apply_catastrophe_to_heightmap(
    hm: &mut Heightmap,
    cat: &Catastrophe,
    cfg: &WorldConfig,
) {
    let w = hm.width as usize;
    let h = hm.height as usize;
    
    // Конвертируем lat/lon в координаты карты
    let (lat, lon) = cat.position;
    let norm_lat = (lat + 90.0) / 180.0;  // 0..1
    let norm_lon = (lon + 180.0) / 360.0; // 0..1
    
    let center_x = (norm_lon * w as f64) as usize;
    let center_y = (norm_lat * h as f64) as f64;
    
    // Определяем радиус влияния в пикселях
    let world_scale = cfg.scale.region_size_km;
    let pixel_per_km = w as f64 / world_scale;
    let radius_pixels = (cat.radius_km * pixel_per_km) as usize;
    
    match cat.catastrophe_type {
        CatastropheType::Earthquake => {
            apply_earthquake(hm, center_x, center_y as usize, radius_pixels, cat.magnitude);
        }
        CatastropheType::VolcanicEruption => {
            apply_volcanic_eruption(hm, center_x, center_y as usize, radius_pixels, cat.magnitude);
        }
        CatastropheType::MeteorImpact => {
            apply_meteor_impact(hm, center_x, center_y as usize, radius_pixels, cat.magnitude);
        }
        _ => {}
    }
}

/// Землетрясение: случайные вертикальные смещения
fn apply_earthquake(hm: &mut Heightmap, cx: usize, cy: usize, radius: usize, magnitude: f64) {
    let w = hm.width as usize;
    let h = hm.height as usize;
    
    let intensity = (magnitude - 5.0) / 4.0; // 0..1 для магнитуды 5..9
    let max_displacement = intensity * 0.05; // максимум 5% от диапазона высот
    
    for dy in -(radius as isize)..=(radius as isize) {
        for dx in -(radius as isize)..=(radius as isize) {
            let x = cx as isize + dx;
            let y = cy as isize + dy;
            
            if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
                continue;
            }
            
            let dist = ((dx * dx + dy * dy) as f64).sqrt();
            if dist > radius as f64 {
                continue;
            }
            
            let falloff = (1.0 - dist / radius as f64).max(0.0);
            let displacement = (((x + y) as f64 * 0.5).sin() * max_displacement * falloff) as f32;
            
            let idx = y as usize * w + x as usize;
            hm.values[idx] = (hm.values[idx] + displacement).clamp(0.0, 1.0);
        }
    }
}

/// Извержение вулкана: конус пепла и лавы
fn apply_volcanic_eruption(hm: &mut Heightmap, cx: usize, cy: usize, radius: usize, magnitude: f64) {
    let w = hm.width as usize;
    let h = hm.height as usize;
    
    let cone_height = (magnitude / 10.0) * 0.15; // до 15% высоты карты
    
    for dy in -(radius as isize)..=(radius as isize) {
        for dx in -(radius as isize)..=(radius as isize) {
            let x = cx as isize + dx;
            let y = cy as isize + dy;
            
            if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
                continue;
            }
            
            let dist = ((dx * dx + dy * dy) as f64).sqrt();
            if dist > radius as f64 {
                continue;
            }
            
            // Конический профиль
            let height_add = cone_height * (1.0 - (dist / radius as f64).powf(1.5));
            
            let idx = y as usize * w + x as usize;
            hm.values[idx] = (hm.values[idx] + height_add as f32).min(1.0);
        }
    }
}

/// Падение метеорита: круглый кратер
fn apply_meteor_impact(hm: &mut Heightmap, cx: usize, cy: usize, radius: usize, magnitude: f64) {
    let w = hm.width as usize;
    let h = hm.height as usize;
    
    let crater_depth = (magnitude / 100.0) * 0.2; // до 20% глубины
    
    for dy in -(radius as isize)..=(radius as isize) {
        for dx in -(radius as isize)..=(radius as isize) {
            let x = cx as isize + dx;
            let y = cy as isize + dy;
            
            if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
                continue;
            }
            
            let dist = ((dx * dx + dy * dy) as f64).sqrt();
            if dist > radius as f64 {
                continue;
            }
            
            let norm_dist = dist / radius as f64;
            
            // Параболический профиль кратера
            let depth_factor = if norm_dist < 0.7 {
                // Внутри кратера - углубление
                -(1.0 - (norm_dist / 0.7).powf(2.0))
            } else {
                // Вал вокруг кратера
                ((norm_dist - 0.7) / 0.3) * 0.3
            };
            
            let height_change = crater_depth * depth_factor;
            
            let idx = y as usize * w + x as usize;
            hm.values[idx] = (hm.values[idx] + height_change as f32).clamp(0.0, 1.0);
        }
    }
}
