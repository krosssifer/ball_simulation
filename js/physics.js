'use strict';

/* ------------------------------------------------------------------
 * Physics engine — pure simulation, zero rendering dependencies.
 *
 * Ring hierarchy (strictly separated):
 *   - this.rings[0]                     === this.outermostRing (largest R)
 *   - this.rings[this.rings.length - 1] === this.innermostRing (smallest R)
 *
 * Geometry model:
 *   Each ring is an exact 2D Capsule-Arc (Minkowski sum of a circular
 *   arc of radius R with a disk of radius wallThickness / 2), leaving
 *   a true Euclidean clear opening of width 2 * R * sin(holeHalf) bounded
 *   by smooth semicircular end-caps.
 *   - Balls always spawn strictly inside innermostRing.
 *   - Balls collide with solid inner/outer surfaces and rounded hole lips,
 *     receiving tangential velocity from rotating rings.
 *   - Ball-ball collisions use mass-weighted elastic impulses + positional
 *     stabilization so dense crowds never push balls through walls.
 *   - A ball is marked escaped ONLY after clearing outermostRing.
 * ------------------------------------------------------------------ */

if (typeof module !== 'undefined' && typeof clone === 'undefined') {
  Object.assign(globalThis, require('./config.js'));
}

const FIXED_DT = 1 / 240;
const MAX_BALLS = 80;
const MAX_SPEED = 2200;
const MAX_EVENTS = 72;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

class Engine {
  constructor(config) {
    this.cfg = config;
    this.balls = [];
    this.rings = [];
    this.events = [];
    this.time = 0;
    this.cx = 0;
    this.cy = 0;
    this.w = 0;
    this.h = 0;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.totalSpawnSerial = 0;
    this.baseRadius = 280;
    this.effWallThickness = config.scene.wallThickness;
    this.effBallRadius = config.balls.size;
    this.effSpacing = config.scene.ringSpacing;
    this.rotationDirFactor = 1;
    this.compatibility = {
      holeBlocked: false,
      minRequiredHoleDeg: 0,
      geometryAdjusted: false,
      message: ''
    };
  }

  /* Explicit ring boundary accessors */
  get outermostRing() {
    return this.rings.length > 0 ? this.rings[0] : null;
  }

  get innermostRing() {
    return this.rings.length > 0 ? this.rings[this.rings.length - 1] : null;
  }

  pushEvent(ev) {
    if (this.events.length < MAX_EVENTS) {
      this.events.push(ev);
    }
  }

  setViewport(w, h) {
    const validW = Math.max(200, w || 800);
    const validH = Math.max(200, h || 600);
    const prevCx = this.cx || validW / 2;
    const prevCy = this.cy || validH / 2;
    const prevOuterR = this.outermostRing ? this.outermostRing.R : 0;
    const hadViewport = this.w > 0 && this.h > 0;

    // Capture relative ball coordinates prior to ring rebuild
    const saved = hadViewport ? this.balls.map(b => ({
      ball: b,
      ox: b.x - prevCx,
      oy: b.y - prevCy,
      opx: b.px - prevCx,
      opy: b.py - prevCy,
      trailOff: b.trail ? b.trail.map(pt => ({ ox: pt.x - prevCx, oy: pt.y - prevCy, t: pt.t })) : []
    })) : null;

    this.w = validW;
    this.h = validH;
    this.cx = validW / 2;
    this.cy = validH / 2;

    this.rebuildRings();

    if (saved && saved.length > 0) {
      const newOuterR = this.outermostRing ? this.outermostRing.R : prevOuterR;
      const scale = (prevOuterR > 1 && newOuterR > 1) ? (newOuterR / prevOuterR) : 1;
      for (const item of saved) {
        const b = item.ball;
        b.x = this.cx + item.ox * scale;
        b.y = this.cy + item.oy * scale;
        b.px = this.cx + item.opx * scale;
        b.py = this.cy + item.opy * scale;
        b.trail = item.trailOff.map(pt => ({
          x: this.cx + pt.ox * scale,
          y: this.cy + pt.oy * scale,
          t: pt.t
        }));
        const dist = Math.hypot(b.x - this.cx, b.y - this.cy);
        b.ringSide = {};
        for (const ring of this.rings) {
          b.ringSide[ring.index] = dist < ring.R ? -1 : 1;
        }
      }
    }
  }

  /* ---------------- geometry & compatibility solver ---------------- */

