// shaders.js - Шейдеры для воды, травы и облаков

// ============= WATER SHADERS =============
export const waterVertexShader = `
    uniform float time;
    uniform float waveHeight;
    uniform float waveFrequency;
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    
    void main() {
        vUv = uv;
        vPosition = position;
        
        // Множественные волны для реалистичности
        float wave1 = sin(position.x * waveFrequency + time) * waveHeight;
        float wave2 = sin(position.z * waveFrequency * 1.3 - time * 0.7) * waveHeight * 0.5;
        float wave3 = sin((position.x + position.z) * waveFrequency * 0.8 + time * 1.2) * waveHeight * 0.3;
        
        vec3 newPosition = position;
        newPosition.y += wave1 + wave2 + wave3;
        
        // Нормали для освещения
        float dx = cos(position.x * waveFrequency + time) * waveFrequency * waveHeight;
        float dz = cos(position.z * waveFrequency * 1.3 - time * 0.7) * waveFrequency * 1.3 * waveHeight * 0.5;
        
        vec3 tangent = normalize(vec3(1.0, dx, 0.0));
        vec3 bitangent = normalize(vec3(0.0, dz, 1.0));
        vNormal = normalize(cross(tangent, bitangent));
        
        vec4 worldPos = modelMatrix * vec4(newPosition, 1.0);
        vWorldPosition = worldPos.xyz;
        
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const waterFragmentShader = `
    uniform float time;
    uniform vec3 waterColor;
    uniform vec3 deepWaterColor;
    uniform float opacity;
    uniform vec3 sunDirection;
    uniform vec3 cameraPos;
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    
    // Простой шум для подводных эффектов
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    void main() {
        vec3 viewDir = normalize(cameraPos - vWorldPosition);
        vec3 normal = normalize(vNormal);
        
        // Френелевский эффект (вода прозрачнее под прямым углом)
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
        
        // Глубина (имитация - на основе позиции)
        float depth = smoothstep(-5.0, 5.0, vPosition.y);
        vec3 color = mix(deepWaterColor, waterColor, depth);
        
        // Зеркальный блик от солнца
        vec3 reflectDir = reflect(-sunDirection, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
        color += vec3(1.0, 1.0, 0.9) * spec * 0.8;
        
        // Caustics (каустика - подводные световые узоры)
        vec2 causticsUv = vUv * 15.0 + time * 0.1;
        float caustics1 = noise(causticsUv);
        float caustics2 = noise(causticsUv * 1.5 + time * 0.15);
        float caustics = pow(caustics1 * caustics2, 2.0) * 0.4;
        color += vec3(0.8, 0.9, 1.0) * caustics * (1.0 - depth);
        
        // Пена на гребнях волн
        float foam = smoothstep(0.7, 1.0, vPosition.y * 0.5 + 0.5);
        color = mix(color, vec3(1.0), foam * 0.3);
        
        // Прозрачность с френелем
        float alpha = mix(opacity, 0.95, fresnel * 0.8);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ============= GRASS SHADERS =============
export const grassVertexShader = `
    uniform float time;
    uniform float windStrength;
    uniform vec3 windDirection;
    
    attribute vec3 offset;
    attribute float scale;
    attribute float phase;
    attribute float grassType; // 0 = обычная, 1 = высокая
    
    varying vec3 vColor;
    varying float vHeight;
    varying float vType;
    
    void main() {
        // position.y будет в диапазоне [0..~12] после смещения геометрии,
        // нормируем в [0..1], чтобы у основания стебель был стабилен.
        float h = clamp(position.y / 12.0, 0.0, 1.0);
        vHeight = h;
        vType = grassType;
        
        // Вариация цвета травы
        float colorVar = fract(sin(dot(offset.xz, vec2(12.9898, 78.233))) * 43758.5453);
        
        if (grassType < 0.5) {
            // Обычная трава (зеленая)
            vColor = mix(
                vec3(0.15, 0.45, 0.08),
                vec3(0.25, 0.55, 0.12),
                colorVar
            );
        } else {
            // Высокая трава (желтоватая)
            vColor = mix(
                vec3(0.35, 0.5, 0.1),
                vec3(0.45, 0.6, 0.15),
                colorVar
            );
        }
        
        vec3 pos = position * scale;
        
        // Ветер влияет только на верхнюю часть
        float windFactor = h * h; // квадратичный рост только к вершине стебля
        float windTime = time + offset.x * 0.5 + offset.z * 0.3 + phase;
        
        // Направленный ветер
        vec2 windOffset = windDirection.xz * sin(windTime) * windStrength * windFactor;
        pos.x += windOffset.x;
        pos.z += windOffset.y;
        
        // Дополнительное качание
        pos.x += cos(windTime * 1.3) * windStrength * 0.3 * windFactor;
        
        vec4 worldPosition = modelMatrix * vec4(pos + offset, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

export const grassFragmentShader = `
    varying vec3 vColor;
    varying float vHeight;
    varying float vType;
    
    void main() {
        // Градиент от темного у основания к светлому на верхушке
        vec3 baseColor = vColor * 0.5;
        vec3 tipColor = vColor * 1.2;
        vec3 color = mix(baseColor, tipColor, vHeight);
        
        // Немного ambient occlusion для реализма
        float ao = mix(0.7, 1.0, vHeight);
        color *= ao;
        
        // Небольшая прозрачность на краях для мягкости
        float alpha = mix(0.95, 1.0, vHeight);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ============= CLOUD SHADERS =============
export const cloudVertexShader = `
    uniform float time;
    uniform vec3 windDirection;
    uniform float windSpeed;
    
    attribute vec3 offset;
    attribute float scale;
    attribute float phase;
    
    varying vec3 vPosition;
    varying vec2 vUv;
    varying float vPhase;
    
    void main() {
        vUv = uv;
        vPhase = phase;
        
        vec3 pos = position * scale;
        
        // Облака двигаются с ветром
        vec3 windOffset = windDirection * time * windSpeed;
        
        // Зацикливание облаков (возвращаются обратно)
        float wrapDistance = 3000.0;
        windOffset.x = mod(windOffset.x + wrapDistance, wrapDistance * 2.0) - wrapDistance;
        windOffset.z = mod(windOffset.z + wrapDistance, wrapDistance * 2.0) - wrapDistance;
        
        // Небольшое вертикальное колебание
        float bobbing = sin(time * 0.5 + phase) * 20.0;
        
        vPosition = pos + offset + windOffset;
        vPosition.y += bobbing;
        
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vPosition, 1.0);
    }
`;

export const cloudFragmentShader = `
    uniform float time;
    uniform float density;
    uniform vec3 sunDirection;
    
    varying vec3 vPosition;
    varying vec2 vUv;
    varying float vPhase;
    
    // 3D шум для объемности облаков
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    
    float noise3D(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        
        return mix(
            mix(
                mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
                f.y
            ),
            mix(
                mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
                f.y
            ),
            f.z
        );
    }
    
    float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        
        for (int i = 0; i < 4; i++) {
            value += amplitude * noise3D(p * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
        }
        
        return value;
    }
    
    void main() {
        // Многослойный шум для объёмных облаков
        vec3 p = vPosition * 0.008;
        p.x += time * 0.02;
        
        float cloudNoise = fbm(p);
        
        // Добавляем детали
        float details = noise3D(p * 4.0 + time * 0.05) * 0.3;
        cloudNoise += details;
        
        // Форма облака с мягкими краями
        float edgeFalloff = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        edgeFalloff *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        
        cloudNoise *= edgeFalloff * density;
        
        // Освещение облака от солнца
        vec3 cloudNormal = normalize(vec3(
            noise3D(p + vec3(0.01, 0, 0)) - noise3D(p - vec3(0.01, 0, 0)),
            1.0,
            noise3D(p + vec3(0, 0, 0.01)) - noise3D(p - vec3(0, 0, 0.01))
        ));
        
        float sunDot = max(dot(cloudNormal, sunDirection), 0.0);
        vec3 litColor = mix(vec3(0.6, 0.65, 0.7), vec3(1.0, 1.0, 0.95), sunDot * 0.7 + 0.3);
        
        // Затемнение в толстых частях облака
        float thickness = cloudNoise * 1.5;
        litColor = mix(litColor, vec3(0.3, 0.3, 0.35), thickness * 0.4);
        
        float alpha = clamp(cloudNoise * 2.5, 0.0, 0.85);
        
        gl_FragColor = vec4(litColor, alpha);
    }
`;

// ============= ATMOSPHERE SHADER (небо с атмосферным рассеянием) =============
export const atmosphereVertexShader = `
    varying vec3 vWorldPosition;
    varying vec3 vViewDirection;
    
    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewDirection = normalize(worldPosition.xyz - cameraPosition);
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

export const atmosphereFragmentShader = `
    uniform vec3 sunDirection;
    uniform float sunIntensity;
    uniform vec3 skyColor;
    uniform vec3 horizonColor;
    
    varying vec3 vWorldPosition;
    varying vec3 vViewDirection;
    
    void main() {
        vec3 viewDir = normalize(vViewDirection);
        
        // Градиент неба от горизонта к зениту
        float heightFactor = max(viewDir.y, 0.0);
        vec3 color = mix(horizonColor, skyColor, pow(heightFactor, 0.6));
        
        // Солнечный диск и свечение
        float sunDot = max(dot(viewDir, sunDirection), 0.0);
        float sunGlow = pow(sunDot, 256.0) * sunIntensity; // яркий диск
        float sunHalo = pow(sunDot, 8.0) * 0.3; // ореол
        
        color += vec3(1.0, 0.95, 0.8) * (sunGlow + sunHalo);
        
        // Атмосферное рассеяние (упрощенный Rayleigh)
        float scatter = pow(1.0 - heightFactor, 3.0) * 0.3;
        color += vec3(0.4, 0.5, 0.7) * scatter;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;
