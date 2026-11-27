'use strict';

/* ------------------------------------------------------------------
 * Renderer — draws the scene from engine state.
 * Reads theme data purely for colors, lighting, shading and trails;
 * never mutates physics state.
 *
 * Features:
 *   - Smooth ~0.4s interpolation across Minimal Dark, Neon Physics,
 *     and Clean Physics themes.
 *   - Exact Capsule-Arc wall rendering with beveled thickness and
 *     visually distinct portal lips matching physics collision bounds.
 *   - Frame-rate-independent simulation-time trails.
 *   - Adaptive secondary-effect quality governor under heavy load.
 * ------------------------------------------------------------------ */

if (typeof module !== 'undefined' && typeof THEMES === 'undefined') {
  Object.assign(globalThis, require('./config.js'));
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.themeName = 'minimal';
    this.cur = null;
    this.target = null;
    this.w = 800;
    this.h = 600;
    this.dpr = 1;
    this.emaFrameDt = 1 / 60;
    this.quality = 1.0;
    this.setTheme('minimal', true);
  }

  setTheme(name, instant) {
    const validName = THEMES[name] ? name : 'minimal';
    this.themeName = validName;
    const t = THEMES[validName];
    this.target = {
      bg: hexToRgb(t.bg),
      ambient: hexToRgb(t.ambient),
      ambientAlpha: t.ambientAlpha,
      ring: hexToRgb(t.ring),
      ringRim: hexToRgb(t.ringRim),
      ringInner: hexToRgb(t.ringInner),
      particle: hexToRgb(t.particle),
      ringGlow: t.ringGlow,
      ballGlow: t.ballGlow,
      trail: t.trail,
      vignette: t.vignette,
      shadowAlpha: t.shadowAlpha
    };
    if (instant || !this.cur) {
      this.cur = clone(this.target);
    }
  }

  resize(w, h, dpr) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  updateQuality(rawFrameDt, ballCount) {
    if (rawFrameDt > 0.001 && rawFrameDt < 0.15) {
      this.emaFrameDt = this.emaFrameDt * 0.9 + rawFrameDt * 0.1;
      if (this.emaFrameDt > 1 / 47) {
        this.quality = Math.max(0.3, this.quality - rawFrameDt * 0.85);
      } else if (this.emaFrameDt < 1 / 56) {
        this.quality = Math.min(1.0, this.quality + rawFrameDt * 0.68);
      }
    }
    // Gentle proactive scaling for massive crowds (50..80 balls)
    const crowdScale = ballCount > 36
      ? Math.max(0.45, 1 - (ballCount - 36) / 95)
      : 1.0;
    return Math.max(0.3, Math.min(1.0, this.quality * crowdScale));
  }

  effectiveQuality(ballCount = 1) {
    const crowdScale = ballCount > 36
      ? Math.max(0.45, 1 - (ballCount - 36) / 95)
      : 1.0;
    return Math.max(0.3, Math.min(1.0, this.quality * crowdScale));
  }

  ballColor(ball, cfg) {
    const base = hexToRgb(cfg.balls.color);
    const shifted = ball.hueShift ? shiftHue(base, ball.hueShift) : base;
    return {
      rgb: shifted,
      css: rgbCss(shifted),
      spec: rgbCss(shade(shifted, 0.46)),
      light: rgbCss(shade(shifted, 0.28)),
      dark: rgbCss(shade(shifted, -0.28)),
      deep: rgbCss(shade(shifted, -0.42))
    };
  }

  /* Ball remains at full opacity across the entire screen until it flies off-screen */
  ballFade(_ball, _engine) {
    return 1;
  }

  interpolateTheme(dt) {
    if (dt <= 0 || !this.cur || !this.target) return;
    const k = 1 - Math.exp(-dt * 5.5);
    const c = this.cur, t = this.target;
    c.bg = lerpRgb(c.bg, t.bg, k);
    c.ambient = lerpRgb(c.ambient, t.ambient, k);
    c.ambientAlpha = lerp(c.ambientAlpha, t.ambientAlpha, k);
    c.ring = lerpRgb(c.ring, t.ring, k);
    c.ringRim = lerpRgb(c.ringRim, t.ringRim, k);
    c.ringInner = lerpRgb(c.ringInner, t.ringInner, k);
    c.particle = lerpRgb(c.particle, t.particle, k);
    c.ringGlow = lerp(c.ringGlow, t.ringGlow, k);
    c.ballGlow = lerp(c.ballGlow, t.ballGlow, k);
    c.trail = lerp(c.trail, t.trail, k);
    c.vignette = lerp(c.vignette, t.vignette, k);
    c.shadowAlpha = lerp(c.shadowAlpha, t.shadowAlpha, k);
  }

  drawBackground(ctx, engine, cur) {
    const w = this.w, h = this.h;
    ctx.fillStyle = rgbCss(cur.bg);
    ctx.fillRect(0, 0, w, h);

    // Delicate atmospheric studio/arena lighting around the simulation center
    const outerR = engine.outermostRing ? engine.outermostRing.R : Math.min(w, h) * 0.35;
    if (cur.ambientAlpha > 0.02) {
      const ambX = this.themeName === 'clean' ? engine.cx - outerR * 0.18 : engine.cx;
      const ambY = this.themeName === 'clean' ? engine.cy - outerR * 0.22 : engine.cy;
      const ambR = Math.max(160, outerR * 1.75);
      const ag = ctx.createRadialGradient(ambX, ambY, 0, engine.cx, engine.cy, ambR);
      ag.addColorStop(0, rgbaCss(cur.ambient, cur.ambientAlpha));
      ag.addColorStop(1, rgbaCss(cur.ambient, 0));
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, w, h);
    }

    // Subtle edge vignette
    if (cur.vignette > 0.015) {
      const cx = w * 0.5, cy = h * 0.5;
      const rad = Math.hypot(w, h) * 0.52;
      const vg = ctx.createRadialGradient(cx, cy, rad * 0.38, cx, cy, rad);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,' + cur.vignette.toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawRings(ctx, engine, cur, effQuality, outerResonance) {
    const cfg = engine.cfg;
    const t = engine.effWallThickness || cfg.scene.wallThickness;
    const hw = t * 0.5;
    const glowMult = cfg.appearance.glowIntensity;
    const isNeon = this.themeName === 'neon';
    const isClean = this.themeName === 'clean';
    const isMinimal = this.themeName === 'minimal';

    const ringCss = rgbCss(cur.ring);
    const rimCss = rgbCss(cur.ringRim);
    const innerCss = rgbCss(cur.ringInner);

    for (let idx = 0; idx < engine.rings.length; idx++) {
      const ring = engine.rings[idx];
      if (ring.broken) continue;
      const hc = ring.baseAngle + ring.rot;
      const arcHalf = ring.arcHoleHalf !== undefined ? ring.arcHoleHalf : ring.holeHalf;
      const start = hc + arcHalf;
      const end = hc - arcHalf + Math.PI * 2;
      const resonance = ring.isOutermost ? outerResonance : 0;

      ctx.lineCap = 'round';

      // 1. Clean theme: soft physical drop shadow beneath the wall
      if (cur.shadowAlpha > 0.01 && effQuality >= 0.45) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(engine.cx + 2, engine.cy + 4.5, ring.R, start, end);
        ctx.lineWidth = t + 1;
        ctx.strokeStyle = 'rgba(20, 22, 30, ' + (cur.shadowAlpha * 0.85).toFixed(3) + ')';
        if (effQuality >= 0.65) {
          ctx.shadowColor = 'rgba(18, 20, 28, ' + cur.shadowAlpha.toFixed(3) + ')';
          ctx.shadowBlur = 11;
        }
        ctx.stroke();
        ctx.restore();
      }

      // 2. Neon / Minimal outer bloom layers
      const glowStrength = (cur.ringGlow + resonance * 12) * (0.35 + glowMult * 0.85);
      if (glowStrength > 1.0) {
        if (isNeon) {
          // Layered neon aura: wide soft outer halo + tighter inner glow
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R, start, end);
          ctx.lineWidth = t + 14 * Math.min(1.2, 0.5 + glowMult * 0.6);
          ctx.strokeStyle = rgbaCss(cur.ring, (0.11 + resonance * 0.09) * Math.min(1.2, glowMult + 0.2));
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R, start, end);
          ctx.lineWidth = t + 5;
          ctx.strokeStyle = rgbaCss(cur.ring, 0.24 + resonance * 0.12);
          if (effQuality >= 0.6) {
            ctx.shadowColor = ringCss;
            ctx.shadowBlur = glowStrength;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else if (effQuality >= 0.6) {
          // Minimal Dark: understated crisp halo
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R, start, end);
          ctx.lineWidth = t + 3;
          ctx.strokeStyle = rgbaCss(cur.ring, 0.08 + resonance * 0.12);
          ctx.stroke();
        }
      }

      // 3. Main Capsule-Arc wall body
      ctx.beginPath();
      ctx.arc(engine.cx, engine.cy, ring.R, start, end);
      ctx.lineWidth = t;
      ctx.strokeStyle = resonance > 0.02
        ? rgbCss(lerpRgb(cur.ring, cur.ringRim, resonance * 0.45))
        : ringCss;
      ctx.stroke();

      // 4. Wall thickness definition: inner/outer bevels & core spine
      if (t >= 7) {
        ctx.lineCap = 'butt';
        const trimStart = start + Math.min(0.06, hw / ring.R * 0.4);
        const trimEnd = end - Math.min(0.06, hw / ring.R * 0.4);

        if (isNeon) {
          // Luminous plasma core spine along the ring centerline
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R, start, end);
          ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(1.8, t * 0.24);
          ctx.strokeStyle = rgbaCss(cur.ringRim, 0.86);
          ctx.stroke();
        } else if (isClean) {
          // Machined matte bevel + crisp dark architectural contours
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R - t * 0.16, trimStart, trimEnd);
          ctx.lineWidth = Math.max(1, t * 0.22);
          ctx.strokeStyle = rgbaCss(cur.ringRim, 0.45);
          ctx.stroke();

          ctx.lineWidth = 1.15;
          ctx.strokeStyle = innerCss;
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R - hw + 0.5, trimStart, trimEnd);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R + hw - 0.5, trimStart, trimEnd);
          ctx.stroke();
        } else if (isMinimal) {
          // Minimal Dark: subtle inner depth bevel + crisp outer specular glint
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgbaCss(cur.ringInner, 0.42);
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R - hw + 0.6, trimStart, trimEnd);
          ctx.stroke();

          ctx.strokeStyle = rgbaCss(cur.ringRim, 0.55);
          ctx.beginPath();
          ctx.arc(engine.cx, engine.cy, ring.R + hw - 0.6, trimStart, trimEnd);
          ctx.stroke();
        }
      }

      // 5. Distinct opening lip accents at E1 and E2 so holes read clearly at a glance
      //    while keeping the gap itself 100% unobstructed open space.
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const capAng = hc + sgn * arcHalf;
        const ex = engine.cx + Math.cos(capAng) * ring.R;
        const ey = engine.cy + Math.sin(capAng) * ring.R;
        const faceAng = capAng - sgn * (Math.PI * 0.5);

        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(2, hw - 0.5), faceAng - 1.3, faceAng + 1.3);
        ctx.lineCap = 'round';
        ctx.lineWidth = isNeon ? 2.1 : 1.6;
        ctx.strokeStyle = isClean ? innerCss : rimCss;
        ctx.globalAlpha = isNeon ? 0.96 : isClean ? 0.88 : 0.92;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* Seamless tapered polygon ribbon trail — zero per-segment alpha banding */
  drawBallTrail(ctx, ball, ix, iy, simNow, maxAge, cur, col, fade, effQuality) {
    const pts = ball.trail;
    if (!pts || pts.length === 0 || maxAge <= 0.001 || cur.trail <= 0.01) return;

    const isNeon = this.themeName === 'neon';
    const stride = effQuality < 0.5 && pts.length > 14 ? 2 : 1;

    // Collect active spine nodes from head (u=0) toward tail (u->1)
    const nodes = [{ x: ix, y: iy, u: 0 }];
    for (let i = pts.length - 1; i >= 0; i -= stride) {
      const p = pts[i];
      const age = Math.max(0, simNow - p.t);
      const u = Math.min(1, age / maxAge);
      if (u >= 1) break;
      const prev = nodes[nodes.length - 1];
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      if (dx * dx + dy * dy < 0.6) continue;
      nodes.push({ x: p.x, y: p.y, u });
    }

    if (nodes.length < 2) return;

    const tail = nodes[nodes.length - 1];
    const spanDx = tail.x - ix;
    const spanDy = tail.y - iy;
    if (spanDx * spanDx + spanDy * spanDy < 1.5) return;

    const buildRibbon = (widthScale) => {
      const leftX = [], leftY = [], rightX = [], rightY = [];
      const last = nodes.length - 1;
      for (let i = 0; i <= last; i++) {
        const curN = nodes[i];
        const prevN = nodes[Math.max(0, i - 1)];
        const nextN = nodes[Math.min(last, i + 1)];
        let tx = nextN.x - prevN.x;
        let ty = nextN.y - prevN.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const nx = -ty;
        const ny = tx;

        // Pinch width slightly on sharp bounce hairpins so ribbons stay graceful
        let cornerScale = 1;
        if (i > 0 && i < last) {
          const ax = curN.x - prevN.x, ay = curN.y - prevN.y;
          const bx = nextN.x - curN.x, by = nextN.y - curN.y;
          const la = Math.hypot(ax, ay) || 1;
          const lb = Math.hypot(bx, by) || 1;
          const cos = (ax * bx + ay * by) / (la * lb);
          cornerScale = 0.55 + 0.45 * Math.max(0, cos);
        }

        const taper = i === last ? 0 : Math.pow(1 - curN.u, 1.55);
        const w = ball.r * 0.74 * taper * widthScale * cornerScale;
        leftX.push(curN.x + nx * w);
        leftY.push(curN.y + ny * w);
        rightX.push(curN.x - nx * w);
        rightY.push(curN.y - ny * w);
      }

      ctx.beginPath();
      ctx.moveTo(leftX[0], leftY[0]);
      for (let i = 1; i < leftX.length - 1; i++) {
        const mx = (leftX[i] + leftX[i + 1]) * 0.5;
        const my = (leftY[i] + leftY[i + 1]) * 0.5;
        ctx.quadraticCurveTo(leftX[i], leftY[i], mx, my);
      }
      ctx.lineTo(leftX[last], leftY[last]);
      for (let i = last - 1; i >= 1; i--) {
        const mx = (rightX[i] + rightX[i - 1]) * 0.5;
        const my = (rightY[i] + rightY[i - 1]) * 0.5;
        ctx.quadraticCurveTo(rightX[i], rightY[i], mx, my);
      }
      ctx.lineTo(rightX[0], rightY[0]);
      ctx.closePath();
    };

    if (ctx.createLinearGradient) {
      if (isNeon && effQuality >= 0.55) {
        const outerGrad = ctx.createLinearGradient(ix, iy, tail.x, tail.y);
        outerGrad.addColorStop(0, rgbaCss(col.rgb, cur.trail * 0.24 * fade));
        outerGrad.addColorStop(1, rgbaCss(col.rgb, 0));
        buildRibbon(1.55);
        ctx.fillStyle = outerGrad;
        ctx.fill();
      }

      const headRgb = isNeon ? shade(col.rgb, 0.24) : col.rgb;
      const coreAlpha = cur.trail * (isNeon ? 0.58 : 0.38) * fade;
      const grad = ctx.createLinearGradient(ix, iy, tail.x, tail.y);
      grad.addColorStop(0, rgbaCss(headRgb, coreAlpha));
      grad.addColorStop(0.55, rgbaCss(col.rgb, coreAlpha * 0.42));
      grad.addColorStop(1, rgbaCss(col.rgb, 0));
      buildRibbon(1.0);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      ctx.globalAlpha = cur.trail * 0.32 * fade;
      buildRibbon(1.0);
      ctx.fillStyle = col.css;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawBall(ctx, ball, ix, iy, fade, cfg, cur, col, effQuality) {
    const r = ball.r;
    const isNeon = this.themeName === 'neon';
    const isClean = this.themeName === 'clean';

    // 1. Clean Physics: soft directional drop shadow
    if (cur.shadowAlpha > 0.01) {
      const sr = r * 1.08;
      const sx = ix + r * 0.2;
      const sy = iy + r * 0.3;
      if (effQuality >= 0.5) {
        const sg = ctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, sr * 1.35);
        sg.addColorStop(0, 'rgba(20, 22, 30, ' + (cur.shadowAlpha * 1.25 * fade).toFixed(3) + ')');
        sg.addColorStop(1, 'rgba(20, 22, 30, 0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 1.35, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = cur.shadowAlpha * fade;
        ctx.fillStyle = '#14161e';
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 2. Fast radial-gradient glow halo (avoids costly per-ball Gaussian shadowBlur)
    const glowAmt = cur.ballGlow * cfg.balls.glow * cfg.appearance.glowIntensity;
    if (glowAmt > 0.6) {
      const haloR = r * (1.35 + Math.min(2.2, glowAmt / 15));
      const haloAlpha = Math.min(0.62, (isNeon ? 0.44 : 0.22) * (glowAmt / 16)) * fade;
      if (haloAlpha > 0.015) {
        const hg = ctx.createRadialGradient(ix, iy, r * 0.55, ix, iy, haloR);
        hg.addColorStop(0, rgbaCss(col.rgb, haloAlpha));
        hg.addColorStop(0.55, rgbaCss(col.rgb, haloAlpha * 0.32));
        hg.addColorStop(1, rgbaCss(col.rgb, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(ix, iy, haloR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. Volumetric 3D sphere shading
    ctx.globalAlpha = fade;
    const gx = ix - r * 0.34;
    const gy = iy - r * 0.36;
    const g = ctx.createRadialGradient(gx, gy, r * 0.06, ix, iy, r);
    if (isNeon) {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.24, col.spec);
      g.addColorStop(0.66, col.css);
      g.addColorStop(1, col.dark);
    } else if (isClean) {
      g.addColorStop(0, col.spec);
      g.addColorStop(0.45, col.css);
      g.addColorStop(0.86, col.dark);
      g.addColorStop(1, col.deep);
    } else {
      // Minimal Dark: sleek satin sphere
      g.addColorStop(0, col.spec);
      g.addColorStop(0.38, col.light);
      g.addColorStop(0.75, col.css);
      g.addColorStop(1, col.deep);
    }

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ix, iy, r, 0, Math.PI * 2);
    ctx.fill();

    // 4. Crisp specular glint & contour details
    if (r >= 6 && effQuality >= 0.45) {
      ctx.fillStyle = isNeon ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.42)';
      ctx.beginPath();
      ctx.arc(ix - r * 0.33, iy - r * 0.35, Math.max(1.1, r * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    if (isClean) {
      ctx.strokeStyle = 'rgba(23, 25, 30, 0.55)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(ix, iy, r - 0.4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (!isNeon && r >= 8) {
      // Subtle rim highlight on Minimal Dark
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.arc(ix, iy, r - 0.4, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  draw(engine, alpha, dt, paused, effects) {
    const ctx = this.ctx;
    const cfg = engine.cfg;
    const effQuality = this.updateQuality(dt, engine.balls.length);

    this.interpolateTheme(dt);
    const cur = this.cur;

    this.drawBackground(ctx, engine, cur);

    const outerResonance = effects ? effects.outerResonance : 0;
    this.drawRings(ctx, engine, cur, effQuality, outerResonance);

    const maxAge = engine.maxTrailDuration ? engine.maxTrailDuration() : 0;
    const stepDt = typeof FIXED_DT !== 'undefined' ? FIXED_DT : 1 / 240;
    const simNow = engine.time + (paused ? 0 : alpha * stepDt);

    // Draw trails first so balls sit cleanly above overlapping trails
    if (maxAge > 0.001 && cur.trail > 0.01) {
      for (let i = 0; i < engine.balls.length; i++) {
        const ball = engine.balls[i];
        const fade = this.ballFade(ball, engine);
        if (fade <= 0.01) continue;
        const ix = ball.px + (ball.x - ball.px) * alpha;
        const iy = ball.py + (ball.y - ball.py) * alpha;
        const col = this.ballColor(ball, cfg);
        this.drawBallTrail(ctx, ball, ix, iy, simNow, maxAge, cur, col, fade, effQuality);
      }
    }

    // Draw volumetric balls
    for (let i = 0; i < engine.balls.length; i++) {
      const ball = engine.balls[i];
      const fade = this.ballFade(ball, engine);
      if (fade <= 0.01) continue;
      const ix = ball.px + (ball.x - ball.px) * alpha;
      const iy = ball.py + (ball.y - ball.py) * alpha;
      const col = this.ballColor(ball, cfg);
      this.drawBall(ctx, ball, ix, iy, fade, cfg, cur, col, effQuality);
    }

    if (effects && cfg.appearance.effectsEnabled) {
      effects.draw(ctx, cur, this.themeName, effQuality);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Renderer };
}