  rebuildRings(resetBroken = false) {
    const s = this.cfg.scene;
    const w = this.w || 1280;
    const h = this.h || 800;
    const minDim = Math.max(220, Math.min(w, h));
    const count = Math.max(1, Math.min(15, Math.round(s.ringCount)));

    const rawT = Math.max(4, s.wallThickness);
    const rawBallR = Math.max(4, this.cfg.balls.size);
    const rawSpacing = Math.max(20, s.ringSpacing);

    // Viewport-adaptive outer radius that still honors manual slider control.
    const viewportScale = Math.max(0.42, Math.min(1.45, minDim / 800));
    const viewportMaxR = Math.max(64, minDim / 2 - Math.max(22, rawT * 0.8 + 14));
    let outerR = Math.min(viewportMaxR, s.circleSize * viewportScale);

    // When multiple concentric rings are active, allow outerR to use available
    // viewport space if the base radius would excessively cram the corridors.
    if (count > 1) {
      const minCorridorTarget = rawT + 2 * rawBallR + (count > 5 ? 12 : 22);
      const minInnerTarget = Math.max(
        (count > 5 ? 56 : 88) * viewportScale,
        rawT * 0.5 + (count > 5 ? 3.6 : 2.6) * rawBallR + (count > 5 ? 14 : 24)
      );
      const multiTargetR = minInnerTarget + (count - 1) * minCorridorTarget;
      if (outerR < multiTargetR) {
        outerR = Math.min(viewportMaxR, Math.max(outerR, multiTargetR));
      }
    }

    // Enforce strict geometric non-overlap across all rings (1..15) and balls:
    //   innerWall = R_inner - effT/2 >= innerRatio * effBallR + effClear
    //   corridor  = effSpacing - effT >= 2.0 * effBallR + effClear
    const baseClear = 6;
    const innerRatio = count > 5 ? 3.4 : 2.2;
    const ballCoeff = 2 * count + (innerRatio - 2);
    let effT = rawT;
    let effBallR = rawBallR;
    let effClear = baseClear;
    let geometryAdjusted = false;

    const minRequiredR = (count - 0.5) * effT + ballCoeff * effBallR + baseClear * count;
    if (minRequiredR > outerR) {
      effClear = count > 5
        ? Math.max(1.8, Math.min(baseClear, (outerR * 0.22) / count))
        : baseClear;
      const avail = Math.max(count * 3, outerR - effClear * count);
      const denom = (count - 0.5) * rawT + ballCoeff * rawBallR;
      const k = Math.max(0.06, avail / Math.max(1, denom));
      effT = Math.max(1.5, rawT * k);
      effBallR = Math.max(1.8, rawBallR * k);
      geometryAdjusted = true;
    }

    let effSpacing = rawSpacing * (viewportScale < 0.85 ? Math.max(0.65, viewportScale) : 1);
    if (count > 1) {
      const minSpacing = effT + 2 * effBallR + effClear;
      const desiredInnerR = Math.max(
        outerR * (count > 5 ? 0.14 : 0.25),
        effT * 0.5 + (innerRatio + 0.2) * effBallR + (count > 5 ? 8 : 16)
      );
      const hardMinInnerR = effT * 0.5 + innerRatio * effBallR + effClear;
      const minInnerCenterR = Math.max(
        hardMinInnerR,
        Math.min(desiredInnerR, outerR - (count - 1) * minSpacing)
      );
      const maxSpacing = Math.max(minSpacing, (outerR - minInnerCenterR) / (count - 1));
      if (effSpacing < minSpacing || effSpacing > maxSpacing) {
        if (rawSpacing < minSpacing) geometryAdjusted = true;
        effSpacing = Math.max(minSpacing, Math.min(effSpacing, maxSpacing));
      }
    }

    this.baseRadius = outerR;
    this.effWallThickness = effT;
    this.effBallRadius = effBallR;
    this.effSpacing = effSpacing;

    const oldRots = this.rings.map(r => r.rot);
    const keepBroken = !resetBroken && Boolean(s.vanishOnPass) && this.rings.length === count;
    const oldBroken = keepBroken ? this.rings.map(r => Boolean(r.broken)) : [];
    if (resetBroken || !s.vanishOnPass || !s.reverseRotationOnVanish || this.rings.length !== count) {
      this.rotationDirFactor = 1;
    }
    const holeHalf = (s.holeSize * Math.PI / 180) / 2;
    const baseAng = s.holePosition * Math.PI / 180;
    const off = s.holeOffset * Math.PI / 180;
    const effDir = s.rotationDirection * (this.rotationDirFactor || 1);
    const baseOmega = s.rotationEnabled
      ? effDir * s.rotationSpeed * Math.PI / 180
      : 0;
    const gradStep = count > 5 ? 0.72 / (count - 1) : 0.18;

    const hw = effT / 2;
    this.rings = [];
    for (let i = 0; i < count; i++) {
      const R = outerR - i * effSpacing;
      const desiredHalfChord = R * Math.sin(Math.min(holeHalf, Math.PI * 0.5));
      const sinArc = (desiredHalfChord + hw) / R;
      const arcHoleHalf = sinArc < 0.998
        ? Math.asin(Math.max(0, sinArc))
        : Math.min(Math.PI - 0.04, holeHalf + hw / R);
      const clearWidth = 2 * desiredHalfChord;
      const passable = clearWidth > 2 * effBallR + 1.0;

      // Gentle radial speed gradient on inner rings prevents multi-ring phase-locking
      const omega = baseOmega * (1 + i * gradStep);

      this.rings.push({
        R,
        baseAngle: baseAng + i * off,
        rot: oldRots[i] || 0,
        omega,
        holeHalf,
        arcHoleHalf,
        clearWidth,
        passable,
        broken: Boolean(oldBroken[i]),
        index: i,
        isOutermost: i === 0,
        isInnermost: i === count - 1
      });
    }

    // Update ball radii and ringSide state if rings were reconfigured live.
    for (const ball of this.balls) {
      ball.r = effBallR;
      const dist = Math.hypot(ball.x - this.cx, ball.y - this.cy);
      const nextSide = {};
      for (const ring of this.rings) {
        if (ball.ringSide && (ring.index in ball.ringSide)) {
          // Keep existing side unless ring radius moved past ball significantly
          nextSide[ring.index] = dist < ring.R ? -1 : 1;
        } else {
          nextSide[ring.index] = dist < ring.R ? -1 : 1;
        }
      }
      ball.ringSide = nextSide;
    }

    this.updateCompatibility(geometryAdjusted);
  }

