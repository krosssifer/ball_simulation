'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ORDER = [
  'js/config.js',
  'js/physics.js',
  'js/effects.js',
  'js/renderer.js',
  'js/ui.js',
  'js/main.js'
];

/* Lightweight DOM + Storage harness to execute the full browser app in vm */
function bootApp(sharedStore = new Map(), width = 1280, height = 800) {
  class MiniClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(... names) { names.forEach(n => this.set.add(n)); }
    remove(...names) { names.forEach(n => this.set.delete(n)); }
    contains(n) { return this.set.has(n); }
    toggle(n, force) {
      const next = force === undefined ? !this.set.has(n) : Boolean(force);
      if (next) this.set.add(n); else this.set.delete(n);
      return next;
    }
  }

  class MiniElement {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.id = '';
      this.type = '';
      this.value = '';
      this.checked = false;
      this.hidden = false;
      this.open = false;
      this.textContent = '';
      this.style = { display: '' };
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.classList = new MiniClassList(this);
      this._className = '';
    }
    get className() { return this._className; }
    set className(v) {
      this._className = String(v);
      this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    set innerHTML(v) {
      if (v === '') this.children = [];
    }
    get innerHTML() { return ''; }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(ev) {
      const list = this.listeners.get(ev.type) || [];
      ev.target = ev.target || this;
      ev.preventDefault = ev.preventDefault || (() => {});
      for (const fn of list) fn(ev);
    }
    click() {
      if (this.type === 'checkbox') {
        this.checked = !this.checked;
        this.dispatchEvent({ type: 'change' });
      } else {
        this.dispatchEvent({ type: 'click' });
      }
    }
    findAll(pred, out = []) {
      if (pred(this)) out.push(this);
      for (const c of this.children) c.findAll(pred, out);
      return out;
    }
  }

  const grad = { addColorStop() {} };
  const ctx2d = {
    fillStyle: '', strokeStyle: '', shadowColor: '', shadowBlur: 0,
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
    setTransform() {}, fillRect() {}, beginPath() {}, arc() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, save() {}, restore() {},
    setLineDash() {}, createRadialGradient() { return grad; }, createLinearGradient() { return grad; }
  };

  const body = new MiniElement('body');
  body.dataset.theme = 'minimal';

  const scene = new MiniElement('canvas');
  scene.id = 'scene';
  scene.getContext = () => ctx2d;

  const compatWarning = new MiniElement('div');
  compatWarning.id = 'compatWarning';
  compatWarning.hidden = true;

  const panelToggle = new MiniElement('button');
  panelToggle.id = 'panelToggle';

  const panelClose = new MiniElement('button');
  panelClose.id = 'panelClose';

  const panel = new MiniElement('aside');
  panel.id = 'panel';

  const panelBody = new MiniElement('div');
  panelBody.id = 'panelBody';
  panel.appendChild(panelBody);

  body.appendChild(scene);
  body.appendChild(compatWarning);
  body.appendChild(panelToggle);
  body.appendChild(panel);

  const byId = { scene, compatWarning, panelToggle, panelClose, panel, panelBody };
  const winListeners = new Map();
  let rafCb = null;
  let nowMs = 1000;

  const localStorage = {
    getItem: k => (sharedStore.has(k) ? sharedStore.get(k) : null),
    setItem: (k, v) => sharedStore.set(k, String(v)),
    removeItem: k => sharedStore.delete(k),
    clear: () => sharedStore.clear()
  };

  const windowObj = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 2,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of winListeners.get(ev.type) || []) fn(ev);
    }
  };

  const documentObj = {
    body,
    createElement: tag => new MiniElement(tag),
    getElementById: id => byId[id] || null
  };

  const context = vm.createContext({
    window: windowObj,
    document: documentObj,
    localStorage,
    performance: { now: () => nowMs },
    requestAnimationFrame: cb => { rafCb = cb; return 1; },
    Math, Number, String, Boolean, Object, Array, JSON, Set, Map, RegExp, parseFloat, parseInt, isFinite, console
  });
  context.globalThis = context;

  for (const rel of SCRIPT_ORDER) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
  }

  function stepFrames(count, dtSec = 1 / 60) {
    for (let i = 0; i < count; i++) {
      nowMs += dtSec * 1000;
      const cb = rafCb;
      if (cb) cb(nowMs);
    }
  }

  return {
    context,
    body,
    panelBody,
    panelToggle,
    panelClose,
    compatWarning,
    windowObj,
    localStorage,
    stepFrames,
    evalExpr: expr => vm.runInContext(expr, context)
  };
}

