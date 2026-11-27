'use strict';

/* ------------------------------------------------------------------
 * Configuration: defaults, themes, palettes, persistence, color utils.
 * Physics never reads theme data — themes are purely visual.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'ball-escape-settings-v1';

const DEFAULTS = {
  scene: {
    circleSize: 280,        // radius of the outermost ring, px
    wallThickness: 14,      // ring wall thickness, px
    ringCount: 1,           // number of concentric rings (1..5)
    ringSpacing: 90,        // distance between ring centerlines, px
    holeSize: 42,           // hole angular width, degrees
    holePosition: 90,       // hole center angle, degrees (90 = bottom)
    holeOffset: 0,          // extra angle offset per ring, degrees
    rotationEnabled: false,
    rotationDirection: 1,   // 1 = clockwise, -1 = counter-clockwise
    rotationSpeed: 25       // degrees per second
  },
  balls: {
    spawnMode: 'single',    // 'single' | 'multiple' | 'sequential'
    count: 3,               // balls in multiple mode / total in sequential
    infiniteSpawn: false,   // sequential mode: spawn forever
    size: 14,               // ball radius, px
    mass: 1,                // ball mass (affects collisions)
    initialSpeed: 450,      // spawn speed, px/s
    restitution: 0.92,      // elasticity 0..1
    color: '#ff4d6d',
    glow: 0.5,              // per-ball glow 0..1
    trailLength: 14,        // trail points
    spawnInterval: 2.0      // seconds between sequential spawns
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
    theme: 'neon',          // 'minimal' | 'neon' | 'clean'
    palette: 'sunset',
    glowIntensity: 0.7,     // global glow multiplier
    trailIntensity: 1.0,    // global trail multiplier
    effectsEnabled: true
  }
};

/* Visual themes. Colors are hex; renderer lerps between them. */
const THEMES = {
  minimal: {
    bg: '#0a0a0c', ring: '#e9e9ec', particle: '#cfcfd4',
    ringGlow: 0, ballGlow: 5, trail: 0.35, vignette: 0.0
  },
  neon: {
    bg: '#030309', ring: '#3ee6ff', particle: '#7df9ff',
    ringGlow: 16, ballGlow: 26, trail: 0.85, vignette: 0.4
  },
  clean: {
    bg: '#f3f2ee', ring: '#26262a', particle: '#8a8a90',
    ringGlow: 0, ballGlow: 3, trail: 0.22, vignette: 0.0
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
  realistic: { gravity: 260, gravityDirection: 90, drag: 0.06, friction: 0.08, energyRetention: 0 },
  arcade:    { gravity: 120, gravityDirection: 90, drag: 0.005, friction: 0.0, energyRetention: 0.85 }
};

/* ---------------- persistence ---------------- */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
        target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    return deepMerge(clone(DEFAULTS), JSON.parse(raw));
  } catch (e) {
    return clone(DEFAULTS);
  }
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) { /* storage unavailable */ }
}

function resetConfig(cfg) {
  const d = clone(DEFAULTS);
  for (const k of Object.keys(d)) cfg[k] = d[k];
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
