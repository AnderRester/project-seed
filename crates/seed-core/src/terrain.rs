use noise::{NoiseFn, Perlin, Seedable};
use seed_config::{HeightmapConfig, WorldConfig};
use std::f64::consts::PI;

#[derive(Debug, Clone)]
pub struct Heightmap {
    pub width: u32,
    pub height: u32,
    /// Значения высоты, нормализованные в диапазоне [0.0, 1.0]
    pub values: Vec<f32>,
}

impl Heightmap {
    #[inline]
    pub fn index(&self, x: u32, y: u32) -> usize {
        (y * self.width + x) as usize
    }

    #[inline]
    pub fn get(&self, x: u32, y: u32) -> f32 {
        self.values[self.index(x, y)]
    }
}

/// Континенты + горные хребты (анизотропные) + детали.
pub fn generate_heightmap_from_config(cfg: &WorldConfig, width: u32, height: u32) -> Heightmap {
    let hcfg: &HeightmapConfig = &cfg.geology.heightmap;

    let base_seed = hcfg.base_seed as u32;

    // Разные генераторы с разными seed'ами
    let perlin_cont = Perlin::new(base_seed);
    let perlin_detail = Perlin::new(base_seed ^ 0x1234_5678);
    let perlin_ridge1 = Perlin::new(base_seed ^ 0x8765_4321);
    let perlin_ridge2 = Perlin::new(base_seed.wrapping_add(7777));
    let perlin_warp = Perlin::new(base_seed.wrapping_add(999));

    let mut raw_values = Vec::with_capacity((width * height) as usize);

    // Масштаб континентов (в “условных км”)
    let continental_scale = hcfg.continental_scale_km.max(10.0);

    let freq_cont = 0.5 / continental_scale; // очень низкая частота
    let freq_detail_base = 4.0 * freq_cont; // детали
    let freq_ridge = 2.0 * freq_cont; // горные цепи
    let freq_warp = 1.0 * freq_cont; // warp
    let warp_strength = 0.5;

    // Смещения от seed, чтобы карта не была привязана к (0,0)
    let offset_x = (base_seed as f64 * 12_345.6789).sin() * 1000.0;
    let offset_y = (base_seed as f64 * 98_765.4321).cos() * 1000.0;

    // Направления горных хребтов (в градусах)
    let theta1 = 25.0_f64 / 180.0 * PI; // первый “магистральный” хребет
    let theta2 = -40.0_f64 / 180.0 * PI; // второй, пересекающий

    let axis1 = (theta1.cos(), theta1.sin());
    let ortho1 = (-theta1.sin(), theta1.cos());
    let axis2 = (theta2.cos(), theta2.sin());
    let ortho2 = (-theta2.sin(), theta2.cos());

    let mut min_v = f64::MAX;
    let mut max_v = f64::MIN;

    let w1 = (width.saturating_sub(1).max(1)) as f64;
    let h1 = (height.saturating_sub(1).max(1)) as f64;

    for y in 0..height {
        for x in 0..width {
            // Нормированные координаты [0..1]
            let fx = x as f64 / w1;
            let fy = y as f64 / h1;

            // Базовые координаты в "мировом" пространстве
            let px = fx * continental_scale + offset_x;
            let py = fy * continental_scale + offset_y;

            // Domain warp
            let wx = perlin_warp.get([px * freq_warp, py * freq_warp]);
            let wy = perlin_warp.get([(px + 100.0) * freq_warp, (py - 50.0) * freq_warp]);
            let xw = px + wx * warp_strength * continental_scale;
            let yw = py + wy * warp_strength * continental_scale;

            // --- Континенты ---
            let cont_raw = perlin_cont.get([xw * freq_cont, yw * freq_cont]);

            // Порог "уровня моря": чем выше bias, тем больше океанов
            let sea_bias = 0.1;
            let cont = cont_raw - sea_bias;

            let land = cont.max(0.0); // суша (0.. ~1)

            // --- Градиент континентального шума (для размещения хребтов) ---
            let eps = 0.5 * continental_scale; // шаг для оценки градиента
            let cont_x1 = perlin_cont.get([(xw + eps) * freq_cont, yw * freq_cont]);
            let cont_x0 = cont_raw;
            let cont_y1 = perlin_cont.get([xw * freq_cont, (yw + eps) * freq_cont]);

            let dx = cont_x1 - cont_x0;
            let dy = cont_y1 - cont_x0;
            let grad_mag = (dx * dx + dy * dy).sqrt(); // чем больше, тем резче переход
            let grad_factor = (grad_mag * 2.0).clamp(0.0, 1.5); // поджимаем сверху

            // --- Детали рельефа ---
            let mut detail = 0.0;
            let mut amp = 1.0;
            let mut f = freq_detail_base;
            for _ in 0..3 {
                let d = perlin_detail.get([xw * f, yw * f]);
                detail += amp * d;
                amp *= 0.5;
                f *= 2.0;
            }
            detail *= 0.25;

            // --- Анизотропные горные хребты ---

            // Проекция точки на ось и перпендикуляр (для хребта 1)
            let u1 = (xw * axis1.0 + yw * axis1.1) * freq_ridge;
            let v1 = (xw * ortho1.0 + yw * ortho1.1) * freq_ridge * 0.35; // 0.35 => вытянутые

            // Хребет 1
            let r1_src = perlin_ridge1.get([u1, v1]);
            let ridge1 = (1.0 - r1_src.abs()).max(0.0).powf(1.7); // пики

            // Хребет 2 (пересекающийся)
            let u2 = (xw * axis2.0 + yw * axis2.1) * freq_ridge * 0.9;
            let v2 = (xw * ortho2.0 + yw * ortho2.1) * freq_ridge * 0.4;

            let r2_src = perlin_ridge2.get([u2, v2]);
            let ridge2 = (1.0 - r2_src.abs()).max(0.0).powf(1.7);

            let ridge_sum = 0.6 * ridge1 + 0.4 * ridge2; // смесь двух направлений

            // Хребты только на суше + усиление там, где сильный градиент континента
            let mountain_raw = ridge_sum * land * grad_factor;

            // Нормируем горы в [0..~2]
            let mountain = mountain_raw.max(0.0).min(2.0);

            // --- Итоговая высота ---

            // 1) базовый “каркас” суши
            let mut base_land = land.powf(1.2);

            // 2) прибрежная зона — сглаживаем детали и горы около берега
            let coastal_width = 0.18;
            let coastal = (land / coastal_width).clamp(0.0, 1.0);

            let mountain_inland = mountain * (0.6 + 0.7 * coastal); // 0.6..1.3
            let detail_inland = detail * coastal;

            let mut elevation = base_land + detail_inland + mountain_inland;

            if elevation < 0.0 {
                elevation = 0.0;
            }

            raw_values.push(elevation);

            if elevation < min_v {
                min_v = elevation;
            }
            if elevation > max_v {
                max_v = elevation;
            }
        }
    }

    // --- МЯГКАЯ ЭРОЗИЯ: СНАЧАЛА ТЕРМИЧЕСКАЯ, ПОТОМ ГИДРО ---

    // 1. Термическая (осыпание склонов)
    apply_thermal_erosion(
        width,
        height,
        &mut raw_values,
        8,    // iterations: умеренное сглаживание
        0.03, // talus: порог уклона
        0.15, // amount: доля перепада, которая "сползает"
    );

    // 2. Гидро-эрозия (формирование мягких русел)
    apply_flow_erosion(
        width,
        height,
        &mut raw_values,
        0.25,  // water_level_fraction: что считаем "морем"
        120.0, // flow_threshold: порог потока для вырезания
        0.015, // carve_strength: максимальная глубина вырезания
    );

    // После эрозии min/max поменялись — пересчитаем
    min_v = f64::MAX;
    max_v = f64::MIN;
    for &v in &raw_values {
        if v < min_v {
            min_v = v;
        }
        if v > max_v {
            max_v = v;
        }
    }

    // Нормализация в [0..1]
    let range = (max_v - min_v).max(1e-6);
    let mut norm = Vec::with_capacity(raw_values.len());
    for v in raw_values {
        let mut x = (v - min_v) / range;
        x = x.powf(1.05); // лёгкая коррекция распределения
        norm.push(x as f32);
    }

    Heightmap {
        width,
        height,
        values: norm,
    }
}

