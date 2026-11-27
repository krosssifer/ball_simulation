'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULTS, clone, applyPhysicsPreset
} = require('../js/config.js');
const { Engine, FIXED_DT, MAX_BALLS } = require('../js/physics.js');
const { Effects, MAX_PARTICLES, MAX_PULSES, MAX_FLASHES, MAX_ESCAPES } = require('../js/effects.js');
const { Renderer } = require('../js/renderer.js');

/* Minimal 2D canvas mock for Renderer unit/perf checks */
function createMockCanvas() {
  const grad = { addColorStop() {} };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    setTransform() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    setLineDash() {},
    createRadialGradient() { return grad; },
    createLinearGradient() { return grad; }
  };
  return {
    width: 1280,
    height: 800,
    getContext() { return ctx; }
  };
}

test('Stage 1: explicit innermostRing vs outermostRing ordering and initial spawn bounds', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 5;
  cfg.balls.spawnMode = 'multiple';
  cfg.balls.count = 20;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.equal(engine.rings.length, 5);
  assert.strictEqual(engine.outermostRing, engine.rings[0]);
  assert.strictEqual(engine.innermostRing, engine.rings[4]);

  for (let i = 0; i < engine.rings.length - 1; i++) {
    assert.ok(
      engine.rings[i].R > engine.rings[i + 1].R,
      `Expected ring[${i}].R (${engine.rings[i].R}) > ring[${i + 1}].R (${engine.rings[i + 1].R})`
    );
  }

  // All 20 balls must spawn strictly inside innermostRing (never between rings)
  const innerWall = engine.innermostRing.R - engine.effWallThickness * 0.5;
  assert.equal(engine.balls.length, 20);
  for (const b of engine.balls) {
    const dist = Math.hypot(b.x - engine.cx, b.y - engine.cy);
    assert.ok(
      dist + b.r <= innerWall + 1e-6,
      `Ball spawned outside innermostRing: dist=${dist}, r=${b.r}, innerWall=${innerWall}`
    );
  }
});

test('Scenario 1: 1 ring and 1 ball — stays fully visible past circle and disappears ONLY off-screen', () => {
  const cfg = clone(DEFAULTS);
  const engine = new Engine(cfg);
  const renderer = new Renderer(createMockCanvas());
  engine.setViewport(1920, 1080);
  engine.restart();

  const ball = engine.balls[0];
  assert.equal(renderer.ballFade(ball, engine), 1);

  let escaped = false;
  let seenEscapedOnScreen = false;
  let lastOffscreenBeforeRemoval = false;
  let escapeEventCount = 0;
  const maxSteps = Math.round(45 / FIXED_DT);

  for (let s = 0; s < maxSteps; s++) {
    const wasOffscreen = engine.isOffscreen(ball);
    engine.step(FIXED_DT);
    for (const ev of engine.events) {
      if (ev.type === 'escape') escapeEventCount++;
    }
    engine.events.length = 0;

    if (engine.balls.includes(ball)) {
      // While the ball exists anywhere on screen (inside or outside circle), opacity MUST stay 1
      assert.equal(renderer.ballFade(ball, engine), 1, 'Ball must not fade out before leaving the screen');
      if (ball.escaped && !engine.isOffscreen(ball)) {
        seenEscapedOnScreen = true;
      }
      if (!escaped && ball.escaped) {
        escaped = true;
        const dist = Math.hypot(ball.x - engine.cx, ball.y - engine.cy);
        const outerBorder = engine.outermostRing.R + engine.effWallThickness * 0.5 + ball.r;
        assert.ok(dist > outerBorder, 'Ball marked escaped before clearing outermostRing');
      }
    } else {
      lastOffscreenBeforeRemoval = wasOffscreen || engine.isOffscreen(ball);
      break;
    }
  }

  assert.ok(escaped, 'Ball should find the opening and exit within 45s');
  assert.ok(seenEscapedOnScreen, 'Ball must remain visible while flying from circle to screen edge');
  assert.ok(lastOffscreenBeforeRemoval, 'Ball must ONLY be removed after flying beyond screen bounds');
  assert.equal(escapeEventCount, 1);

  // Also verify a slow escaped ball (> 4 seconds on screen) is NEVER deleted mid-screen by a timer
  const slowEngine = new Engine(clone(DEFAULTS));
  slowEngine.cfg.balls.initialSpeed = 90;
  slowEngine.setViewport(1920, 1080);
  slowEngine.balls = [{
    x: 960 + 360, y: 540, px: 960 + 360, py: 540,
    vx: 90, vy: 0, r: 14, m: 1,
    escaped: true, escapeTime: 0, hueShift: 0,
    ringSide: { 0: 1 }, turbvx: 0, turby: 0,
    trail: [{ x: 960 + 360, y: 540, t: 0 }], lastTrailT: 0
  }];
  slowEngine.cfg.physics.gravity = 0;
  slowEngine.cfg.physics.drag = 0;
  // Advance 4.0 seconds (360px -> +360px = 1680px < 1920px, still on screen!)
  for (let s = 0; s < Math.round(4.0 / FIXED_DT); s++) {
    slowEngine.step(FIXED_DT);
  }
  assert.equal(slowEngine.balls.length, 1, 'Slow escaped ball still on screen after 4s must NOT disappear');
  assert.equal(slowEngine.isOffscreen(slowEngine.balls[0]), false);
});

