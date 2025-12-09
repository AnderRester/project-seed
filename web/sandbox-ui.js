// sandbox-ui.js - UI песочница для управления параметрами мира

export class SandboxUI {
    constructor(onRegenerate, onParamChange) {
        this.onRegenerate = onRegenerate;
        this.onParamChange = onParamChange;
        this.panel = null;
        this.isVisible = true;

        this.params = {
            // Terrain
            seaLevel: 0.11,
            continentalScale: 4000,
            mountainHeight: 4000,
            erosionIterations: 200,
            riverDensity: 0.7,

            // Climate
            temperature: 25,
            humidity: 0.5,
            precipitation: 1.0,
            stormFrequency: 0.3,

            // Visual
            cloudDensity: 0.5,
            grassDensity: 0.3,
            waterWaveHeight: 2.0,
            waterOpacity: 0.7,
            timeScale: 1.0,

            // Player
            moveSpeed: 20.0,
            sprintMultiplier: 2.0,
            jumpHeight: 5.0,
            maxHp: 100,
            hpRegen: 1.0,

            // Environment
            gravity: 9.8,
            windSpeed: 10.0,
            dayNightSpeed: 1.0,
            fogDensity: 0.3,

            // Catastrophes
            enableCatastrophes: false,
            earthquakeIntensity: 0.5,
            volcanicActivity: 0.3,

            // System
            worldSeed: 256454,
            mapResolution: 1024, // Увеличено для детализации
        };

        this.createUI();
        this.attachEvents();
    }