  updateCompatibility(geometryAdjusted) {
    const inner = this.innermostRing;
    if (!inner) {
      this.compatibility = {
        holeBlocked: false,
        minRequiredHoleDeg: 0,
        geometryAdjusted: false,
        message: ''
      };
      return this.compatibility;
    }

    const r = this.effBallRadius;
    const blocked = this.rings.some(ring => !ring.passable);
    let minDeg = 0;
    let message = '';

    if (blocked) {
      const ratio = Math.min(1, (r + 0.8) / inner.R);
      minDeg = Math.min(180, Math.ceil((2 * Math.asin(ratio) * 180) / Math.PI));
      message = 'Шарик шире отверстия — для выхода нужно ≥ ' + minDeg + '°';
    }

    this.compatibility = {
      holeBlocked: blocked,
      minRequiredHoleDeg: minDeg,
      geometryAdjusted: Boolean(geometryAdjusted),
      message
    };
    return this.compatibility;
  }

  /* ---------------- spawning (strictly inside innermostRing) ---------------- */

  findSpawnPosition(r, maxOff, slotIndex, slotTotal) {
    if (maxOff <= 0.5) {
      return { x: this.cx, y: this.cy };
    }

    // Deterministic golden-angle spiral seed + jitter so multi-ball spawns fill
    // the innermost circle evenly without overlapping walls or clustering.
    const idx = typeof slotIndex === 'number' ? slotIndex : this.balls.length;
    const tot = Math.max(1, typeof slotTotal === 'number' ? slotTotal : Math.max(1, this.balls.length + 1));

    let bestX = this.cx;
    let bestY = this.cy;
    let bestMinDist2 = -1;

    const candidates = this.balls.length === 0 ? 1 : 14;
    for (let c = 0; c < candidates; c++) {
      let rad, ang;
      if (c === 0 && typeof slotIndex === 'number' && tot > 1) {
        const frac = Math.sqrt((idx + 0.5) / tot);
        rad = maxOff * 0.86 * frac;
        ang = idx * GOLDEN_ANGLE;
      } else {
        rad = maxOff * Math.sqrt(Math.random()) * (candidates === 1 ? 0.45 : 0.9);
        ang = Math.random() * Math.PI * 2;
      }
      const x = this.cx + Math.cos(ang) * rad;
      const y = this.cy + Math.sin(ang) * rad;

      if (this.balls.length === 0) return { x, y };

      let minD2 = Infinity;
      for (const other of this.balls) {
        const dx = x - other.x;
        const dy = y - other.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      if (minD2 > bestMinDist2) {
        bestMinDist2 = minD2;
        bestX = x;
        bestY = y;
        if (minD2 >= (2 * r + 2) * (2 * r + 2)) break;
      }
    }

    // Final hard clamp so floating-point roundoff can never place a ball outside maxOff.
    const dx = bestX - this.cx;
    const dy = bestY - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > maxOff && d > 1e-6) {
      bestX = this.cx + (dx / d) * maxOff;
      bestY = this.cy + (dy / d) * maxOff;
    }
    return { x: bestX, y: bestY };
  }