test('Default theme is Minimal Dark in both index.html and live config', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<body\s+data-theme="minimal">/);

  const app = bootApp();
  assert.equal(app.evalExpr('cfg.appearance.theme'), 'minimal');
  assert.equal(app.body.dataset.theme, 'minimal');
  assert.equal(app.evalExpr('renderer.themeName'), 'minimal');
});

test('Scenario 10 & Stage 3: switching physics mode applies preset, updates UI, and persists across reload', () => {
  const store = new Map();
  const app1 = bootApp(store);

  assert.equal(app1.evalExpr('cfg.physics.mode'), 'arcade');

  // Click "realistic" segmented button inside physics.mode control
  const modeWrap = app1.panelBody.findAll(el => el.dataset && el.dataset.path === 'physics.mode')[0];
  const realisticBtn = modeWrap.findAll(el => el.dataset && el.dataset.value === 'realistic')[0];
  realisticBtn.click();

  // 1. Preset applied in memory
  const expected = app1.evalExpr('PHYSICS_PRESETS.realistic');
  assert.equal(app1.evalExpr('cfg.physics.mode'), 'realistic');
  assert.equal(app1.evalExpr('cfg.physics.gravity'), expected.gravity);
  assert.equal(app1.evalExpr('cfg.physics.drag'), expected.drag);
  assert.equal(app1.evalExpr('cfg.physics.friction'), expected.friction);
  assert.equal(app1.evalExpr('cfg.physics.energyRetention'), expected.energyRetention);

  // 2. UI slider inputs & displayed values updated immediately
  const gravInput = app1.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'physics.gravity')[0];
  const retInput = app1.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'physics.energyRetention')[0];
  assert.equal(Number(gravInput.value), expected.gravity);
  assert.equal(Number(retInput.value), expected.energyRetention);

  // 3. Reload into a brand-new app instance sharing localStorage
  const app2 = bootApp(store);
  assert.equal(app2.evalExpr('cfg.physics.mode'), 'realistic');
  assert.equal(app2.evalExpr('cfg.physics.gravity'), expected.gravity);
  assert.equal(app2.evalExpr('cfg.physics.drag'), expected.drag);
  assert.equal(app2.evalExpr('cfg.physics.friction'), expected.friction);
  assert.equal(app2.evalExpr('cfg.physics.energyRetention'), expected.energyRetention);

  // Switch back to arcade and reload again
  const modeWrap2 = app2.panelBody.findAll(el => el.dataset && el.dataset.path === 'physics.mode')[0];
  const arcadeBtn2 = modeWrap2.findAll(el => el.dataset && el.dataset.value === 'arcade')[0];
  arcadeBtn2.click();

  const app3 = bootApp(store);
  const expArcade = app3.evalExpr('PHYSICS_PRESETS.arcade');
  assert.equal(app3.evalExpr('cfg.physics.mode'), 'arcade');
  assert.equal(app3.evalExpr('cfg.physics.gravity'), expArcade.gravity);
  assert.equal(app3.evalExpr('cfg.physics.energyRetention'), expArcade.energyRetention);
});

