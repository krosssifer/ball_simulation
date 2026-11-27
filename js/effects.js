'use strict';

/* ------------------------------------------------------------------
 * Visual effects: impact particles, restrained collision pulses,
 * intermediate hole-passage glints, and final outer-ring escape bursts.
 *
 * Purely cosmetic — zero feedback into physics.
 * Every pool is strictly capped and updated in simulation time so
 * effect duration matches playback speed (0.25x..4x) without leaks.
 * ------------------------------------------------------------------ */

if (typeof module !== 'undefined' && typeof rgbCss === 'undefined') {
  Object.assign(globalThis, require('./config.js'));
}

const MAX_PARTICLES = 260;
const MAX_PULSES = 34;
const MAX_FLASHES = 22;
const MAX_ESCAPES = 14;
const MAX_VANISHING_RINGS = 20;

function swapPop(arr, idx) {
  const last = arr.length - 1;
  if (idx !== last) arr[idx] = arr[last];
  arr.pop();
}

class Effects {
  constructor() {
    this.particles = [];
    this.pulses = [];
    this.flashes = [];
    this.escapes = [];
    this.vanishingRings = [];
    this.outerResonance = 0; // 0..1 subtle outer-ring shimmer after final escape
  }

  clear() {
    this.particles.length = 0;
    this.pulses.length = 0;
    this.flashes.length = 0;
    this.escapes.length = 0;
    this.vanishingRings.length = 0;
    this.outerResonance = 0;
  }

