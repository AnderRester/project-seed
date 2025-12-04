use crate::terrain::Heightmap;
use seed_config::{BiomeConfig, WorldConfig};

#[derive(Debug, Clone)]
pub struct BiomeMap {
    pub width: u32,
    pub height: u32,
    /// Для каждой ячейки – индекс биома в cfg.biomes (или None, если не подошёл)
    pub biome_indices: Vec<Option<usize>>,
}

impl BiomeMap {
    #[inline]
    pub fn index(&self, x: u32, y: u32) -> usize {
        (y * self.width + x) as usize
    }

    #[inline]
    pub fn get_index(&self, x: u32, y: u32) -> Option<usize> {
        self.biome_indices[self.index(x, y)]
    }
}

/// Внутренняя структура для расчёта условий в точке
#[derive(Clone, Copy, Debug)]
struct BiomeSample {
    temperature_c: f64,
    humidity: f64,
    elevation_m: f64,
    precipitation_mm_per_year: f64,
}

/// Основная функция: генерирует карту биомов по heightmap и конфигу мира
pub fn generate_biome_map_from_config(cfg: &WorldConfig, hm: &Heightmap) -> BiomeMap {
    let hcfg = &cfg.geology.heightmap;
    let clim = &cfg.environment.climate_model;
    let atm = &cfg.environment.atmosphere;

    let base_temp = atm.base_temperature_c;
    let lapse = clim.temperature_lapse_rate_c_per_km;
    let sea_level_m = if clim.sea_level_meters <= 0.0 {
        // Fallback: 30% от амплитуды высот – часть карты уйдёт под воду
        0.3 * hcfg.mountain_amplitude_meters
    } else {
        clim.sea_level_meters
    };
    let humidity_mean = atm.humidity_global_mean;
    let precip_scale = clim.precipitation_scale;

    let width = hm.width;
    let height = hm.height;

    let mut biome_indices = Vec::with_capacity((width * height) as usize);

    for y in 0..height {
        // Нормализуем y в [-1..1]: -1 = северный полюс, 0 = экватор, 1 = южный полюс
        let lat_norm = (y as f64 / (height.saturating_sub(1).max(1)) as f64); // [0..1]
        let lat_pos = lat_norm * 2.0 - 1.0; // [-1..1]
        let lat_abs = lat_pos.abs(); // 0 = экватор, 1 = полюс

        for x in 0..width {
            let v = hm.get(x, y) as f64; // 0..1

            // Простейшая модель высоты: 0..1 -> 0..mountain_amplitude_meters
            let elevation_m = v * hcfg.mountain_amplitude_meters;

            // Температура:
            // - базовая при 0 м и средней широте
            // - охлаждение к полюсам (lat_abs)
            // - охлаждение с высотой (lapse)
            let polar_cooling = 40.0; // условно: разница экватор/полюс ~40°C
            let temp_lat = base_temp - polar_cooling * lat_abs;
            let temp_c = temp_lat - (elevation_m / 1000.0) * lapse;

            // Влажность:
            // - глобальная средняя
            // - чуть суше к полюсам
            let humidity = (humidity_mean * (1.0 - 0.5 * lat_abs)).clamp(0.0, 1.0);

            // Осадки: просто функция от влажности и глобального масштаба осадков
            let precipitation_mm = 1000.0 * precip_scale * humidity;

            let sample = BiomeSample {
                temperature_c: temp_c,
                humidity,
                elevation_m,
                precipitation_mm_per_year: precipitation_mm,
            };

            let biome_idx = choose_biome(&cfg.biomes, &sample, sea_level_m);
            biome_indices.push(biome_idx);
        }
    }

    BiomeMap {
        width,
        height,
        biome_indices,
    }
}

/// Выбор подходящего биома для одной точки
fn choose_biome(biomes: &[BiomeConfig], sample: &BiomeSample, sea_level_m: f64) -> Option<usize> {
    // Море — пока без отдельного биома (рисуем просто воду).
    if sample.elevation_m < sea_level_m {
        return None;
    }

    if biomes.is_empty() {
        return None;
    }

    let mut best_idx: Option<usize> = None;
    let mut best_score = f64::MAX;

    for (i, biome) in biomes.iter().enumerate() {
        let c = &biome.climate_range;

        // Центры диапазонов
        let t_center = 0.5 * (c.temperature_c[0] + c.temperature_c[1]);
        let h_center = 0.5 * (c.humidity[0] + c.humidity[1]);
        let e_center = 0.5 * (c.elevation_meters[0] + c.elevation_meters[1]);
        let p_center = 0.5
            * (biome.precipitation_range_mm_per_year[0] + biome.precipitation_range_mm_per_year[1]);

        // "Полуширины" диапазонов (защита от нулевых)
        let t_span = (c.temperature_c[1] - c.temperature_c[0]).abs().max(1.0);
        let h_span = (c.humidity[1] - c.humidity[0]).abs().max(0.05);
        let e_span = (c.elevation_meters[1] - c.elevation_meters[0])
            .abs()
            .max(50.0);
        let p_span = (biome.precipitation_range_mm_per_year[1]
            - biome.precipitation_range_mm_per_year[0])
            .abs()
            .max(50.0);

        // Нормированные отклонения
        let dt = (sample.temperature_c - t_center) / t_span;
        let dh = (sample.humidity - h_center) / h_span;
        let de = (sample.elevation_m - e_center) / e_span;
        let dp = (sample.precipitation_mm_per_year - p_center) / p_span;

        // Веса: T и влажность важнее, высота и осадки — чуть слабее
        let mut score = 1.0 * dt * dt + 1.0 * dh * dh + 0.5 * de * de + 0.25 * dp * dp;

        // Мягкий штраф, если точка вообще вышла за диапазон по какому-то параметру
        if sample.temperature_c < c.temperature_c[0] || sample.temperature_c > c.temperature_c[1] {
            score += 0.5;
        }
        if sample.humidity < c.humidity[0] || sample.humidity > c.humidity[1] {
            score += 0.5;
        }
        if sample.elevation_m < c.elevation_meters[0] || sample.elevation_m > c.elevation_meters[1]
        {
            score += 0.3;
        }
        if sample.precipitation_mm_per_year < biome.precipitation_range_mm_per_year[0]
            || sample.precipitation_mm_per_year > biome.precipitation_range_mm_per_year[1]
        {
            score += 0.3;
        }

        if score < best_score {
            best_score = score;
            best_idx = Some(i);
        }
    }

    best_idx
}