    createUI() {
        this.panel = document.createElement("div");
        this.panel.id = "sandboxPanel";
        this.panel.className = "sandbox-panel";

        this.panel.innerHTML = `
            <style>
                .sandbox-panel {
                    position: fixed;
                    top: 60px;
                    right: 20px;
                    width: 340px;
                    max-height: calc(100vh - 80px);
                    overflow-y: auto;
                    background: linear-gradient(135deg, rgba(20, 25, 35, 0.95), rgba(30, 35, 45, 0.95));
                    backdrop-filter: blur(10px);
                    padding: 20px;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                    color: #e0e0e0;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 13px;
                    z-index: 100;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .sandbox-panel::-webkit-scrollbar {
                    width: 8px;
                }
                
                .sandbox-panel::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 4px;
                }
                
                .sandbox-panel::-webkit-scrollbar-thumb {
                    background: rgba(100, 150, 200, 0.5);
                    border-radius: 4px;
                }
                
                .sandbox-panel::-webkit-scrollbar-thumb:hover {
                    background: rgba(100, 150, 200, 0.7);
                }
                
                .sandbox-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid rgba(100, 150, 200, 0.3);
                }
                
                .sandbox-header h2 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 600;
                    background: linear-gradient(135deg, #4CAF50, #2196F3);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                
                .toggle-btn {
                    background: rgba(255, 255, 255, 0.1);
                    border: none;
                    padding: 5px 10px;
                    border-radius: 4px;
                    color: #fff;
                    cursor: pointer;
                    font-size: 11px;
                }
                
                .toggle-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
                
                .action-bar {
                    margin-bottom: 15px;
                    padding: 12px;
                    background: rgba(76, 175, 80, 0.15);
                    border-radius: 8px;
                    border: 1px solid rgba(76, 175, 80, 0.3);
                }
                
                .btn-regenerate {
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #4CAF50, #45a049);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    font-size: 15px;
                    font-weight: 600;
                    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
                    transition: all 0.3s;
                }
                
                .btn-regenerate:hover {
                    background: linear-gradient(135deg, #45a049, #4CAF50);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(76, 175, 80, 0.6);
                }
                
                .btn-regenerate:active {
                    transform: translateY(0);
                }
                
                .param-group {
                    margin-bottom: 18px;
                    padding: 15px;
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                
                .param-group h3 {
                    margin: 0 0 12px 0;
                    font-size: 15px;
                    font-weight: 600;
                    color: #4CAF50;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .param-item {
                    margin-top: 12px;
                }
                
                .param-item label {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                    font-size: 12px;
                    color: #b0b0b0;
                }
                
                .param-value {
                    font-weight: 600;
                    color: #2196F3;
                    min-width: 60px;
                    text-align: right;
                }
                
                input[type="range"] {
                    width: 100%;
                    height: 6px;
                    -webkit-appearance: none;
                    appearance: none;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 3px;
                    outline: none;
                }
                
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    background: linear-gradient(135deg, #2196F3, #1976D2);
                    cursor: pointer;
                    border-radius: 50%;
                    box-shadow: 0 2px 6px rgba(33, 150, 243, 0.5);
                }
                
                input[type="range"]::-moz-range-thumb {
                    width: 16px;
                    height: 16px;
                    background: linear-gradient(135deg, #2196F3, #1976D2);
                    cursor: pointer;
                    border-radius: 50%;
                    border: none;
                    box-shadow: 0 2px 6px rgba(33, 150, 243, 0.5);
                }
                
                input[type="number"] {
                    width: 100%;
                    padding: 8px;
                    border-radius: 4px;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    background: rgba(0, 0, 0, 0.3);
                    color: #fff;
                    font-size: 13px;
                }
                
                input[type="checkbox"] {
                    margin-right: 8px;
                    cursor: pointer;
                }
                
                .catastrophe-btns {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    margin-top: 10px;
                }
                
                .btn-catastrophe {
                    padding: 10px;
                    border: none;
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                
                .btn-earthquake {
                    background: linear-gradient(135deg, #f44336, #d32f2f);
                }
                
                .btn-volcano {
                    background: linear-gradient(135deg, #ff9800, #f57c00);
                }
                
                .btn-meteor {
                    background: linear-gradient(135deg, #9c27b0, #7b1fa2);
                }
                
                .btn-random-seed {
                    background: linear-gradient(135deg, #2196F3, #1976D2);
                }
                
                .btn-catastrophe:hover, .btn-random-seed:hover {
                    transform: scale(1.05);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                }
                
                .info-text {
                    font-size: 11px;
                    color: #808080;
                    margin-top: 8px;
                    font-style: italic;
                }
                
                .hotkey-hint {
                    position: fixed;
                    bottom: 10px;
                    right: 20px;
                    padding: 8px 12px;
                    background: rgba(0, 0, 0, 0.7);
                    border-radius: 6px;
                    color: #b0b0b0;
                    font-size: 11px;
                    z-index: 99;
                }
            </style>
            
            <div class="sandbox-header">
                <h2>🌍 World Sandbox</h2>
                <button class="toggle-btn" id="minimizeBtn">Minimize</button>
            </div>
            
            <div class="action-bar">
                <button class="btn-regenerate" id="regenerateBtn">
                    ⚡ Regenerate World
                </button>
            </div>
            
            <div class="param-group">
                <h3>🏔️ Terrain Parameters</h3>
                
                <div class="param-item">
                    <label>
                        <span>Sea Level</span>
                        <span class="param-value" id="seaLevelVal">${this.params.seaLevel.toFixed(2)}</span>
                    </label>
                    <input type="range" id="seaLevel" min="0" max="0.5" step="0.01" value="${this.params.seaLevel}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Continental Scale (km)</span>
                        <span class="param-value" id="continentalScaleVal">${this.params.continentalScale}</span>
                    </label>
                    <input type="range" id="continentalScale" min="1000" max="10000" step="100" value="${
                        this.params.continentalScale
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Mountain Height (m)</span>
                        <span class="param-value" id="mountainHeightVal">${this.params.mountainHeight}</span>
                    </label>
                    <input type="range" id="mountainHeight" min="1000" max="8000" step="100" value="${
                        this.params.mountainHeight
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>River Density</span>
                        <span class="param-value" id="riverDensityVal">${this.params.riverDensity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="riverDensity" min="0" max="1" step="0.05" value="${
                        this.params.riverDensity
                    }">
                </div>
            </div>
            
            <div class="param-group">
                <h3>🌡️ Climate Parameters</h3>
                
                <div class="param-item">
                    <label>
                        <span>Base Temperature (°C)</span>
                        <span class="param-value" id="temperatureVal">${this.params.temperature}</span>
                    </label>
                    <input type="range" id="temperature" min="-10" max="40" step="1" value="${this.params.temperature}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Humidity</span>
                        <span class="param-value" id="humidityVal">${this.params.humidity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="humidity" min="0" max="1" step="0.05" value="${this.params.humidity}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Storm Frequency</span>
                        <span class="param-value" id="stormFrequencyVal">${this.params.stormFrequency.toFixed(2)}</span>
                    </label>
                    <input type="range" id="stormFrequency" min="0" max="1" step="0.05" value="${
                        this.params.stormFrequency
                    }">
                </div>
            </div>
            
            <div class="param-group">
                <h3>🎨 Visual Parameters</h3>
                
                <div class="param-item">
                    <label>
                        <span>Cloud Density</span>
                        <span class="param-value" id="cloudDensityVal">${this.params.cloudDensity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="cloudDensity" min="0" max="1" step="0.05" value="${
                        this.params.cloudDensity
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Grass Density</span>
                        <span class="param-value" id="grassDensityVal">${this.params.grassDensity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="grassDensity" min="0" max="1" step="0.05" value="${
                        this.params.grassDensity
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Water Wave Height</span>
                        <span class="param-value" id="waterWaveHeightVal">${this.params.waterWaveHeight.toFixed(
                            1
                        )}</span>
                    </label>
                    <input type="range" id="waterWaveHeight" min="0" max="5" step="0.1" value="${
                        this.params.waterWaveHeight
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Water Opacity</span>
                        <span class="param-value" id="waterOpacityVal">${this.params.waterOpacity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="waterOpacity" min="0.3" max="1" step="0.05" value="${
                        this.params.waterOpacity
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Time Scale</span>
                        <span class="param-value" id="timeScaleVal">${this.params.timeScale.toFixed(1)}</span>
                    </label>
                    <input type="range" id="timeScale" min="0.1" max="5" step="0.1" value="${this.params.timeScale}">
                </div>
            </div>
            
            <div class="param-group">
                <h3>🏃 Player Parameters</h3>
                
                <div class="param-item">
                    <label>
                        <span>Movement Speed</span>
                        <span class="param-value" id="moveSpeedVal">${this.params.moveSpeed.toFixed(1)}</span>
                    </label>
                    <input type="range" id="moveSpeed" min="5" max="100" step="1" value="${this.params.moveSpeed}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Sprint Multiplier</span>
                        <span class="param-value" id="sprintMultiplierVal">${this.params.sprintMultiplier.toFixed(
                            1
                        )}x</span>
                    </label>
                    <input type="range" id="sprintMultiplier" min="1.5" max="4" step="0.1" value="${
                        this.params.sprintMultiplier
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Jump Height (m)</span>
                        <span class="param-value" id="jumpHeightVal">${this.params.jumpHeight.toFixed(1)}</span>
                    </label>
                    <input type="range" id="jumpHeight" min="1" max="20" step="0.5" value="${this.params.jumpHeight}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Max HP</span>
                        <span class="param-value" id="maxHpVal">${this.params.maxHp}</span>
                    </label>
                    <input type="range" id="maxHp" min="50" max="500" step="10" value="${this.params.maxHp}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>HP Regen/sec</span>
                        <span class="param-value" id="hpRegenVal">${this.params.hpRegen.toFixed(1)}</span>
                    </label>
                    <input type="range" id="hpRegen" min="0" max="10" step="0.1" value="${this.params.hpRegen}">
                </div>
            </div>
            
            <div class="param-group">
                <h3>🌍 Environment</h3>
                
                <div class="param-item">
                    <label>
                        <span>Gravity (m/s²)</span>
                        <span class="param-value" id="gravityVal">${this.params.gravity.toFixed(1)}</span>
                    </label>
                    <input type="range" id="gravity" min="1" max="30" step="0.5" value="${this.params.gravity}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Wind Speed</span>
                        <span class="param-value" id="windSpeedVal">${this.params.windSpeed.toFixed(1)}</span>
                    </label>
                    <input type="range" id="windSpeed" min="0" max="50" step="1" value="${this.params.windSpeed}">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Day/Night Speed</span>
                        <span class="param-value" id="dayNightSpeedVal">${this.params.dayNightSpeed.toFixed(1)}x</span>
                    </label>
                    <input type="range" id="dayNightSpeed" min="0.1" max="10" step="0.1" value="${
                        this.params.dayNightSpeed
                    }">
                </div>
                
                <div class="param-item">
                    <label>
                        <span>Fog Density</span>
                        <span class="param-value" id="fogDensityVal">${this.params.fogDensity.toFixed(2)}</span>
                    </label>
                    <input type="range" id="fogDensity" min="0" max="1" step="0.01" value="${this.params.fogDensity}">
                </div>
            </div>
            
            <div class="param-group">
                <h3>💥 Catastrophes</h3>
                
                <div class="param-item">
                    <label>
                        <input type="checkbox" id="enableCatastrophes" ${
                            this.params.enableCatastrophes ? "checked" : ""
                        }>
                        <span>Enable Catastrophes</span>
                    </label>
                </div>
                
                <div class="catastrophe-btns">
                    <button class="btn-catastrophe btn-earthquake" id="triggerEarthquake">
                        💥 Earthquake
                    </button>
                    <button class="btn-catastrophe btn-volcano" id="triggerVolcano">
                        🌋 Volcano
                    </button>
                    <button class="btn-catastrophe btn-meteor" id="triggerMeteor">
                        ☄️ Meteor
                    </button>
                </div>
                
                <p class="info-text">Trigger catastrophes to dynamically alter the terrain</p>
            </div>
            
            <div class="param-group">
                <h3>🎲 Random Seed</h3>
                
                <div class="param-item">
                    <label>
                        <span>World Seed</span>
                        <span class="param-value" id="worldSeedVal">${this.params.worldSeed}</span>
                    </label>
                    <input type="number" id="worldSeed" value="${this.params.worldSeed}">
                </div>
                
                <button class="btn-catastrophe btn-random-seed" id="randomSeedBtn" style="width: 100%; margin-top: 8px;">
                    🎲 Generate Random Seed
                </button>
                
                <p class="info-text">Same seed generates identical worlds</p>
            </div>
            
            <div class="hotkey-hint">
                Press <strong>H</strong> to toggle this panel
            </div>
        `;

        document.body.appendChild(this.panel);
    }