test('Scenario 2: 5 concentric rings and 1 ball — sequential traversal without premature fade/escape', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 5;
  const engine = new Engine(cfg);
  const renderer = new Renderer(createMockCanvas());
  engine.setViewport(1280, 800);
  engine.restart();

  const ball = engine.balls[0];
  const crossedRings = [];
  const maxSteps = Math.round(90 / FIXED_DT);

  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);

    for (const ev of engine.events) {
      if (ev.type === 'hole' && !crossedRings.includes(ev.ringIndex)) {
        crossedRings.push(ev.ringIndex);
      }
    }
    engine.events.length = 0;

    const dist = Math.hypot(ball.x - engine.cx, ball.y - engine.cy);
    if (dist < engine.outermostRing.R) {
      assert.equal(ball.escaped, false, `Premature escape inside outer ring at dist=${dist}`);
      assert.equal(renderer.ballFade(ball, engine), 1, `Premature fade at dist=${dist}`);
    }

    if (ball.escaped) break;
  }

  assert.equal(ball.escaped, true, 'Ball must traverse all 5 rings and exit');
  // Ring indices crossed from innermost (4) outward to outermost (0)
  assert.deepEqual(crossedRings, [4, 3, 2, 1, 0]);
});

test('Scenario 3: 5 concentric rings and 20 balls — all start inside innermost and all exit outermost', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 5;
  cfg.balls.spawnMode = 'multiple';
  cfg.balls.count = 20;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  let escapedCount = 0;
  const maxSteps = Math.round(120 / FIXED_DT);

  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    for (const ev of engine.events) {
      if (ev.type === 'escape') escapedCount++;
    }
    engine.events.length = 0;

    for (const b of engine.balls) {
      const dist = Math.hypot(b.x - engine.cx, b.y - engine.cy);
      if (dist < engine.outermostRing.R) {
        assert.equal(b.escaped, false, 'Ball between rings must not be marked escaped');
      }
    }

    if (engine.activeBallCount() === 0) break;
  }

  assert.equal(engine.activeBallCount(), 0, 'All 20 balls should exit all 5 rings');
  assert.equal(escapedCount, 20);
});