/// D8-сток: для каждой клетки считаем, сколько "воды" через неё проходит.
/// Возвращает вектор длиной width*height, значения нормированы в [0..1].
pub fn compute_flow_accumulation(hm: &Heightmap, sea_level_norm: f32) -> Vec<f32> {
    let w = hm.width as usize;
    let h = hm.height as usize;
    let len = w * h;
    if len == 0 {
        return Vec::new();
    }

    let vals = &hm.values;
    let mut downslope: Vec<Option<usize>> = vec![None; len];

    // D8: для каждой клетки ищем самого низкого соседа (если мы выше него и выше моря)
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            let h_here = vals[idx] as f32;
            if h_here <= sea_level_norm {
                continue; // море — сток не считаем
            }

            let mut best_diff = 0.0f32;
            let mut best_n: Option<usize> = None;

            for dy in -1..=1 {
                for dx in -1..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as isize + dx as isize;
                    let ny = y as isize + dy as isize;
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                        continue;
                    }
                    let nidx = ny as usize * w + nx as usize;
                    let h_nei = vals[nidx] as f32;
                    let diff = h_here - h_nei;
                    if diff > best_diff {
                        best_diff = diff;
                        best_n = Some(nidx);
                    }
                }
            }

            if best_diff > 0.0 {
                downslope[idx] = best_n;
            }
        }
    }

    // Порядок обхода: сверху вниз по высоте
    let mut order: Vec<usize> = (0..len).collect();
    order.sort_unstable_by(|&a, &b| {
        vals[b]
            .partial_cmp(&vals[a])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Накопление потока
    let mut flow = vec![1.0f32; len];
    for &idx in &order {
        if let Some(nidx) = downslope[idx] {
            flow[nidx] += flow[idx];
        }
    }

    // Нормализация в [0..1]
    let mut max_flow = 0.0f32;
    for f in &flow {
        if *f > max_flow {
            max_flow = *f;
        }
    }
    if max_flow > 0.0 {
        for f in &mut flow {
            *f /= max_flow;
        }
    }

    flow
}

// Простая термическая эрозия.
// width, height - размеры сетки.
// heights - массив высот (row-major, length = width * height).
// iterations - сколько раз прогоняем процесс.
// talus - порог уклона (чем меньше, тем сильнее эрозия).
// amount - доля перепада, которая может "сползти" за одну итерацию.
fn apply_thermal_erosion(
    width: u32,
    height: u32,
    heights: &mut [f64],
    iterations: u32,
    talus: f64,
    amount: f64,
) {
    let w = width as usize;
    let h = height as usize;
    let len = heights.len();
    if len != w * h || len == 0 {
        return;
    }

    // 8-соседей (по квадрату)
    const NEIGHBORS: &[(i32, i32)] = &[
        (-1, -1),
        (0, -1),
        (1, -1),
        (-1, 0),
        (1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
    ];

    for _ in 0..iterations {
        let mut delta = vec![0.0_f64; len];

        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                let h_here = heights[idx];

                // считаем перепады до соседей
                let mut diffs: [f64; 8] = [0.0; 8];
                let mut total_diff = 0.0;
                let mut count = 0usize;

                for (ni, &(dx, dy)) in NEIGHBORS.iter().enumerate() {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let nidx = ny as usize * w + nx as usize;
                    let h_nei = heights[nidx];
                    let diff = h_here - h_nei;
                    // интересен только случай, когда мы выше соседа
                    if diff > talus {
                        diffs[ni] = diff;
                        total_diff += diff;
                        count += 1;
                    }
                }

                if count == 0 || total_diff <= 0.0 {
                    continue;
                }

                // сколько максимально "сползёт" с этой клетки
                let max_drop = amount * total_diff;
                let mut dropped_sum = 0.0;

                for (ni, &(dx, dy)) in NEIGHBORS.iter().enumerate() {
                    let diff = diffs[ni];
                    if diff <= 0.0 {
                        continue;
                    }

                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }

                    let share = max_drop * (diff / total_diff);
                    dropped_sum += share;

                    let nidx = ny as usize * w + nx as usize;
                    delta[nidx] += share;
                }

                delta[idx] -= dropped_sum;
            }
        }

        for i in 0..len {
            heights[i] += delta[i];
        }
    }
}