test('Stage 3: conditional dependent controls update immediately on slider, toggle, and segmented changes', () => {
  const app = bootApp();
  const findCtl = p => app.panelBody.findAll(el => el.classList.contains('ctl') && el.dataset.path === p)[0];

  // 1. Rotation controls initially hidden, revealed immediately when rotationEnabled toggled
  const rotDirCtl = findCtl('scene.rotationDirection');
  const rotSpdCtl = findCtl('scene.rotationSpeed');
  assert.equal(rotDirCtl.style.display, 'none');
  assert.equal(rotSpdCtl.style.display, 'none');

  const rotToggle = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'scene.rotationEnabled')[0];
  rotToggle.click();
  assert.equal(rotDirCtl.style.display, '');
  assert.equal(rotSpdCtl.style.display, '');

  // 2. Multi-ring controls revealed immediately when ringCount slider moves > 1
  const spacingCtl = findCtl('scene.ringSpacing');
  const offsetCtl = findCtl('scene.holeOffset');
  assert.equal(spacingCtl.style.display, 'none');
  assert.equal(offsetCtl.style.display, 'none');

  const ringCountInput = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'scene.ringCount')[0];
  ringCountInput.value = '4';
  ringCountInput.dispatchEvent({ type: 'input' });
  assert.equal(spacingCtl.style.display, '');
  assert.equal(offsetCtl.style.display, '');

  ringCountInput.value = '1';
  ringCountInput.dispatchEvent({ type: 'input' });
  assert.equal(spacingCtl.style.display, 'none');
  assert.equal(offsetCtl.style.display, 'none');

  // 3. Sequential spawn + infiniteSpawn immediately toggles balls.count visibility
  const spawnWrap = findCtl('balls.spawnMode');
  const seqBtn = spawnWrap.findAll(el => el.dataset && el.dataset.value === 'sequential')[0];
  seqBtn.click();

  const countCtl = findCtl('balls.count');
  const infCtl = findCtl('balls.infiniteSpawn');
  const intCtl = findCtl('balls.spawnInterval');
  assert.equal(countCtl.style.display, '');
  assert.equal(infCtl.style.display, '');
  assert.equal(intCtl.style.display, '');

  const infToggle = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'balls.infiniteSpawn')[0];
  infToggle.click();
  assert.equal(countCtl.style.display, 'none');

  infToggle.click();
  assert.equal(countCtl.style.display, '');
});

test('Stage 3: dragging balls.count slider does NOT trigger multiple full restarts', () => {
  const app = bootApp();

  // Switch to multiple spawn mode (1 intentional restart)
  const spawnWrap = app.panelBody.findAll(el => el.classList.contains('ctl') && el.dataset.path === 'balls.spawnMode')[0];
  const multiBtn = spawnWrap.findAll(el => el.dataset && el.dataset.value === 'multiple')[0];
  multiBtn.click();

  // Spy on engine.restart and remember the first ball object reference
  app.evalExpr('window.__restarts = 0; const _origRestart = engine.restart.bind(engine); engine.restart = function() { window.__restarts++; return _origRestart(); };');
  const firstBallRef = app.evalExpr('engine.balls[0]');

  const countInput = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'balls.count')[0];
  for (let n = 4; n <= 16; n++) {
    countInput.value = String(n);
    countInput.dispatchEvent({ type: 'input' });
  }
  countInput.dispatchEvent({ type: 'change' });

  assert.equal(app.evalExpr('window.__restarts'), 0, 'Dragging balls.count must cause 0 full restarts');
  assert.strictEqual(app.evalExpr('engine.balls[0]'), firstBallRef, 'Existing balls must not be destroyed');
  assert.equal(app.evalExpr('engine.activeBallCount()'), 16, 'Ball count adjusts live to 16');
});

