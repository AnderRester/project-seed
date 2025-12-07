use clap::Parser;
use image::{GrayImage, ImageBuffer, Rgb, RgbImage};
use seed_config::WorldConfig;
use seed_core::{
    generate_biome_map_from_config, generate_heightmap_from_config, BiomeMap, Heightmap, World,
};

#[derive(Parser, Debug)]
#[command(name = "seed-cli")]
#[command(about = "SEED world tools", long_about = None)]
struct Cli {
    /// Path to world config JSON
    #[arg(short, long, default_value = "world-config.json")]
    config: String,

    /// Если указан путь, будет сгенерирован heightmap и сохранён как PNG (grayscale)
    #[arg(long)]
    heightmap_out: Option<String>,

    /// Если указан путь, будет сгенерирована карта биомов и сохранена как PNG (color)
    #[arg(long)]
    biome_out: Option<String>,

    /// Если указан путь, будет сгенерирована совмещённая карта (рельеф + биомы)
    #[arg(long)]
    worldview_out: Option<String>,

    /// Ширина карт в пикселях
    #[arg(long, default_value_t = 512)]
    width: u32,

    /// Высота карт в пикселях
    #[arg(long, default_value_t = 512)]
    height: u32,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    println!("Loading world config from: {}", cli.config);
    let cfg = WorldConfig::from_file(&cli.config)?;
    let world =
        World::from_config(&cfg).map_err(|e| anyhow::anyhow!("failed to construct world: {e}"))?;

    // Сводка
    print_world_summary(&cfg, &world);

    // Нужно ли генерировать heightmap?
    let need_heightmap =
        cli.heightmap_out.is_some() || cli.biome_out.is_some() || cli.worldview_out.is_some();

    let mut heightmap: Option<Heightmap> = None;
    let mut biomemap: Option<BiomeMap> = None;

    if need_heightmap {
        println!();
        println!("Generating heightmap {}x{} ...", cli.width, cli.height);
        let hm = generate_heightmap_from_config(&cfg, cli.width, cli.height);
        heightmap = Some(hm);
    }

    // heightmap -> PNG
    if let (Some(out_path), Some(ref hm)) = (&cli.heightmap_out, &heightmap) {
        println!("Saving heightmap (grayscale) to: {}", out_path);
        save_heightmap_to_png(hm, out_path)?;
    }

    // Генерация и сохранение карты биомов
    if cli.biome_out.is_some() || cli.worldview_out.is_some() {
        if let Some(ref hm) = heightmap {
            println!("Generating biome map ...");
            let bm = generate_biome_map_from_config(&cfg, hm);
            biomemap = Some(bm);
        }
    }

    if let (Some(out_path), Some(ref bm)) = (&cli.biome_out, &biomemap) {
        println!("Saving biome map (color) to: {}", out_path);
        save_biome_map_to_png(bm, &cfg, out_path)?;
    }

    // Совмещённая карта: биомы + освещение рельефа
    if let (Some(out_path), Some(ref hm), Some(ref bm)) =
        (&cli.worldview_out, &heightmap, &biomemap)
    {
        println!("Saving worldview (biomes + shading) to: {}", out_path);
        save_worldview_to_png(hm, bm, &cfg, out_path)?;
    }

    println!("Done.");
    Ok(())
}

// ---------- Сохранение heightmap ----------

fn save_heightmap_to_png(hm: &Heightmap, path: &str) -> anyhow::Result<()> {
    let mut img: GrayImage = GrayImage::new(hm.width, hm.height);

    for y in 0..hm.height {
        for x in 0..hm.width {
            let v = hm.get(x, y); // 0.0..1.0
            let v_u8 = (v.clamp(0.0, 1.0) * 255.0) as u8;
            img.put_pixel(x, y, image::Luma([v_u8]));
        }
    }

    img.save(path)?;
    Ok(())
}