test('Scenario 4 & 5: sequential spawning and staggered multi-ball exits', () => {
  const cfg = clone(DEFAULTS);
  cfg.balls.spawnMode = 'sequential';
  cfg.balls.count = 4;
  cfg.balls.spawnInterval = 0.6;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.equal(engine.spawnedCount, 1);
  assert.equal(engine.hasPendingSpawns(), true);

  const escapeTimes = [];
  const innerWall = engine.innermostRing.R - engine.effWallThickness * 0.5;
  let prevTotal = 1;

  const maxSteps = Math.round(60 / FIXED_DT);
  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    if (engine.spawnedCount > prevTotal) {
      prevTotal = engine.spawnedCount;
      const newest = engine.balls[engine.balls.length - 1];
      const d = Math.hypot(newest.x - engine.cx, newest.y - engine.cy);
      assert.ok(d + newest.r <= innerWall + 1e-5, 'Sequential ball spawned outside innermostRing');
    }
    for (const ev of engine.events) {
      if (ev.type === 'escape') escapeTimes.push(engine.time);
    }
    engine.events.length = 0;

    if (!engine.hasPendingSpawns() && engine.activeBallCount() === 0) break;
  }

  assert.equal(engine.spawnedCount, 4);
  assert.equal(engine.hasPendingSpawns(), false);
  assert.equal(escapeTimes.length, 4);
  assert.ok(escapeTimes[3] > escapeTimes[0], 'Balls should exit at distinct times');
});

test('Scenario 8: long-running infinite simulation caps balls and effects without NaN or leaks', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 3;
  cfg.scene.rotationEnabled = true;
  cfg.balls.spawnMode = 'sequential';
  cfg.balls.infiniteSpawn = true;
  cfg.balls.spawnInterval = 0.3;
  cfg.behavior.endMode = 'infinite';

  const engine = new Engine(cfg);
  const effects = new Effects();
  engine.setViewport(1280, 800);
  engine.restart();

  // Simulate 90 full seconds (21,600 fixed steps) of continuous spawning/collisions
  const totalSteps = Math.round(90 / FIXED_DT);
  for (let s = 0; s < totalSteps; s++) {
    engine.step(FIXED_DT);
    if (s % 4 === 0) {
      for (const ev of engine.events) {
        if (ev.type === 'bounce') effects.bounce(ev.x, ev.y, ev.strength, 'rgb(255,255,255)', 1);
        else if (ev.type === 'hole') effects.hole(ev.x, ev.y, 'rgb(255,255,255)', ev.isOutermost, 1);
        else if (ev.type === 'escape') effects.escape(ev.x, ev.y, ev.nx, ev.ny, 'rgb(255,80,100)', 'rgb(255,255,255)', 1);
      }
      engine.events.length = 0;
      effects.update(4 * FIXED_DT);

      assert.ok(engine.balls.length <= MAX_BALLS);
      assert.ok(effects.particles.length <= MAX_PARTICLES);
      assert.ok(effects.pulses.length <= MAX_PULSES);
      assert.ok(effects.flashes.length <= MAX_FLASHES);
      assert.ok(effects.escapes.length <= MAX_ESCAPES);
    }
  }

  for (const b of engine.balls) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(Number.isFinite(b.vx) && Number.isFinite(b.vy));
  }
});

test('Scenario 9: rotating concentric rings with staggered hole offsets', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 5;
  cfg.scene.rotationEnabled = true;
  cfg.scene.rotationSpeed = 48;
  cfg.scene.rotationDirection = -1;
  cfg.scene.holePosition = 35;
  cfg.scene.holeOffset = 72;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  const initialRot = engine.rings[0].rot;
  const maxSteps = Math.round(120 / FIXED_DT);
  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    engine.events.length = 0;
    if (engine.activeBallCount() === 0) break;
  }

  assert.ok(engine.rings[0].rot < initialRot, 'Counter-clockwise rotation should decrease angle');
  assert.equal(engine.activeBallCount(), 0, 'Ball should traverse all 5 staggered rotating rings');
});