/// Гидро-эрозия по схеме D8:
/// - считаем для каждой клетки, сколько "воды" через неё проходит;
/// - места с большим потоком немного "вырезаем" вниз — формируются русла.
fn apply_flow_erosion(
    width: u32,
    height: u32,
    heights: &mut [f64],
    water_level_fraction: f64, // доля диапазона высот, считаем ниже этого уровня "морем"
    flow_threshold: f64,       // порог потока, выше которого начинаем резать
    carve_strength: f64,       // максимальная глубина вырезания в единицах высоты
) {
    let w = width as usize;
    let h = height as usize;
    let len = w * h;
    if heights.len() != len || len == 0 {
        return;
    }

    // min/max для оценки уровня "моря"
    let mut min_h = f64::MAX;
    let mut max_h = f64::MIN;
    for &v in heights.iter() {
        if v < min_h {
            min_h = v;
        }
        if v > max_h {
            max_h = v;
        }
    }
    let range = (max_h - min_h).max(1e-6);
    let water_level = min_h + range * water_level_fraction;

    // Для каждой клетки найдём "downslope" соседа — наиболее низкого.
    let mut downslope: Vec<Option<usize>> = vec![None; len];

    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            let h_here = heights[idx];

            let mut best_diff = 0.0;
            let mut best_neighbor: Option<usize> = None;

            for dy in -1..=1 {
                for dx in -1..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as isize + dx as isize;
                    let ny = y as isize + dy as isize;
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                        continue;
                    }
                    let nidx = ny as usize * w + nx as usize;
                    let h_nei = heights[nidx];
                    let diff = h_here - h_nei;
                    if diff > best_diff {
                        best_diff = diff;
                        best_neighbor = Some(nidx);
                    }
                }
            }

            if best_diff > 0.0 {
                downslope[idx] = best_neighbor;
            }
        }
    }

    // Список индексов, отсортированных по высоте (сверху вниз)
    let mut order: Vec<usize> = (0..len).collect();
    order.sort_unstable_by(|&a, &b| {
        heights[b]
            .partial_cmp(&heights[a])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Инициализируем поток: каждая клетка "даёт" 1 единицу воды
    let mut flow = vec![1.0_f64; len];
    for &idx in &order {
        if let Some(nidx) = downslope[idx] {
            flow[nidx] += flow[idx];
        }
    }

    // Максимальный поток для нормализации
    let mut max_flow = 0.0;
    for &f in &flow {
        if f > max_flow {
            max_flow = f;
        }
    }
    if max_flow <= 0.0 {
        return;
    }

    // Вырезаем русла
    for idx in 0..len {
        // не трогаем дно океана
        if heights[idx] <= water_level {
            continue;
        }

        let f = flow[idx];
        if f < flow_threshold {
            continue;
        }

        // k ~ 0..1, но быстро растёт при больших потоках
        let k = (f / max_flow).sqrt();
        heights[idx] -= carve_strength * k;
    }
}
