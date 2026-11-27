'use strict';

/* ------------------------------------------------------------------
 * Physics engine — pure simulation, no rendering knowledge.
 *
 * Geometry: concentric rings (annuli) centered at (cx, cy). Each ring
 * has a centerline radius R, wall thickness t, and a real opening
 * (hole) spanning an angular interval. Balls collide with the inner
 * and outer surfaces of every ring except inside the hole interval,
 * where they pass freely. Rotating rings impart their tangential
 * surface velocity to bouncing balls.
 *
 * Integration uses a fixed timestep (1/240 s) driven by an
 * accumulator in main.js, so playback speed changes never break
 * collision correctness. Ball-ball collisions are mass-weighted
 * elastic impulses.
 * ------------------------------------------------------------------ */

const FIXED_DT = 1 / 240;
const MAX_BALLS = 80;

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
    this.events = [];       // drained by main.js each frame
    this.time = 0;
    this.cx = 0; this.cy = 0; this.w = 0; this.h = 0;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.baseRadius = 300;
  }

  setViewport(w, h) {
    const dx = w / 2 - this.cx;
    const dy = h / 2 - this.cy;
    this.w = w; this.h = h;
    this.cx = w / 2; this.cy = h / 2;
    for (const b of this.balls) { b.x += dx; b.y += dy; b.px += dx; b.py += dy; }
    this.rebuildRings();
  }

  rebuildRings() {
    const s = this.cfg.scene;
    const maxR = Math.max(80, Math.min(this.w, this.h) / 2 - 36);
    const R = Math.min(s.circleSize, maxR);
    const count = Math.max(1, Math.min(5, Math.round(s.ringCount)));
    let spacing = s.ringSpacing;
    if (count > 1) {
      const minInner = 70;
      const maxSpacing = Math.max(30, (R - minInner) / (count - 1));
      spacing = Math.min(spacing, maxSpacing);
    }
    this.baseRadius = R;
    const oldRots = this.rings.map(r => r.rot);
    const holeHalf = (s.holeSize * Math.PI / 180) / 2;
    const baseAng = s.holePosition * Math.PI / 180;
    const off = s.holeOffset * Math.PI / 180;
    const omega = s.rotationEnabled
      ? s.rotationDirection * s.rotationSpeed * Math.PI / 180 : 0;
    this.rings = [];
    for (let i = 0; i < count; i++) {
      this.rings.push({
        R: R - i * spacing,
        baseAngle: baseAng + i * off,
        rot: oldRots[i] || 0,
        omega,
        holeHalf,
        index: i
      });
    }
  }

  /* ---------------- spawning ---------------- */

  spawnBall(angleOffset) {
    if (this.balls.length >= MAX_BALLS) return null;
    const b = this.cfg.balls;
    const innerR = this.rings.length
      ? this.rings[0].R - this.cfg.scene.wallThickness / 2 : 200;
    const r = b.size;
    const a = Math.random() * Math.PI * 2 + (angleOffset || 0);
    const maxOff = Math.max(0, innerR - r - 12);
    const off = maxOff * Math.random() * 0.5;
    const x = this.cx + Math.cos(a) * off;
    const y = this.cy + Math.sin(a) * off;
    // Bias the initial heading toward the innermost ring's hole (where the
    // ball actually starts) with a wide random spread, so the ball usually
    // finds the opening within a few bounces without following a scripted path.
    const innerRing = this.rings[this.rings.length - 1];
    const holeAng = innerRing ? innerRing.baseAngle + innerRing.rot : 0;
    const va = holeAng + (Math.random() * 2 - 1) * 1.3 + (angleOffset || 0) * 0.15;
    const sp = b.initialSpeed * (0.85 + Math.random() * 0.3);
    const ball = {
      x, y, px: x, py: y,
      vx: Math.cos(va) * sp, vy: Math.sin(va) * sp,
      r, m: b.mass,
      escaped: false,
      hueShift: this.balls.length * 16,
      band: {},      // per-ring band state: 'hole' | 'wall'
      _trail: []
    };
    this.balls.push(ball);
    return ball;
  }

  restart() {
    this.balls = [];
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.rebuildRings();
    const mode = this.cfg.balls.spawnMode;
    if (mode === 'single') {
      this.spawnBall();
    } else if (mode === 'multiple') {
      const n = Math.max(1, Math.round(this.cfg.balls.count));
      for (let i = 0; i < n; i++) this.spawnBall(i * Math.PI * 2 / n);
    } else {
      this.spawnBall();
      this.spawnedCount = 1;
    }
  }

  applyBallParams() {
    for (const b of this.balls) {
      b.r = this.cfg.balls.size;
      b.m = this.cfg.balls.mass;
    }
  }

  hasPendingSpawns() {
    const b = this.cfg.balls;
    return b.spawnMode === 'sequential' &&
      (b.infiniteSpawn || this.spawnedCount < b.count);
  }

  activeBallCount() {
    let n = 0;
    for (const b of this.balls) if (!b.escaped) n++;
    return n;
  }

  /* ---------------- main step ---------------- */

  step(dt) {
    const cfg = this.cfg, p = cfg.physics, b = cfg.balls;
    this.time += dt;

    for (const ring of this.rings) ring.rot += ring.omega * dt;

    // Sequential spawning
    if (b.spawnMode === 'sequential') {
      this.spawnTimer += dt;
      if (this.spawnTimer >= b.spawnInterval) {
        this.spawnTimer = 0;
        if ((b.infiniteSpawn || this.spawnedCount < b.count) &&
            this.balls.length < MAX_BALLS) {
          this.spawnBall();
          this.spawnedCount++;
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
    const TURB_V = 140;   // arcade turbulence: std of smooth velocity wobble, px/s

    const outer = this.rings[this.rings.length - 1];
    const t = cfg.scene.wallThickness;
    const diag = Math.hypot(this.w, this.h);

    for (const ball of this.balls) {
      ball.px = ball.x; ball.py = ball.y;

      ball.vx += gx * dt;
      ball.vy += gy * dt;
      ball.vx *= dragK;
      ball.vy *= dragK;

      // Energy retention (arcade): pull speed toward the target speed.
      if (retention > 0) {
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp > 1e-3) {
          const ns = sp + (targetSpeed - sp) * Math.min(1, retention * dt * 3);
          ball.vx *= ns / sp;
          ball.vy *= ns / sp;
        } else {
          ball.vx += (Math.random() - 0.5) * targetSpeed * 0.2;
          ball.vy += (Math.random() - 0.5) * targetSpeed * 0.2;
        }
      }

      // Arcade turbulence: a smooth (low-frequency) random wobble in the
      // velocity so the ball's heading meanders and eventually sweeps the
      // whole perimeter to find any opening — without high-frequency jitter.
      // Energy retention above renormalizes speed, so only the direction diffuses.
      if (arcade) {
        const tc = Math.exp(-1.8 * dt);
        const sigma = TURB_V * Math.sqrt(1 - tc * tc);
        ball.turbvx = (ball.turbvx || 0) * tc + (Math.random() - 0.5) * 2 * sigma;
        ball.turby = (ball.turby || 0) * tc + (Math.random() - 0.5) * 2 * sigma;
        ball.vx += ball.turbvx * dt;
        ball.vy += ball.turby * dt;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      for (const ring of this.rings) this.collideRing(ball, ring);

      // Escape detection: beyond the outermost ring by a margin.
      if (outer) {
        const od = Math.hypot(ball.x - this.cx, ball.y - this.cy);
        if (!ball.escaped && od > outer.R + t / 2 + ball.r + 50) {
          ball.escaped = true;
          this.events.push({ type: 'escape', x: ball.x, y: ball.y });
        }
      }
    }

    this.collideBalls();

    // Remove balls that have left the visible area entirely.
    if (this.balls.length) {
      this.balls = this.balls.filter(ball => {
        const od = Math.hypot(ball.x - this.cx, ball.y - this.cy);
        return od < diag + 200;
      });
    }
  }

  /* ---------------- ring collision ---------------- */

  collideRing(ball, ring) {
    const t = this.cfg.scene.wallThickness;
    const dx = ball.x - this.cx;
    const dy = ball.y - this.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    const nx = dx / dist, ny = dy / dist;
    const inner = ring.R - t / 2;
    const outer = ring.R + t / 2;

    const inBand = dist + ball.r >= inner && dist - ball.r <= outer;
    const key = ring.index;

    if (!inBand) {
      if (ball.band[key] === 'hole') {
        // Passed through the opening — flash at the hole.
        const hc = ring.baseAngle + ring.rot;
        this.events.push({
          type: 'hole',
          x: this.cx + Math.cos(hc) * ring.R,
          y: this.cy + Math.sin(hc) * ring.R
        });
      }
      ball.band[key] = null;
      return;
    }

    // Inside the wall band: check whether the ball is within the hole.
    const ang = Math.atan2(dy, dx);
    const hc = ring.baseAngle + ring.rot;
    const diff = Math.abs(angDiff(ang, hc));
    const ballAngR = Math.asin(Math.min(1, ball.r / Math.max(dist, ball.r)));
    const inHole = diff < Math.max(0, ring.holeHalf - ballAngR);

    if (inHole) {
      ball.band[key] = 'hole';
      return; // free passage through the opening
    }
    ball.band[key] = 'wall';

    const e = this.cfg.balls.restitution;
    const fr = this.cfg.physics.friction;

    // Wall surface velocity (rotating ring): omega x r.
    const wx = -ring.omega * ring.R * ny;
    const wy = ring.omega * ring.R * nx;
    const rvx = ball.vx - wx;
    const rvy = ball.vy - wy;
    const vn = rvx * nx + rvy * ny;

    if (dist < ring.R) {
      // Inner surface: ball is inside the ring.
      const target = inner - ball.r;
      if (dist > target) {
        ball.x = this.cx + nx * target;
        ball.y = this.cy + ny * target;
      }
      if (vn > 0) {
        const tx = -ny, ty = nx;
        const vt = (rvx * tx + rvy * ty) * (1 - fr);
        const nvn = -e * vn;
        ball.vx = wx + nvn * nx + vt * tx;
        ball.vy = wy + nvn * ny + vt * ty;
        this.jitter(ball);
        if (vn > 120) {
          this.events.push({
            type: 'bounce',
            x: ball.x + nx * ball.r, y: ball.y + ny * ball.r,
            strength: vn
          });
        }
      }
    } else {
      // Outer surface: ball is outside the ring.
      const target = outer + ball.r;
      if (dist < target) {
        ball.x = this.cx + nx * target;
        ball.y = this.cy + ny * target;
      }
      if (vn < 0) {
        const tx = -ny, ty = nx;
        const vt = (rvx * tx + rvy * ty) * (1 - fr);
        const nvn = -e * vn;
        ball.vx = wx + nvn * nx + vt * tx;
        ball.vy = wy + nvn * ny + vt * ty;
        this.jitter(ball);
        if (-vn > 120) {
          this.events.push({
            type: 'bounce',
            x: ball.x - nx * ball.r, y: ball.y - ny * ball.r,
            strength: -vn
          });
        }
      }
    }
  }

  // Micro-roughness: a sub-degree random rotation on each wall
  // bounce. Visually imperceptible, but it breaks perfectly
  // periodic billiard orbits so the ball eventually finds the hole.
  jitter(ball) {
    const j = (Math.random() * 2 - 1) * 0.0175; // ±1°
    const c = Math.cos(j), s = Math.sin(j);
    const vx = ball.vx * c - ball.vy * s;
    const vy = ball.vx * s + ball.vy * c;
    ball.vx = vx; ball.vy = vy;
  }

  /* ---------------- ball-ball collision ---------------- */

  collideBalls() {
    const balls = this.balls;
    const e = this.cfg.balls.restitution;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 < 1e-9) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist;
        const overlap = minDist - dist;
        const invA = 1 / a.m, invB = 1 / b.m;
        const invSum = invA + invB;

        // Positional separation, weighted by inverse mass.
        a.x -= nx * overlap * (invA / invSum);
        a.y -= ny * overlap * (invA / invSum);
        b.x += nx * overlap * (invB / invSum);
        b.y += ny * overlap * (invB / invSum);

        // Elastic impulse along the contact normal.
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const impulse = -(1 + e) * vn / invSum;
          a.vx -= impulse * invA * nx;
          a.vy -= impulse * invA * ny;
          b.vx += impulse * invB * nx;
          b.vy += impulse * invB * ny;
          if (-vn > 140) {
            this.events.push({
              type: 'bounce',
              x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
              strength: -vn
            });
          }
        }
      }
    }
  }
}