  bounce(x, y, strength, colorCss, quality = 1) {
    const q = Math.max(0.25, Math.min(1, quality));

    // Coalesce near-simultaneous pulses at almost the same contact point
    let duplicatePulse = false;
    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      if (p.life < 0.045) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < 324) { // 18px radius
          duplicatePulse = true;
          break;
        }
      }
    }

    if (!duplicatePulse && this.pulses.length < MAX_PULSES && (q > 0.4 || Math.random() < q)) {
      this.pulses.push({
        x, y,
        r: 4,
        speed: 72 + Math.min(60, strength * 0.08),
        life: 0,
        max: 0.26
      });
    }

    const baseCount = Math.min(7, Math.max(2, Math.floor(strength / 95)));
    const count = Math.max(1, Math.round(baseCount * q));
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const sp = 35 + Math.random() * (85 + Math.min(90, strength * 0.12));
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.24 + Math.random() * 0.26,
        size: 1.1 + Math.random() * 1.7,
        color: colorCss,
        streak: false
      });
    }
  }

  hole(x, y, colorCss, isOutermost = false, quality = 1) {
    if (isOutermost) return; // Outermost exit gets the dedicated escape celebration
    if (this.flashes.length >= MAX_FLASHES) {
      if (quality < 0.6) return;
      swapPop(this.flashes, 0);
    }
    this.flashes.push({
      x, y,
      life: 0,
      max: 0.34,
      color: colorCss
    });
  }

  escape(x, y, nx, ny, ballColorCss, accentColorCss, quality = 1) {
    const q = Math.max(0.3, Math.min(1, quality));
    this.outerResonance = Math.min(1, this.outerResonance + 0.85);

    if (this.escapes.length >= MAX_ESCAPES) {
      swapPop(this.escapes, 0);
    }
    const baseAng = Math.atan2(ny, nx);
    this.escapes.push({
      x, y,
      ang: baseAng,
      life: 0,
      max: 0.62,
      color: ballColorCss,
      accent: accentColorCss
    });

    // Directional fan of graceful outward streaks
    const sparkCount = Math.max(5, Math.round(12 * q));
    for (let i = 0; i < sparkCount; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        swapPop(this.particles, 0);
      }
      const spread = ((i / Math.max(1, sparkCount - 1)) - 0.5) * 1.35 + (Math.random() - 0.5) * 0.25;
      const a = baseAng + spread;
      const sp = 95 + Math.random() * 155;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.42 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2.0,
        color: i % 3 === 0 ? accentColorCss : ballColorCss,
        streak: true
      });
    }
  }

  ringVanish(cx, cy, ev, ringColorCss, rimColorCss, quality = 1) {
    const q = Math.max(0.3, Math.min(1, quality));
    if (this.vanishingRings.length >= MAX_VANISHING_RINGS) {
      swapPop(this.vanishingRings, 0);
    }
    const start = ev.hc + ev.arcHoleHalf;
    const end = ev.hc - ev.arcHoleHalf + Math.PI * 2;
    this.vanishingRings.push({
      cx, cy,
      R: ev.R,
      start,
      end,
      thickness: ev.thickness || 12,
      color: ringColorCss,
      rim: rimColorCss,
      life: 0,
      max: 0.42
    });

    // Delicate radial dust along the dissolving arc
    const span = Math.max(0.2, end - start);
    const n = Math.max(8, Math.round(20 * q));
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        swapPop(this.particles, 0);
      }
      const a = start + ((i + Math.random() * 0.8) / n) * span;
      const px = cx + Math.cos(a) * ev.R;
      const py = cy + Math.sin(a) * ev.R;
      const outSp = 32 + Math.random() * 68;
      const tanSp = (Math.random() - 0.5) * 40;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(a) * outSp - Math.sin(a) * tanSp,
        vy: Math.sin(a) * outSp + Math.cos(a) * tanSp,
        life: 0,
        max: 0.3 + Math.random() * 0.24,
        size: 1.2 + Math.random() * 1.6,
        color: i % 2 === 0 ? rimColorCss : ringColorCss,
        streak: false
      });
    }
  }

  update(simDt) {
    if (simDt <= 0) return;

    if (this.outerResonance > 0) {
      this.outerResonance = Math.max(0, this.outerResonance - simDt * 2.1);
    }

    const damp = Math.exp(-2.8 * simDt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += simDt;
      if (p.life >= p.max) {
        swapPop(this.particles, i);
        continue;
      }
      p.x += p.vx * simDt;
      p.y += p.vy * simDt;
      p.vx *= damp;
      p.vy *= damp;
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.life += simDt;
      if (p.life >= p.max) {
        swapPop(this.pulses, i);
        continue;
      }
      p.r += p.speed * simDt;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += simDt;
      if (f.life >= f.max) {
        swapPop(this.flashes, i);
      }
    }

    for (let i = this.escapes.length - 1; i >= 0; i--) {
      const e = this.escapes[i];
      e.life += simDt;
      if (e.life >= e.max) {
        swapPop(this.escapes, i);
      }
    }

    for (let i = this.vanishingRings.length - 1; i >= 0; i--) {
      const vr = this.vanishingRings[i];
      vr.life += simDt;
      if (vr.life >= vr.max) {
        swapPop(this.vanishingRings, i);
      }
    }
  }

  draw(ctx, themeCur, themeName = 'minimal', quality = 1) {
    const isNeon = themeName === 'neon';
    const isClean = themeName === 'clean';

    // 0. Dissolving rings (when vanishOnPass mode is enabled)
    ctx.lineCap = 'round';
    for (let i = 0; i < this.vanishingRings.length; i++) {
      const vr = this.vanishingRings[i];
      const k = vr.life / vr.max;
      const ease = 1 - Math.pow(1 - k, 3);
      const fade = Math.pow(1 - k, 1.75);
      const curR = vr.R + 15 * ease;

      if (isNeon && quality >= 0.5) {
        ctx.globalAlpha = fade * 0.35;
        ctx.strokeStyle = vr.color;
        ctx.lineWidth = vr.thickness * (1.35 - 0.7 * k);
        ctx.beginPath();
        ctx.arc(vr.cx, vr.cy, curR, vr.start, vr.end);
        ctx.stroke();
      }

      ctx.globalAlpha = fade * (isNeon ? 0.85 : 0.72);
      ctx.strokeStyle = isNeon ? vr.rim : vr.color;
      ctx.lineWidth = Math.max(0.8, vr.thickness * (1 - 0.72 * k));
      ctx.beginPath();
      ctx.arc(vr.cx, vr.cy, curR, vr.start, vr.end);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 1. Intermediate hole-passage soft glints
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      const k = f.life / f.max;
      const ease = 1 - k;
      const r = 10 + 26 * k;
      ctx.globalAlpha = ease * ease * (isNeon ? 0.5 : isClean ? 0.24 : 0.34);
      if (quality >= 0.55) {
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = f.color;
      }
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Final outer-ring escape signature ripples + directional arc
    for (let i = 0; i < this.escapes.length; i++) {
      const e = this.escapes[i];
      const k = e.life / e.max;
      const easeOut = 1 - Math.pow(1 - k, 3);
      const fade = (1 - k) * (1 - k);

      // Soft bloom at exit portal
      if (quality >= 0.5 && !isClean) {
        const br = 16 + 44 * easeOut;
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, br);
        g.addColorStop(0, e.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = fade * (isNeon ? 0.52 : 0.28);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // Primary expanding wave ring
      const r1 = 10 + 56 * easeOut;
      ctx.globalAlpha = fade * (isNeon ? 0.78 : isClean ? 0.48 : 0.62);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = (isNeon ? 2.2 : 1.6) * (1 - k * 0.65);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r1, 0, Math.PI * 2);
      ctx.stroke();

      // Secondary directional outward crest arc
      if (k > 0.06) {
        const r2 = 6 + 74 * easeOut;
        ctx.globalAlpha = fade * (isNeon ? 0.6 : 0.4);
        ctx.strokeStyle = e.accent;
        ctx.lineWidth = 1.2 * (1 - k * 0.5);
        ctx.beginPath();
        ctx.arc(e.x, e.y, r2, e.ang - 1.15, e.ang + 1.15);
        ctx.stroke();
      }
    }

    // 3. Restrained bounce pulses
    const pulseColor = rgbCss(themeCur.particle);
    const pulseAlphaScale = isNeon ? 0.44 : isClean ? 0.25 : 0.30;
    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      const k = p.life / p.max;
      ctx.globalAlpha = (1 - k) * (1 - k) * pulseAlphaScale;
      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = (isNeon ? 1.5 : 1.1) * (1 - k) + 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Impact & escape particles
    ctx.lineCap = 'round';
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const k = p.life / p.max;
      const alpha = (1 - k) * (isClean ? 0.68 : 0.86);
      ctx.globalAlpha = alpha;

      if (p.streak && quality >= 0.5) {
        const tailDt = 0.028 * (1 - k * 0.5);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.8, p.size * (1 - k * 0.45));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * tailDt, p.y - p.vy * tailDt);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (1 - k * 0.55)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Effects, MAX_PARTICLES, MAX_PULSES, MAX_FLASHES, MAX_ESCAPES, MAX_VANISHING_RINGS };
}
