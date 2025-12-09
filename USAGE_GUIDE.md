# Руководство по использованию новых функций

## Процедурная генерация объектов

### Использование в коде

```rust
use seed_core::{generate_objects_for_chunk, ProceduralObject, ObjectType};
use seed_config::WorldConfig;

// Загрузка конфигурации
let cfg = WorldConfig::from_file("world-config.json")?;

// Генерация heightmap и biome map
let hm = generate_heightmap_from_config(&cfg, 1024, 1024);
let bm = generate_biome_map_from_config(&cfg, &hm);

// Генерация объектов для чанка
let objects = generate_objects_for_chunk(
    &cfg,
    &hm,
    &bm,
    0,    // chunk_x
    0,    // chunk_y
    256,  // chunk_width
    256,  // chunk_height
    cfg.world_seed
);

// Использование сгенерированных объектов
for obj in objects {
    match obj.object_type {
        ObjectType::TreeConifer => {
            println!("Хвойное дерево на ({}, {}, {})", obj.x, obj.y, obj.z);
            println!("  Масштаб: {}, Поворот: {}°, Вариант: {}",
                     obj.scale, obj.rotation_y.to_degrees(), obj.variant);
        }
        ObjectType::HouseWood => {
            println!("Деревянный дом на ({}, {}, {})", obj.x, obj.y, obj.z);
        }
        _ => {}
    }
}
```

### Типы объектов

-   `TreeConifer` - Хвойное дерево (ели, сосны)
-   `TreeDeciduous` - Лиственное дерево (дубы, берёзы)
-   `TreePalm` - Пальма (тропики)
-   `RockSmall` - Маленький камень
-   `RockMedium` - Средний камень
-   `RockLarge` - Большой валун
-   `BoulderCluster` - Группа камней
-   `Bush` - Куст
-   `Grass` - Трава (кластер)
-   `Cactus` - Кактус
-   `HouseWood` - Деревянный дом
-   `HouseStone` - Каменный дом
-   `HouseMedieval` - Средневековый дом

### Параметры объектов

Каждый `ProceduralObject` содержит:

-   `x, y, z: f32` - Позиция в мировых координатах
-   `object_type: ObjectType` - Тип объекта
-   `scale: f32` - Масштаб (0.7 - 1.5)
-   `rotation_y: f32` - Поворот по Y-оси (радианы)
-   `variant: u8` - Вариант модели (0-4)

## Настройка генерации мира

### Параметры эрозии

В `terrain.rs` можно настроить параметры эрозии:

```rust
// Термическая эрозия (осыпание склонов)
apply_thermal_erosion(
    width,
    height,
    &mut raw_values,
    12,    // iterations: количество проходов
    0.025, // talus: порог уклона (меньше = больше эрозии)
    0.18,  // amount: интенсивность сползания
);

// Гидроэрозия (формирование речных русел)
apply_flow_erosion(
    width,
    height,
    &mut raw_values,
    0.22,  // water_level_fraction: уровень моря
    100.0, // flow_threshold: порог потока для вырезания
    0.022, // carve_strength: глубина вырезания
);

// Генерация озёр
apply_lake_formation(
    width,
    height,
    &mut raw_values,
    &perlin_detail,
    0.15,  // min_depth: минимальная глубина озера
    0.008, // formation_chance: вероятность формирования
);

// Формирование каньонов
apply_canyon_erosion(
    width,
    height,
    &mut raw_values,
    &perlin_ridge1,
    0.025, // carve_intensity: интенсивность вырезания
);
```

### Добавление новых биомов

В `world-config.json`:

```json
{
    "id": "my_custom_biome",
    "displayName": "My Custom Biome",
    "climateRange": {
        "temperatureC": [10, 30],
        "humidity": [0.3, 0.7],
        "elevationMeters": [0, 1000]
    },
    "precipitationRangeMmPerYear": [500, 1500],
    "baseMaterialId": "soil",
    "overlayMaterialIds": ["grass"],
    "dominantMaterials": ["soil", "grass"],
    "vegetationDensity": 0.6,
    "faunaProfiles": ["temperate_animals"],
    "allowSettlements": true
}
```