test('Stage 2: compatibility check blocks impassable holes, warns, and prevents overlap in extreme configs', () => {
  // 1. Impassable hole: 8 deg opening with large 24px radius ball
  const cfg = clone(DEFAULTS);
  cfg.scene.holeSize = 8;
  cfg.balls.size = 24;
  cfg.balls.initialSpeed = 800; // Max speed test against blocked hole!

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.equal(engine.compatibility.holeBlocked, true);
  assert.ok(engine.compatibility.message.length > 0);

  // Run 15 seconds at high speed — ball must NEVER leak through the blocked hole
  const steps = Math.round(15 / FIXED_DT);
  for (let s = 0; s < steps; s++) {
    engine.step(FIXED_DT);
    engine.events.length = 0;
    assert.equal(engine.balls[0].escaped, false, 'Ball leaked through an impassable hole');
  }

  // 2. Extreme cramped mobile config: 5 rings + max wallThickness 30 + max ball size 30 on 320x568
  const cramped = clone(DEFAULTS);
  cramped.scene.ringCount = 5;
  cramped.scene.wallThickness = 30;
  cramped.balls.size = 30;
  cramped.scene.circleSize = 140;

  const eng2 = new Engine(cramped);
  eng2.setViewport(320, 568);
  eng2.restart();

  // Verify zero geometric overlap between adjacent walls and balls
  for (let i = 0; i < eng2.rings.length - 1; i++) {
    const corridor = eng2.rings[i].R - eng2.rings[i + 1].R - eng2.effWallThickness;
    assert.ok(
      corridor >= 2 * eng2.effBallRadius + 5,
      `Overlapping corridor ${corridor} for ball diameter ${2 * eng2.effBallRadius}`
    );
  }
  const innerSpace = eng2.innermostRing.R - eng2.effWallThickness * 0.5;
  assert.ok(innerSpace >= eng2.effBallRadius + 5);
});

test('Stage 2: mass-weighted ball collisions transfer more velocity to lighter ball', () => {
  const cfg = clone(DEFAULTS);
  cfg.physics.gravity = 0;
  cfg.physics.drag = 0;
  cfg.physics.energyRetention = 0;
  cfg.physics.mode = 'realistic';
  cfg.balls.restitution = 1.0;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.balls = [
    { x: 600, y: 400, px: 600, py: 400, vx: 300, vy: 0, r: 14, m: 5.0, escaped: false, escapeTime: 0, ringSide: { 0: -1 }, trail: [], lastTrailT: 0 },
    { x: 626, y: 400, px: 626, py: 400, vx: 0,   vy: 0, r: 14, m: 0.5, escaped: false, escapeTime: 0, ringSide: { 0: -1 }, trail: [], lastTrailT: 0 }
  ];

  engine.collideBalls(true);
  // Heavy ball (m=5) keeps moving right; light ball (m=0.5) launches faster than 500 px/s
  assert.ok(engine.balls[0].vx > 200);
  assert.ok(engine.balls[1].vx > 500);
});

test('Scenario 11 & 12: window resize preserves unescaped state; speed & frame-rate-independent trails', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 3;
  const engine = new Engine(cfg);
  engine.setViewport(1920, 1080);
  engine.restart();

  for (let i = 0; i < 120; i++) engine.step(FIXED_DT);
  assert.equal(engine.balls[0].escaped, false);

  // Shrink window dramatically to mobile portrait (375x667)
  engine.setViewport(375, 667);
  const b = engine.balls[0];
  const distAfterResize = Math.hypot(b.x - engine.cx, b.y - engine.cy);
  assert.ok(distAfterResize < engine.outermostRing.R, 'Unescaped ball must stay inside outermostRing across resize');
  assert.equal(b.escaped, false);

  // Frame-rate independence of time-based trail:
  // Run 0.5s of sim time in two engines and render one at 30Hz vs one at 144Hz
  const cfgA = clone(DEFAULTS), cfgB = clone(DEFAULTS);
  const engA = new Engine(cfgA), engB = new Engine(cfgB);
  const renA = new Renderer(createMockCanvas()), renB = new Renderer(createMockCanvas());
  engA.setViewport(1280, 800); engB.setViewport(1280, 800);
  engA.balls = [{ x: 500, y: 400, px: 500, py: 400, vx: 250, vy: 120, r: 14, m: 1, escaped: false, escapeTime: 0, ringSide: { 0: -1 }, trail: [], lastTrailT: 0 }];
  engB.balls = [{ x: 500, y: 400, px: 500, py: 400, vx: 250, vy: 120, r: 14, m: 1, escaped: false, escapeTime: 0, ringSide: { 0: -1 }, trail: [], lastTrailT: 0 }];
  cfgA.physics.mode = 'realistic'; cfgB.physics.mode = 'realistic';

  for (let s = 0; s < 120; s++) {
    engA.step(FIXED_DT);
    engB.step(FIXED_DT);
    if (s % 8 === 0) renA.draw(engA, 1, 1 / 30, false, null);   // 30 FPS render calls
    if (s % 2 === 0) renB.draw(engB, 1, 1 / 120, false, null);  // 120 FPS render calls
  }

  const durA = engA.time - engA.balls[0].trail[0].t;
  const durB = engB.time - engB.balls[0].trail[0].t;
  assert.ok(Math.abs(durA - durB) < 0.001, `Trail temporal span must match regardless of FPS (${durA} vs ${durB})`);
});

