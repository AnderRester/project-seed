use seed_config::WorldConfig;
use seed_core::{
    compute_flow_accumulation, generate_biome_map_from_config, generate_heightmap_from_config,
    BiomeMap, Heightmap,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SeedWorld {
    cfg: WorldConfig,
    heightmap: Heightmap,
    biomemap: BiomeMap,
}

#[wasm_bindgen]
impl SeedWorld {
    /// Создаёт мир из JSON-строки конфигурации
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str, width: u32, height: u32) -> Result<SeedWorld, JsValue> {
        let cfg: WorldConfig = serde_json::from_str(config_json)
            .map_err(|e| JsValue::from_str(&format!("Config parse error: {e}")))?;

        let hm = generate_heightmap_from_config(&cfg, width, height);
        let bm = generate_biome_map_from_config(&cfg, &hm);

        Ok(SeedWorld {
            cfg,
            heightmap: hm,
            biomemap: bm,
        })
    }

    /// Ширина карты
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.heightmap.width
    }

    /// Высота карты
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.heightmap.height
    }

    /// Возвращает высоты как плоский массив f32 (0..1)
    #[wasm_bindgen]
    pub fn heightmap_values(&self) -> Vec<f32> {
        self.heightmap.values.clone()
    }

    /// Возвращает RGBA-буфер "worldview" (биомы + освещение рельефа)
    #[wasm_bindgen]
    pub fn worldview_rgba(&self) -> Vec<u8> {
        build_worldview_rgba(&self.heightmap, &self.biomemap, &self.cfg)
    }

    /// Индексы биомов (та же сетка, что heightmap): 0..N-1 или 255 для воды/отсутствия
    #[wasm_bindgen]
    pub fn biome_indices(&self) -> Vec<u8> {
        self.biomemap
            .indices
            .iter()
            .map(|opt| opt.unwrap_or(255)) // 255 = "нет биома / вода"
            .collect()
    }
}

// ---- Ниже — логика рендеринга worldview в RGBA ----

