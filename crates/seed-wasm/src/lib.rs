use seed_config::WorldConfig;
use seed_core::{
    generate_biome_map_from_config, generate_heightmap_from_config, BiomeMap, Heightmap,
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

    /// Возвращает RGBA-буфер "worldview" (биомы + освещение рельефа)
    #[wasm_bindgen]
    pub fn worldview_rgba(&self) -> Vec<u8> {
        build_worldview_rgba(&self.heightmap, &self.biomemap, &self.cfg)
    }

    #[wasm_bindgen]
    pub fn heightmap_values(&self) -> Vec<f32> {
        self.heightmap.values.clone()
    }
}

// ---- Ниже — та же логика, что в save_worldview_to_png, только в Vec<u8> ----

fn build_worldview_rgba(hm: &Heightmap, bm: &BiomeMap, cfg: &WorldConfig) -> Vec<u8> {
    let mut buf = vec![0u8; (hm.width * hm.height * 4) as usize];

    let palette = build_biome_palette(cfg);
    let water_color = [40u8, 80u8, 160u8];
    let light_dir = normalize3(0.6, 0.6, 1.0);
    let slope_scale = 40.0_f32;

    for y in 0..hm.height {
        for x in 0..hm.width {
            let hc = hm.get(x, y);

            let xl = x.saturating_sub(1);
            let xr = (x + 1).min(hm.width - 1);
            let yu = y.saturating_sub(1);
            let yd = (y + 1).min(hm.height - 1);

            let hl = hm.get(xl, y);
            let hr = hm.get(xr, y);
            let hu = hm.get(x, yu);
            let hd = hm.get(x, yd);

            let dx = (hr - hl) as f32;
            let dy = (hd - hu) as f32;

            let nx = -dx * slope_scale;
            let ny = -dy * slope_scale;
            let nz = 1.0;
            let normal = normalize3(nx, ny, nz);

            let dot = normal.0 * light_dir.0 + normal.1 * light_dir.1 + normal.2 * light_dir.2;
            let mut shade = dot.max(0.0);
            let ambient = 0.3;
            shade = ambient + shade * (1.0 - ambient);
            shade = shade.clamp(0.0, 1.0);

            let base_color = match bm.get_index(x, y) {
                Some(idx) if idx < palette.len() => palette[idx],
                _ => water_color,
            };

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

// --- утилиты: палитра биомов (как в CLI) ---

fn build_biome_palette(cfg: &WorldConfig) -> Vec<[u8; 3]> {
    let n = cfg.biomes.len().max(1);
    let mut palette = Vec::with_capacity(n);

    for (i, biome) in cfg.biomes.iter().enumerate() {
        let t = (i as f32) / (n as f32);
        let name_hash = simple_hash(&biome.id) as f32;
        let hue = (t * 360.0 + (name_hash % 60.0)) % 360.0;

        let (r, g, b) = hsv_to_rgb(hue, 0.8, 0.9);
        palette.push([r, g, b]);
    }

    palette
}

fn simple_hash(s: &str) -> u32 {
    let mut h = 0u32;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    h
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;

    let (r1, g1, b1) = match h {
        h if h < 60.0 => (c, x, 0.0),
        h if h < 120.0 => (x, c, 0.0),
        h if h < 180.0 => (0.0, c, x),
        h if h < 240.0 => (0.0, x, c),
        h if h < 300.0 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };

    let r = ((r1 + m) * 255.0).round() as u8;
    let g = ((g1 + m) * 255.0).round() as u8;
    let b = ((b1 + m) * 255.0).round() as u8;
    (r, g, b)
}

fn normalize3(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let len = (x * x + y * y + z * z).sqrt().max(1e-6);
    (x / len, y / len, z / len)
}