  spawnBall(angleOffset, slotIndex, slotTotal) {
    if (this.balls.length >= MAX_BALLS) return null;
    if (this.rings.length === 0) this.rebuildRings();

    const b = this.cfg.balls;
    const innerRing = this.innermostRing;
    const hw = this.effWallThickness / 2;
    const r = this.effBallRadius;
    const innerWallR = innerRing ? innerRing.R - hw : 180;
    const safety = Math.min(6, Math.max(1.5, (innerWallR - r) * 0.12));
    const maxOff = Math.max(0, innerWallR - r - safety);

    const pos = this.findSpawnPosition(r, maxOff, slotIndex, slotTotal);
    const x = pos.x;
    const y = pos.y;

    // Choose a natural initial direction across the arena while avoiding an
    // instant zero-bounce straight shot out of the hole on frame 1.
    const holeAng = innerRing ? innerRing.baseAngle + innerRing.rot : 0;
    const spread = Math.PI - 0.38;
    const va = holeAng + Math.PI + (Math.random() * 2 - 1) * spread + (angleOffset || 0) * 0.15;
    const sp = b.initialSpeed * (0.88 + Math.random() * 0.24);

    const ringSide = {};
    for (const ring of this.rings) {
      ringSide[ring.index] = -1; // Guaranteed strictly inside every ring at spawn
    }

    const serial = this.totalSpawnSerial++;
    const ball = {
      x, y,
      px: x, py: y,
      vx: Math.cos(va) * sp,
      vy: Math.sin(va) * sp,
      r,
      m: b.mass,
      escaped: false,
      escapeTime: 0,
      hueShift: (serial * 19) % 360,
      ringSide,
      turbvx: 0,
      turby: 0,
      trail: [{ x, y, t: this.time }],
      lastTrailT: this.time
    };
    this.balls.push(ball);
    return ball;
  }

  restart() {
    this.balls = [];
    this.events = [];
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.totalSpawnSerial = 0;
    this.rebuildRings(true);

    const mode = this.cfg.balls.spawnMode;
    if (mode === 'single') {
      this.spawnBall(0, 0, 1);
      this.spawnedCount = 1;
    } else if (mode === 'multiple') {
      const n = Math.max(1, Math.min(MAX_BALLS, Math.round(this.cfg.balls.count)));
      for (let i = 0; i < n; i++) {
        this.spawnBall((i * Math.PI * 2) / n, i, n);
      }
      this.spawnedCount = n;
    } else {
      this.spawnBall(0, 0, 1);
      this.spawnedCount = 1;
    }
  }

  /* Live ball count adjustment for multiple-mode slider dragging without full restart */
  adjustBallCount(targetCount) {
    const target = Math.max(1, Math.min(MAX_BALLS, Math.round(targetCount)));
    if (this.cfg.balls.spawnMode !== 'multiple') return;

    const active = [];
    for (let i = 0; i < this.balls.length; i++) {
      if (!this.balls[i].escaped) active.push(i);
    }

    if (active.length < target) {
      const toAdd = target - active.length;
      for (let i = 0; i < toAdd && this.balls.length < MAX_BALLS; i++) {
        this.spawnBall((i * Math.PI * 2) / Math.max(1, toAdd), active.length + i, target);
      }
    } else if (active.length > target) {
      let toRemove = active.length - target;
      for (let i = this.balls.length - 1; i >= 0 && toRemove > 0; i--) {
        if (!this.balls[i].escaped) {
          this.balls.splice(i, 1);
          toRemove--;
        }
      }
    }
  }

  applyBallParams() {
    this.rebuildRings();
    for (const b of this.balls) {
      b.r = this.effBallRadius;
      b.m = this.cfg.balls.mass;
    }
  }