fn save_worldview_to_png(
    hm: &Heightmap,
    bm: &BiomeMap,
    cfg: &WorldConfig,
    path: &str,
) -> anyhow::Result<()> {
    let mut img: RgbImage = ImageBuffer::new(hm.width, hm.height);

    // Палитра биомов
    let palette = build_biome_palette(cfg);

    // Цвет воды (пока без ocean-биома)
    let water_color = [40u8, 80u8, 160u8];

    // Направление света (примерно северо-запад, сверху)
    let light_dir = normalize3(0.6, 0.6, 1.0);

    // Насколько сильно высота будет влиять на наклон нормали
    let slope_scale = 40.0_f32;

    for y in 0..hm.height {
        for x in 0..hm.width {
            // Высота в центре
            let hc = hm.get(x, y);

            // Соседи (с клэмпом по краю)
            let xl = x.saturating_sub(1);
            let xr = (x + 1).min(hm.width - 1);
            let yu = y.saturating_sub(1);
            let yd = (y + 1).min(hm.height - 1);

            let hl = hm.get(xl, y);
            let hr = hm.get(xr, y);
            let hu = hm.get(x, yu);
            let hd = hm.get(x, yd);

            // Градиенты высоты
            let dx = (hr - hl) as f32;
            let dy = (hd - hu) as f32;

            // Нормаль поверхности (приблизительная)
            let nx = -dx * slope_scale;
            let ny = -dy * slope_scale;
            let nz = 1.0;

            let normal = normalize3(nx, ny, nz);

            // Косинус угла между нормалью и направлением света
            let dot = normal.0 * light_dir.0 + normal.1 * light_dir.1 + normal.2 * light_dir.2;
            let mut shade = dot.max(0.0); // 0..1

            // Добавляем немного амбиента, чтобы не уходило в полную тьму
            let ambient = 0.3;
            shade = ambient + shade * (1.0 - ambient);
            shade = shade.clamp(0.0, 1.0);

            // Цвет биома или воды
            let base_color = match bm.get_index(x, y) {
                Some(idx) if idx < palette.len() => palette[idx],
                _ => water_color,
            };

            let r = (base_color[0] as f32 * shade).round().clamp(0.0, 255.0) as u8;
            let g = (base_color[1] as f32 * shade).round().clamp(0.0, 255.0) as u8;
            let b = (base_color[2] as f32 * shade).round().clamp(0.0, 255.0) as u8;

            img.put_pixel(x, y, Rgb([r, g, b]));
        }
    }

    img.save(path)?;
    Ok(())
}

/// Нормализация 3D-вектора
fn normalize3(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let len = (x * x + y * y + z * z).sqrt().max(1e-6);
    (x / len, y / len, z / len)
}

// ---------- Сохранение карты биомов ----------

fn save_biome_map_to_png(bm: &BiomeMap, cfg: &WorldConfig, path: &str) -> anyhow::Result<()> {
    let mut img: RgbImage = ImageBuffer::new(bm.width, bm.height);

    // Палитра цветов для биомов
    let palette = build_biome_palette(&cfg);

    for y in 0..bm.height {
        for x in 0..bm.width {
            let idx_opt = bm.get_index(x, y);
            let color = match idx_opt {
                Some(idx) if idx < palette.len() => palette[idx],
                _ => [0u8, 0u8, 0u8], // неизвестный/море -> чёрный
            };
            img.put_pixel(x, y, Rgb(color));
        }
    }

    img.save(path)?;
    Ok(())
}

// fn build_biome_palette(cfg: &WorldConfig) -> Vec<[u8; 3]> {
//     let n = cfg.biomes.len().max(1);
//     let mut palette = Vec::with_capacity(n);

//     for (i, biome) in cfg.biomes.iter().enumerate() {
//         // Используем индекс, чтобы разнести цвета по кругу, и слегка "сдвинем" по id
//         let t = (i as f32) / (n as f32);
//         let name_hash = simple_hash(&biome.id) as f32;
//         let hue = (t * 360.0 + (name_hash % 60.0)) % 360.0;

//         let (r, g, b) = hsv_to_rgb(hue, 0.8, 0.9);
//         palette.push([r, g, b]);
//     }

//     palette
// }

