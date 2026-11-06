// OVERDRAFT — renderer. Canvas2D, no assets, no dependencies.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
import { W, H, MAX_PULSE, OVERDRAFT_FLOOR, ENEMY_TYPES, SIEGE_WEAPONS, SIEGE_WEAPON_MAX, SPAWN_FADE, overdraftFloor } from './sim.js';
import { drawCard } from './share.js';
import { pickLayout, clock as fmtClock, PULSE_REFILL_SECONDS } from './layout.js';

const TAU = Math.PI * 2;
const glowCache = new Map();

function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, hexA(color, 0.55));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glowCache.set(color, cv);
  return cv;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.t = 0;
    this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    try { this.bestScore = +(localStorage.getItem('overdraft_best') || 0) || 0; } catch { this.bestScore = 0; }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Measure the REAL element, not the window. The canvas has max-width/max-height
    // constraints, so on a phone in landscape (where browser chrome eats vertical
    // space) window.innerHeight and the canvas box disagree — that mismatch is what
    // pushed the A button off the bottom of the screen.
    const rect = (this.canvas.parentElement && this.canvas.parentElement.getBoundingClientRect)
      ? this.canvas.parentElement.getBoundingClientRect()
      : null;
    const cw = Math.max(1, Math.floor(rect && rect.width ? rect.width : window.innerWidth));
    const ch = Math.max(1, Math.floor(rect && rect.height ? rect.height : window.innerHeight));
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.dpr = dpr;
    // On phones the world IS the screen: fill it edge to edge, no letterbox.
    // On desktop keep a wide arena and letterbox vertically.
    const coarse = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : ('ontouchstart' in window);
    this.mobile = coarse || cw < 720;
    this.portrait = ch > cw;          // drives the (non-blocking) rotate hint
    // safe-area insets (notch, rounded corners, home bar). Read once per resize;
    // the CSS env() values are exposed on the stage element as custom props.
    this.safe = this.readSafeInsets();
    this.rotateHintDismissed = this.rotateHintDismissed || false;
    const ww = cw, wh = ch;   // world units == CSS pixels (dpr only affects the backing store)
    if (this.mobile) {
      // PHONES RESERVE A HUD BAND AT THE TOP.
      //
      // The arena used to be the whole screen and the HUD was drawn on top of it:
      // in landscape that put SCORE in the top-left corner and the countdown across
      // the top-middle, both directly over the area enemies walk into. The player
      // was fighting underneath their own readouts, and on a 390px-tall screen the
      // top ~54px was unusable anyway because that is where the clock sat.
      //
      // Now the arena starts BELOW that band. The HUD lives in the strip above it,
      // like a proper game frame, and nothing is drawn over the playfield. The
      // arena loses a little height and gains a clean rectangle to defend.
      this.hudH = Math.round(clamp(wh * 0.135, 40, 62));
      this.worldW = ww;
      this.worldH = Math.max(120, wh - this.hudH);
      this.scale = 1;
      this.ox = 0;
      this.oy = this.hudH;
    } else {
      // Desktop: keep a 16:9 arena but let it grow to fill a big monitor
      // instead of sitting as a small box in the middle of the screen.
      this.scale = Math.min(ww / W, wh / H);
      this.worldW = W; this.worldH = H;
      this.ox = (ww - W * this.scale) / 2;
      this.oy = (wh - H * this.scale) / 2;
      this.hudH = 0;
      this.hudLeft = this.ox;          // HUD anchors to the arena edge
      this.hudRight = this.ox + W * this.scale;
      this.hudTop = this.oy;
      this.hudBottom = this.oy + H * this.scale;
    }
  }

  // The surface the HUD lays itself out on: the window on desktop, the arena on phones.
  get uiW() { return this.mobile ? this.worldW : this.canvas.width / this.dpr; }
  get uiH() { return this.mobile ? this.worldH : this.canvas.height / this.dpr; }

  // page/client coords (CSS px) -> world coords
  toWorld(sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  // page/client coords -> the surface the HUD uses (window px on desktop).
  // `space` lets a caller pin the conversion to the space a screen was DRAWN in.
  // Without it, a touch that flips renderer.mobile mid-handler makes the hit test
  // read in a different coordinate system than the thing it is testing.
  toUI(sx, sy, space) {
    const useWorld = space ? space === 'world' : this.mobile;
    if (useWorld) return this.toWorld(sx, sy);
    return { x: sx, y: sy };
  }

  draw(s, mouse, dt) {
    const c = this.ctx;
    this.t += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#04050a';
    c.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    // Trauma shake: amplitude scales with trauma^2 so small hits are felt and big
    // hits are violent, and it uses smooth noise rather than white noise so it
    // reads as a camera kick instead of a stutter.
    const shake = s.shake;
    const trauma = Math.min(1, shake / 24);
    const amp = shake * trauma;
    const n1 = Math.sin(this.t * 61.3) * Math.sin(this.t * 23.7);
    const n2 = Math.sin(this.t * 54.1 + 1.7) * Math.sin(this.t * 19.3 + 0.5);
    const sx = n1 * amp;
    const sy = n2 * amp;

    c.save();
    c.translate(this.ox + sx, this.oy + sy);
    c.scale(this.scale, this.scale);
    c.beginPath();
    c.rect(0, 0, this.worldW, this.worldH);
    c.clip();

    this.drawArena(s);
    if (s.mode === 'title') {
      this.drawTitleBg(s);
    } else {
      this.drawEntities(s);
      this.drawParticles(s);
      this.drawAttractTag(s);
    }
    c.restore();

    // HUD: phones draw in world space (world == screen), desktop draws in CSS
    // pixels so text stays crisp and the chrome hugs the real window edges.
    c.save();
    if (this.mobile) {
      c.translate(this.ox, this.oy);
      c.scale(this.scale, this.scale);
    }
    if (s.mode !== 'title') this.drawHUD(s);
    if (s.mode === 'title') {
      this.drawTitle(s);
      this.drawRotateHint();
    }
    if (s.mode === 'pick') this.drawPick(s);
    if (s.mode === 'play' && s.levelState === 'teach') this.drawTeach(s);
    if (s.mode === 'play' && (s.levelState === 'clear' || s.levelState === 'fail')) {
      this.drawLevelCard(s, s.levelState);
    }
    if (s.mode === 'dead') this.drawDead(s);
    c.restore();

    // ---- post pass: scanlines + phosphor edge glow + film grain ----
    // The research says retro reads as deliberate style, but only if it stays
    // legible: lines stay at 2px apart with 8% opacity, and the whole pass is
    // skipped for reduced-motion players and throttled on phones.
    if (!this.reduceMotion) {
      const cw = this.canvas.width / this.dpr, ch = this.canvas.height / this.dpr;
      // scanlines: one dark line every 3 CSS px, scaled by device pixel ratio
      const step = this.mobile ? 3 : 3;
      c.save();
      c.globalAlpha = 0.10;
      c.fillStyle = '#000';
      c.beginPath();
      for (let y = 0; y < ch; y += step) c.rect(0, y, cw, 1);
      c.fill();
      c.restore();

      // phosphor vignette: the edges of a CRT are dimmer than the middle
      const g = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.34,
                                       cw / 2, ch / 2, Math.max(cw, ch) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = g;
      c.fillRect(0, 0, cw, ch);

      // coloured edge fringe (chromatic aberration, done cheaply at the borders)
      if (!this.mobile) {
        c.save();
        c.globalAlpha = 0.05;
        c.fillStyle = '#ff2a6d';
        c.fillRect(0, 0, 3, ch);
        c.fillStyle = '#05d9e8';
        c.fillRect(cw - 3, 0, 3, ch);
        c.restore();
      }

      // sparse grain: sells 'this is a screen', not 'this is a CSS gradient'
      c.save();
      c.globalAlpha = 0.035;
      c.fillStyle = '#9fd8ff';
      const n = this.mobile ? 26 : 60;
      for (let i = 0; i < n; i++) {
        const gx = (Math.random() * cw) | 0, gy = (Math.random() * ch) | 0;
        c.fillRect(gx, gy, 1, 1);
      }
      c.restore();
    }

    // full-screen colour flashes
    if (s.flashRed > 0.01) {
      c.fillStyle = `rgba(255,20,60,${s.flashRed * 0.20})`;
      c.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    }
    const over = s.mode !== 'title' && s.player.hp <= 0;
    if (over) {
      const pulse = 0.10 + Math.sin(this.t * 6) * 0.05;
      const g = c.createRadialGradient(
        this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2, 40,
        this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2,
        this.canvas.width / this.dpr * 0.75,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(255,0,50,${pulse})`);
      c.fillStyle = g;
      c.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    }
  }

  drawArena(s) {
    const c = this.ctx;
    const W = this.worldW, H = this.worldH;
    // deep background
    const g = c.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, '#0b1222');
    g.addColorStop(0.6, '#070a13');
    g.addColorStop(1, '#04050a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // grid
    const cell = 64;
    const off = (this.t * 10) % cell;
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(90,180,255,0.055)';
    c.beginPath();
    for (let x = -off; x < W + cell; x += cell) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = -off; y < H + cell; y += cell) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();

    // arena boundary
    c.strokeStyle = s.player.hp <= 0 ? 'rgba(255,60,90,0.35)' : 'rgba(110,245,255,0.22)';
    c.lineWidth = 2;
    c.strokeRect(14, 14, W - 28, H - 28);

    // corner brackets
    c.strokeStyle = s.player.hp <= 0 ? 'rgba(255,80,110,0.8)' : 'rgba(110,245,255,0.55)';
    c.lineWidth = 3;
    const L = 26, P = 14;
    const corners = [[P, P, 1, 1], [W - P, P, -1, 1], [P, H - P, 1, -1], [W - P, H - P, -1, -1]];
    for (const [x, y, dx, dy] of corners) {
      c.beginPath();
      c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L);
      c.stroke();
    }
  }

  drawTitleBg(s) {
    const c = this.ctx;
    const W = this.worldW, H = this.worldH;
    // slow drifting verticals + a horizon glow
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = ((this.t * (18 + i * 9) + i * 260) % (W + 400)) - 200;
      const grd = c.createLinearGradient(x, 0, x, H);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, i % 2 ? 'rgba(110,245,255,0.05)' : 'rgba(255,60,120,0.05)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(x, 0, 120 + i * 40, H);
    }
    // fake enemies drifting for texture
    for (let i = 0; i < 7; i++) {
      const a = this.t * 0.25 + i * 1.1;
      const rr = 250 + i * 46;
      const x = W / 2 + Math.cos(a) * rr * 1.5;
      const y = H / 2 + Math.sin(a * 0.8) * rr * 0.6;
      const col = i % 2 ? '#ff5f6d' : '#6ff5ff';
      c.globalAlpha = 0.22;
      c.drawImage(glowSprite(col), x - 40, y - 40, 80, 80);
      c.globalAlpha = 1;
    }
    c.restore();
  }

  drawEntities(s) {
    const c = this.ctx;
    const p = s.player;

    // player trail
    if (Math.hypot(p.vx, p.vy) > 80) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      const len = Math.min(70, Math.hypot(p.vx, p.vy) * 0.07);
      const a = Math.atan2(p.vy, p.vx);
      const grd = c.createLinearGradient(p.x, p.y, p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
      grd.addColorStop(0, 'rgba(110,245,255,0.35)');
      grd.addColorStop(1, 'rgba(110,245,255,0)');
      c.strokeStyle = grd;
      c.lineWidth = 8;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len); c.stroke();
      c.restore();
    }

    // enemies
    for (const e of s.enemies) {
      const fade = e.spawnT > 0 ? 1 - e.spawnT / SPAWN_FADE : 1;
      c.save();
      c.globalAlpha = 0.35 + fade * 0.65;
      c.translate(e.x, e.y);
      c.rotate(this.angleOf(e));
      const col = e.hitFlash > 0.3 ? '#ffffff' : e.color;
      c.strokeStyle = col;
      c.fillStyle = hexA(col, 0.13);
      c.lineWidth = 2.5;
      c.lineJoin = 'round';
      const r = e.r;
      if (e.type === 'scrapper') {
        c.beginPath();
        c.moveTo(r, 0); c.lineTo(-r * 0.8, r * 0.8); c.lineTo(-r * 0.45, 0); c.lineTo(-r * 0.8, -r * 0.8);
        c.closePath(); c.fill(); c.stroke();
      } else if (e.type === 'drifter') {
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const R = i % 2 ? r * 0.72 : r;
          i ? c.lineTo(Math.cos(a) * R, Math.sin(a) * R) : c.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        }
        c.closePath(); c.fill(); c.stroke();
      } else if (e.type === 'lancer') {
        c.beginPath();
        c.moveTo(r, 0); c.lineTo(0, r * 0.7); c.lineTo(-r, 0); c.lineTo(0, -r * 0.7);
        c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.arc(0, 0, r * 0.28, 0, TAU); c.fillStyle = col; c.fill();
      } else {
        c.rotate(this.t * 0.6);
        c.beginPath(); c.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4); c.fill(); c.stroke();
        c.beginPath(); c.arc(0, 0, r * 0.42, 0, TAU); c.stroke();
        c.beginPath(); c.arc(0, 0, r, 0.4, 1.2); c.stroke();
        c.beginPath(); c.arc(0, 0, r, 3.5, 4.3); c.stroke();
      }
      c.restore();

      // hp pips for multi-hp enemies
      if (e.hp > 1) {
        c.save();
        c.translate(e.x, e.y);
        c.fillStyle = 'rgba(255,255,255,0.85)';
        const n = Math.ceil(e.hp), wpi = 4;
        for (let i = 0; i < n; i++) c.fillRect(-(n * wpi) / 2 + i * wpi, e.r + 6, 2.5, 2.5);
        c.restore();
      }
    }

    // wall impact marks left by ricochets (permanence: the arena remembers your misses)
    c.save();
    for (const m of s.wallMarks || []) {
      c.globalAlpha = Math.max(0, m.life / 2.5) * 0.5;
      c.strokeStyle = '#ff3b5c';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(m.x, m.y, 5 + (1 - m.life / 2.5) * 9, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();

    // enemy bullets
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const b of s.bullets) {
      if (b.friendly) continue;
      c.drawImage(glowSprite('#ff2d55'), b.x - 26, b.y - 26, 52, 52);
      c.fillStyle = '#ffe1e7';
      c.beginPath(); c.arc(b.x, b.y, 4.5, 0, TAU); c.fill();
    }
    c.restore();

    // muzzle flash: a brief bloom at the barrel sells the shot costing something
    if (s.time - p.lastShot < 0.07) {
      const k = 1 - (s.time - p.lastShot) / 0.07;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = k * 0.9;
      const col = p.hp <= 0 ? '#ff3b5c' : '#bffcff';
      c.drawImage(glowSprite(col), p.x + Math.cos(p.aim) * 24 - 34, p.y + Math.sin(p.aim) * 24 - 34, 68, 68);
      c.restore();
    }

    // player bullets with trails
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const b of s.bullets) {
      if (!b.friendly) continue;
      const col = b.over ? '#ff3b5c' : '#6ff5ff';
      if (b.trail) {
        for (let i = 0; i < b.trail.length; i++) {
          const t = b.trail[i];
          const a = (i / b.trail.length) * 0.5;
          c.globalAlpha = a;
          c.drawImage(glowSprite(col), t.x - 11, t.y - 11, 22, 22);
        }
        c.globalAlpha = 1;
      }
      c.drawImage(glowSprite(col), b.x - 20, b.y - 20, 40, 40);
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(b.x, b.y, 3.4, 0, TAU); c.fill();
    }
    c.restore();

    // player
    this.drawPlayer(s);
  }

  angleOf(e) {
    const p = { x: 0, y: 0 };
    const a = Math.atan2(e.vy, e.vx);
    return Number.isFinite(a) ? a : 0;
  }

  drawPlayer(s) {
    const c = this.ctx;
    const p = s.player;
    const over = p.hp <= 0;
    const main = over ? '#ff3b5c' : '#6ff5ff';

    // heartbeat ring when in overdraft
    if (over) {
      const beat = (Math.sin(this.t * 5.4) + 1) / 2;
      c.save();
      c.globalAlpha = 0.35 + beat * 0.3;
      c.strokeStyle = 'rgba(255,60,90,0.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, 30 + beat * 16, 0, TAU);
      c.stroke();
      c.restore();
    }

    c.save();
    c.translate(p.x, p.y);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = p.invuln > 0 && Math.floor(this.t * 20) % 2 ? 0.45 : 0.9;
    c.drawImage(glowSprite(main), -46, -46, 92, 92);
    c.restore();

    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.aim);
    const flick = p.hitFlash > 0 ? '#ffffff' : main;
    c.strokeStyle = flick;
    c.fillStyle = hexA(flick, 0.18);
    c.lineWidth = 2.6;
    c.lineJoin = 'round';
    // arrowhead hull
    c.beginPath();
    c.moveTo(18, 0); c.lineTo(-11, 12); c.lineTo(-5, 0); c.lineTo(-11, -12);
    c.closePath(); c.fill(); c.stroke();
    // muzzle
    c.beginPath(); c.moveTo(18, 0); c.lineTo(26, 0); c.stroke();
    // core
    c.beginPath(); c.arc(-2, 0, 3.2, 0, TAU); c.fillStyle = flick; c.fill();
    c.restore();

    // aim laser (fades fast when you fire — sells the cost)
    const sinceShot = s.time - p.lastShot;
    const laserA = Math.max(0, 1 - sinceShot * 2.4) * 0.5;
    if (laserA > 0.01) {
      c.save();
      c.globalAlpha = laserA;
      c.strokeStyle = hexA(main, 0.6);
      c.lineWidth = 1;
      c.setLineDash([6, 10]);
      c.beginPath();
      c.moveTo(p.x + Math.cos(p.aim) * 26, p.y + Math.sin(p.aim) * 26);
      c.lineTo(p.x + Math.cos(p.aim) * 900, p.y + Math.sin(p.aim) * 900);
      c.stroke();
      c.restore();
    }
  }

  drawParticles(s) {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const q of s.particles) {
      const a = Math.max(0, q.life / q.max);
      c.globalAlpha = a;
      c.fillStyle = q.color;
      c.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    c.restore();

    c.save();
    c.font = '700 16px ui-monospace, Menlo, monospace';
    c.textAlign = 'center';
    for (const f of s.floaters) {
      c.globalAlpha = Math.min(1, f.life / 0.4);
      c.font = `700 ${f.size}px ui-monospace, Menlo, monospace`;
      c.fillStyle = f.color;
      c.shadowColor = f.color;
      c.shadowBlur = 12;
      c.fillText(f.text, f.x, f.y);
    }
    c.restore();
  }

  // Honest label whenever the attract-mode bot is driving.
  drawAttractTag(s) {
    if (!s.hermes) return;
    const c = this.ctx;
    c.save();
    c.font = '700 11px ui-monospace, Menlo, monospace';
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,209,102,0.9)';
    c.fillText('ATTRACT MODE', 34, 112);
    c.fillStyle = 'rgba(255,209,102,0.45)';
    c.fillText('bot is playing — click to take over', 34, 128);
    c.restore();
  }

  drawHUD(s) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const p = s.player;
    const over = p.hp <= 0;
    // phones: respect the notch/home bar and shrink the chrome
    const mob = this.mobile;
    const topPad = mob ? 54 : 0;
    const botPad = mob ? 26 : 0;
    const uiK = mob ? 0.72 : 1;
    // desktop: sit just inside the arena box; phone: inside the screen safely
    const padL = mob ? 0 : this.ox;
    const padR = mob ? 0 : (this.uiW - this.ox - W * this.scale) * 0 + (this.uiW - (this.ox + W * this.scale));

    // ---- THE HUD BAND ----------------------------------------------------
    // On a phone everything lives in the reserved strip above the arena (see
    // resize(): this.hudH), so nothing is drawn over the playfield. Desktop keeps
    // its in-arena corners, because its arena is letterboxed and those corners sit
    // outside the fight anyway.
    //
    //   LEFT   SCORE stacked over the PULSE bar -- the two numbers you watch
    //          constantly, together, at the same edge
    //   RIGHT  the goal: LEVEL + quota, or WAVE + remaining
    //   CENTRE the countdown, as a thin bar rather than a block
    const band = this.hudH || 0;
    // drawHUD runs in arena space on a phone, so the reserved strip above the
    // arena is at negative y.
    const bandTop = -band;

    c.save();
    c.textAlign = 'left';
    if (mob) {
      c.font = '700 9px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText('SCORE', 14, bandTop + band * 0.30);
      c.font = '800 17px ui-monospace, Menlo, monospace';
      c.fillStyle = '#dff6ff';
      c.shadowColor = 'rgba(110,245,255,0.5)';
      c.shadowBlur = 10;
      c.fillText(String(s.score).padStart(6, '0'), 12, bandTop + band * 0.30 + 18);
    } else {
      c.font = '700 13px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText('SCORE', 24 + padL, 26 + topPad);
      c.font = `700 ${Math.round(30 * uiK)}px ui-monospace, Menlo, monospace`;
      c.fillStyle = '#dff6ff';
      c.shadowColor = 'rgba(110,245,255,0.5)';
      c.shadowBlur = 14;
      c.fillText(String(s.score).padStart(6, '0'), 22 + padL, 22 + topPad + 30 * uiK);
    }
    c.restore();

    // the PULSE bar: inside the band on a phone, above the controls on desktop
    this.drawPulseBar(s, mob ? { mob: true, inBand: true, bandTop } : { mob: false });

    const LV = s._lv || { quota: 1, time: 1 };

    if (s.siege) {
      this.drawSiegeHUD(s, { mob, topPad: mob ? 0 : topPad, uiK, padR, band, bandTop });
    } else {
      c.save();
      c.textAlign = 'right';
      if (mob) {
        c.font = '700 9px ui-monospace, Menlo, monospace';
        c.fillStyle = 'rgba(160,190,215,0.55)';
        c.fillText('LEVEL', W - 14, bandTop + band * 0.30);
        c.font = '800 17px ui-monospace, Menlo, monospace';
        c.fillStyle = over ? '#ff5f6d' : '#dff6ff';
        c.fillText(String(s.level).padStart(2, '0'), W - 12, bandTop + band * 0.30 + 18);
        const quotaFree = !(LV.quota > 0);
        const q = quotaFree ? s.levelKills : Math.min(LV.quota, s.levelKills);
        c.font = '700 10px ui-monospace, Menlo, monospace';
        c.fillStyle = (!quotaFree && q >= LV.quota) ? '#7dffb2' : 'rgba(255,209,102,0.95)';
        c.fillText(quotaFree ? `${q} KILLS` : `${q}/${LV.quota}`, W - 12, bandTop + band * 0.30 + 33);
      } else {
        c.font = '700 12px ui-monospace, Menlo, monospace';
        c.fillStyle = 'rgba(160,190,215,0.55)';
        c.fillText('LEVEL', W - 24 - padR, 24 + topPad);
        c.font = `700 ${Math.round(28 * uiK)}px ui-monospace, Menlo, monospace`;
        c.fillStyle = over ? '#ff5f6d' : '#dff6ff';
        c.fillText(String(s.level).padStart(2, '0'), W - 22 - padR, 20 + topPad + 28 * uiK);
        const quotaFree = !(LV.quota > 0);
        const q = quotaFree ? s.levelKills : Math.min(LV.quota, s.levelKills);
        c.font = '700 12px ui-monospace, Menlo, monospace';
        c.fillStyle = (!quotaFree && q >= LV.quota) ? '#7dffb2' : 'rgba(255,209,102,0.95)';
        c.fillText(quotaFree ? `${q} KILLS` : `${q}/${LV.quota} KILLS`,
                   W - 24 - padR, 16 + topPad + 28 * uiK + 18);
      }
      c.restore();

      // centre: the countdown as a thin bar inside the band
      const bw = mob ? Math.min(150, W * 0.22) : Math.min(220, W * 0.34);
      const leftT = Math.max(0, LV.time - s.levelT);
      const urgency = leftT <= 6;
      const clockY = mob ? bandTop + band * 0.34 : 10 + (this.safe ? this.safe.top : 0);
      c.save();
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(W / 2 - bw / 2, clockY, bw, 3);
      c.fillStyle = urgency ? '#ff5f6d' : (over ? '#ff5f6d' : 'rgba(110,245,255,0.75)');
      c.fillRect(W / 2 - bw / 2, clockY, bw * Math.min(1, s.levelT / LV.time), 3);
      c.textAlign = 'center';
      c.font = `800 ${mob ? 11 : (urgency ? 15 : 12)}px ui-monospace, Menlo, monospace`;
      c.fillStyle = urgency ? '#ff5f6d' : 'rgba(190,215,240,0.8)';
      c.fillText(`${leftT.toFixed(1)}s`, W / 2, clockY + (mob ? 15 : 17));
      c.restore();
    }

    // streak
    if (s.streak >= 3) {
      c.save();
      c.textAlign = 'center';
      c.font = '700 20px ui-monospace, Menlo, monospace';
      const a = Math.min(1, s.streakT / 2.6);
      c.globalAlpha = a;
      c.fillStyle = '#ffd166';
      c.shadowColor = '#ffd166';
      c.shadowBlur = 16;
      c.fillText(`x${s.streak} STREAK`, W / 2, 52 + topPad);
      c.restore();
    }

    // the dash pip is positioned off the bar that was drawn above
    const barW = this._pulseBarW || 0;
    const by = this._pulseBarY != null ? this._pulseBarY : H - 62;

    // dash cooldown pip
    c.save();
    const ready = p.dashCd <= 0;
    c.globalAlpha = ready ? 1 : 0.35;
    c.strokeStyle = ready ? '#9ffcff' : 'rgba(160,190,215,0.6)';
    c.lineWidth = 2;
    const dx = Math.min(W - 26, W / 2 + barW / 2 + 34), dy = by + (mob ? 8 : 10);
    c.beginPath(); c.arc(dx, dy, 8, 0, TAU); c.stroke();
    if (!ready) {
      c.beginPath();
      c.arc(dx, dy, 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.dashCd / s.mods.dashCd));
      c.stroke();
    } else {
      c.beginPath(); c.moveTo(dx - 4, dy - 5); c.lineTo(dx + 5, dy); c.lineTo(dx - 4, dy + 5); c.closePath(); c.stroke();
    }
    c.restore();

    // desktop: tappable pause + mode badge (no touch buttons on PC)
    if (!mob) {
      const px = W - 30, py = 30, pr = 15;
      this._deskPause = { x: px, y: py, r: pr };
      c.save();
      c.globalAlpha = 0.7;
      c.strokeStyle = '#9ffcff'; c.lineWidth = 2;
      c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#9ffcff';
      const bw2 = 3.2, bh2 = 12;
      c.fillRect(px - bw2 * 2.2, py - bh2 / 2, bw2, bh2);
      c.fillRect(px + bw2 * 1.2, py - bh2 / 2, bw2, bh2);
      c.restore();

      // mode badge, clickable. Three modes now, so derive the label and colour
      // from the mode itself rather than a two-way boolean.
      const modeId = s.fireMode || 'manual';
      const modeInfo = {
        manual:   { label: 'MARKSMAN · TAB',   fill: 'rgba(255,209,102,0.14)', line: '#ffd166', text: '#ffe9b8' },
        assisted: { label: 'AUTO-AIM · TAB',   fill: 'rgba(110,245,255,0.14)', line: '#6ff5ff', text: '#bffcff' },
        auto:     { label: 'SIEGE · TITLE',    fill: 'rgba(125,255,178,0.14)', line: '#7dffb2', text: '#c8ffdc' },
      }[modeId];
      const auto = modeId === 'auto';
      const label = modeInfo.label;
      c.save();
      c.font = '700 11px ui-monospace, Menlo, monospace';
      const tw = c.measureText(label).width + 20;
      const bx = W - 30 - pr * 2 - 12 - tw, by = 18;
      this._deskMode = { x: bx, y: by, w: tw, h: 24 };
      c.globalAlpha = 0.9;
      c.fillStyle = modeInfo.fill;
      c.strokeStyle = modeInfo.line;
      c.lineWidth = 1.5;
      roundRect(c, bx, by, tw, 24, 12);
      c.fill(); c.stroke();
      c.fillStyle = modeInfo.text;
      c.textAlign = 'center';
      c.fillText(label, bx + tw / 2, by + 16);
      c.restore();
    }

    // low-health vignette + heartbeat text
    if (p.hp <= 1.2 && !over) {
      c.save();
      c.globalAlpha = 0.5 + Math.sin(this.t * 7) * 0.2;
      c.font = '700 13px ui-monospace, Menlo, monospace';
      c.textAlign = 'center';
      c.fillStyle = '#ff3b5c';
      c.fillText(mob ? 'CRITICAL — STOP FIRING' : 'PULSE CRITICAL — STOP FIRING TO REGEN', W / 2, by - 26);
      c.restore();
    }
  }

  // ------------------------------------------------------------------
  // TOUCH LAYOUT — the single source of truth for both drawing and
  // hit-testing, so a button can never be drawn somewhere it isn't tappable.
  // Anchored to the real screen corners, scaled off the short edge, so the
  // controls use the whole square instead of fixed pixel offsets.
  // ------------------------------------------------------------------
  // How much vertical room the on-screen controls get. Derived from the SHORT
  // edge of the arena, then clamped to a fraction of the height so a wide, short
  // landscape window (a phone on its side, or a tablet) can never end up with
  // buttons that take a quarter of the screen.
  controlBand() {
    const W = this.worldW, H = this.worldH;
    if (!this.mobile) return { R: 56, pad: 18, band: 150, W, H };
    // Landscape phones are only ~390px tall, so HEIGHT is the binding constraint
    // there, not the short edge (which IS the height). Budget the whole cluster
    // against the height so the arithmetic cannot overflow a short screen.
    const budget = clamp(H * 0.26, 96, 260);   // total vertical room for controls
    const pad = clamp(budget * 0.07, 7, 20);
    const R = clamp((budget - pad * 2) / 2.20, 20, 62);
    const band = pad * 2 + R * 2.20;   // stick/fire row plus breathing room
    return { R, pad, band, W, H };
  }

  // The notch and home bar are real estate we cannot use. Read them from CSS env()
  // via a probe element so the HUD never sits under a camera cutout.
  readSafeInsets() {
    if (!this.mobile) return { top: 0, right: 0, bottom: 0, left: 0 };
    const d = document.documentElement;
    if (!d) return { top: 0, right: 0, bottom: 0, left: 0 };
    const cs = getComputedStyle(d);
    const px = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      top: px(cs.getPropertyValue('--sat')),
      right: px(cs.getPropertyValue('--sar')),
      bottom: px(cs.getPropertyValue('--sab')),
      left: px(cs.getPropertyValue('--sal')),
    };
  }

  controlLayout() {
    const { R, pad, W, H } = this.controlBand();
    const sa = this.safe || { top: 0, right: 0, bottom: 0, left: 0 };
    const gap = R * 0.32;
    const fireR = R * 1.10;
    const dashR = R * 0.82;

    // A (fire) and B (dash) sit side by side under the right thumb, the way a
    // pad is laid out: the primary action is the biggest target on screen, the
    // secondary sits next to it and is clearly smaller.
    const bx = pad + sa.left, br = pad + sa.right, bt = pad + sa.top, bb = pad + sa.bottom;
    const stick = { x: bx + R, y: H - bb - R, r: R };
    const fire  = { x: W - br - fireR, y: H - bb - R, r: fireR };

    // B ON THE THUMB ARC, AIM OUT OF THE CLUSTER.
    // The two action buttons used to sit side by side in a flat row with the AIM
    // toggle floating directly above A. That reads wrong to anyone who has held a
    // controller: B was the far target and AIM sat in the firing zone, close
    // enough to hit by accident while mashing fire.
    //
    // Now A is the bottom-right anchor, B sits up-and-right of it on the natural
    // arc a right thumb sweeps, and AIM moves left of B — reachable, but no longer
    // in the path between A and the corner.
    // Distance is derived, not eyeballed: the two circles sit one small gap
    // apart along a 50-degree arc, so they can never overlap at any screen size.
    const dashD = fireR + dashR + 6;
    const dash  = { x: fire.x - dashD * 0.643, y: fire.y - dashD * 0.766, r: dashR };
    const mode  = { x: dash.x - dashR - gap - R * 0.62, y: fire.y, r: R * 0.62 };
    const pause = { x: W - br - R * 0.52, y: bt + R * 0.62, r: R * 0.52 };
    // GYRO sits in the top-left CORNER — that is where a game puts it, and it stays
    // there. It just no longer hugs the glass. At R * 0.52 from the edge it sat
    // close enough to the bezel that a thumb could not reach it without brushing
    // the edge, and on a notched phone the cutout came close to it.
    //
    // The nudge is deliberately small: enough clearance to be comfortable, not
    // enough to pull it away from the corner and down into the play area. Pushing
    // it to the centre-left (where the AIM button used to be) would put a control
    // in the middle of the screen and it would be tapped by accident constantly.
    const gyro  = { x: bx + R * 0.80, y: bt + R * 0.78, r: R * 0.52 };
    return { R, pad, stick, dash, fire, mode, pause, gyro, W, H };
  }

  // SIEGE HAS NO FIRE BUTTON.
  // siegeFire() in the sim fires on its own cooldown and never reads the fire
  // input at all, so the "A / FIRE" circle in SIEGE was wired to nothing — the
  // player was pressing an inert button. In a mode where the gun aims and fires
  // itself, the only verbs are MOVE and DASH.
  //
  // So this layout promotes dash into the primary slot: it keeps the biggest
  // target on screen, in the corner a thumb already rests on. A mode whose whole
  // skill is dodging gives its one action the most reachable position, rather
  // than making it the second-biggest circle next to a dead one.
  siegeControlLayout() {
    const L = this.controlLayout();
    const { R, W, H } = L;
    const b = this.controlBand();
    const sa = this.safe || { top: 0, right: 0, bottom: 0, left: 0 };
    const primaryR = R * 1.10;               // the size A used to have
    return {
      ...L,
      dash: { x: W - sa.right - b.pad - primaryR, y: H - sa.bottom - b.pad - R, r: primaryR },
      fire: null,                            // nothing to press
    };
  }

  // generous hit radius: +14px of slop so thumbs forgive
  hit(cx, cy, btn) {
    if (!btn) return false;
    return (cx - btn.x) ** 2 + (cy - btn.y) ** 2 < (btn.r + 14) ** 2;
  }

  drawTouchControls(s, input) {
    if (!this.mobile) return;
    const c = this.ctx;
    // In SIEGE there is no fire button at all (see siegeControlLayout): the gun
    // fires itself and the only decisions are movement and the dash.
    const siege = !!s.siege;
    const L = siege ? this.siegeControlLayout() : this.controlLayout();
    const auto = siege || s.fireMode === 'auto';
    const hostile = s.player.hp <= 0;

    // ---------- movement stick (bottom-left) ----------
    c.save();
    c.globalAlpha = 0.5;
    c.strokeStyle = 'rgba(110,245,255,0.55)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(L.stick.x, L.stick.y, L.stick.r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.10;
    c.fillStyle = '#6ff5ff';
    c.beginPath(); c.arc(L.stick.x, L.stick.y, L.stick.r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.8;
    const kx = L.stick.x + (input.ax || 0) * L.stick.r * 0.6;
    const ky = L.stick.y + (input.ay || 0) * L.stick.r * 0.6;
    c.fillStyle = 'rgba(110,245,255,0.9)';
    c.beginPath(); c.arc(kx, ky, L.stick.r * 0.32, 0, Math.PI * 2); c.fill();
    c.restore();

    // ---------- A: fire / shoot ----------
    // Campaign only. SIEGE has no use for it, so it is not drawn there.
    if (!siege) {
    c.save();
    const aOn = input.fire || auto;
    c.globalAlpha = aOn ? 0.95 : 0.6;
    c.strokeStyle = hostile ? 'rgba(255,59,92,0.9)' : (auto ? '#7dffb2' : '#ffd166');
    c.lineWidth = 3;
    c.beginPath(); c.arc(L.fire.x, L.fire.y, L.fire.r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = aOn ? 0.30 : 0.12;
    c.fillStyle = hostile ? '#ff3b5c' : (auto ? '#7dffb2' : '#ffd166');
    c.beginPath(); c.arc(L.fire.x, L.fire.y, L.fire.r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.95;
    c.fillStyle = auto ? '#c8ffdc' : '#ffe9b8';
    c.textAlign = 'center';
    c.font = `800 ${Math.round(L.fire.r * 0.62)}px ui-monospace, Menlo, monospace`;
    c.fillText('A', L.fire.x, L.fire.y + L.fire.r * 0.22);
    c.globalAlpha = 0.55;
    c.font = `700 ${Math.round(L.fire.r * 0.22)}px ui-monospace, Menlo, monospace`;
    c.fillText(siege ? 'TIER ' + s.playerTier : (auto ? 'AUTO' : 'FIRE'), L.fire.x, L.fire.y + L.fire.r * 0.72);
    // charge ring = how many shots the budget allows (in SIEGE: the weapon tier)
    const afford = siege ? (s.playerTier / 7) * 8 : Math.max(0, Math.floor(s.player.hp - 3));
    c.globalAlpha = 0.85;
    c.strokeStyle = hostile ? '#ff3b5c' : (auto ? '#7dffb2' : '#6ff5ff');
    c.lineWidth = 3.5;
    c.beginPath();
    c.arc(L.fire.x, L.fire.y, L.fire.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, afford / 8));
    c.stroke();
    c.restore();
    }

    // ---------- B: dash ----------
    const ready = s.player.dashCd <= 0;
    c.save();
    c.globalAlpha = ready ? 0.85 : 0.32;
    c.strokeStyle = '#9ffcff';
    c.lineWidth = 3;
    c.beginPath(); c.arc(L.dash.x, L.dash.y, L.dash.r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = ready ? 0.16 : 0.05;
    c.fillStyle = '#9ffcff';
    c.beginPath(); c.arc(L.dash.x, L.dash.y, L.dash.r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.95;
    c.fillStyle = '#d8feff';
    c.textAlign = 'center';
    c.font = `800 ${Math.round(L.dash.r * 0.62)}px ui-monospace, Menlo, monospace`;
    c.fillText('B', L.dash.x, L.dash.y + L.dash.r * 0.22);
    c.globalAlpha = 0.55;
    c.font = `700 ${Math.round(L.dash.r * 0.22)}px ui-monospace, Menlo, monospace`;
    c.fillText('DASH', L.dash.x, L.dash.y + L.dash.r * 0.72);
    c.restore();

    // ---------- mode toggle (top-right of the fire stack) ----------
    // SIEGE has fixed rules, so there is nothing to toggle: draw the weapon name
    // instead of a button that would swing the aim mode mid-run.
    if (siege) {
      // The weapon tier used to be printed on the A button. With A gone it moves
      // to the corner readout it always belonged in -- it is information, not a
      // control, and putting it where a thumb rests invited phantom taps.
      c.save();
      c.globalAlpha = 0.9;
      c.strokeStyle = '#7dffb2';
      c.lineWidth = 2;
      c.beginPath(); c.arc(L.mode.x, L.mode.y, L.mode.r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#7dffb2';
      c.textAlign = 'center';
      c.font = `800 ${Math.round(L.mode.r * 0.42)}px ui-monospace, Menlo, monospace`;
      const nm = (s.weapon || {}).name || 'SINGLE';
      c.fillText(nm.split(' ')[0], L.mode.x, L.mode.y + L.mode.r * 0.18);
      c.globalAlpha = 0.55;
      c.font = `700 ${Math.round(L.mode.r * 0.30)}px ui-monospace, Menlo, monospace`;
      c.fillText('TIER ' + (s.playerTier || 1), L.mode.x, L.mode.y + L.mode.r * 0.62);
      c.restore();
    } else {
      // MARKSMAN HAS NO AIM BUTTON.
      // The button existed only to let a MARKSMAN run switch itself into AUTO-AIM
      // mid-fight, which erased the difference between the two modes — the exact
      // complaint that the modes felt identical. In MARKSMAN the gun is yours:
      // there is nothing to toggle, so the control is not drawn at all.
      if (s.fireMode === 'manual') { /* no mode control in MARKSMAN */ }
      else {
        c.save();
        c.globalAlpha = 0.9;
        c.strokeStyle = auto ? '#7dffb2' : '#ffd166';
        c.lineWidth = 2;
        c.beginPath(); c.arc(L.mode.x, L.mode.y, L.mode.r, 0, Math.PI * 2); c.stroke();
        c.fillStyle = auto ? '#7dffb2' : '#ffd166';
        c.textAlign = 'center';
        c.font = `800 ${Math.round(L.mode.r * 0.5)}px ui-monospace, Menlo, monospace`;
        c.fillText(auto ? 'AUTO' : 'AIM', L.mode.x, L.mode.y + L.mode.r * 0.18);
        c.restore();
      }
    }

    // ---------- pause (top-right corner) ----------
    c.save();
    c.globalAlpha = 0.75;
    c.strokeStyle = '#9ffcff';
    c.lineWidth = 2;
    c.beginPath(); c.arc(L.pause.x, L.pause.y, L.pause.r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#9ffcff';
    const bw = L.pause.r * 0.22, bh = L.pause.r * 0.7;
    c.fillRect(L.pause.x - bw * 1.6, L.pause.y - bh / 2, bw, bh);
    c.fillRect(L.pause.x + bw * 0.6, L.pause.y - bh / 2, bw, bh);
    c.restore();

    // ---------- gyro toggle (top-left corner, hidden without a sensor) ----------
    if (!this.gyroAvailable) { return; }
    c.save();
    c.globalAlpha = this.gyroOn ? 0.95 : 0.55;
    c.strokeStyle = this.gyroOn ? '#7dffb2' : 'rgba(160,190,215,0.8)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(L.gyro.x, L.gyro.y, L.gyro.r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = this.gyroOn ? '#7dffb2' : '#9fb6cf';
    c.textAlign = 'center';
    c.font = `800 ${Math.round(L.gyro.r * 0.55)}px ui-monospace, Menlo, monospace`;
    c.fillText('GYRO', L.gyro.x, L.gyro.y + L.gyro.r * 0.18);
    c.restore();
  }

  // First-run instructions. Shown over the title screen and dismissed by the first
  // real input, so it never blocks anyone. On a phone the copy talks about A/B and
  // tilting; on a PC it talks about mouse and keys. Same overlay, right language.
  drawInstructions(s, alpha) {
    if (alpha <= 0) return;
    const c = this.ctx;
    const W = this.worldW, H = this.worldH;
    const mob = this.mobile;
    c.save();
    c.globalAlpha = alpha;

    const pad = mob ? 18 : 40;
    const panelW = Math.min(W - pad * 2, mob ? 340 : 520);
    let lines = mob
      ? [
          ['HOW TO PLAY', ''],
          ['LEFT THUMB', 'move'],
          ['RIGHT THUMB', 'drag to aim + fire'],
          // SIEGE has no fire button (the gun fires itself), so the help panel
          // must not teach a control that is not there.
          ...(s.siege
            ? [['DASH (big)', 'the only button']]
            : [['A (big)', 'fire'], ['B (small)', 'dash']]),
          ['GYRO', 'tilt to move (top-left)'],
          ['', ''],
          ['YOUR HP IS YOUR AMMO', ''],
          ['Every shot costs 1 PULSE', ''],
          ['Every kill pays it back', ''],
          ['Clear the quota before the clock runs out', ''],
          ['SIEGE', 'endless: gun auto-fires + evolves'],
          ['', ''],
          ['TAP ANYWHERE TO BEGIN', ''],
        ]
      : [
          ['HOW TO PLAY', ''],
          ['W A S D', 'move'],
          ['MOUSE', 'aim'],
          ['LEFT CLICK / J', 'fire'],
          ['SHIFT', 'dash'],
          ['P', 'pause'],
          ['TAB', 'switch aim mode'],
          ['', ''],
          ['YOUR HP IS YOUR AMMO', ''],
          ['Every shot costs 1 PULSE', ''],
          ['Every kill pays it back', ''],
          ['Clear the quota before the clock runs out', ''],
          ['SIEGE', 'endless: gun auto-fires + evolves'],
          ['', ''],
          ['CLICK ANYWHERE TO BEGIN', ''],
        ];

    // HOW THE PANEL FITS A SHORT PHONE
    // Phones play in landscape, so H here is often 390 or even 320 — and the
    // full list is 14 rows. Rather than let the panel run off the bottom (which
    // is how the A button got clipped before), drop the least essential rows
    // when the screen is short. The rule-teaching rows are never dropped: they
    // are the whole point of the screen.
    let rowH = mob ? 19 : 22;
    const chrome = () => mob ? 30 : 38;
    const DROP_ORDER = ['GYRO', 'SIEGE'];
    let dropped = [];
    while (mob && lines.length * rowH + chrome() > H - 8) {
      const next = DROP_ORDER.find((k) => !dropped.includes(k) && lines.some((l) => l[0] === k));
      if (!next) break;
      // take the row, and the blank spacer that precedes it if there is one
      const i = lines.findIndex((l) => l[0] === next);
      if (i > 0 && lines[i - 1][0] === '' && lines[i - 1][1] === '') lines.splice(i - 1, 2);
      else lines.splice(i, 1);
      dropped.push(next);
    }
    // If it is still too tall on an absurdly short frame, tighten the leading.
    while (mob && lines.length * rowH + chrome() > H - 8 && rowH > 13) rowH -= 1;

    const panelH = lines.length * rowH + chrome();
    const x = W / 2 - panelW / 2;
    const y = H / 2 - panelH / 2;

    // dim the arena behind it
    c.fillStyle = `rgba(4,5,10,${0.82 * alpha})`;
    c.fillRect(0, 0, W, H);

    c.fillStyle = 'rgba(8,14,24,0.97)';
    c.strokeStyle = 'rgba(110,245,255,0.45)';
    c.lineWidth = 1.5;
    roundRect(c, x, y, panelW, panelH, 12);
    c.fill(); c.stroke();

    let ty = y + (mob ? 26 : 30);
    const left = x + (mob ? 16 : 24);
    const right = x + panelW - (mob ? 16 : 24);
    for (const [key, val] of lines) {
      if (key === 'HOW TO PLAY' || key === 'YOUR HP IS YOUR AMMO' || key.startsWith('TAP') || key.startsWith('CLICK')) {
        c.textAlign = 'center';
        c.font = `800 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
        c.fillStyle = key === 'HOW TO PLAY' ? '#9ffcff' : key.startsWith('TAP') || key.startsWith('CLICK') ? '#7dffb2' : '#ffd166';
        c.fillText(key, W / 2, ty);
        ty += rowH;
        continue;
      }
      if (key === '' && val === '') { ty += rowH * 0.45; continue; }
      c.textAlign = 'left';
      c.font = `800 ${mob ? 10 : 11}px ui-monospace, Menlo, monospace`;
      c.fillStyle = '#dff6ff';
      c.fillText(key, left, ty);
      c.textAlign = 'right';
      c.font = `400 ${mob ? 10 : 11}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(190,215,240,0.8)';
      c.fillText(val, right, ty);
      ty += rowH;
    }
    c.restore();
  }

  // Portrait is fully playable; landscape is simply better. This hint is
  // dismissible and never blocks input, because on iPhone the browser cannot
  // lock orientation at all — a blocking rotate screen would just lose players.
  // The PULSE bar, factored out so SIEGE draws the same health readout as the
  // campaign (it is the same resource — only what spends it differs).
  drawPulseBar(s, opts) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const p = s.player;
    const mob = (opts && opts.mob) != null ? opts.mob : this.mobile;
    const over = p.hp <= 0;
    this._pulseBarW = 0;
    const total = p.maxHp;
    // DEBT COLLECTOR runs a deeper overdraft (-6 instead of -3). The bar has to show
    // the floor the level is actually enforcing, or the player cannot see how much
    // rope they have and the -6 reads as a bug when they survive past the old edge.
    const floor = overdraftFloor(s);
    const negCount = Math.abs(floor);
    const full = total + negCount;
    const sa = this.safe || { top: 0, right: 0, bottom: 0, left: 0 };
    const inBand = !!(opts && opts.inBand);
    const ctrlBand = this.mobile ? this.controlBand().band : 150;
    // In the HUD band the bar shares the strip with SCORE (left), the countdown
    // (centre) and the goal (right), so it is capped to the space under the score
    // rather than spanning the width.
    const hudBand = this.hudH || 0;
    const maxBar = inBand
      ? Math.max(90, W * 0.30)
      : (mob ? W - sa.left - sa.right - 40 : W - 160);
    let segW = mob ? (inBand ? 11 : 20) : 30;
    const gap = mob ? (inBand ? 2 : 3) : 5;
    if (full * segW + (full - 1) * gap > maxBar) segW = Math.max(6, (maxBar - (full - 1) * gap) / full);
    const barW = full * segW + (full - 1) * gap;
    // in the band: tucked under the score, at the bottom edge of the strip.
    // otherwise: just above the control band, left-aligned with the stick.
    const bx = inBand ? 14 : (mob ? sa.left + 20 : W / 2 - barW / 2);
    const bandTop = (opts && opts.bandTop != null) ? opts.bandTop : -hudBand;
    const by = inBand ? bandTop + hudBand - 12 : (mob ? H - sa.bottom - ctrlBand - 14 : H - 62);
    const segH = inBand ? 9 : (mob ? 14 : 20);

    c.save();
    c.font = `700 ${inBand ? 9 : 11}px ui-monospace, Menlo, monospace`;
    c.textAlign = 'left';
    c.fillStyle = over ? '#ff5f6d' : 'rgba(160,190,215,0.6)';
    const hpShown = Math.max(floor, Math.min(p.maxHp, p.hp));
    c.fillText(over ? `OVERDRAFT ${hpShown.toFixed(0)}` : `PULSE ${Math.floor(hpShown)}/${p.maxHp}`, bx, by - (inBand ? 12 : 9));
    // DEBT COLLECTOR's clock runs the whole level, so it is shown the whole level,
    // not just while you happen to be under zero.
    if (s._lv && s._lv.rule === 'overdraftWindow') {
      const left = Math.max(0, 12 - (s.overdraftT || 0));
      c.save();
      c.textAlign = 'right';
      c.font = '700 12px ui-monospace, Menlo, monospace';
      c.fillStyle = left <= 3 ? '#7dffb2' : 'rgba(125,255,178,0.72)';
      c.fillText(`DEBT CLOCK ${left.toFixed(1)}s / 12s`, bx + barW, by - 9);
      c.restore();
    }
    if (over) {
      const blink = Math.sin(this.t * 12) > 0;
      c.textAlign = 'right';
      c.fillStyle = blink ? '#ff2d55' : 'rgba(255,45,85,0.35)';
      const rule = s._lv && s._lv.rule === 'overdraftWindow';
      if (!rule) c.fillText('KILL TO REPAY', bx + barW, by - 10);
    }
    c.restore();

    for (let i = 0; i < full; i++) {
      const x = bx + i * (segW + gap);
      const isNeg = i >= total;
      const idx = i; // 0..total-1 positive, then negative credit
      // value represented: positive segments from left fill by hp; negative ones by |hp|
      let filled;
      if (!isNeg) filled = p.hp >= idx + 1 ? 1 : p.hp > idx ? p.hp - idx : 0;
      else {
        const negIdx = floor + (i - total); // the level's own floor upward
        filled = p.hp <= negIdx + 1 && p.hp > negIdx ? Math.min(1, negIdx + 1 - p.hp) : p.hp <= negIdx ? 1 : 0;
      }
      c.save();
      if (isNeg) {
        c.strokeStyle = p.hp <= 0 ? 'rgba(255,45,85,0.9)' : 'rgba(255,45,85,0.30)';
        c.lineWidth = 1.5;
        c.strokeRect(x + 0.5, by + 0.5, segW, segH);
        if (filled > 0) {
          c.fillStyle = 'rgba(255,45,85,0.85)';
          c.fillRect(x, by, segW * filled, segH);
        }
      } else {
        c.fillStyle = 'rgba(110,245,255,0.10)';
        c.fillRect(x, by, segW, segH);
        if (filled > 0) {
          const low = p.hp <= 2;
          const col = low ? '#ff3b5c' : '#6ff5ff';
          c.fillStyle = col;
          c.shadowColor = col;
          c.shadowBlur = 16;
          c.fillRect(x, by, segW * filled, segH);
        }
      }
      c.restore();
    }
    this._pulseBarW = barW;
    this._pulseBarY = by;
    this._pulseBarX = bx;
  }

  // SIEGE HUD: the survival clock is the headline, because time IS the score
  // there. Wave + remaining enemies sit where the campaign puts LEVEL + quota.
  drawSiegeHUD(s, o) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = o.mob, topPad = o.topPad, uiK = o.uiK, padR = o.padR || 0;
    const band = o.band != null ? o.band : (this.hudH || 0);
    const bandTop = o.bandTop != null ? o.bandTop : -band;
    // on a phone the WAVE readout lives in the reserved strip, right-aligned,
    // level with the score on the other side
    if (mob) {
      c.save();
      c.textAlign = 'right';
      c.font = '700 9px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText('WAVE', W - 14, bandTop + band * 0.30);
      c.font = '800 17px ui-monospace, Menlo, monospace';
      c.fillStyle = '#dff6ff';
      c.fillText(String(Math.max(1, s.wave2)).padStart(2, '0'), W - 12, bandTop + band * 0.30 + 18);
      const left0 = s.enemies.filter((e) => !e.dead).length;
      c.font = '700 10px ui-monospace, Menlo, monospace';
      if (s.waveBreath > 0) {
        c.fillStyle = 'rgba(160,190,215,0.7)';
        c.fillText(`NEXT ${s.waveBreath.toFixed(0)}s`, W - 12, bandTop + band * 0.30 + 33);
      } else {
        c.fillStyle = 'rgba(255,209,102,0.95)';
        c.fillText(left0 > 0 ? `${left0} LEFT` : 'CLEAR', W - 12, bandTop + band * 0.30 + 33);
      }
      c.restore();

      // centre: the WAVE clock. SIEGE has no per-level quota, so what belongs in
      // the middle of the strip is how long this wave has been running and how
      // long until the next one breathes. It is a readout, not gameplay chrome --
      // it never crosses into the arena.
      const waveSec = Math.max(0, Math.floor(s.siegeT || 0));
      const mm = Math.floor(waveSec / 60), ss = String(waveSec % 60).padStart(2, '0');
      c.save();
      c.textAlign = 'center';
      c.font = '800 13px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(190,215,240,0.85)';
      c.fillText(`${mm}:${ss}`, W / 2, bandTop + band * 0.30 + 4);
      if (s.waveBreath > 0) {
        c.font = '700 9px ui-monospace, Menlo, monospace';
        c.fillStyle = 'rgba(255,209,102,0.9)';
        c.fillText(`NEXT WAVE ${s.waveBreath.toFixed(0)}s`, W / 2, bandTop + band * 0.30 + 18);
      }
      c.restore();
      return;
    }
    const w = s.weapon || SIEGE_WEAPONS[0];

    // top-right: WAVE n and how many of it are left to kill
    c.save();
    c.textAlign = 'right';
    c.font = '700 12px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.55)';
    c.fillText('WAVE', W - 24 - padR, 24 + topPad);
    c.font = `700 ${Math.round(28 * uiK)}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#dff6ff';
    c.fillText(String(Math.max(1, s.wave2)).padStart(2, '0'), W - 22 - padR, 20 + topPad + 28 * uiK);

    const left = Math.max(0, (s.waveLeft || 0) + s.enemies.length);
    c.font = '700 12px ui-monospace, Menlo, monospace';
    if (s.waveBreath > 0) {
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 6);
      c.fillStyle = `rgba(125,255,178,${pulse})`;
      c.fillText(`NEXT WAVE ${s.waveBreath.toFixed(1)}s`, W - 24 - padR, 16 + topPad + 28 * uiK + 18);
    } else {
      c.fillStyle = left > 0 ? 'rgba(255,209,102,0.95)' : '#7dffb2';
      c.fillText(left > 0 ? `${left} LEFT` : 'CLEAR', W - 24 - padR, 16 + topPad + 28 * uiK + 18);
    }
    c.restore();

    // centre-top: SURVIVAL CLOCK (counts UP — this is how long you lasted)
    const clockY = 10 + (this.safe ? this.safe.top : 0) + (mob ? 6 : 0);
    c.save();
    c.textAlign = 'center';
    c.font = `800 ${mob ? 17 : 20}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#eafcff';
    c.shadowColor = 'rgba(110,245,255,0.5)';
    c.shadowBlur = 12;
    c.fillText(fmtClock(s.siegeT), W / 2, clockY + 18);
    c.shadowBlur = 0;
    // the 60s refill is schedulable only if it is visible: count down to it
    const sinceRefill = s.siegeT - s.refills * PULSE_REFILL_SECONDS;
    const toRefill = Math.max(0, PULSE_REFILL_SECONDS - sinceRefill);
    c.font = `700 ${mob ? 9 : 11}px ui-monospace, Menlo, monospace`;
    c.fillStyle = toRefill < 10 ? '#7dffb2' : 'rgba(160,190,215,0.6)';
    c.fillText(`+3 PULSE IN ${fmtClock(toRefill)}`, W / 2, clockY + (mob ? 32 : 34));
    c.restore();

    // bottom-centre-ish: the weapon ladder, so an evolution is never invisible
    if (!mob) {
      c.save();
      c.textAlign = 'left';
      c.font = '800 13px ui-monospace, Menlo, monospace';
      c.fillStyle = '#6ff5ff';
      c.fillText(`T${s.playerTier} ${w.name}`, 24 + (this.ox || 0), 54);
      c.font = '400 11px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.6)';
      c.fillText(`${w.desc} · enemies T${s.enemyTier}`, 24 + (this.ox || 0), 70);
      c.restore();
    }
  }

  drawRotateHint() {
    if (!this.mobile || !this.portrait || this.rotateHintDismissed) return;
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    c.save();
    const w = Math.min(W - 24, 330), h = 54;
    const x = (W - w) / 2, y = H - h - 76;
    c.globalAlpha = 0.96;
    c.fillStyle = 'rgba(8,16,28,0.95)';
    c.strokeStyle = 'rgba(110,245,255,0.45)';
    c.lineWidth = 1.5;
    roundRect(c, x, y, w, h, 10);
    c.fill(); c.stroke();

    // little landscape glyph
    c.strokeStyle = '#9ffcff';
    c.lineWidth = 1.8;
    c.strokeRect(x + 14, y + 20, 22, 14);

    c.textAlign = 'left';
    c.font = '800 12px ui-monospace, Menlo, monospace';
    c.fillStyle = '#eafcff';
    c.fillText('BEST PLAYED SIDEWAYS', x + 46, y + 24);
    c.font = '400 10px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(170,200,225,0.8)';
    c.fillText('portrait works too · tap to hide this', x + 46, y + 39);
    this._rotateHint = { x, y, w, h };
    c.restore();
  }

  drawTitle(s) {
    // Every screen remembers the space it was laid out in, so a device-type flip
    // during the same pointerdown cannot change how its hit tests are interpreted.
    this._titleSpace = this.mobile ? 'world' : 'ui';
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const k = mob ? 0.44 : 1;          // text scale
    const cx = W / 2;
    // Short screens (landscape phones) get a compact title: no pulse preview, no
    // secondary tagline, tighter spacing — so START and the chips always fit.
    const tight = H < 460;
    const cy = tight ? H * 0.19 : H * (mob ? 0.36 : 0.34);
    c.save();
    c.textAlign = 'center';

    // logo
    c.font = `800 ${Math.round(104 * (mob ? 0.52 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#eafcff';
    c.shadowColor = 'rgba(110,245,255,0.85)';
    c.shadowBlur = 42;
    c.fillText('OVERDRAFT', cx, cy);

    // glitch ghosts
    c.globalCompositeOperation = 'lighter';
    const j = Math.sin(this.t * 2.3) * 3;
    c.globalAlpha = 0.25;
    c.fillStyle = '#ff2d55'; c.shadowBlur = 0;
    c.fillText('OVERDRAFT', cx + 3 + j, cy);
    c.fillStyle = '#00e5ff';
    c.fillText('OVERDRAFT', cx - 3 + j * 0.5, cy);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    c.shadowBlur = 0;
    // The hook, not the manual. "Your health bar is the magazine" explained the
    // mechanic but sold nothing; a question challenges the player before they have
    // pressed anything. The rule itself still has to appear below it, because a
    // stranger who starts without knowing why their health drops will bounce.
    c.font = `700 ${Math.round(22 * (mob ? 0.8 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(210,235,255,0.95)';
    c.fillText('CAN YOU WITHSTAND THE SIEGE?', cx, cy + 46 * (mob ? 0.7 : 1));

    const ruleY = cy + (mob ? 78 : 82);
    c.font = `400 ${Math.round(15 * (mob ? 0.85 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(160,190,215,0.72)';
    c.fillText('Every shot costs 1 PULSE. Every kill pays it back.', cx, ruleY);
    // Where the copy ends, in concrete pixels. Everything below this (the pulse
    // preview, START, the mode chips) is positioned from it rather than from fixed
    // offsets, because fixed offsets only worked while the old three-line tagline
    // was pushing the whole block down. Removing a line moved START up into the text.
    const copyBottom = ruleY;
    // (the old "nine levels, each with a new rule" line is gone: it described the
    // content instead of the challenge, and the level cards teach the rules better
    // than a paragraph on the title screen ever could)

    // pulse bar preview (skipped on short screens to make room for the buttons)
    if (!tight) {
    const segW = mob ? 18 : 30, gap = mob ? 3 : 5, n = 11;
    const bw = n * segW + (n - 1) * gap;
    const bx = cx - bw / 2;
    const by = cy + (mob ? 126 : 136);
    for (let i = 0; i < n; i++) {
      const isNeg = i >= MAX_PULSE;
      c.save();
      if (isNeg) { c.strokeStyle = 'rgba(255,45,85,0.55)'; c.strokeRect(bx + i * (segW + gap) + 0.5, by + 0.5, segW, 14); }
      else {
        c.fillStyle = 'rgba(110,245,255,0.28)';
        c.fillRect(bx + i * (segW + gap), by, segW, 14);
      }
      c.restore();
    }
    c.font = '700 10px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.5)';
    c.textAlign = 'right';
    c.fillText('CREDIT', bx + bw, by + 30);
    c.textAlign = 'left';
    c.fillStyle = 'rgba(110,245,255,0.55)';
    c.fillText('PULSE', bx, by + 30);
    }  // end pulse preview (skipped when the screen is short)

    // call to action
    const blink = (Math.sin(this.t * 3.4) + 1) / 2;
    c.textAlign = 'center';
    c.globalAlpha = 0.55 + blink * 0.45;
    c.font = `800 ${Math.round(22 * (mob ? 0.82 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#9ffcff';
    c.shadowColor = 'rgba(110,245,255,0.8)';
    c.shadowBlur = 20;
    // ---- START: one big explicit target. Tapping "somewhere" is not a control,
    // and on a phone a player who taps a mode chip gets a mode change, not a start.
    const startW = Math.min(mob ? 260 : 300, W - 48);
    const startH = mob ? 58 : 56;
    const startX = cx - startW / 2;
    // measured from the copy, with the preview band accounted for on tall screens
    const startY = copyBottom + (tight ? 16 : mob ? 34 : 42);
    this._startBtn = { x: startX, y: startY, w: startW, h: startH };
    c.save();
    const pulseS = 0.5 + 0.5 * (Math.sin(this.t * 3.4) + 1) / 2;
    c.globalAlpha = 0.92 + pulseS * 0.08;
    c.fillStyle = 'rgba(110,245,255,0.16)';
    c.strokeStyle = '#6ff5ff';
    c.lineWidth = 2.2;
    roundRect(c, startX, startY, startW, startH, 12);
    c.fill(); c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = '#dffaff';
    c.textAlign = 'center';
    c.font = `800 ${mob ? 20 : 21}px ui-monospace, Menlo, monospace`;
    c.fillText('START', cx, startY + startH / 2 + 7);
    c.restore();

    // ---- mode selector: the two modes have different rules, so lead with it ----
    const modalY = startY + startH + (tight ? 10 : mob ? 14 : 16);
    // fit three chips inside the screen width with a margin, whatever the device
    const chipGap = mob ? 7 : 11;
    const chipAvail = W - 28;
    const chipW = Math.min(mob ? 104 : 150, Math.floor((chipAvail - chipGap * 2) / 3));
    const chipH = 58;
    const chipX = cx - (chipW * 3 + chipGap * 2) / 2;
    // Three chips, two ideas: the first two choose HOW the campaign aims, the
    // third leaves the campaign entirely and starts the endless mode.
    const modes = [
      { id: 'manual', label: 'MARKSMAN', sub: 'fast enemies · keep moving' },
      { id: 'assisted', label: 'AUTO-AIM', sub: 'gun aims · you fire' },
      { id: 'siege', label: 'SIEGE', sub: 'endless · dodge only' },
    ];
    for (let i = 0; i < 3; i++) {
      const m = modes[i];
      const on = (this.titleMode || s.fireMode || 'assisted') === m.id;
      const x = chipX + i * (chipW + chipGap);
      c.save();
      c.globalAlpha = on ? 1 : 0.55;
      const tone = m.id === 'manual' ? '#ffd166' : m.id === 'assisted' ? '#6ff5ff' : '#7dffb2';
      const siegeSel = m.id === 'siege';
      c.fillStyle = on ? (m.id === 'manual' ? 'rgba(255,209,102,0.14)' : m.id === 'assisted' ? 'rgba(110,245,255,0.14)' : 'rgba(125,255,178,0.14)') : 'rgba(12,20,34,0.9)';
      c.strokeStyle = on ? tone : 'rgba(160,190,215,0.4)';
      c.lineWidth = on ? 2.5 : 1.5;
      roundRect(c, x, modalY, chipW, chipH, 8);
      c.fill(); c.stroke();
      c.fillStyle = on ? '#eafcff' : 'rgba(220,235,250,0.8)';
      c.textAlign = 'center';
      c.font = `800 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
      c.fillText(m.label, x + chipW / 2, modalY + (mob ? 24 : 26));
      c.globalAlpha = on ? 0.7 : 0.4;
      c.font = `400 ${mob ? 8 : 10}px ui-monospace, Menlo, monospace`;
      c.fillText(m.sub, x + chipW / 2, modalY + (mob ? 41 : 44));
      c.restore();
    }
    this._modeChips = { x: chipX, y: modalY, w: chipW, h: chipH, gap: chipGap };

    c.globalAlpha = 0.55 + blink * 0.45;
    c.textAlign = 'center';
    c.font = `800 ${Math.round(22 * (mob ? 0.82 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#9ffcff';
    c.shadowColor = 'rgba(110,245,255,0.8)';
    c.shadowBlur = 20;
    c.globalAlpha = 1;
    c.shadowBlur = 0;
    c.font = `400 ${mob ? 10 : 13}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(160,190,215,0.55)';
    // The hint sits BELOW the mode chips, measured from where they actually end.
    // It used to be a fixed cy + 260, which only worked because the old title had an
    // extra tagline line pushing everything down. Removing that line moved the chips
    // up into the copy and the two drew on top of each other.
    const hintY = modalY + chipH + (mob ? 21 : 24);
    let hintDrawn = false;
    if (tight || hintY > H - 8) {
      // no room for a hint line on a short screen; the controls are self-evident
    } else if (mob) {
      c.fillText('left thumb moves  ·  right thumb aims + fires  ·  tap DASH', cx, hintY);
      hintDrawn = true;
    } else {
      c.fillText('WASD MOVE  ·  MOUSE AIM  ·  CLICK / J FIRE  ·  SHIFT DASH  ·  M MUTE', cx, hintY);
      hintDrawn = true;
    }

    // ---- FULL SCREEN chip ----------------------------------------------------
    // The browser's address bar and tab strip eat real space, and on a phone that
    // is the difference between a playable arena and a cramped one. The game has
    // always ASKED for fullscreen on the first touch (Android only — see
    // wantsFullscreen()), but that request is a one-shot: the browser can refuse
    // it, the user can exit, and there was never a way to ask again.
    //
    // So this is the manual door. It draws only when a real fullscreen mode
    // exists (document.fullscreenEnabled) and we are not already in it — meaning
    // it never appears on iOS Safari, which has no element fullscreen at all, and
    // never on a desktop where the window is already the frame.
    this._fsChip = null;
    const canFs = typeof document !== 'undefined'
      && document.fullscreenEnabled
      && !document.fullscreenElement
      && (this.mobile || mob);
    if (canFs) {
      const fsH = 34;
      const fsLabel = 'TAP FOR FULL SCREEN';
      c.font = `700 ${mob ? 10 : 11}px ui-monospace, Menlo, monospace`;
      const fsW = (c.measureText ? c.measureText(fsLabel).width : 160) + 34;
      const fsX = cx - fsW / 2;
      // sit under the hint when there is one, otherwise tuck against the bottom
      const fsY = hintDrawn ? hintY + 10 : Math.min(modalY + chipH + 10, H - fsH - 6);
      if (fsY + fsH <= H - 4) {
        this._fsChip = { x: fsX, y: fsY, w: fsW, h: fsH };
        c.save();
        c.textAlign = 'center';
        c.fillStyle = 'rgba(110,245,255,0.10)';
        c.strokeStyle = 'rgba(110,245,255,0.55)';
        c.lineWidth = 1.4;
        roundRect(c, fsX, fsY, fsW, fsH, 8);
        c.fill(); c.stroke();
        c.fillStyle = '#9ffcff';
        c.fillText(fsLabel, cx, fsY + fsH / 2 + 3.5);
        c.restore();
      }
    }
    c.restore();
  }

  // The level card: what this level is, what it wants, and the one sentence that
  // explains the new idea. Shown for the first second and a half of every level.
  drawLevelCard(s, kind) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const L = s._lv || { name: '', quota: 0, time: 0, teach: '' };
    const isClear = kind === 'clear';
    const tone = isClear ? '#7dffb2' : '#ff4d6d';

    c.save();
    c.fillStyle = isClear ? 'rgba(4,14,10,0.86)' : 'rgba(10,4,8,0.88)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';

    const cx = W / 2, cy = H / 2;
    c.font = `800 ${mob ? 44 : 64}px ui-monospace, Menlo, monospace`;
    c.fillStyle = tone;
    c.shadowColor = tone;
    c.shadowBlur = 30;
    c.fillText(isClear ? 'CLEARED' : 'NOT ENOUGH', cx, cy - (mob ? 40 : 56));
    c.shadowBlur = 0;

    c.font = `800 ${mob ? 15 : 19}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#eafcff';
    c.fillText(`LEVEL ${s.level} — ${L.name}`, cx, cy + (mob ? 4 : 6));

    if (isClear) {
      c.font = `400 ${mob ? 12 : 15}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(160,200,185,0.9)';
      const next = (s.level + 1);
      const t = `${s.levelKills} / ${L.quota} kills · ${s.levelT.toFixed(0)}s of ${L.time}s`;
      c.fillText(t, cx, cy + (mob ? 30 : 38));
      c.fillStyle = 'rgba(125,255,178,0.75)';
      c.fillText(`+1 PULSE banked · clearing to level ${next}`, cx, cy + (mob ? 52 : 64));
    } else {
      c.font = `400 ${mob ? 12 : 15}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(255,190,200,0.95)';
      c.fillText(`${s.levelKills} / ${L.quota} kills — the clock ran out`, cx, cy + (mob ? 30 : 38));
      c.fillStyle = 'rgba(200,215,235,0.8)';
      c.fillText('Same level. Nothing lost. Go again.', cx, cy + (mob ? 52 : 64));
    }

    // the teaching line is the whole point of the card
    if (L.teach) {
      c.font = `italic 400 ${mob ? 12 : 15}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(255,209,102,0.92)';
      c.fillText(L.teach, cx, cy + (mob ? 86 : 100));
    }
    c.restore();
  }

  // The brief that appears at the start of a level, while the fight is frozen.
  drawTeach(s) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const L = s._lv || { name: '', quota: 0, time: 0, teach: '' };
    const cx = W / 2, cy = H / 2;

    c.save();
    c.fillStyle = 'rgba(4,6,12,0.72)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';

    // countdown ring: the card is a beat, not a modal, so it visibly runs out
    const frac = Math.max(0, Math.min(1, s.teachT / (s.levelState === 'teach' ? 1.7 : 1.5)));
    c.strokeStyle = 'rgba(110,245,255,0.85)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy - (mob ? 74 : 92), mob ? 16 : 20, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    c.stroke();

    c.font = `800 ${mob ? 11 : 13}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#9ffcff';
    c.fillText(`LEVEL ${s.level}`, cx, cy - (mob ? 38 : 46));

    c.font = `800 ${mob ? 22 : 32}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#eafcff';
    c.fillText(L.name, cx, cy - (mob ? 12 : 14));

    c.font = `400 ${mob ? 12 : 15}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(255,209,102,0.95)';
    c.fillText(L.teach || '', cx, cy + (mob ? 16 : 22));

    c.fillStyle = 'rgba(190,215,240,0.9)';
    c.font = `800 ${mob ? 13 : 16}px ui-monospace, Menlo, monospace`;
    // DEBT COLLECTOR has no kill quota, so it must not advertise one
    const goal = L.rule === 'overdraftWindow'
      ? 'SURVIVE 12s IN OVERDRAFT'
      : `${L.quota} KILLS IN ${L.time}s`;
    c.fillText(goal, cx, cy + (mob ? 46 : 58));
    c.restore();
  }

  // The augment picker. Geometry comes from layout.js — the SAME function the
  // input handler uses — so a card can never be drawn somewhere it cannot be
  // tapped. On a landscape phone the three cards sit in a ROW (the old column
  // pushed cards 2 and 3 below the bottom edge, which made this screen a dead end).
  drawPick(s) {
    this._pickSpace = this.mobile ? 'world' : 'ui';
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const lay = pickLayout(W, H, mob);
    this._pickLayout = lay;
    const cards = s.pick || [];

    c.save();
    c.fillStyle = 'rgba(4,5,10,0.86)';
    c.fillRect(0, 0, W, H);

    // header above the cards: on a landscape phone that is the top ~58px
    const headY = mob ? (lay.vertical ? 26 : 24) : 226;
    c.textAlign = 'center';
    c.font = `800 ${mob ? (lay.vertical ? 15 : 14) : 16}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#9ffcff';
    c.fillText(`LEVEL ${s.level} — CHOOSE AN UPGRADE`, W / 2, headY);
    c.font = `400 ${mob ? 11 : 13}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(160,190,215,0.6)';
    c.fillText(mob ? 'tap a card' : 'click a card, or press 1 / 2 / 3', W / 2, headY + (mob ? 16 : 24));

    const small = lay.cards[0].h < 150;
    cards.forEach((card, i) => {
      const box = lay.cards[i];
      if (!box) return;
      const hover = s.hoverCard === i;
      c.save();
      c.translate(box.x, box.y);
      c.fillStyle = hover ? 'rgba(110,245,255,0.10)' : 'rgba(12,20,34,0.95)';
      c.strokeStyle = hover ? '#6ff5ff' : 'rgba(110,245,255,0.35)';
      c.lineWidth = hover ? 2.5 : 1.5;
      c.shadowColor = hover ? 'rgba(110,245,255,0.55)' : 'transparent';
      c.shadowBlur = hover ? 26 : 0;
      roundRect(c, 0, 0, box.w, box.h, 10);
      c.fill(); c.stroke();
      c.shadowBlur = 0;

      const pad = small ? 14 : 22;
      c.textAlign = 'left';
      c.font = `700 ${small ? 10 : 11}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText('0' + (i + 1), pad, small ? 20 : 32);

      c.font = `800 ${small ? 17 : 24}px ui-monospace, Menlo, monospace`;
      c.fillStyle = '#eafcff';
      c.fillText(card.name, pad, small ? 46 : 78);

      c.font = `400 ${small ? 11 : 14}px ui-monospace, Menlo, monospace`;
      c.fillStyle = 'rgba(200,225,245,0.8)';
      wrapText(c, card.desc, pad, small ? 68 : 112, box.w - pad * 2, small ? 15 : 20);
      c.restore();
    });

    // ---- the escape hatch ----
    // A card screen with no way out is a dead end (this one was). SKIP keeps the
    // run moving and is always drawn, on every screen size.
    const sk = lay.skip;
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = 'rgba(10,18,30,0.95)';
    c.strokeStyle = 'rgba(160,190,215,0.45)';
    c.lineWidth = 1.4;
    roundRect(c, sk.x, sk.y, sk.w, sk.h, 8);
    c.fill(); c.stroke();
    c.textAlign = 'center';
    c.font = `700 ${mob ? 11 : 12}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(200,225,245,0.85)';
    c.fillText('SKIP · KEEP GOING', sk.x + sk.w / 2, sk.y + sk.h / 2 + 4);
    c.restore();
    c.restore();
  }

  // The death screen. Campaign and SIEGE share it because they share the failure
  // state (PULSE hit the floor) — but the numbers that matter differ, and so does
  // the leaderboard the run is filed in. The mini board sits to the right on a
  // wide screen and folds away on a phone where there is no room for columns.
  drawDead(s) {
    this._deadSpace = this.mobile ? 'world' : 'ui';
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const siege = !!s.siege;
    const wide = !mob && W >= 900;
    c.save();
    c.fillStyle = 'rgba(4,5,10,0.78)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';

    const dk = mob ? 0.6 : 1;
    const cx = wide ? W * 0.32 : W / 2;
    const headY = mob ? H * 0.2 : 176;

    c.font = `800 ${Math.round(76 * dk)}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#ff2d55';
    c.shadowColor = '#ff2d55';
    c.shadowBlur = mob ? 24 : 40;
    c.fillText(siege ? 'OVERWHELMED' : 'BANKRUPT', cx, headY);
    c.shadowBlur = 0;
    c.font = `400 ${mob ? 12 : 15}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(200,225,245,0.75)';
    c.fillText(
      siege ? 'the waves kept coming' : 'you ran out of pulse owing the trigger finger',
      cx, headY + (mob ? 24 : 32));

    const acc = s.shotsFired ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
    const best = this.bestScore || 0;
    const isBest = s.score > best && s.score > 0;
    const rows = siege
      ? [
          ['SURVIVED', fmtClock(s.siegeT)],
          ['WAVE', String(Math.max(1, s.wave2))],
          ['KILLS', String(s.siegeKills)],
          ['WEAPON', (s.weapon || SIEGE_WEAPONS[0]).name],
          ['SCORE', String(s.score)],
          ...(isBest ? [['', 'NEW BEST']] : best ? [['BEST', String(best)]] : []),
        ]
      : [
          ['SCORE', String(s.score)],
          ...(isBest ? [['', 'NEW BEST']] : best ? [['BEST', String(best)]] : []),
          ['LEVEL', String(s.level)],
          ['CLEARED', String(s.levelsCleared)],
          ['KILLS', String(s.kills)],
          ['ACCURACY', acc + '%'],
          ['BEST STREAK', String(s.bestStreak)],
        ];
    // ---- button block FIRST, so the stats can be fitted into what is left ------
    // The buttons are anchored to the bottom and the text grows downward from the
    // header. With two buttons those two blocks just about missed each other; with
    // three they overlapped, and the BEST row printed on top of SCORE.
    const bW = Math.min(mob ? 232 : 240, W - 60), bH = mob ? 46 : 44, bGap = 10;
    const bTop = H - sa3(this) - 10 - (bH * 3 + bGap * 2);

    const rowTop = headY + (mob ? 50 : 76);
    const spaceForRows = Math.max(60, bTop - 14 - rowTop);
    const step = Math.min(mob ? 26 : 30, spaceForRows / Math.max(1, rows.length));
    const rowY = rowTop;
    const colL = wide ? cx : W / 2;
    c.font = `700 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
    rows.forEach(([k, v], i) => {
      const y = rowY + i * step;
      c.textAlign = 'right';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText(k, colL - 14, y);
      c.textAlign = 'left';
      if (v === 'NEW BEST') {
        const p = (Math.sin(this.t * 8) + 1) / 2;
        c.fillStyle = `rgba(125,255,178,${0.65 + p * 0.35})`;
        c.font = `800 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
      } else {
        c.fillStyle = '#eafcff';
        c.font = `700 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
      }
      c.fillText(v, colL + 14, y);
    });

    // one-line verdict that sells the mechanic
    let verdict;
    if (siege) {
      verdict = s.siegeT < 45 ? 'The gun held. You did not.'
        : s.siegeT < 120 ? 'Nine seconds of greed, every single time.'
        : 'You lasted. The ladder just climbs faster than you do.';
    } else {
      verdict = 'You fired like it was free. It was not.';
      if (acc >= 70) verdict = 'Surgical. The ammo economy was on your side.';
      else if (acc >= 50) verdict = 'Decent aim. The misses are what killed you.';
      else if (acc >= 30) verdict = 'You spent more than you earned.';
    }
    // expose the verdict: the share card quotes the line the player just read, so
    // the image and the screen cannot disagree
    this.lastVerdict = verdict;

    // three real buttons, thumb-sized, so a failed run always has a way back
    // Anchored to the BOTTOM and built upward: the old version positioned
    // everything downward from a fixed rowY, which ran off a 375px-tall screen.
    const bX = colL - bW / 2;
    // SHARE goes first: the impulse to post a run lasts about five seconds, so the
    // button has to be the easiest thing on the screen to hit. Result is a PNG,
    // drawn locally, no upload and no permission prompt.
    const btns = [
      { id: 'share', label: 'SHARE MY RUN', tone: '#7dffb2', x: bX, y: bTop, w: bW, h: bH },
      { id: 'again', label: 'RUN IT BACK', tone: '#9ffcff', x: bX, y: bTop + bH + bGap, w: bW, h: bH },
      { id: 'menu', label: 'MAIN MENU · PICK MODE', tone: '#ffd166', x: bX, y: bTop + (bH + bGap) * 2, w: bW, h: bH },
    ];
    this._deadBtns = btns;
    for (const btn of btns) {
      c.globalAlpha = 0.96;
      c.fillStyle = 'rgba(10,18,30,0.95)';
      c.strokeStyle = btn.tone;
      c.lineWidth = 1.6;
      roundRect(c, btn.x, btn.y, btn.w, btn.h, 11);
      c.fill(); c.stroke();
      c.fillStyle = btn.tone;
      c.font = `800 ${mob ? 13 : 14}px ui-monospace, Menlo, monospace`;
      c.textAlign = 'center';
      c.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    }

    // ---- mini leaderboard ----
    // Local, top 5, one board per mode. The run that just ended is highlighted, so
    // you can see exactly where it landed instead of guessing.
    const board = this.board || { campaign: [], siege: [] };
    const list = siege ? board.siege : board.campaign;
    const just = this.lastRun || null;
    if (wide) {
      const bx = W * 0.55, bw = Math.min(430, W * 0.4);
      const top = 176;
      c.textAlign = 'left';
      c.font = '800 13px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.7)';
      c.fillText(siege ? 'SIEGE — LONGEST SURVIVED' : 'CAMPAIGN — TOP SCORES', bx, top);
      c.strokeStyle = 'rgba(110,245,255,0.22)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(bx, top + 10); c.lineTo(bx + bw, top + 10); c.stroke();
      if (!list.length) {
        c.font = '400 13px ui-monospace, Menlo, monospace';
        c.fillStyle = 'rgba(160,190,215,0.45)';
        c.fillText('no runs filed yet — this one is first', bx, top + 34);
      }
      list.forEach((r, i) => {
        const y = top + 34 + i * 30;
        const mine = just && r.ts === just.ts && r.score === just.score;
        c.font = `700 13px ui-monospace, Menlo, monospace`;
        c.fillStyle = mine ? '#7dffb2' : 'rgba(160,190,215,0.5)';
        c.fillText(String(i + 1).padStart(2, '0'), bx, y);
        c.fillStyle = mine ? '#eafcff' : 'rgba(220,235,250,0.85)';
        c.fillText(String(r.score).padStart(6, '0'), bx + 34, y);
        c.fillStyle = mine ? 'rgba(125,255,178,0.95)' : 'rgba(160,190,215,0.6)';
        c.textAlign = 'right';
        c.fillText(
          siege ? `${fmtClock(r.time)} · W${r.wave}` : `LV${r.level} · ${r.acc}%`,
          bx + bw, y);
        c.textAlign = 'left';
      });
      // desktop verdict lives under the stat rows
      c.textAlign = 'left';
      c.font = 'italic 400 14px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(255,209,102,0.9)';
      c.fillText(verdict, cx - 118, rowY + rows.length * step + 4);
    } else {
      // phones: one compact line about the board — a table would eat the buttons
      const bestRow = list[0];
      let slot = bTop - 8;
      c.textAlign = 'center';
      c.font = '700 10px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText(
        bestRow
          ? `BEST ${siege ? fmtClock(bestRow.time) + ' · WAVE ' + bestRow.wave : 'LV' + bestRow.level}`
          : 'NO RUNS FILED YET',
        colL, slot);
      slot -= 15;
      // the verdict only if there is genuinely room above the numbers
      if (slot > rowY + (rows.length - 1) * step + 12) {
        c.font = 'italic 400 11px ui-monospace, Menlo, monospace';
        c.fillStyle = 'rgba(255,209,102,0.9)';
        c.fillText(verdict, colL, slot);
      }
    }
    c.restore();
  }
}

// bottom safe-area inset, in the same units the death screen draws in
function sa3(r) {
  const s = r.safe || { bottom: 0 };
  return s.bottom || 0;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) {
      c.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) c.fillText(line, x, y);
}
