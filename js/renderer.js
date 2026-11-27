'use strict';

/* ------------------------------------------------------------------
 * Renderer — draws the scene from engine state. Reads theme data
 * only for colors/glow; never touches physics parameters.
 * Theme changes are smoothly interpolated over ~0.4 s.
 * ------------------------------------------------------------------ */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.themeName = 'neon';
    this.cur = null;
    this.target = null;
    this.setTheme('neon', true);
  }

  setTheme(name, instant) {
    this.themeName = name;
    const t = THEMES[name] || THEMES.neon;
    this.target = {
      bg: hexToRgb(t.bg),
      ring: hexToRgb(t.ring),
      particle: hexToRgb(t.particle),
      ringGlow: t.ringGlow,
      ballGlow: t.ballGlow,
      trail: t.trail,
      vignette: t.vignette
    };
    if (instant || !this.cur) this.cur = clone(this.target);
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  ballColor(ball, cfg) {
    const base = hexToRgb(cfg.balls.color);
    const shifted = ball.hueShift ? shiftHue(base, ball.hueShift) : base;
    return {
      css: rgbCss(shifted),
      light: rgbCss(shade(shifted, 0.38)),
      dark: rgbCss(shade(shifted, -0.28))
    };
  }

  ballFade(ball, engine) {
    if (!ball.escaped) return 1;
    const outer = engine.rings[engine.rings.length - 1];
    if (!outer) return 1;
    const dist = Math.hypot(ball.x - engine.cx, ball.y - engine.cy);
    const edge = outer.R + engine.cfg.scene.wallThickness / 2 + ball.r;
    return Math.max(0, Math.min(1, 1 - (dist - edge) / 150));
  }

  draw(engine, alpha, dt, paused, effects) {
    const ctx = this.ctx;
    const cfg = engine.cfg;
    const w = this.w, h = this.h;

    // Smooth theme transition.
    if (dt > 0 && this.cur && this.target) {
      const k = 1 - Math.exp(-dt * 5);
      this.cur.bg = lerpRgb(this.cur.bg, this.target.bg, k);
      this.cur.ring = lerpRgb(this.cur.ring, this.target.ring, k);
      this.cur.particle = lerpRgb(this.cur.particle, this.target.particle, k);
      this.cur.ringGlow = lerp(this.cur.ringGlow, this.target.ringGlow, k);
      this.cur.ballGlow = lerp(this.cur.ballGlow, this.target.ballGlow, k);
      this.cur.trail = lerp(this.cur.trail, this.target.trail, k);
      this.cur.vignette = lerp(this.cur.vignette, this.target.vignette, k);
    }
    const cur = this.cur;

    // Background.
    ctx.fillStyle = rgbCss(cur.bg);
    ctx.fillRect(0, 0, w, h);

    // Vignette (neon theme).
    if (cur.vignette > 0.02) {
      const cx = w / 2, cy = h / 2;
      const rad = Math.hypot(w, h) / 2;
      const g = ctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + cur.vignette.toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    const t = cfg.scene.wallThickness;
    const ringCss = rgbCss(cur.ring);

    // Rings: thick arc with a real gap at the hole.
    for (const ring of engine.rings) {
      const hc = ring.baseAngle + ring.rot;
      const start = hc + ring.holeHalf;
      const end = hc - ring.holeHalf + Math.PI * 2;

      ctx.beginPath();
      ctx.arc(engine.cx, engine.cy, ring.R, start, end);
      ctx.lineWidth = t;
      ctx.strokeStyle = ringCss;
      ctx.lineCap = 'butt';
      if (cur.ringGlow > 0.5) {
        ctx.shadowColor = ringCss;
        ctx.shadowBlur = cur.ringGlow * (0.5 + cfg.appearance.glowIntensity);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Rounded caps at the hole edges.
      ctx.fillStyle = ringCss;
      for (const sgn of [1, -1]) {
        const a = hc + sgn * ring.holeHalf;
        ctx.beginPath();
        ctx.arc(engine.cx + Math.cos(a) * ring.R,
                engine.cy + Math.sin(a) * ring.R, t / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Clean theme: crisp inner/outer edge lines.
      if (this.themeName === 'clean') {
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbCss(shade(cur.ring, 0.25));
        ctx.beginPath();
        ctx.arc(engine.cx, engine.cy, ring.R - t / 2, start, end);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(engine.cx, engine.cy, ring.R + t / 2, start, end);
        ctx.stroke();
      }
    }

    // Balls with trails.
    const trailMax = Math.round(cfg.balls.trailLength * cfg.appearance.trailIntensity);
    for (const ball of engine.balls) {
      const ix = ball.px + (ball.x - ball.px) * alpha;
      const iy = ball.py + (ball.y - ball.py) * alpha;
      const fade = this.ballFade(ball, engine);
      if (fade <= 0.01) continue;
      const col = this.ballColor(ball, cfg);

      if (!paused) {
        ball._trail.unshift({ x: ix, y: iy });
        while (ball._trail.length > trailMax) ball._trail.pop();
      }

      // Trail (behind the ball).
      const tl = ball._trail.length;
      if (tl > 1 && cur.trail > 0.01) {
        for (let i = tl - 1; i >= 1; i--) {
          const p = ball._trail[i];
          const f = 1 - i / tl;
          ctx.globalAlpha = f * cur.trail * 0.45 * fade;
          ctx.fillStyle = col.css;
          ctx.beginPath();
          ctx.arc(p.x, p.y, ball.r * (0.25 + 0.7 * f), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Glow.
      const glowAmt = cur.ballGlow * cfg.balls.glow * cfg.appearance.glowIntensity;
      if (glowAmt > 0.5) {
        ctx.shadowColor = col.css;
        ctx.shadowBlur = glowAmt;
      }

      // Volumetric sphere: radial gradient with offset highlight.
      const g = ctx.createRadialGradient(
        ix - ball.r * 0.35, iy - ball.r * 0.4, ball.r * 0.08,
        ix, iy, ball.r
      );
      g.addColorStop(0, col.light);
      g.addColorStop(0.55, col.css);
      g.addColorStop(1, col.dark);
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ix, iy, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    if (effects) effects.draw(ctx, cur);
  }
}