test('Stage 5: performance benchmark for 1, 20, 50, 80 balls at 4x speed with 5 rotating rings + adaptive quality', () => {
  for (const count of [1, 20, 50, 80]) {
    const cfg = clone(DEFAULTS);
    cfg.scene.ringCount = 5;
    cfg.scene.rotationEnabled = true;
    cfg.scene.rotationSpeed = 60;
    cfg.balls.spawnMode = count === 1 ? 'single' : 'multiple';
    cfg.balls.count = count;
    cfg.behavior.speed = 4;

    const engine = new Engine(cfg);
    const effects = new Effects();
    const renderer = new Renderer(createMockCanvas());
    renderer.resize(1280, 800, 1);
    engine.setViewport(1280, 800);
    engine.restart();

    const frames = 60; // 60 frames at 4x speed = 960 physics substeps
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      for (let sub = 0; sub < 16; sub++) {
        engine.step(FIXED_DT);
      }
      for (const ev of engine.events) {
        if (ev.type === 'bounce') effects.bounce(ev.x, ev.y, ev.strength, 'rgb(255,255,255)', renderer.effectiveQuality(engine.balls.length));
        else if (ev.type === 'hole') effects.hole(ev.x, ev.y, 'rgb(255,255,255)', ev.isOutermost, 1);
        else if (ev.type === 'escape') effects.escape(ev.x, ev.y, ev.nx, ev.ny, 'rgb(255,80,100)', 'rgb(255,255,255)', 1);
      }
      engine.events.length = 0;
      effects.update((1 / 60) * 4);
      renderer.draw(engine, 0.5, 1 / 60, false, effects);
    }
    const avgFrameMs = (performance.now() - t0) / frames;
    assert.ok(
      avgFrameMs < 12,
      `Expected <12ms avg frame budget for ${count} balls @ 4x speed, got ${avgFrameMs.toFixed(2)}ms`
    );
  }

  // Adaptive quality drops smoothly under simulated low FPS (30 FPS) and recovers at 60 FPS
  const renderer = new Renderer(createMockCanvas());
  for (let i = 0; i < 40; i++) renderer.updateQuality(1 / 28, 20);
  assert.ok(renderer.quality < 0.85, `Expected quality drop under low FPS, got ${renderer.quality}`);
  for (let i = 0; i < 80; i++) renderer.updateQuality(1 / 60, 5);
  assert.ok(renderer.quality > 0.9, `Expected quality recovery at 60 FPS, got ${renderer.quality}`);
});

test('Vanish-on-pass mode: passed rings sequentially break, stop colliding, and restore on restart', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 4;
  cfg.scene.vanishOnPass = true;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.ok(engine.rings.every(r => r.broken === false));

  const vanishedRadii = [];
  const maxSteps = Math.round(90 / FIXED_DT);
  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    for (const ev of engine.events) {
      if (ev.type === 'ringVanish') vanishedRadii.push(ev.R);
    }
    engine.events.length = 0;
    if (engine.rings.every(r => r.broken)) break;
  }

  assert.equal(vanishedRadii.length, 4, 'All 4 rings must vanish as the ball overcomes them');
  // Radii must increase strictly from innermost to outermost
  for (let i = 0; i < vanishedRadii.length - 1; i++) {
    assert.ok(vanishedRadii[i] < vanishedRadii[i + 1], 'Rings must vanish from innermost outward');
  }
  assert.ok(engine.rings.every(r => r.broken === true));

  // Restart must restore all rings intact
  engine.restart();
  assert.ok(engine.rings.every(r => r.broken === false));
});

