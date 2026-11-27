'use strict';

/* ------------------------------------------------------------------
 * Configuration: defaults, themes, palettes, persistence, color utils.
 * Physics never reads theme data — themes are purely visual.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'ball-escape-settings-v2';

const DEFAULTS = {
  scene: {
    circleSize: 280,        // reference radius of the outermost ring, px
    wallThickness: 14,      // ring wall thickness, px
    ringCount: 1,           // number of concentric rings (1..5)
    ringSpacing: 84,        // distance between ring centerlines, px
    holeSize: 42,           // hole angular width, degrees
    holePosition: 90,       // hole center angle, degrees (90 = bottom)
    holeOffset: 0,          // extra angle offset per inner ring, degrees
    rotationEnabled: false,
    rotationDirection: 1,   // 1 = clockwise, -1 = counter-clockwise
    rotationSpeed: 28       // degrees per second
  },
  balls: {
    spawnMode: 'single',    // 'single' | 'multiple' | 'sequential'
    count: 5,               // balls in multiple mode / total in sequential (2..80)
    infiniteSpawn: false,   // sequential mode: spawn forever
    size: 14,               // ball radius, px
    mass: 1,                // ball mass (affects collisions)
    initialSpeed: 460,      // spawn speed, px/s
    restitution: 0.92,      // elasticity 0..1
    color: '#ff4d6d',
    glow: 0.55,             // per-ball glow 0..1
    trailLength: 16,        // trail length unit (~1/60s of sim time per unit)
    spawnInterval: 1.8      // seconds between sequential spawns
  },
  physics: {
    mode: 'arcade',         // 'realistic' | 'arcade'
    gravity: 120,           // px/s^2
    gravityDirection: 90,   // degrees (90 = down)
    drag: 0.005,            // air resistance coefficient
    friction: 0.0,          // tangential velocity loss on bounce
    energyRetention: 0.85   // 0..1, pulls speed toward initialSpeed
  },
  behavior: {
    endMode: 'auto',        // 'infinite' | 'auto' | 'stop'
    speed: 1                // playback speed multiplier
  },
  appearance: {
    theme: 'minimal',       // 'minimal' | 'neon' | 'clean' — Minimal Dark is default
    palette: 'sunset',
    glowIntensity: 0.65,    // global glow multiplier
    trailIntensity: 1.0,    // global trail multiplier
    effectsEnabled: true
  }
};

/* Visual themes. Colors are hex; renderer smoothly interpolates between them. */
const THEMES = {
  minimal: {
    bg: '#090a0e',
    ambient: '#1d2130',
    ambientAlpha: 0.52,
    ring: '#ececf2',
    ringRim: '#ffffff',
    ringInner: '#9ea3b2',
    particle: '#e2e4ee',
    ringGlow: 3,
    ballGlow: 7,
    trail: 0.42,
    vignette: 0.28,
    shadowAlpha: 0.0
  },
  neon: {
    bg: '#03040b',
    ambient: '#0a2b4c',
    ambientAlpha: 0.72,
    ring: '#2ce6ff',
    ringRim: '#e6fdff',
    ringInner: '#0284c7',
    particle: '#7ef9ff',
    ringGlow: 20,
    ballGlow: 26,
    trail: 0.88,
    vignette: 0.52,
    shadowAlpha: 0.0
  },
  clean: {
    bg: '#f3f2ed',
    ambient: '#ffffff',
    ambientAlpha: 0.78,
    ring: '#2e3138',
    ringRim: '#4d525e',
    ringInner: '#17191d',
    particle: '#5b5f6b',
    ringGlow: 0,
    ballGlow: 0,
    trail: 0.30,
    vignette: 0.08,
    shadowAlpha: 0.16
  }
};

const PALETTES = [
  { name: 'Коралл',  value: '#ff4d6d' },
  { name: 'Океан',   value: '#38bdf8' },
  { name: 'Лайм',    value: '#a3e635' },
  { name: 'Фиолет',  value: '#a78bfa' },
  { name: 'Янтарь',  value: '#fbbf24' },
  { name: 'Моно',    value: '#e5e5e5' }
];

/* Physics presets applied when switching realistic/arcade mode. */
const PHYSICS_PRESETS = {
  realistic: { gravity: 240, gravityDirection: 90, drag: 0.015, friction: 0.025, energyRetention: 0 },
  arcade:    { gravity: 120, gravityDirection: 90, drag: 0.005, friction: 0.0,   energyRetention: 0.85 }
};

/* ---------------- persistence & sanitization ---------------- */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(target)) {
    if (!(k in source)) continue;
    const sv = source[k];
    const tv = target[k];
    if (tv && typeof tv === 'object' && !Array.isArray(tv) &&
        sv && typeof sv === 'object' && !Array.isArray(sv)) {
      deepMerge(tv, sv);
    } else if (typeof sv === typeof tv) {
      target[k] = sv;
    }
  }
  return target;
}