    attachEvents() {
        // Minimize button
        document.getElementById("minimizeBtn").addEventListener("click", () => {
            this.toggle();
        });

        // Regenerate button
        document.getElementById("regenerateBtn").addEventListener("click", () => {
            this.onRegenerate();
        });

        // Terrain parameters
        this.attachSlider("seaLevel", 2);
        this.attachSlider("continentalScale", 0);
        this.attachSlider("mountainHeight", 0);
        this.attachSlider("riverDensity", 2);

        // Climate parameters
        this.attachSlider("temperature", 0);
        this.attachSlider("humidity", 2);
        this.attachSlider("stormFrequency", 2);

        // Visual parameters (immediate effect)
        this.attachSlider("cloudDensity", 2, true);
        this.attachSlider("grassDensity", 2, true);
        this.attachSlider("waterWaveHeight", 1, true);
        this.attachSlider("waterOpacity", 2, true);
        this.attachSlider("timeScale", 1, true);

        // Player parameters (immediate effect)
        this.attachSlider("moveSpeed", 1, true);
        this.attachSlider("sprintMultiplier", 1, true);
        this.attachSlider("jumpHeight", 1, true);
        this.attachSlider("maxHp", 0, true);
        this.attachSlider("hpRegen", 1, true);

        // Environment parameters (immediate effect)
        this.attachSlider("gravity", 1, true);
        this.attachSlider("windSpeed", 1, true);
        this.attachSlider("dayNightSpeed", 1, true);
        this.attachSlider("fogDensity", 2, true);

        // Catastrophes
        document.getElementById("enableCatastrophes").addEventListener("change", (e) => {
            this.params.enableCatastrophes = e.target.checked;
        });

        document.getElementById("triggerEarthquake").addEventListener("click", () => {
            this.onParamChange("triggerCatastrophe", "earthquake");
        });

        document.getElementById("triggerVolcano").addEventListener("click", () => {
            this.onParamChange("triggerCatastrophe", "volcano");
        });

        document.getElementById("triggerMeteor").addEventListener("click", () => {
            this.onParamChange("triggerCatastrophe", "meteor");
        });

        // Seed
        document.getElementById("worldSeed").addEventListener("change", (e) => {
            this.params.worldSeed = parseInt(e.target.value) || 0;
            document.getElementById("worldSeedVal").textContent = this.params.worldSeed;
        });

        document.getElementById("randomSeedBtn").addEventListener("click", () => {
            this.params.worldSeed = Math.floor(Math.random() * 999999);
            document.getElementById("worldSeed").value = this.params.worldSeed;
            document.getElementById("worldSeedVal").textContent = this.params.worldSeed;
        });

        // Keyboard shortcut
        window.addEventListener("keydown", (e) => {
            if (e.key === "h" || e.key === "H") {
                this.toggle();
            }
        });
    }

    attachSlider(paramName, decimals, immediate = false) {
        const input = document.getElementById(paramName);
        const display = document.getElementById(paramName + "Val");

        input.addEventListener("input", (e) => {
            const value = parseFloat(e.target.value);
            this.params[paramName] = value;

            if (decimals === 0) {
                display.textContent = Math.round(value);
            } else {
                display.textContent = value.toFixed(decimals);
            }

            if (immediate) {
                this.onParamChange(paramName, value);
            }
        });
    }

    toggle() {
        this.isVisible = !this.isVisible;
        this.panel.style.display = this.isVisible ? "block" : "none";

        const btn = document.getElementById("minimizeBtn");
        btn.textContent = this.isVisible ? "Minimize" : "Show Panel";
    }

    getParams() {
        return this.params;
    }

    updateParam(paramName, value) {
        if (this.params.hasOwnProperty(paramName)) {
            this.params[paramName] = value;

            const input = document.getElementById(paramName);
            if (input) {
                input.value = value;
            }

            const display = document.getElementById(paramName + "Val");
            if (display) {
                const decimals = typeof value === "number" && value % 1 !== 0 ? 2 : 0;
                display.textContent = decimals > 0 ? value.toFixed(decimals) : value;
            }
        }
    }
}