  isOffscreen(ball) {
    const w = this.w || 1280;
    const h = this.h || 800;
    return (
      ball.x + ball.r < 0 ||
      ball.x - ball.r > w ||
      ball.y + ball.r < 0 ||
      ball.y - ball.r > h
    );
  }

  isFullyClearedScreen(ball) {
    if (!this.isOffscreen(ball)) return false;
    const w = this.w || 1280;
    const h = this.h || 800;
    const pad = ball.r + 24;
    if (ball.x >= -pad && ball.x <= w + pad && ball.y >= -pad && ball.y <= h + pad) {
      return false;
    }
    if (ball.trail && ball.trail.length > 0) {
      const cutoff = this.time - this.maxTrailDuration();
      for (let i = 0; i < ball.trail.length; i++) {
        const pt = ball.trail[i];
        if (pt.t >= cutoff && pt.x >= -ball.r && pt.x <= w + ball.r && pt.y >= -ball.r && pt.y <= h + ball.r) {
          return false;
        }
      }
    }
    return true;
  }

  hasPendingSpawns() {
    const b = this.cfg.balls;
    return b.spawnMode === 'sequential' &&
      (b.infiniteSpawn || this.spawnedCount < b.count);
  }

  activeBallCount() {
    let n = 0;
    for (const b of this.balls) {
      if (!this.isOffscreen(b)) n++;
    }
    return n;
  }

  maxTrailDuration() {
    const len = this.cfg.balls.trailLength;
    const mult = this.cfg.appearance.trailIntensity;
    if (len <= 0 || mult <= 0.001) return 0;
    return (len / 60) * mult;
  }

  recordTrail(ball) {
    const maxAge = this.maxTrailDuration();
    if (maxAge <= 0) {
      if (ball.trail.length > 0) ball.trail.length = 0;
      return;
    }

    const cutoff = this.time - maxAge;
    // Prune expired points from the front (oldest first).
    let drop = 0;
    while (drop < ball.trail.length && ball.trail[drop].t < cutoff) {
      drop++;
    }
    if (drop > 0) {
      ball.trail.splice(0, drop);
    }

    const sampleInterval = Math.max(1 / 120, maxAge / 34);
    if (this.time - ball.lastTrailT >= sampleInterval || ball.trail.length === 0) {
      ball.trail.push({ x: ball.x, y: ball.y, t: this.time });
      ball.lastTrailT = this.time;
      if (ball.trail.length > 44) {
        ball.trail.shift();
      }
    }
  }

  /* ---------------- main physics step ---------------- */