fn build_worldview_rgba(hm: &Heightmap, bm: &BiomeMap, cfg: &WorldConfig) -> Vec<u8> {
    let mut buf = vec![0u8; (hm.width * hm.height * 4) as usize];

    let palette = build_biome_palette(cfg);

    let shallow = [70u8, 140u8, 200u8];
    let deep = [10u8, 30u8, 80u8];
    let sea_level_norm = cfg.sea_level as f32;

    let flow = compute_flow_accumulation(hm, sea_level_norm);

    let river_color = [30u8, 120u8, 220u8];
    let beach_color = [210u8, 190u8, 120u8];
    let beach_width = 0.03_f32;

    let light_dir = normalize3(0.6, 0.6, 1.0);
    let slope_scale = 40.0_f32;

    let h_h = hm.height as f32;

    for y in 0..hm.height {
        for x in 0..hm.width {
            let hc = hm.get(x, y) as f32;
            let idx1 = (y * hm.width + x) as usize;

            // --- высота и соседи ---
            let xl = x.saturating_sub(1);
            let xr = (x + 1).min(hm.width - 1);
            let yu = y.saturating_sub(1);
            let yd = (y + 1).min(hm.height - 1);

            let hl = hm.get(xl, y) as f32;
            let hr = hm.get(xr, y) as f32;
            let hu = hm.get(x, yu) as f32;
            let hd = hm.get(x, yd) as f32;

            // --- нормаль и освещение ---
            let dx = hr - hl;
            let dy = hd - hu;

            let nx = -dx * slope_scale;
            let ny = -dy * slope_scale;
            let nz = 1.0;
            let normal = normalize3(nx, ny, nz);

            let dot = normal.0 * light_dir.0 + normal.1 * light_dir.1 + normal.2 * light_dir.2;
            let mut shade = dot.max(0.0);
            let ambient = 0.3;
            shade = ambient + shade * (1.0 - ambient);
            shade = shade.clamp(0.0, 1.0);

            // --- базовый цвет: биом или вода ---
            let mut base_color = match bm.get_index(x, y) {
                Some(bi) if bi < palette.len() => palette[bi],
                _ => {
                    // вода: градиент по глубине
                    let depth = (sea_level_norm - hc).max(0.0);
                    let depth_norm = (depth / sea_level_norm).clamp(0.0, 1.0);
                    let t = depth_norm;
                    [
                        (shallow[0] as f32 * (1.0 - t) + deep[0] as f32 * t) as u8,
                        (shallow[1] as f32 * (1.0 - t) + deep[1] as f32 * t) as u8,
                        (shallow[2] as f32 * (1.0 - t) + deep[2] as f32 * t) as u8,
                    ]
                }
            };

            // --- снеговые шапки ---
            let lat = (y as f32 / (h_h - 1.0)) * 2.0 - 1.0;
            let lat_abs = lat.abs();

            let snow_height_start = 0.7;
            let snow_lat_start = 0.5;

            let height_factor =
                ((hc - snow_height_start) / (1.0 - snow_height_start)).clamp(0.0, 1.0);
            let lat_factor = ((lat_abs - snow_lat_start) / (1.0 - snow_lat_start)).clamp(0.0, 1.0);

            let snow_mask = (height_factor * lat_factor).clamp(0.0, 1.0);

            if snow_mask > 0.0 {
                let s = snow_mask;
                base_color[0] = (base_color[0] as f32 * (1.0 - s) + 255.0 * s) as u8;
                base_color[1] = (base_color[1] as f32 * (1.0 - s) + 255.0 * s) as u8;
                base_color[2] = (base_color[2] as f32 * (1.0 - s) + 255.0 * s) as u8;
            }

            let flow_val = flow[idx1];

            // пляжи
            if hc > sea_level_norm {
                let dh = hc - sea_level_norm;
                if dh > 0.0 && dh < beach_width {
                    let t = (dh / beach_width).clamp(0.0, 1.0);
                    let s = 1.0 - t;
                    base_color[0] =
                        (base_color[0] as f32 * (1.0 - s) + beach_color[0] as f32 * s) as u8;
                    base_color[1] =
                        (base_color[1] as f32 * (1.0 - s) + beach_color[1] as f32 * s) as u8;
                    base_color[2] =
                        (base_color[2] as f32 * (1.0 - s) + beach_color[2] as f32 * s) as u8;
                }
            }

            // реки
            if hc > sea_level_norm && flow_val > 0.1 {
                let t = ((flow_val - 0.1) / 0.9).clamp(0.0, 1.0);
                let intensity = t.powf(0.4);

                base_color[0] = (base_color[0] as f32 * (1.0 - intensity)
                    + river_color[0] as f32 * intensity) as u8;
                base_color[1] = (base_color[1] as f32 * (1.0 - intensity)
                    + river_color[1] as f32 * intensity) as u8;
                base_color[2] = (base_color[2] as f32 * (1.0 - intensity)
                    + river_color[2] as f32 * intensity) as u8;
            }

            // --- применяем освещение ---
            let r = (base_color[0] as f32 * shade).round().clamp(0.0, 255.0) as u8;
            let g = (base_color[1] as f32 * shade).round().clamp(0.0, 255.0) as u8;
            let b = (base_color[2] as f32 * shade).round().clamp(0.0, 255.0) as u8;

            let idx = ((y * hm.width + x) * 4) as usize;
            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = 255;
        }
    }

    buf
}

// --- палитра биомов ---

pub fn build_biome_palette(cfg: &WorldConfig) -> Vec<[u8; 3]> {
    cfg.biomes
        .iter()
        .map(|b| match b.id.as_str() {
            "temperate_forest" => [34, 139, 34],
            "hot_desert" => [210, 180, 80],
            "cold_mountains" => [160, 160, 170],
            "tundra" => [150, 180, 160],
            _ => {
                let mut h = simple_hash(&b.id) as u64;
                let r = 80 + (h & 0x7F) as u8;
                h >>= 7;
                let g = 80 + (h & 0x7F) as u8;
                h >>= 7;
                let bl = 80 + (h & 0x7F) as u8;
                [r, g, bl]
            }
        })
        .collect()
}

fn simple_hash(s: &str) -> u32 {
    let mut h = 0u32;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    h
}

fn normalize3(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let len = (x * x + y * y + z * z).sqrt().max(1e-6);
    (x / len, y / len, z / len)
}
