'use strict';

/* ------------------------------------------------------------------
 * Visual effects: impact particles, expanding pulse rings and
 * hole-passage flashes. Purely cosmetic — no physics feedback.
 * Particle counts are capped so long sessions cannot leak memory.
 * ------------------------------------------------------------------ */

const MAX_PARTICLES = 400;

class Effects {
  constructor() {
    this.particles = [];
    this.pulses = [];
    this.flashes = [];
  }

  bounce(x, y, strength, colorCss) {
    const n = Math.min(10, Math.max(3, Math.floor(strength / 55)));
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 150;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 0.3 + Math.random() * 0.35,
        size: 1.2 + Math.random() * 2.2,
        color: colorCss
      });
    }
    this.pulses.push({ x, y, r: 5, life: 0, max: 0.28 });
  }

  hole(x, y, colorCss) {
    this.flashes.push({ x, y, life: 0, max: 0.45, color: colorCss });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-2.2 * dt);
      p.vy *= Math.exp(-2.2 * dt);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.life += dt;
      p.r += 90 * dt;
      if (p.life >= p.max) this.pulses.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += dt;
      if (f.life >= f.max) this.flashes.splice(i, 1);
    }
  }

  draw(ctx, themeCur) {
    // Hole-passage flashes (radial glow).
    for (const f of this.flashes) {
      const k = f.life / f.max;
      const r = 14 + 46 * k;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, f.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Impact pulses.
    const pulseColor = rgbCss(themeCur.particle);
    for (const p of this.pulses) {
      const k = p.life / p.max;
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = 1.6 * (1 - k) + 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Particles.
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