function sanitizeConfig(cfg) {
  const s = cfg.scene;
  s.circleSize = clampNum(s.circleSize, 140, 460, DEFAULTS.scene.circleSize);
  s.wallThickness = clampNum(s.wallThickness, 6, 30, DEFAULTS.scene.wallThickness);
  s.ringCount = Math.round(clampNum(s.ringCount, 1, 5, DEFAULTS.scene.ringCount));
  s.ringSpacing = clampNum(s.ringSpacing, 50, 170, DEFAULTS.scene.ringSpacing);
  s.holeSize = clampNum(s.holeSize, 8, 70, DEFAULTS.scene.holeSize);
  s.holePosition = clampNum(s.holePosition, 0, 359, DEFAULTS.scene.holePosition);
  s.holeOffset = clampNum(s.holeOffset, 0, 180, DEFAULTS.scene.holeOffset);
  s.rotationEnabled = Boolean(s.rotationEnabled);
  s.rotationDirection = s.rotationDirection === -1 ? -1 : 1;
  s.rotationSpeed = clampNum(s.rotationSpeed, 5, 180, DEFAULTS.scene.rotationSpeed);

  const b = cfg.balls;
  if (!['single', 'multiple', 'sequential'].includes(b.spawnMode)) {
    b.spawnMode = DEFAULTS.balls.spawnMode;
  }
  b.count = Math.round(clampNum(b.count, 2, 80, DEFAULTS.balls.count));
  b.infiniteSpawn = Boolean(b.infiniteSpawn);
  b.size = clampNum(b.size, 6, 30, DEFAULTS.balls.size);
  b.mass = clampNum(b.mass, 0.2, 5, DEFAULTS.balls.mass);
  b.initialSpeed = clampNum(b.initialSpeed, 50, 800, DEFAULTS.balls.initialSpeed);
  b.restitution = clampNum(b.restitution, 0, 1, DEFAULTS.balls.restitution);
  if (typeof b.color !== 'string' || !/^#[0-9a-fA-F]{3,6}$/.test(b.color)) {
    b.color = DEFAULTS.balls.color;
  }
  b.glow = clampNum(b.glow, 0, 1, DEFAULTS.balls.glow);
  b.trailLength = Math.round(clampNum(b.trailLength, 0, 40, DEFAULTS.balls.trailLength));
  b.spawnInterval = clampNum(b.spawnInterval, 0.3, 10, DEFAULTS.balls.spawnInterval);

  const p = cfg.physics;
  if (!['realistic', 'arcade'].includes(p.mode)) p.mode = DEFAULTS.physics.mode;
  p.gravity = clampNum(p.gravity, 0, 800, DEFAULTS.physics.gravity);
  p.gravityDirection = clampNum(p.gravityDirection, 0, 359, DEFAULTS.physics.gravityDirection);
  p.drag = clampNum(p.drag, 0, 0.5, DEFAULTS.physics.drag);
  p.friction = clampNum(p.friction, 0, 0.5, DEFAULTS.physics.friction);
  p.energyRetention = clampNum(p.energyRetention, 0, 1, DEFAULTS.physics.energyRetention);

  const beh = cfg.behavior;
  if (!['infinite', 'auto', 'stop'].includes(beh.endMode)) {
    beh.endMode = DEFAULTS.behavior.endMode;
  }
  if (![0.25, 0.5, 1, 2, 4].includes(Number(beh.speed))) {
    beh.speed = DEFAULTS.behavior.speed;
  } else {
    beh.speed = Number(beh.speed);
  }

  const a = cfg.appearance;
  if (!THEMES[a.theme]) a.theme = DEFAULTS.appearance.theme;
  a.glowIntensity = clampNum(a.glowIntensity, 0, 1.5, DEFAULTS.appearance.glowIntensity);
  a.trailIntensity = clampNum(a.trailIntensity, 0, 2, DEFAULTS.appearance.trailIntensity);
  a.effectsEnabled = Boolean(a.effectsEnabled);

  return cfg;
}

function loadConfig(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    if (!store) return clone(DEFAULTS);
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    return sanitizeConfig(deepMerge(clone(DEFAULTS), JSON.parse(raw)));
  } catch (e) {
    return clone(DEFAULTS);
  }
}

function saveConfig(cfg, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    if (store) store.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) { /* storage unavailable */ }
}

function resetConfig(cfg) {
  const d = clone(DEFAULTS);
  for (const k of Object.keys(d)) cfg[k] = d[k];
  return cfg;
}

function applyPhysicsPreset(cfg, mode) {
  if (mode && PHYSICS_PRESETS[mode]) {
    cfg.physics.mode = mode;
  }
  const preset = PHYSICS_PRESETS[cfg.physics.mode];
  if (preset) Object.assign(cfg.physics, preset);
  return cfg;
}

/* ---------------- color utils ---------------- */

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbCss(c) {
  return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')';
}

function rgbaCss(c, a) {
  const alpha = Math.max(0, Math.min(1, a));
  return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + alpha.toFixed(3) + ')';
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function shiftHue(rgb, deg) {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return hslToRgb(hsl.h + deg, hsl.s, hsl.l);
}

function shade(rgb, dl) {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return hslToRgb(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + dl)));
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(a, b, t) {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY, DEFAULTS, THEMES, PALETTES, PHYSICS_PRESETS,
    clone, deepMerge, sanitizeConfig, loadConfig, saveConfig, resetConfig, applyPhysicsPreset,
    hexToRgb, rgbCss, rgbaCss, rgbToHsl, hslToRgb, shiftHue, shade, lerp, lerpRgb
  };
}