В `seed-wasm/src/lib.rs` добавьте цвет для биома:

```rust
pub fn build_biome_palette(cfg: &WorldConfig) -> Vec<[u8; 3]> {
    cfg.biomes
        .iter()
        .map(|b| match b.id.as_str() {
            "my_custom_biome" => [120, 180, 90], // RGB цвет
            // ... остальные биомы
            _ => {
                // Автоматическая генерация цвета
            }
        })
        .collect()
}
```

## Оптимизация VR клиента

### Настройка параметров

В `vr_client.js`:

```javascript
// Частота отправки ориентации
const ORIENT_INTERVAL = 1000 / 60; // 60 Hz (можно снизить до 30)

// Предсказание движения
const predictTime = 0.033; // 33ms (2 кадра при 60fps)

// Сглаживание сенсоров
const smoothing = 0.7; // 0 = нет сглаживания, 1 = максимальное

// Стерео эффект
const stereoOffset = 2; // пиксели смещения для глубины

// Barrel distortion
const barrelStrength = 0.15; // сила коррекции линз
```

### Оптимизация для слабых устройств

Если VR клиент работает медленно:

1. Снизьте частоту отправки ориентации:

```javascript
const ORIENT_INTERVAL = 1000 / 30; // 30 Hz вместо 60
```

2. Уменьшите сглаживание сенсоров:

```javascript
const smoothing = 0.5; // меньше нагрузка на CPU
```

3. Отключите предсказание движения (закомментируйте соответствующий код)

## WebSocket сервер

### Настройка параметров

В `server.js`:

```javascript
// Включение/выключение сжатия
const ENABLE_COMPRESSION = true;

// Интервал буферизации кадров (ms)
const FRAME_BUFFER_MS = 16; // 60 FPS

// Настройка сжатия
perMessageDeflate: {
    level: 6,        // 1-9, компромисс скорость/сжатие
    threshold: 256   // минимальный размер для сжатия
}

// Heartbeat (проверка живых соединений)
const heartbeatInterval = 30000; // 30 секунд
```

### Мониторинг производительности

Сервер автоматически выводит статистику каждую минуту:

-   Количество отправленных/полученных сообщений
-   Объём данных в MB
-   Количество подключенных клиентов
-   Статус хоста

## Советы по производительности

### Генерация мира

1. **Размер карты**: Начните с 512x512 для тестирования, увеличивайте до 2048x2048 для финальной версии
2. **Количество итераций эрозии**: Уменьшите до 8 для быстрой генерации
3. **Плотность объектов**: Уменьшите `vegetation_density` в биомах для меньшего количества объектов

### VR клиент

1. **Качество JPEG**: На сервере используйте quality: 75-85 для баланса качество/скорость
2. **Разрешение**: Для простых VR очков достаточно 1280x720 на глаз
3. **FPS**: Целевой FPS 60, минимум 45 для комфортного VR

### WebSocket

1. **Батчинг**: Группируйте небольшие обновления вместо отправки каждого отдельно
2. **Сжатие**: Для текстовых данных >1KB сжатие даёт выигрыш 60-80%
3. **Бинарный протокол**: Используйте для всех данных кроме простых команд

## Отладка

### Проверка генерации объектов

```rust
let objects = generate_objects_for_chunk(...);
println!("Всего объектов: {}", objects.len());

let tree_count = objects.iter()
    .filter(|o| matches!(o.object_type,
        ObjectType::TreeConifer | ObjectType::TreeDeciduous))
    .count();
println!("Деревьев: {}", tree_count);
```

### Визуализация биомов

В `seed-wasm` используйте `worldview_rgba()` для получения RGB буфера:

```javascript
const world = new SeedWorld(configJson, 512, 512);
const rgbaBuffer = world.worldview_rgba();
// Отобразите rgbaBuffer на canvas
```

### Мониторинг VR latency

```javascript
let lastFrameReceived = 0;
function handleFrame(data) {
    const now = performance.now();
    const latency = now - lastFrameReceived;
    console.log(`Frame latency: ${latency}ms`);
    lastFrameReceived = now;
    // ...
}
```

---

Полная документация доступна в файле `IMPROVEMENTS.md`
