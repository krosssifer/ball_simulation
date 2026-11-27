'use strict';

/* ------------------------------------------------------------------
 * Main application controller:
 *   - Fixed-timestep physics accumulator + render interpolation
 *   - Resize & DPR handling with adaptive circle sizing
 *   - Synchronized physics-preset application and persistence
 *   - Non-intrusive geometry compatibility warning
 *   - End-of-run behaviors (infinite / auto / stop) after outermost exit
 * ------------------------------------------------------------------ */

const cfg = loadConfig();
const canvas = document.getElementById('scene');
const engine = new Engine(cfg);
const renderer = new Renderer(canvas);
const effects = new Effects();
const compatBanner = document.getElementById('compatWarning');

let paused = false;
let clearedScene = false;
let accumulator = 0;
let restartDelay = 0;
let stopDelay = 0;
let lastTime = performance.now() / 1000;

function setPaused(p) {
  paused = Boolean(p);
  if (ui) ui.setPaused(paused);
}

function updateCompatibilityUI() {
  const msg = engine.compatibility && engine.compatibility.holeBlocked
    ? engine.compatibility.message
    : '';
  if (compatBanner) {
    if (msg) {
      compatBanner.textContent = msg;
      compatBanner.hidden = false;
    } else {
      compatBanner.textContent = '';
      compatBanner.hidden = true;
    }
  }
  if (ui) ui.setWarning(msg);
}

function applyChange(path, _val, meta) {
  const committed = !meta || meta.committed !== false;

  // Stage 3: strict preset order -> 1) apply preset, 2) refresh UI, 3) save config
  if (path === 'physics.mode') {
    applyPhysicsPreset(cfg, cfg.physics.mode);
    ui.refresh();
    saveConfig(cfg);
    return;
  }

  if (path.startsWith('scene.')) {
    if (path === 'scene.reverseRotationOnVanish' && cfg.scene.reverseRotationOnVanish && !cfg.scene.rotationEnabled) {
      cfg.scene.rotationEnabled = true;
      ui.refresh();
    } else if (path === 'scene.rotationDirection') {
      engine.rotationDirFactor = 1;
    }
    engine.rebuildRings();
    updateCompatibilityUI();
  } else if (path === 'balls.size' || path === 'balls.mass') {
    engine.applyBallParams();
    updateCompatibilityUI();
  } else if (path === 'balls.spawnMode') {
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    effects.clear();
    engine.restart();
    if (paused && cfg.behavior.endMode === 'stop') setPaused(false);
  } else if (path === 'balls.count') {
    // Never cause repeated full restarts while dragging the count slider
    clearedScene = false;
    if (cfg.balls.spawnMode === 'multiple') {
      if (engine.activeBallCount() === 0 && committed) {
        restartDelay = 0;
        stopDelay = 0;
        engine.restart();
        if (paused && cfg.behavior.endMode === 'stop') setPaused(false);
      } else if (engine.activeBallCount() > 0) {
        engine.adjustBallCount(cfg.balls.count);
      }
    } else if (cfg.balls.spawnMode === 'sequential') {
      if (paused && cfg.behavior.endMode === 'stop' && engine.hasPendingSpawns()) {
        stopDelay = 0;
        setPaused(false);
      }
    }
  } else if (path === 'balls.infiniteSpawn') {
    clearedScene = false;
    if (paused && cfg.behavior.endMode === 'stop' && engine.hasPendingSpawns()) {
      stopDelay = 0;
      setPaused(false);
    }
  } else if (path === 'appearance.theme') {
    // Theme switch never resets physics
    document.body.dataset.theme = cfg.appearance.theme;
    renderer.setTheme(cfg.appearance.theme, false);
  } else if (path === 'appearance.effectsEnabled' && !cfg.appearance.effectsEnabled) {
    effects.clear();
  }

  saveConfig(cfg);
}

const ui = new PanelUI(document.getElementById('panelBody'), cfg, applyChange, {
  pause: () => setPaused(!paused),
  restart: () => {
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    effects.clear();
    engine.restart();
    if (paused) setPaused(false);
    updateCompatibilityUI();
  },
  addBall: () => {
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    engine.spawnBall();
    if (paused && cfg.behavior.endMode === 'stop') setPaused(false);
  },
  clear: () => {
    clearedScene = true;
    restartDelay = 0;
    stopDelay = 0;
    engine.balls = [];
    effects.clear();
  },
  reset: () => {
    resetConfig(cfg);
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    document.body.dataset.theme = cfg.appearance.theme;
    renderer.setTheme(cfg.appearance.theme, true);
    effects.clear();
    if (paused) setPaused(false);
    engine.restart();
    ui.refresh();
    updateCompatibilityUI();
    saveConfig(cfg);
  }
});