pub fn build_biome_palette(cfg: &WorldConfig) -> Vec<[u8; 3]> {
    cfg.biomes
        .iter()
        .map(|b| match b.id.as_str() {
            // Тёплый лес
            "temperate_forest" => [34, 139, 34],     // тёмно-зелёный
            // Пустыня
            "hot_desert" => [210, 180, 80],          // песочный
            // Холодные горы
            "cold_mountains" => [160, 160, 170],     // серо-каменный
            // Тундра / холодная равнина
            "tundra" => [150, 180, 160],             // холодно-зелёный
            // fallback — если добавишь новый биом, но не задашь цвет
            _ => {
                // стабильный "псевдослучайный" цвет по hash id
                let mut h = simple_hash(&b.id) as u64;
                // чуть поиграем компонентами
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

/// Очень простой хеш строки (не для крипты, а для разнообразия цветов)
fn simple_hash(s: &str) -> u32 {
    let mut h = 0u32;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    h
}

/// Конвертация HSV -> RGB (0<=h<360, 0..1, 0..1)
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

// ---------- Сводка по миру (как ранее) ----------

fn print_world_summary(cfg: &WorldConfig, world: &World) {
    println!("=======================");
    println!("=== World summary ===");
    println!("=======================");
    println!("ID:        {}", cfg.world_id);
    println!("Name:      {}", cfg.meta.name);
    println!("Author:    {}", cfg.meta.author);
    println!("Created:   {}", cfg.meta.created_at);
    println!("Seed ver.: {}", cfg.seed_version);
    println!();

    println!("--- Scale ---");
    println!("Mode:               {}", cfg.scale.mode);
    println!("Region size (km):   {}", cfg.scale.region_size_km);
    println!("Planet radius (km): {}", cfg.scale.planet_radius_km);
    println!("Chunk size (m):     {}", cfg.scale.chunk_size_meters);
    println!("Max detail (m):     {}", cfg.scale.max_detail_meters);
    println!();

    let star_system = &cfg.cosmos.star_system;
    println!("--- Cosmos ---");
    println!("Stars:   {}", star_system.stars.len());
    println!("Planets: {}", star_system.planets.len());
    println!("Active planet ID: {}", star_system.active_planet_id);

    let p = &world.cosmos.active_planet;
    println!("Active planet name:    {}", p.name);
    println!("  Radius:              {} km", p.radius_km);
    println!("  Gravity:             {} m/s^2", p.gravity_ms2);
    println!("  Day length:          {} h", p.day_length_hours);
    println!("  Year length:         {} days", p.year_length_days);
    println!();

    let atm = &cfg.environment.atmosphere;
    let clim = &cfg.environment.climate_model;

    println!("--- Environment ---");
    println!("Atmosphere:");
    println!("  Pressure:        {} kPa", atm.pressure_k_pa);
    println!("  Base temp:       {} °C", atm.base_temperature_c);
    println!("  Mean humidity:   {}", atm.humidity_global_mean);
    println!("  Gases:");
    for (gas, fraction) in &atm.composition {
        println!("    {}: {}", gas, fraction);
    }

    println!("Climate model:");
    println!("  Type:                    {}", clim.model_type);
    println!("  Sea level:               {} m", clim.sea_level_meters);
    println!(
        "  Lapse rate:              {} °C/km",
        clim.temperature_lapse_rate_c_per_km
    );
    println!("  Precipitation scale:     {}", clim.precipitation_scale);
    println!("  Global wind pattern:     {}", clim.wind_global_pattern);
    println!("  Storm freq:              {}", clim.storm_frequency);
    println!("  Storm intensity (mean):  {}", clim.storm_intensity_mean);
    println!("  Seasonality enabled:     {}", clim.seasonality.enabled);
    println!(
        "  Seasons:                 {}",
        clim.seasonality.season_count
    );
    println!(
        "  Season length (days):    {}",
        clim.seasonality.season_length_days
    );
    println!();

    let geo = &cfg.geology;
    println!("--- Geology ---");
    println!("Heightmap:");
    println!(
        "  Mode:                   {}",
        geo.heightmap.generation_mode
    );
    println!("  Base seed:              {}", geo.heightmap.base_seed);
    println!(
        "  Continental scale (km): {}",
        geo.heightmap.continental_scale_km
    );
    println!(
        "  Mountain amp (m):       {}",
        geo.heightmap.mountain_amplitude_meters
    );
    println!(
        "  Erosion iterations:     {}",
        geo.heightmap.erosion_iterations
    );
    println!("  River density:          {}", geo.heightmap.river_density);

    println!("Material layers: {}", geo.material_layers.len());
    for layer in &geo.material_layers {
        println!(
            "  - {} ({}) depth {:?} m",
            layer.name, layer.r#type, layer.depth_range_meters
        );
    }
    println!();

    println!("--- Materials & Biomes ---");
    println!("Materials defined: {}", cfg.materials.len());
    for m in &cfg.materials {
        println!(
            "  - {} [{}], category={}, density={} kg/m^3, footprints={}",
            m.display_name, m.id, m.category, m.density_kg_m3, m.supports_footprints
        );
    }

    println!("Biomes defined: {}", cfg.biomes.len());
    for b in &cfg.biomes {
        println!(
            "  - {} [{}], vegetation={}, settlements={}",
            b.display_name, b.id, b.vegetation_density, b.allow_settlements
        );
    }
    println!();

    println!("--- Ecosystems ---");
    println!("Simulation scale: {}", cfg.ecosystems.simulation_scale);
    println!(
        "Time step:        {} minutes",
        cfg.ecosystems.time_step_minutes
    );
    println!(
        "Species defined:  {}",
        cfg.ecosystems.species_definitions.len()
    );
    for s in &cfg.ecosystems.species_definitions {
        println!(
            "  - {} [{}], trophic={}, density={} /km^2, migration={}",
            s.id, s.id, s.trophic_level, s.population_density_per_km2, s.migration_enabled
        );
    }
    println!();

    let cat = &cfg.catastrophes;
    println!("--- Catastrophes ---");
    println!("Enabled:                   {}", cat.global_controls.enabled);
    println!(
        "Max concurrent events:     {}",
        cat.global_controls.max_concurrent_events
    );
    println!(
        "Allow planet-destroying:   {}",
        cat.global_controls.allow_planet_destroying_events
    );
    println!(
        "Base randomness:           {}",
        cat.global_controls.base_randomness
    );
    println!("Event types: {}", cat.event_types.len());
    for e in &cat.event_types {
        println!(
            "  - {} [{}], trigger={}, base freq/yr={}",
            e.display_name, e.id, e.trigger_model, e.base_frequency_per_year
        );
    }
    println!();

    println!("--- Civilizations ---");
    println!("Enabled: {}", cfg.civilizations.enabled);
    println!(
        "Faction presets: {}",
        cfg.civilizations.faction_presets.len()
    );
    for f in &cfg.civilizations.faction_presets {
        println!(
            "  - {} [{}], tech={}, population={}, capital=({}°, {}°)",
            f.name,
            f.id,
            f.tech_level,
            f.starting_population,
            f.capital_location_hint.lat_deg,
            f.capital_location_hint.lon_deg
        );
    }
    let hist = &cfg.civilizations.history_simulation;
    println!("History simulation:");
    println!("  Enabled:          {}", hist.enabled);
    println!("  Years to simulate: {}", hist.years_to_simulate);
    println!("  War likelihood:   {}", hist.war_likelihood);
    println!("  Trade importance: {}", hist.trade_importance);
    println!(
        "  Catastrophe impact: {}",
        hist.catastrophe_impact_on_history
    );
    println!();

    let nd = &cfg.narrative_director;
    println!("--- Narrative Director ---");
    println!("ID:                            {}", nd.id);
    println!("Enabled:                       {}", nd.enabled);
    println!("Aggressiveness:                {}", nd.aggressiveness);
    println!("Player danger bias:            {}", nd.player_danger_bias);
    println!("World stability bias:          {}", nd.world_stability_bias);
    println!(
        "Can trigger global catastrophes: {}",
        nd.can_trigger_global_catastrophes
    );
    println!("Quest generation:");
    println!(
        "  Enabled:                     {}",
        nd.quest_generation.enabled
    );
    println!(
        "  Max active quests/player:    {}",
        nd.quest_generation.max_active_quests_per_player
    );
    println!(
        "  Use real world state:        {}",
        nd.quest_generation.use_real_world_state
    );
    println!(
        "  Preferred quest types:       {:?}",
        nd.quest_generation.preferred_quest_types
    );
    println!("Event policies:");
    println!(
        "  Allow city destruction:      {}",
        nd.event_policies.allow_city_destruction
    );
    println!(
        "  Allow permanent biome changes: {}",
        nd.event_policies.allow_permanent_biome_changes
    );
    println!(
        "  Max players killed by system event: {}",
        nd.event_policies.max_players_killed_by_system_event
    );
    println!();

    let sim = &cfg.simulation;
    println!("--- Simulation ---");
    println!("Time:");
    println!("  Time scale:                    {}", sim.time.time_scale);
    println!(
        "  Allow time acceleration:       {}",
        sim.time.allow_time_acceleration
    );
    println!(
        "  Max time scale in hub:         {}",
        sim.time.max_time_scale_in_hub
    );
    println!(
        "  Max time scale in background:  {}",
        sim.time.max_time_scale_in_background_sim
    );

    println!("Physics:");
    println!("  Solver accuracy: {}", sim.physics.solver_accuracy);
    println!("  Max substeps:    {}", sim.physics.max_substeps);

    println!("LOD:");
    println!("  Terrain LOD levels:    {}", sim.lod.terrain_lod_levels);
    println!("  Object LOD levels:     {}", sim.lod.object_lod_levels);
    println!(
        "  Destruction LOD levels: {}",
        sim.lod.destruction_lod_levels
    );

    println!("Network:");
    println!("  Authoritative mode: {}", sim.network.authoritative_mode);
    println!("  Tick rate:          {} Hz", sim.network.tick_rate_hz);
    println!("  Max latency:        {} ms", sim.network.max_latency_ms);
    println!(
        "  Active region radius:     {} km",
        sim.network.region_radius_km_active
    );
    println!(
        "  Background region radius: {} km",
        sim.network.region_radius_km_background
    );
    println!(
        "  State sync strategy:      {}",
        sim.network.state_sync_strategy
    );
}