test('15 concentric rings: non-overlapping across desktop/mobile and sequential inner-to-outer escape', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 15;
  cfg.scene.holeSize = 48;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.equal(engine.rings.length, 15);
  for (let i = 0; i < engine.rings.length - 1; i++) {
    const gap = engine.rings[i].R - engine.rings[i + 1].R - engine.effWallThickness;
    assert.ok(
      gap >= 2 * engine.effBallRadius + 1,
      `Expected non-overlapping corridor at ring ${i}, got gap=${gap}`
    );
  }
  const innerClear = engine.innermostRing.R - engine.effWallThickness * 0.5;
  assert.ok(innerClear > 2 * engine.effBallRadius, 'Innermost of 15 rings must comfortably house the ball');

  const d0 = Math.hypot(engine.balls[0].x - engine.cx, engine.balls[0].y - engine.cy);
  assert.ok(d0 + engine.balls[0].r < innerClear, 'Ball must spawn strictly inside innermost of 15 rings');

  // Extreme mobile cramped check (320x568 with thick walls & large ball slider)
  const cramped = clone(DEFAULTS);
  cramped.scene.ringCount = 15;
  cramped.scene.wallThickness = 30;
  cramped.balls.size = 30;
  sanitizeConfig(cramped);
  assert.equal(cramped.scene.ringCount, 15);
  const mobileEngine = new Engine(cramped);
  mobileEngine.setViewport(320, 568);
  mobileEngine.restart();
  assert.equal(mobileEngine.rings.length, 15);
  assert.ok(mobileEngine.innermostRing.R > mobileEngine.effWallThickness * 0.5 + mobileEngine.effBallRadius);
  for (let i = 0; i < 14; i++) {
    assert.ok(mobileEngine.rings[i].R - mobileEngine.rings[i + 1].R > mobileEngine.effWallThickness + 2 * mobileEngine.effBallRadius);
  }

  // Simulate sequential escape through all 15 rings on desktop
  const maxSteps = Math.round(180 / FIXED_DT);
  let escaped = false;
  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    if (engine.balls.some(b => b.escaped)) {
      escaped = true;
      break;
    }
  }
  assert.equal(escaped, true, 'Ball must sequentially traverse and escape all 15 concentric rings');
});

test('Reverse rotation on vanish: flips omega sign on each vanished ring, preserves across rebuild, and resets on restart', () => {
  const cfg = clone(DEFAULTS);
  cfg.scene.ringCount = 5;
  cfg.scene.vanishOnPass = true;
  cfg.scene.reverseRotationOnVanish = true;
  cfg.scene.rotationEnabled = true;
  cfg.scene.rotationDirection = 1;
  cfg.scene.rotationSpeed = 40;
  cfg.scene.holeSize = 52;

  const engine = new Engine(cfg);
  engine.setViewport(1280, 800);
  engine.restart();

  assert.ok(engine.outermostRing.omega > 0, 'Initial outer ring omega should be positive');

  const signsAfterEachVanish = [];
  const maxSteps = Math.round(120 / FIXED_DT);
  for (let s = 0; s < maxSteps; s++) {
    engine.step(FIXED_DT);
    for (const ev of engine.events) {
      if (ev.type === 'ringVanish') {
        assert.equal(ev.reversedRotation, true);
        signsAfterEachVanish.push(Math.sign(engine.outermostRing.omega));
      }
    }
    engine.events.length = 0;
    if (signsAfterEachVanish.length === 1) {
      // Live speed edit must preserve the flipped rotation direction
      cfg.scene.rotationSpeed = 55;
      engine.rebuildRings();
      assert.equal(Math.sign(engine.outermostRing.omega), -1, 'Live rebuildRings must preserve flipped direction');
    }
    if (signsAfterEachVanish.length >= 4) break;
  }

  assert.deepEqual(
    signsAfterEachVanish.slice(0, 4),
    [-1, 1, -1, 1],
    'Each vanished ring must reverse rotation direction of remaining rings'
  );

  engine.restart();
  assert.equal(engine.rotationDirFactor, 1);
  assert.ok(engine.outermostRing.omega > 0, 'Restart must restore initial rotation direction');
});