test('Stage 2 & 6: compatibility warning, panel toggle, and theme switch without resetting physics', () => {
  const app = bootApp();
  app.stepFrames(15);

  assert.equal(app.compatWarning.hidden, true);

  // Set impassable opening (8 deg with 24px ball)
  const holeInput = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'scene.holeSize')[0];
  const sizeInput = app.panelBody.findAll(el => el.tagName === 'INPUT' && el.dataset.path === 'balls.size')[0];
  sizeInput.value = '24';
  sizeInput.dispatchEvent({ type: 'input' });
  holeInput.value = '8';
  holeInput.dispatchEvent({ type: 'input' });

  assert.equal(app.compatWarning.hidden, false);
  assert.match(app.compatWarning.textContent, /Шарик шире отверстия/);

  // Widen hole -> warning disappears
  holeInput.value = '48';
  holeInput.dispatchEvent({ type: 'input' });
  assert.equal(app.compatWarning.hidden, true);

  // Opening/closing panel and changing themes must NOT reset ball trajectory
  const ballBefore = app.evalExpr('({ ref: engine.balls[0], x: engine.balls[0].x, vx: engine.balls[0].vx })');
  app.panelToggle.click();
  assert.equal(app.body.classList.contains('panel-open'), true);

  const themeWrap = app.panelBody.findAll(el => el.classList.contains('ctl') && el.dataset.path === 'appearance.theme')[0];
  themeWrap.findAll(el => el.dataset && el.dataset.value === 'neon')[0].click();
  assert.equal(app.body.dataset.theme, 'neon');
  themeWrap.findAll(el => el.dataset && el.dataset.value === 'clean')[0].click();
  assert.equal(app.body.dataset.theme, 'clean');

  app.panelClose.click();
  assert.equal(app.body.classList.contains('panel-open'), false);

  const ballAfter = app.evalExpr('({ ref: engine.balls[0], x: engine.balls[0].x, vx: engine.balls[0].vx })');
  assert.strictEqual(ballAfter.ref, ballBefore.ref);
  assert.equal(ballAfter.x, ballBefore.x);
  assert.equal(ballAfter.vx, ballBefore.vx);
});

test('Scenarios 6 & 7: stop and auto-restart wait until all active balls pass outermostRing', () => {
  // Scenario 6: stop after last ball exits 3 rings
  const appStop = bootApp();
  appStop.evalExpr(`
    cfg.scene.ringCount = 3;
    cfg.behavior.endMode = 'stop';
    cfg.behavior.speed = 4;
    engine.restart();
  `);

  let pausedInsideOuter = false;
  for (let f = 0; f < 1800; f++) {
    appStop.stepFrames(1, 1 / 60);
    const state = appStop.evalExpr(`({
      paused,
      active: engine.activeBallCount(),
      insideOuter: engine.balls.some(b => Math.hypot(b.x - engine.cx, b.y - engine.cy) < engine.outermostRing.R)
    })`);
    if (state.paused && state.insideOuter) {
      pausedInsideOuter = true;
      break;
    }
    if (state.paused) break;
  }
  assert.equal(pausedInsideOuter, false, 'Must never pause while ball is still inside outer rings');
  assert.equal(appStop.evalExpr('paused'), true, 'Simulation should pause after ball exits outermostRing');

  // Scenario 7: auto-restart after traversing 3 rings
  const appAuto = bootApp();
  appAuto.evalExpr(`
    cfg.scene.ringCount = 3;
    cfg.behavior.endMode = 'auto';
    cfg.behavior.speed = 4;
    window.__autoRestarts = 0;
    const _orig = engine.restart.bind(engine);
    engine.restart = function() { window.__autoRestarts++; return _orig(); };
    _orig();
  `);

  let restartedPrematurely = false;
  for (let f = 0; f < 2000; f++) {
    const hadInsideBefore = appAuto.evalExpr('engine.balls.some(b => !b.escaped && Math.hypot(b.x - engine.cx, b.y - engine.cy) < engine.outermostRing.R)');
    const prevCount = appAuto.evalExpr('window.__autoRestarts');
    appAuto.stepFrames(1, 1 / 60);
    const nextCount = appAuto.evalExpr('window.__autoRestarts');
    if (nextCount > prevCount && hadInsideBefore) {
      restartedPrematurely = true;
      break;
    }
    if (nextCount >= 1) break;
  }
  assert.equal(restartedPrematurely, false, 'Auto-restart must never fire while balls are inside outer rings');
  assert.ok(appAuto.evalExpr('window.__autoRestarts') >= 1, 'Auto-restart should trigger after outermost exit');
});
