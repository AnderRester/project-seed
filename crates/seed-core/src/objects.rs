use crate::biome::BiomeMap;
use crate::terrain::Heightmap;
use noise::{NoiseFn, Perlin};
use seed_config::WorldConfig;

#[derive(Debug, Clone)]
pub struct ProceduralObject {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub object_type: ObjectType,
    pub scale: f32,
    pub rotation_y: f32,
    pub variant: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectType {
    TreeConifer,    // Хвойное дерево
    TreeDeciduous,  // Лиственное дерево
    TreePalm,       // Пальма
    RockSmall,      // Маленький камень
    RockMedium,     // Средний камень
    RockLarge,      // Большой валун
    BoulderCluster, // Группа камней
    Bush,           // Куст
    Grass,          // Трава (кластер)
    Cactus,         // Кактус
    HouseWood,      // Деревянный дом
    HouseStone,     // Каменный дом
    HouseMedieval,  // Средневековый дом
}

/// Генерирует процедурные объекты для чанка мира
pub fn generate_objects_for_chunk(
    cfg: &WorldConfig,
    hm: &Heightmap,
    bm: &BiomeMap,
    chunk_x: u32,
    chunk_y: u32,
    chunk_width: u32,
    chunk_height: u32,
    base_seed: u64,
) -> Vec<ProceduralObject> {
    let mut objects = Vec::new();

    let biomes = &cfg.biomes;
    let sea_level = cfg.sea_level as f32;

    // Разные генераторы шума для разных типов объектов
    let noise_trees = Perlin::new((base_seed ^ 0xAAAA) as u32);
    let noise_rocks = Perlin::new((base_seed ^ 0xBBBB) as u32);
    let noise_houses = Perlin::new((base_seed ^ 0xCCCC) as u32);
    let noise_detail = Perlin::new((base_seed ^ 0xDDDD) as u32);

    for y in chunk_y..(chunk_y + chunk_height).min(hm.height) {
        for x in chunk_x..(chunk_x + chunk_width).min(hm.width) {
            let h = hm.get(x, y);

            // Пропускаем воду
            if h <= sea_level + 0.01 {
                continue;
            }

            let biome_idx = bm.get_index(x, y);
            if biome_idx.is_none() {
                continue;
            }

            let biome_idx = biome_idx.unwrap();
            if biome_idx >= biomes.len() {
                continue;
            }

            let biome = &biomes[biome_idx];

            // Позиция в мировых координатах
            let world_x = x as f32;
            let world_y = y as f32;

            // Вычисляем склон (градиент высоты)
            let slope = calculate_slope(hm, x, y);

            // Очень крутые склоны - пропускаем
            if slope > 0.4 {
                continue;
            }

            // === ДЕРЕВЬЯ ===
            if biome.vegetation_density > 0.0 {
                let tree_noise = noise_trees.get([world_x as f64 * 0.15, world_y as f64 * 0.15]);
                let tree_threshold = 0.5 - (biome.vegetation_density as f64 * 0.4);

                if tree_noise > tree_threshold {
                    // Определяем тип дерева по биому
                    let tree_type = match biome.id.as_str() {
                        "temperate_forest" => {
                            let variant_noise =
                                noise_detail.get([world_x as f64 * 0.3, world_y as f64 * 0.3]);
                            if variant_noise > 0.0 {
                                ObjectType::TreeDeciduous
                            } else {
                                ObjectType::TreeConifer
                            }
                        }
                        "hot_desert" => ObjectType::Cactus,
                        "cold_mountains" => ObjectType::TreeConifer,
                        "tundra" => {
                            if tree_noise > 0.7 {
                                ObjectType::TreeConifer
                            } else {
                                ObjectType::Bush
                            }
                        }
                        _ => ObjectType::TreeDeciduous,
                    };

                    // Вариативность масштаба и поворота
                    let scale_noise =
                        noise_detail.get([(world_x + 100.0) as f64 * 0.2, world_y as f64 * 0.2]);
                    let scale = 0.8 + (scale_noise * 0.5 + 0.5) * 0.6; // 0.8..1.4

                    let rotation_noise =
                        noise_detail.get([world_x as f64 * 0.7, (world_y + 50.0) as f64 * 0.7]);
                    let rotation_y = (rotation_noise * std::f64::consts::PI * 2.0) as f32;

                    let variant_noise =
                        noise_detail.get([world_x as f64 * 1.3, world_y as f64 * 1.3]);
                    let variant = ((variant_noise * 0.5 + 0.5) * 4.0) as u8; // 0..3

                    objects.push(ProceduralObject {
                        x: world_x,
                        y: world_y,
                        z: h,
                        object_type: tree_type,
                        scale: scale as f32,
                        rotation_y,
                        variant,
                    });
                }
            }

            // === КАМНИ ===
            let rock_noise = noise_rocks.get([world_x as f64 * 0.25, world_y as f64 * 0.25]);
            let rock_density = match biome.id.as_str() {
                "cold_mountains" => 0.15,
                "hot_desert" => 0.08,
                "tundra" => 0.06,
                _ => 0.02,
            };

            let rock_threshold = 0.8 - rock_density;

            if rock_noise > rock_threshold {
                // Выбираем размер камня
                let size_noise =
                    noise_detail.get([world_x as f64 * 0.4, (world_y + 200.0) as f64 * 0.4]);
                let rock_type = if size_noise > 0.5 {
                    ObjectType::RockLarge
                } else if size_noise > 0.0 {
                    ObjectType::RockMedium
                } else {
                    ObjectType::RockSmall
                };

                let scale_noise =
                    noise_detail.get([(world_x + 300.0) as f64 * 0.3, world_y as f64 * 0.3]);
                let scale = 0.7 + (scale_noise * 0.5 + 0.5) * 0.8; // 0.7..1.5

                let rotation_noise =
                    noise_detail.get([world_x as f64 * 0.9, (world_y + 150.0) as f64 * 0.9]);
                let rotation_y = (rotation_noise * std::f64::consts::PI * 2.0) as f32;

                let variant = ((rock_noise * 0.5 + 0.5) * 5.0) as u8; // 0..4

                objects.push(ProceduralObject {
                    x: world_x,
                    y: world_y,
                    z: h,
                    object_type: rock_type,
                    scale: scale as f32,
                    rotation_y,
                    variant,
                });
            }

            // === ЗДАНИЯ ===
            if biome.allow_settlements {
                let house_noise = noise_houses.get([world_x as f64 * 0.05, world_y as f64 * 0.05]);

                // Очень редко генерируем дома (только в подходящих местах)
                if house_noise > 0.95 && slope < 0.15 {
                    let house_type = match biome.id.as_str() {
                        "temperate_forest" => ObjectType::HouseWood,
                        _ => ObjectType::HouseStone,
                    };

                    let rotation_noise =
                        noise_detail.get([(world_x + 500.0) as f64 * 0.1, world_y as f64 * 0.1]);
                    // Дома выравниваем по сторонам света (0, 90, 180, 270 градусов)
                    let rotation_y = (((rotation_noise * 0.5 + 0.5) * 4.0).floor()
                        * std::f64::consts::FRAC_PI_2) as f32;

                    objects.push(ProceduralObject {
                        x: world_x,
                        y: world_y,
                        z: h,
                        object_type: house_type,
                        scale: 1.0,
                        rotation_y,
                        variant: 0,
                    });
                }
            }
        }
    }

    objects
}

/// Вычисляет наклон поверхности (0 = плоско, 1 = вертикально)
fn calculate_slope(hm: &Heightmap, x: u32, y: u32) -> f32 {
    let _h_center = hm.get(x, y);

    let x_left = x.saturating_sub(1);
    let x_right = (x + 1).min(hm.width - 1);
    let y_up = y.saturating_sub(1);
    let y_down = (y + 1).min(hm.height - 1);

    let h_left = hm.get(x_left, y);
    let h_right = hm.get(x_right, y);
    let h_up = hm.get(x, y_up);
    let h_down = hm.get(x, y_down);

    let dx = (h_right - h_left) * 0.5;
    let dy = (h_down - h_up) * 0.5;

    (dx * dx + dy * dy).sqrt() * 20.0 // масштабируем для удобства
}
