use crate::terrain::Heightmap;
use noise::{NoiseFn, Perlin};
use seed_config::{BiomeConfig, WorldConfig};

#[derive(Debug, Clone)]
pub struct BiomeMap {
    pub width: u32,
    pub height: u32,
    /// Для каждой ячейки – индекс биома в cfg.biomes (или None, если не подошёл)
    pub indices: Vec<Option<u8>>,
}

impl BiomeMap {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            indices: vec![None; (width * height) as usize],
        }
    }

    #[inline]
    fn idx(&self, x: u32, y: u32) -> usize {
        (y * self.width + x) as usize
    }

    pub fn set_index(&mut self, x: u32, y: u32, bi: Option<usize>) {
        let idx = self.idx(x, y);
        self.indices[idx] = bi.map(|v| v as u8);
    }

    pub fn get_index(&self, x: u32, y: u32) -> Option<usize> {
        self.indices[self.idx(x, y)].map(|v| v as usize)
    }
}

/// Простое сглаживание: для каждой клетки берём "модальный" биом соседей.
fn smooth_biome_map(src: &BiomeMap, iterations: u32) -> BiomeMap {
    let mut current = src.clone();

    for _ in 0..iterations {
        let mut next = current.clone();

        for y in 0..current.height {
            for x in 0..current.width {
                let mut counts: [u16; 256] = [0; 256];
                let mut has_any = false;

                for dy in -1_i32..=1 {
                    for dx in -1_i32..=1 {
                        let nx = x as i32 + dx;
                        let ny = y as i32 + dy;
                        if nx < 0
                            || ny < 0
                            || nx >= current.width as i32
                            || ny >= current.height as i32
                        {
                            continue;
                        }

                        if let Some(bi) = current.get_index(nx as u32, ny as u32) {
                            counts[bi as usize] += 1;
                            has_any = true;
                        }
                    }
                }

                if !has_any {
                    next.set_index(x, y, None);
                    continue;
                }

                let mut best_bi: Option<usize> = None;
                let mut best_count: u16 = 0;

                for bi in 0..256usize {
                    let c = counts[bi];
                    if c > best_count {
                        best_count = c;
                        best_bi = Some(bi);
                    }
                }

                if let Some(bi) = best_bi {
                    next.set_index(x, y, Some(bi));
                } else {
                    next.set_index(x, y, None);
                }
            }
        }

        current = next;
    }

    current
}

#[derive(Clone, Copy, Debug)]
struct BiomeSample {
    pub latitude: f64,
    pub elevation_m: f64,
    pub temperature_c: f64,
    pub humidity: f64,
    pub precipitation_mm_per_year: f64,
}

