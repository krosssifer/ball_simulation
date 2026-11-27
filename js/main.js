'use strict';

/* ------------------------------------------------------------------
 * Main loop: fixed-timestep physics with render interpolation,
 * resize/DPR handling, end-of-run behavior, keyboard shortcuts,
 * panel toggle and live application of settings changes.
 * ------------------------------------------------------------------ */

const cfg = loadConfig();
const canvas = document.getElementById('scene');
const engine = new Engine(cfg);
const renderer = new Renderer(canvas);
const effects = new Effects();

let paused = false;
let accumulator = 0;
let restartDelay = 0;
let lastTime = performance.now() / 1000;

function setPaused(p) {
  paused = p;
  ui.setPaused(paused);
}

function applyChange(path) {
  saveConfig(cfg);
  if (path === 'physics.mode') {
    const preset = PHYSICS_PRESETS[cfg.physics.mode];
    if (preset) Object.assign(cfg.physics, preset);
    ui.refresh();
  }
  if (path.startsWith('scene.')) engine.rebuildRings();
  if (path === 'balls.size' || path === 'balls.mass') engine.applyBallParams();
  if (path === 'balls.spawnMode' || path === 'balls.count' ||
      path === 'balls.infiniteSpawn') {
    engine.restart();
  }
  if (path === 'appearance.theme') {
    document.body.dataset.theme = cfg.appearance.theme;
    renderer.setTheme(cfg.appearance.theme);
  }
}

const ui = new PanelUI(document.getElementById('panelBody'), cfg, applyChange, {
  pause: () => setPaused(!paused),
  restart: () => { engine.restart(); restartDelay = 0; },
  addBall: () => engine.spawnBall(),
  clear: () => { engine.balls = []; },
  reset: () => {
    resetConfig(cfg);
    document.body.dataset.theme = cfg.appearance.theme;
    renderer.setTheme(cfg.appearance.theme, true);
    engine.restart();
    ui.refresh();
    saveConfig(cfg);
  }
});

/* ---------------- panel toggle ---------------- */

const toggleBtn = document.getElementById('panelToggle');
const panel = document.getElementById('panel');

function setPanel(open) {
  document.body.classList.toggle('panel-open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  toggleBtn.setAttribute('aria-label', open ? 'Закрыть настройки' : 'Открыть настройки');
}
toggleBtn.addEventListener('click', () => {
  setPanel(!document.body.classList.contains('panel-open'));
});

/* ---------------- resize ---------------- */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(w, h, dpr);
  engine.setViewport(w, h);
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
    engine.restart();
    restartDelay = 0;
  } else if (e.code === 'KeyB') {
    engine.spawnBall();
  }
});

/* ---------------- events -> effects ---------------- */

function handleEvents() {
  const enabled = cfg.appearance.effectsEnabled;
  const particleCss = rgbCss(renderer.cur.particle);
  for (const ev of engine.events) {
    if (!enabled) continue;
    if (ev.type === 'bounce') effects.bounce(ev.x, ev.y, ev.strength, particleCss);
    else if (ev.type === 'hole') effects.hole(ev.x, ev.y, particleCss);
  }
  engine.events.length = 0;
}

/* ---------------- end-of-run behavior ---------------- */

function checkEndBehavior(frameDt) {
  const active = engine.activeBallCount();
  const pending = engine.hasPendingSpawns();
  if (active === 0 && !pending) {
    if (cfg.behavior.endMode === 'stop') {
      if (!paused) setPaused(true);
    } else if (cfg.behavior.endMode === 'auto') {
      restartDelay += frameDt;
      if (restartDelay > 0.9) {
        engine.restart();
        restartDelay = 0;
      }
    }
  } else {
    restartDelay = 0;
  }
}

/* ---------------- main loop ---------------- */

function frame(nowMs) {
  const now = nowMs / 1000;
  const frameDt = Math.min(0.05, Math.max(0, now - lastTime));
  lastTime = now;

  if (!paused) {
    accumulator += frameDt * cfg.behavior.speed;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 240) {
      engine.step(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps >= 240) accumulator = 0; // avoid spiral of death
    const alpha = Math.min(1, accumulator / FIXED_DT);

    handleEvents();
    checkEndBehavior(frameDt);
    effects.update(frameDt);
    renderer.draw(engine, alpha, frameDt, false, effects);
  } else {
    renderer.draw(engine, 1, 0, true, effects);
  }

  requestAnimationFrame(frame);
}

/* ---------------- init ---------------- */

document.body.dataset.theme = cfg.appearance.theme;
renderer.setTheme(cfg.appearance.theme, true);
resize();
engine.restart();
ui.refresh();
requestAnimationFrame(frame);