  step(dt) {
    const cfg = this.cfg;
    const p = cfg.physics;
    const b = cfg.balls;
    this.time += dt;

    // Sequential spawning
    if (b.spawnMode === 'sequential') {
      this.spawnTimer += dt;
      while (this.spawnTimer >= b.spawnInterval) {
        this.spawnTimer -= b.spawnInterval;
        if ((b.infiniteSpawn || this.spawnedCount < b.count) &&
            this.balls.length < MAX_BALLS) {
          this.spawnBall();
          this.spawnedCount++;
        } else {
          this.spawnTimer = 0;
          break;
        }
      }
    }

    const gAng = p.gravityDirection * Math.PI / 180;
    const gx = Math.cos(gAng) * p.gravity;
    const gy = Math.sin(gAng) * p.gravity;
    const dragK = Math.exp(-p.drag * dt);
    const retention = p.energyRetention;
    const targetSpeed = b.initialSpeed;
    const arcade = p.mode === 'arcade';
    const TURB_V = 155;

    let maxSpeed = 0;
    for (const ball of this.balls) {
      ball.px = ball.x;
      ball.py = ball.y;

      ball.vx += gx * dt;
      ball.vy += gy * dt;
      ball.vx *= dragK;
      ball.vy *= dragK;

      if (retention > 0) {
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp > 1e-3) {
          const ns = sp + (targetSpeed - sp) * Math.min(1, retention * dt * 3.2);
          ball.vx *= ns / sp;
          ball.vy *= ns / sp;
        } else {
          const a = Math.random() * Math.PI * 2;
          ball.vx += Math.cos(a) * targetSpeed * 0.25;
          ball.vy += Math.sin(a) * targetSpeed * 0.25;
        }
      }

      if (arcade && !ball.escaped) {
        const tc = Math.exp(-1.9 * dt);
        const sigma = TURB_V * Math.sqrt(Math.max(0, 1 - tc * tc));
        ball.turbvx = (ball.turbvx || 0) * tc + (Math.random() - 0.5) * 2 * sigma;
        ball.turby = (ball.turby || 0) * tc + (Math.random() - 0.5) * 2 * sigma;
        ball.vx += ball.turbvx * dt;
        ball.vy += ball.turby * dt;
      }

      // Prevent an escaped ball from stalling motionless mid-screen in zero-gravity + high-drag configs
      if (ball.escaped && p.gravity < 5 && retention === 0) {
        const curSp = Math.hypot(ball.vx, ball.vy);
        if (curSp < 55) {
          const dx = ball.x - this.cx;
          const dy = ball.y - this.cy;
          const d = Math.hypot(dx, dy) || 1;
          ball.vx = (dx / d) * 55;
          ball.vy = (dy / d) * 55;
        }
      }

      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > MAX_SPEED) {
        const scale = MAX_SPEED / sp;
        ball.vx *= scale;
        ball.vy *= scale;
        if (MAX_SPEED > maxSpeed) maxSpeed = MAX_SPEED;
      } else if (sp > maxSpeed) {
        maxSpeed = sp;
      }
    }

    // Adaptive substepping prevents high-speed or fast-rotation tunneling.
    const hw = this.effWallThickness * 0.5;
    let maxRingSpeed = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.broken) {
        const rs = Math.abs(r.omega) * r.R;
        if (rs > maxRingSpeed) maxRingSpeed = rs;
      }
    }
    const maxSafeStep = Math.max(2.0, Math.min(this.effBallRadius, hw) * 0.65);
    const maxDisp = (maxSpeed + maxRingSpeed * 0.5) * dt;
    const substeps = Math.max(1, Math.min(12, Math.ceil(maxDisp / maxSafeStep)));
    const sdt = dt / substeps;

    for (let s = 0; s < substeps; s++) {
      for (const ring of this.rings) {
        ring.rot += ring.omega * sdt;
      }
      for (const ball of this.balls) {
        ball.x += ball.vx * sdt;
        ball.y += ball.vy * sdt;
      }

      this.collideBalls(true);
      for (const ball of this.balls) {
        for (const ring of this.rings) {
          this.collideRing(ball, ring, true);
        }
      }

      // Positional stabilization pass when multiple balls interact near walls/openings.
      if (this.balls.length > 1) {
        this.collideBalls(false);
        for (const ball of this.balls) {
          for (const ring of this.rings) {
            this.collideRing(ball, ring, false);
          }
        }
      }
    }

    // Definitive ring-exit detection, ring vanish-on-pass, & off-screen removal.
    const outerRing = this.outermostRing;
    const vanishOnPass = Boolean(cfg.scene.vanishOnPass);
    const reverseOnVanish = Boolean(cfg.scene.reverseRotationOnVanish);

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      this.recordTrail(ball);

      const dx = ball.x - this.cx;
      const dy = ball.y - this.cy;
      const od = Math.hypot(dx, dy);
      const vr = od > 1e-6 ? (dx * ball.vx + dy * ball.vy) / od : 0;

      // Vanish any intact ring once a ball has completely overcome it
      if (vanishOnPass) {
        for (let rIdx = this.rings.length - 1; rIdx >= 0; rIdx--) {
          const ring = this.rings[rIdx];
          if (ring.broken) continue;
          const ringClear = ring.R + hw + ball.r;
          if (od > ringClear + 2 && (vr >= -15 || od > ringClear + 12)) {
            ring.broken = true;
            if (reverseOnVanish) {
              this.rotationDirFactor = (this.rotationDirFactor || 1) * -1;
              for (let k = 0; k < this.rings.length; k++) {
                this.rings[k].omega = -this.rings[k].omega;
              }
            }
            this.pushEvent({
              type: 'ringVanish',
              R: ring.R,
              hc: ring.baseAngle + ring.rot,
              arcHoleHalf: ring.arcHoleHalf,
              thickness: this.effWallThickness,
              isOutermost: ring.isOutermost,
              reversedRotation: reverseOnVanish && Boolean(cfg.scene.rotationEnabled)
            });
          }
        }
      }

      if (outerRing) {
        if (!ball.escaped) {
          const outerClear = outerRing.R + hw + ball.r;
          const margin = outerRing.broken ? 2 : 12;
          if (od > outerClear + margin) {
            if (vr >= -20 || od > outerClear + 36 || outerRing.broken) {
              ball.escaped = true;
              ball.escapeTime = 0;
              const nx = od > 1e-6 ? dx / od : 1;
              const ny = od > 1e-6 ? dy / od : 0;
              this.pushEvent({
                type: 'escape',
                x: ball.x,
                y: ball.y,
                nx,
                ny,
                hueShift: ball.hueShift
              });
            }
          }
        } else if (!outerRing.broken && od < outerRing.R - hw) {
          // If gravity pulled a ball back through a top opening into an intact ring
          ball.escaped = false;
          ball.escapeTime = 0;
        }
      }

      if (ball.escaped) {
        ball.escapeTime += dt;
      }

      // Remove ONLY after both the ball and its visible trail have flown beyond screen bounds.
      if (this.isFullyClearedScreen(ball)) {
        this.balls.splice(i, 1);
      }
    }
  }

  /* ---------------- Capsule-Arc ring collision ---------------- */

  collideRing(ball, ring, applyImpulse) {
    if (ring.broken) return;

    const hw = this.effWallThickness * 0.5;
    const minDist = hw + ball.r;

    const dx = ball.x - this.cx;
    const dy = ball.y - this.cy;
    const dist = Math.hypot(dx, dy);

    // Broad-phase radial reject
    if (dist < ring.R - minDist || dist > ring.R + minDist) {
      // Keep ringSide synchronized when well clear of the ring
      ball.ringSide[ring.index] = dist < ring.R ? -1 : 1;
      return;
    }

    if (dist < 1e-6) return;

    const ang = Math.atan2(dy, dx);
    const hc = ring.baseAngle + ring.rot;
    const diff = angDiff(ang, hc);
    const absDiff = Math.abs(diff);

    const e = this.cfg.balls.restitution;
    const rawFr = this.cfg.physics.friction;
    const fr = ring.omega !== 0 ? Math.max(rawFr, 0.015) : rawFr;

    if (absDiff >= ring.arcHoleHalf) {
      // Solid circular wall section. Use tracked ringSide so a fast ball can
      // never flip across ring.R through solid wall.
      const side = ball.ringSide[ring.index] || (dist < ring.R ? -1 : 1);
      const nx = dx / dist;
      const ny = dy / dist;

      // Rotating ring wall velocity at centerline: omega x r
      const wx = -ring.omega * ring.R * ny;
      const wy = ring.omega * ring.R * nx;
      const rvx = ball.vx - wx;
      const rvy = ball.vy - wy;
      const vn = rvx * nx + rvy * ny;

      if (side < 0) {
        // Ball belongs inside this ring
        const target = ring.R - minDist;
        if (dist > target) {
          ball.x = this.cx + nx * target;
          ball.y = this.cy + ny * target;
        }
        if (applyImpulse && vn > 0) {
          const tx = -ny, ty = nx;
          const vt = (rvx * tx + rvy * ty) * (1 - fr);
          const nvn = -e * vn;
          ball.vx = wx + nvn * nx + vt * tx;
          ball.vy = wy + nvn * ny + vt * ty;
          this.jitter(ball, vn);
          if (vn > 125) {
            this.pushEvent({
              type: 'bounce',
              x: ball.x + nx * ball.r,
              y: ball.y + ny * ball.r,
              strength: vn
            });
          }
        }
      } else {
        // Ball belongs outside this ring
        const target = ring.R + minDist;
        if (dist < target) {
          ball.x = this.cx + nx * target;
          ball.y = this.cy + ny * target;
        }
        if (applyImpulse && vn < 0) {
          const tx = -ny, ty = nx;
          const vt = (rvx * tx + rvy * ty) * (1 - fr);
          const nvn = -e * vn;
          ball.vx = wx + nvn * nx + vt * tx;
          ball.vy = wy + nvn * ny + vt * ty;
          this.jitter(ball, -vn);
          if (-vn > 125) {
            this.pushEvent({
              type: 'bounce',
              x: ball.x - nx * ball.r,
              y: ball.y - ny * ball.r,
              strength: -vn
            });
          }
        }
      }
      return;
    }

    // Ball is inside the angular opening [-arcHoleHalf, +arcHoleHalf].
    // Collide against both rounded semicircular wall end-caps E1 and E2.
    const cap1 = hc + ring.arcHoleHalf;
    const cap2 = hc - ring.arcHoleHalf;
    const minDist2 = minDist * minDist;

    for (let pass = 0; pass < 2; pass++) {
      let hitAny = false;
      for (let c = 0; c < 2; c++) {
        const ca = c === 0 ? cap1 : cap2;
        const rx = Math.cos(ca) * ring.R;
        const ry = Math.sin(ca) * ring.R;
        const ex = this.cx + rx;
        const ey = this.cy + ry;

        const cdx = ball.x - ex;
        const cdy = ball.y - ey;
        const cd2 = cdx * cdx + cdy * cdy;
        if (cd2 >= minDist2) continue;

        hitAny = true;
        const cd = Math.sqrt(cd2) || 1e-6;
        const cnx = cdx / cd;
        const cny = cdy / cd;

        ball.x = ex + cnx * minDist;
        ball.y = ey + cny * minDist;

        if (applyImpulse && pass === 0) {
          const wx = -ring.omega * ry;
          const wy = ring.omega * rx;
          const rvx = ball.vx - wx;
          const rvy = ball.vy - wy;
          const vn = rvx * cnx + rvy * cny;
          if (vn < 0) {
            const tx = -cny, ty = cnx;
            const vt = (rvx * tx + rvy * ty) * (1 - fr);
            const nvn = -e * vn;
            ball.vx = wx + nvn * cnx + vt * tx;
            ball.vy = wy + nvn * cny + vt * ty;
            this.jitter(ball, -vn);
            if (-vn > 125) {
              this.pushEvent({
                type: 'bounce',
                x: ex + cnx * hw,
                y: ey + cny * hw,
                strength: -vn
              });
            }
          }
        }
      }
      if (!hitAny) break;
    }

    // Check whether the ball crossed ring.R cleanly through the opening.
    const newDist = Math.hypot(ball.x - this.cx, ball.y - this.cy);
    const prevSide = ball.ringSide[ring.index] || -1;
    const newSide = newDist < ring.R ? -1 : 1;

    if (prevSide === -1 && newSide === 1) {
      ball.ringSide[ring.index] = 1;
      if (applyImpulse) {
        this.pushEvent({
          type: 'hole',
          x: ball.x,
          y: ball.y,
          ringIndex: ring.index,
          isOutermost: ring.isOutermost
        });
      }
    } else if (prevSide === 1 && newSide === -1) {
      ball.ringSide[ring.index] = -1;
    }
  }

  // Subtle micro-roughness on energetic bounces breaks perfectly periodic
  // billiard orbits while scaling smoothly to zero on resting/rolling contacts.
  jitter(ball, impactSpeed) {
    if (impactSpeed < 35) return;
    const factor = Math.min(1, (impactSpeed - 35) / 140);
    const j = (Math.random() * 2 - 1) * 0.018 * factor;
    const c = Math.cos(j);
    const s = Math.sin(j);
    const vx = ball.vx * c - ball.vy * s;
    const vy = ball.vx * s + ball.vy * c;
    ball.vx = vx;
    ball.vy = vy;
  }

  /* ---------------- mass-weighted ball-ball collision ---------------- */

  collideBalls(applyImpulse) {
    const balls = this.balls;
    const n = balls.length;
    if (n < 2) return;

    const e = this.cfg.balls.restitution;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) continue;

        let nx, ny, dist;
        if (d2 < 1e-8) {
          const ang = ((i * 7 + j * 13) % 36) * (Math.PI / 18);
          nx = Math.cos(ang);
          ny = Math.sin(ang);
          dist = 0;
        } else {
          dist = Math.sqrt(d2);
          nx = dx / dist;
          ny = dy / dist;
        }

        const overlap = minDist - dist;
        const invA = 1 / Math.max(0.05, a.m);
        const invB = 1 / Math.max(0.05, b.m);
        const invSum = invA + invB;

        // Positional separation weighted by inverse mass
        const corrA = overlap * (invA / invSum);
        const corrB = overlap * (invB / invSum);
        a.x -= nx * corrA;
        a.y -= ny * corrA;
        b.x += nx * corrB;
        b.y += ny * corrB;

        if (!applyImpulse) continue;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const impulse = -(1 + e) * vn / invSum;
          a.vx -= impulse * invA * nx;
          a.vy -= impulse * invA * ny;
          b.vx += impulse * invB * nx;
          b.vy += impulse * invB * ny;

          if (-vn > 145) {
            this.pushEvent({
              type: 'bounce',
              x: (a.x + b.x) * 0.5,
              y: (a.y + b.y) * 0.5,
              strength: -vn
            });
          }
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Engine, FIXED_DT, MAX_BALLS, angDiff };
}