/// Основная функция: генерирует карту биомов по heightmap и конфигу мира
pub fn generate_biome_map_from_config(cfg: &WorldConfig, hm: &Heightmap) -> BiomeMap {
    let width = hm.width;
    let height = hm.height;
    let mut bm = BiomeMap::new(width, height);

    let biomes: &[BiomeConfig] = &cfg.biomes;

    // sea_level в координатах heightmap (0..1)
    let sea_level_norm = cfg.sea_level as f64;
    let max_relief_m = 3500.0_f64;

    // вспомогательный поиск индексов биомов по id (для fallback'ов)
    fn find_biome_index(biomes: &[BiomeConfig], id: &str) -> Option<usize> {
        biomes.iter().position(|b| b.id == id)
    }

    let forest_idx = find_biome_index(biomes, "temperate_forest");
    let desert_idx = find_biome_index(biomes, "hot_desert");
    let tundra_idx = find_biome_index(biomes, "tundra");
    let mountains_idx = find_biome_index(biomes, "cold_mountains");

    // шумы для климата
    let base_seed = cfg.world_seed as u32;
    let biome_noise = Perlin::new(base_seed.wrapping_add(4242)); // общий паттерн
    let humidity_noise = Perlin::new(base_seed.wrapping_add(7777));
    let temp_noise = Perlin::new(base_seed.wrapping_add(8888));

    let w1 = (width.saturating_sub(1).max(1)) as f64;
    let h1 = (height.saturating_sub(1).max(1)) as f64;

    for y in 0..height {
        let fy = y as f64 / h1;
        // широта [-1..1]: -1 — юг, 0 — экватор, 1 — север
        let lat = fy * 2.0 - 1.0;
        let lat_abs = lat.abs();
        let heat = 1.0 - lat_abs; // 1 — жарко, 0 — холодно

        for x in 0..width {
            let h01 = hm.get(x, y) as f64;

            // вода — биом не ставим (рисуем воду по sea_level отдельно)
            if h01 <= sea_level_norm + 0.002 {
                bm.set_index(x, y, None);
                continue;
            }

            // относительная высота над уровнем моря [0..1]
            let rel = ((h01 - sea_level_norm) / (1.0 - sea_level_norm)).clamp(0.0, 1.0);
            let elevation_m = rel * max_relief_m;

            let fx = x as f64 / w1;

            // ---- Температура (°C) ----
            // базовая: от ~28°C на экваторе до ~-10°C у полюсов
            let base_eq_temp = 28.0_f64;
            let base_pole_temp = -10.0_f64;
            let lat_factor = 1.0 - lat_abs; // 1 экватор, 0 полюс
            let mut temp_c = base_pole_temp + (base_eq_temp - base_pole_temp) * lat_factor;

            // градиент по высоте (6.5° на 1000 м)
            let lapse_rate = 0.0065;
            temp_c -= elevation_m * lapse_rate;

            // немного шума температуры
            let t_raw = temp_noise.get([fx * 1.3, fy * 1.3]); // -1..1
            temp_c += t_raw * 3.0; // ±3°

            // ---- Влажность (0..1) ----
            // экватор и субполярные области более влажные, субтропики суше
            let dryness_belt = (lat_abs - 0.4).abs(); // минимум около |lat|~0.4
            let mut humidity = 1.0 - dryness_belt * 1.2;
            humidity = humidity.clamp(0.1, 0.95);

            // шум по влажности
            let h_raw = humidity_noise.get([fx * 1.1, fy * 1.1]); // -1..1
            humidity += h_raw * 0.15;
            humidity = humidity.clamp(0.05, 0.98);

            // ---- Осадки (мм/год) ----
            let mut precip = humidity * 1800.0; // 0..1800
            precip = precip.clamp(50.0, 2800.0);

            // ---- Простейший "фон" биомов для разнообразия ----
            let biome_freq = 1.2;
            let n_raw = biome_noise.get([fx * biome_freq, fy * biome_freq]); // -1..1
            let n01 = (n_raw * 0.5 + 0.5).clamp(0.0, 1.0);

            // Заполняем BiomeSample
            let sample = BiomeSample {
                latitude: lat,
                elevation_m,
                temperature_c: temp_c,
                humidity,
                precipitation_mm_per_year: precip,
            };

            // Пытаемся выбрать биом по климатическим диапазонам из JSON
            let mut idx = choose_biome(biomes, &sample, 0.0);

            // --- Fallback, если JSON-диапазоны не дали ничего разумного ---
            if idx.is_none() {
                // Горы — если есть соответствующий биом и мы высоко
                if let Some(mi) = mountains_idx {
                    let mountain_base = ((elevation_m - 1400.0) / 1200.0).clamp(0.0, 1.0);
                    if mountain_base > 0.7 {
                        idx = Some(mi);
                    }
                }

                if idx.is_none() {
                    if heat > 0.45 {
                        // тёплый пояс — тропики/субтропики: лес + много пустыни
                        if let Some(di) = desert_idx {
                            let elevation_factor = 1.0 - (elevation_m / 1400.0).clamp(0.0, 1.0);
                            // чем жарче (heat ближе к 1) и ниже (elevation_factor ближе к 1),
                            // тем больше шансов стать пустыней
                            let base = 0.25 + 0.35 * (heat - 0.45) / 0.55; // ~0.25..0.6
                            let desert_threshold = base * elevation_factor;
                            if n01 < desert_threshold {
                                idx = Some(di);
                            }
                        }
                        if idx.is_none() {
                            idx = forest_idx;
                        }
                    } else if heat < 0.3 {
                        // холодный пояс: тундра/лес
                        if let Some(ti) = tundra_idx {
                            let tundra_thresh = 0.55;
                            if n01 < tundra_thresh && elevation_m < 1600.0 {
                                idx = Some(ti);
                            }
                        }
                        if idx.is_none() {
                            idx = forest_idx;
                        }
                    } else {
                        // умеренный пояс
                        if let Some(di) = desert_idx {
                            let elevation_factor = 1.0 - (elevation_m / 900.0).clamp(0.0, 1.0);
                            let desert_threshold = 0.25 * elevation_factor;
                            if n01 < desert_threshold {
                                idx = Some(di);
                            }
                        }
                        if idx.is_none() {
                            if let Some(ti) = tundra_idx {
                                if n01 > 0.86 && elevation_m < 1500.0 {
                                    idx = Some(ti);
                                }
                            }
                        }
                        if idx.is_none() {
                            idx = forest_idx;
                        }
                    }
                }
            }

            bm.set_index(x, y, idx);
        }
    }

    // Сглаживание границ биомов (убираем одиночные пиксели/иголки)
    smooth_biome_map(&bm, 2)
}

/// Выбор подходящего биома для одной точки
fn choose_biome(biomes: &[BiomeConfig], sample: &BiomeSample, sea_level_m: f64) -> Option<usize> {
    // Море – без биома (рисуем просто воду).
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

        // центры диапазонов
        let t_center = 0.5 * (c.temperature_c[0] + c.temperature_c[1]);
        let h_center = 0.5 * (c.humidity[0] + c.humidity[1]);
        let e_center = 0.5 * (c.elevation_meters[0] + c.elevation_meters[1]);
        let p_center = 0.5
            * (biome.precipitation_range_mm_per_year[0] + biome.precipitation_range_mm_per_year[1]);

        // полуширины диапазонов
        let t_span = (c.temperature_c[1] - c.temperature_c[0]).abs().max(1.0);
        let h_span = (c.humidity[1] - c.humidity[0]).abs().max(0.05);
        let e_span = (c.elevation_meters[1] - c.elevation_meters[0])
            .abs()
            .max(50.0);
        let p_span = (biome.precipitation_range_mm_per_year[1]
            - biome.precipitation_range_mm_per_year[0])
            .abs()
            .max(50.0);

        // нормированные отклонения
        let dt = (sample.temperature_c - t_center) / t_span;
        let dh = (sample.humidity - h_center) / h_span;
        let de = (sample.elevation_m - e_center) / e_span;
        let dp = (sample.precipitation_mm_per_year - p_center) / p_span;

        // веса: T и влажность важнее, высота/осадки чуть слабее
        let mut score = 1.0 * dt * dt + 1.0 * dh * dh + 0.5 * de * de + 0.25 * dp * dp;

        // мягкий штраф за выход за диапазон
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