/* ---------------- panel toggle (never resets physics) ---------------- */

const toggleBtn = document.getElementById('panelToggle');
const closeBtn = document.getElementById('panelClose');
const panel = document.getElementById('panel');

function setPanel(open) {
  const isOpen = Boolean(open);
  document.body.classList.toggle('panel-open', isOpen);
  panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  toggleBtn.setAttribute('aria-label', isOpen ? 'Закрыть настройки' : 'Открыть настройки');
}

toggleBtn.addEventListener('click', () => {
  setPanel(!document.body.classList.contains('panel-open'));
});
if (closeBtn) {
  closeBtn.addEventListener('click', () => setPanel(false));
}

/* ---------------- resize ---------------- */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(w, h, dpr);
  engine.setViewport(w, h);
  updateCompatibilityUI();
}
window.addEventListener('resize', resize);

/* ---------------- keyboard ---------------- */

window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.code === 'KeyR') {
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    effects.clear();
    engine.restart();
    if (paused) setPaused(false);
  } else if (e.code === 'KeyB') {
    clearedScene = false;
    restartDelay = 0;
    stopDelay = 0;
    engine.spawnBall();
    if (paused && cfg.behavior.endMode === 'stop') setPaused(false);
  } else if (e.code === 'Escape' && document.body.classList.contains('panel-open')) {
    setPanel(false);
  }
});

/* ---------------- events -> effects ---------------- */

function handleEvents() {
  const enabled = cfg.appearance.effectsEnabled;
  if (!enabled) {
    engine.events.length = 0;
    return;
  }

  const effQuality = renderer.effectiveQuality(engine.balls.length);
  const particleCss = rgbCss(renderer.cur.particle);
  const ringCss = rgbCss(renderer.cur.ring);
  const rimCss = rgbCss(renderer.cur.ringRim);
  const baseBallRgb = hexToRgb(cfg.balls.color);

  for (let i = 0; i < engine.events.length; i++) {
    const ev = engine.events[i];
    if (ev.type === 'bounce') {
      effects.bounce(ev.x, ev.y, ev.strength, particleCss, effQuality);
    } else if (ev.type === 'hole') {
      effects.hole(ev.x, ev.y, ringCss, ev.isOutermost, effQuality);
    } else if (ev.type === 'ringVanish') {
      effects.ringVanish(engine.cx, engine.cy, ev, ringCss, rimCss, effQuality);
    } else if (ev.type === 'escape') {
      const ballRgb = ev.hueShift ? shiftHue(baseBallRgb, ev.hueShift) : baseBallRgb;
      effects.escape(ev.x, ev.y, ev.nx, ev.ny, rgbCss(ballRgb), ringCss, effQuality);
    }
  }
  engine.events.length = 0;
}

/* ---------------- end-of-run behavior (after balls leave screen) ---------------- */

function checkEndBehavior(frameDt, simDt) {
  if (clearedScene) return;

  const active = engine.activeBallCount();
  const pending = engine.hasPendingSpawns();

  if (active === 0 && !pending) {
    if (cfg.behavior.endMode === 'stop') {
      stopDelay += simDt;
      if (engine.balls.length === 0 || stopDelay >= 0.45) {
        stopDelay = 0;
        if (!paused) setPaused(true);
      }
    } else if (cfg.behavior.endMode === 'auto') {
      restartDelay += frameDt;
      if (restartDelay >= 0.55 && engine.balls.length === 0) {
        restartDelay = 0;
        engine.restart();
      } else if (restartDelay >= 1.1) {
        restartDelay = 0;
        engine.restart();
      }
    }
  } else {
    restartDelay = 0;
    stopDelay = 0;
  }
}

/* ---------------- main loop ---------------- */

function frame(nowMs) {
  const now = nowMs / 1000;
  const frameDt = Math.min(0.05, Math.max(0, now - lastTime));
  lastTime = now;

  if (!paused) {
    const simDt = frameDt * cfg.behavior.speed;
    accumulator += simDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 260) {
      engine.step(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps >= 260) accumulator = 0; // Spiral-of-death guard
    const alpha = Math.min(1, accumulator / FIXED_DT);

    handleEvents();
    effects.update(simDt);
    checkEndBehavior(frameDt, simDt);
    renderer.draw(engine, alpha, frameDt, false, effects);
  } else {
    renderer.draw(engine, 1, frameDt, true, effects);
  }

  requestAnimationFrame(frame);
}

/* ---------------- init ---------------- */

document.body.dataset.theme = cfg.appearance.theme;
renderer.setTheme(cfg.appearance.theme, true);
resize();
engine.restart();
ui.refresh();
updateCompatibilityUI();
requestAnimationFrame(frame);
