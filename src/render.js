// OVERDRAFT — renderer. Canvas2D, no assets, no dependencies.
import { W, H, MAX_PULSE, OVERDRAFT_FLOOR, ENEMY_TYPES } from './sim.js';

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
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
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
    const ww = cw, wh = ch;   // world units == CSS pixels (dpr only affects the backing store)
    if (this.mobile) {
      this.worldW = ww; this.worldH = wh;
      this.scale = 1;
      this.ox = 0; this.oy = 0;
    } else {
      // Desktop: keep a 16:9 arena but let it grow to fill a big monitor
      // instead of sitting as a small box in the middle of the screen.
      this.scale = Math.min(ww / W, wh / H);
      this.worldW = W; this.worldH = H;
      this.ox = (ww - W * this.scale) / 2;
      this.oy = (wh - H * this.scale) / 2;
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

  // page/client coords -> the surface the HUD uses (window px on desktop)
  toUI(sx, sy) {
    if (this.mobile) return this.toWorld(sx, sy);
    return { x: sx, y: sy };
  }

  draw(s, mouse, dt) {
    const c = this.ctx;
    this.t += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#04050a';
    c.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    const shake = s.shake;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;

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
    if (s.mode === 'title') this.drawTitle(s);
    if (s.mode === 'pick') this.drawPick(s);
    if (s.mode === 'dead') this.drawDead(s);
    c.restore();

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
      const fade = e.spawnT > 0 ? 1 - e.spawnT / 0.28 : 1;
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

    // top-left: score
    c.save();
    c.font = '700 13px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.55)';
    c.textAlign = 'left';
    c.fillText('SCORE', 24 + padL, 26 + topPad);
    c.font = `700 ${Math.round(30 * uiK)}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#dff6ff';
    c.shadowColor = 'rgba(110,245,255,0.5)';
    c.shadowBlur = 14;
    c.fillText(String(s.score).padStart(6, '0'), 22 + padL, 22 + topPad + 30 * uiK);
    c.restore();

    // top-right: wave + kills
    c.save();
    c.textAlign = 'right';
    c.font = '700 13px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.55)';
    c.fillText('WAVE', W - 24 - padR, 26 + topPad);
    c.font = `700 ${Math.round(30 * uiK)}px ui-monospace, Menlo, monospace`;
    c.fillStyle = over ? '#ff5f6d' : '#dff6ff';
    c.fillText(String(s.wave).padStart(2, '0'), W - 22 - padR, 22 + topPad + 30 * uiK);
    c.font = '700 12px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.5)';
    c.fillText(`${s.kills} KILLS · ${Math.round(s.shotsFired ? (s.shotsHit / s.shotsFired) * 100 : 0)}% ACC`, W - 24 - padR, 18 + topPad + 30 * uiK + 18);
    c.restore();

    // wave timer bar
    const bw = 220;
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fillRect(W / 2 - bw / 2, 18 + topPad, bw, 3);
    c.fillStyle = over ? '#ff5f6d' : 'rgba(110,245,255,0.7)';
    c.fillRect(W / 2 - bw / 2, 18 + topPad, bw * Math.min(1, s.waveT / s.waveLen), 3);
    c.restore();

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

    // ---- PULSE bar ----
    const total = p.maxHp;
    const negCount = Math.abs(OVERDRAFT_FLOOR);
    const full = total + negCount;
    const maxBar = W - (mob ? 96 : 160);
    let segW = mob ? 22 : 30;
    const gap = mob ? 3 : 5;
    if (full * segW + (full - 1) * gap > maxBar) segW = Math.max(7, (maxBar - (full - 1) * gap) / full);
    const barW = full * segW + (full - 1) * gap;
    const bx = W / 2 - barW / 2;
    const by = H - (mob ? 46 + botPad : 62);
    const segH = mob ? 16 : 20;

    c.save();
    c.font = '700 11px ui-monospace, Menlo, monospace';
    c.textAlign = 'left';
    c.fillStyle = over ? '#ff5f6d' : 'rgba(160,190,215,0.6)';
    const hpShown = Math.max(OVERDRAFT_FLOOR, Math.min(p.maxHp, p.hp));
    c.fillText(over ? `OVERDRAFT ${hpShown.toFixed(0)}` : `PULSE ${Math.floor(hpShown)}/${p.maxHp}`, bx, by - 9);
    if (over) {
      const blink = Math.sin(this.t * 12) > 0;
      c.textAlign = 'right';
      c.fillStyle = blink ? '#ff2d55' : 'rgba(255,45,85,0.35)';
      c.fillText('KILL TO REPAY', bx + barW, by - 10);
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
        const negIdx = OVERDRAFT_FLOOR + (i - total); // -3,-2,-1
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

      // mode badge, clickable
      const auto = s.fireMode === 'auto';
      const label = auto ? 'TURRET · TAB' : 'MARKSMAN · TAB';
      c.save();
      c.font = '700 11px ui-monospace, Menlo, monospace';
      const tw = c.measureText(label).width + 20;
      const bx = W - 30 - pr * 2 - 12 - tw, by = 18;
      this._deskMode = { x: bx, y: by, w: tw, h: 24 };
      c.globalAlpha = 0.9;
      c.fillStyle = auto ? 'rgba(125,255,178,0.14)' : 'rgba(255,209,102,0.14)';
      c.strokeStyle = auto ? '#7dffb2' : '#ffd166';
      c.lineWidth = 1.5;
      roundRect(c, bx, by, tw, 24, 12);
      c.fill(); c.stroke();
      c.fillStyle = auto ? '#c8ffdc' : '#ffe9b8';
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
  controlLayout() {
    const W = this.worldW, H = this.worldH;
    const short = Math.min(W, H);
    const R = Math.max(46, Math.min(short * 0.115, 96));   // button radius
    const pad = Math.max(18, short * 0.045);               // screen-edge padding
    const gap = R * 0.34;

    const stick = { x: pad + R, y: H - pad - R, r: R };
    const dash  = { x: pad + R, y: H - pad - R * 2 - gap - R, r: R * 0.78 };
    const fire  = { x: W - pad - R, y: H - pad - R, r: R * 1.06 };
    const mode  = { x: W - pad - R, y: H - pad - R * 2 - gap - R * 0.9, r: R * 0.62 };
    const pause = { x: W - pad - R * 0.5, y: pad + R * 0.5, r: R * 0.46 };
    const gyro  = { x: pad + R * 0.5, y: pad + R * 0.5, r: R * 0.46 };

    return { R, pad, stick, dash, fire, mode, pause, gyro, W, H };
  }

  // generous hit radius: +14px of slop so thumbs forgive
  hit(cx, cy, btn) {
    if (!btn) return false;
    return (cx - btn.x) ** 2 + (cy - btn.y) ** 2 < (btn.r + 14) ** 2;
  }

  drawTouchControls(s, input) {
    if (!this.mobile) return;
    const c = this.ctx;
    const L = this.controlLayout();
    const auto = s.fireMode === 'auto';
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
    c.fillText(auto ? 'AUTO' : 'FIRE', L.fire.x, L.fire.y + L.fire.r * 0.72);
    // charge ring = how many shots the budget allows
    const afford = Math.max(0, Math.floor(s.player.hp - 3));
    c.globalAlpha = 0.85;
    c.strokeStyle = hostile ? '#ff3b5c' : (auto ? '#7dffb2' : '#6ff5ff');
    c.lineWidth = 3.5;
    c.beginPath();
    c.arc(L.fire.x, L.fire.y, L.fire.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, afford / 8));
    c.stroke();
    c.restore();

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

    // ---------- gyro toggle (top-left corner) ----------
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

  drawTitle(s) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    const mob = this.mobile;
    const k = mob ? 0.44 : 1;          // text scale
    const cx = W / 2;
    const cy = H * (mob ? 0.36 : 0.34);
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
    c.font = `700 ${Math.round(20 * (mob ? 0.8 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(210,235,255,0.92)';
    c.fillText('YOUR HEALTH BAR IS THE MAGAZINE.', cx, cy + 46 * (mob ? 0.7 : 1));

    c.font = `400 ${Math.round(15 * (mob ? 0.85 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = 'rgba(160,190,215,0.72)';
    c.fillText('Every shot costs 1 PULSE. Every kill pays it back.', cx, cy + (mob ? 78 : 82));
    c.fillStyle = 'rgba(255,95,109,0.85)';
    c.fillText(mob ? 'Miss enough and you die.' : 'Miss enough and you die of your own trigger finger.', cx, cy + (mob ? 100 : 106));

    // pulse bar preview
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

    // call to action
    const blink = (Math.sin(this.t * 3.4) + 1) / 2;
    c.textAlign = 'center';
    c.globalAlpha = 0.55 + blink * 0.45;
    c.font = `800 ${Math.round(22 * (mob ? 0.82 : 1))}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#9ffcff';
    c.shadowColor = 'rgba(110,245,255,0.8)';
    c.shadowBlur = 20;
    // ---- mode selector: the two modes have different rules, so lead with it ----
    const modalY = cy + (mob ? 158 : 172);
    const chipW = mob ? 132 : 176, chipH = mob ? 44 : 52, chipGap = mob ? 10 : 16;
    const chipX = cx - (chipW * 2 + chipGap) / 2;
    const modes = [
      { id: 'manual', label: 'MARKSMAN', sub: 'you aim · misses ricochet' },
      { id: 'auto', label: 'TURRET', sub: 'auto-fire · tight budget' },
    ];
    for (let i = 0; i < 2; i++) {
      const m = modes[i];
      const on = (s.fireMode || 'auto') === m.id;
      const x = chipX + i * (chipW + chipGap);
      c.save();
      c.globalAlpha = on ? 1 : 0.55;
      c.fillStyle = on ? (m.id === 'auto' ? 'rgba(125,255,178,0.14)' : 'rgba(255,209,102,0.14)') : 'rgba(12,20,34,0.9)';
      c.strokeStyle = on ? (m.id === 'auto' ? '#7dffb2' : '#ffd166') : 'rgba(160,190,215,0.4)';
      c.lineWidth = on ? 2.5 : 1.5;
      roundRect(c, x, modalY, chipW, chipH, 8);
      c.fill(); c.stroke();
      c.fillStyle = on ? '#eafcff' : 'rgba(220,235,250,0.8)';
      c.textAlign = 'center';
      c.font = `800 ${mob ? 13 : 15}px ui-monospace, Menlo, monospace`;
      c.fillText(m.label, x + chipW / 2, modalY + (mob ? 19 : 22));
      c.globalAlpha = on ? 0.7 : 0.4;
      c.font = `400 ${mob ? 8 : 10}px ui-monospace, Menlo, monospace`;
      c.fillText(m.sub, x + chipW / 2, modalY + (mob ? 33 : 39));
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
    if (mob) {
      c.fillText('left thumb: move   ·   right thumb: aim + fire', cx, cy + 232);
    } else {
      c.fillText('WASD / ARROWS MOVE  ·  MOUSE AIM  ·  CLICK FIRE  ·  SHIFT DASH  ·  M MUTE', cx, cy + 260);
    }
    c.restore();
  }

  drawPick(s) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    c.save();
    c.fillStyle = 'rgba(4,5,10,0.82)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.font = '800 16px ui-monospace, Menlo, monospace';
    c.fillStyle = '#9ffcff';
    const mob0 = this.mobile;
    c.fillText('WAVE CLEARED — TAKE ONE AUGMENT', W / 2, mob0 ? H * 0.18 : 226);
    c.font = '400 13px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(160,190,215,0.6)';
    c.fillText(mob0 ? 'tap one' : 'click a card, or press 1 / 2 / 3', W / 2, mob0 ? H * 0.18 + 24 : 252);

    const cards = s.pick || [];
    const mob = this.mobile;
    const cw = mob ? Math.min(W - 56, 320) : 260;
    const chh = mob ? 132 : 190;
    const gap = mob ? 14 : 30;
    const vertical = mob;
    const totalW = vertical ? cw : cards.length * cw + (cards.length - 1) * gap;
    const startX = W / 2 - totalW / 2;
    const y = vertical ? H * 0.3 : 300;
    cards.forEach((card, i) => {
      const x = vertical ? startX : startX + i * (cw + gap);
      const yOff = vertical ? i * (chh + gap) : 0;
      const hover = s.hoverCard === i;
      c.save();
      c.translate(x, y + yOff);
      if (hover) c.translate(0, -8);
      c.fillStyle = hover ? 'rgba(110,245,255,0.10)' : 'rgba(12,20,34,0.95)';
      c.strokeStyle = hover ? '#6ff5ff' : 'rgba(110,245,255,0.35)';
      c.lineWidth = hover ? 2.5 : 1.5;
      c.shadowColor = hover ? 'rgba(110,245,255,0.55)' : 'transparent';
      c.shadowBlur = hover ? 26 : 0;
      roundRect(c, 0, 0, cw, chh, 10);
      c.fill(); c.stroke();
      c.shadowBlur = 0;

      c.textAlign = 'left';
      c.font = '700 11px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText('0' + (i + 1), 22, 32);

      c.font = '800 24px ui-monospace, Menlo, monospace';
      c.fillStyle = '#eafcff';
      c.fillText(card.name, 22, 78);

      c.font = '400 14px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(200,225,245,0.8)';
      wrapText(c, card.desc, 22, 112, cw - 44, 20);
      c.restore();
    });
    c.restore();
  }

  drawDead(s) {
    const c = this.ctx;
    const W = this.uiW, H = this.uiH;
    c.save();
    c.fillStyle = 'rgba(4,5,10,0.72)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';

    const mob = this.mobile;
    const dk = mob ? 0.6 : 1;
    c.font = `800 ${Math.round(84 * dk)}px ui-monospace, Menlo, monospace`;
    c.fillStyle = '#ff2d55';
    c.shadowColor = '#ff2d55';
    c.shadowBlur = 40;
    c.fillText('BANKRUPT', W / 2, mob ? H * 0.26 : 250);
    c.shadowBlur = 0;
    c.font = '400 15px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(200,225,245,0.75)';
    c.fillText(mob ? 'out of pulse' : 'you ran out of pulse owing the trigger finger', W / 2, (mob ? H * 0.26 : 250) + 34);

    const acc = s.shotsFired ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
    const rows = [
      ['SCORE', String(s.score)],
      ['WAVE', String(s.wave)],
      ['KILLS', String(s.kills)],
      ['ACCURACY', acc + '%'],
      ['BEST STREAK', String(s.bestStreak)],
    ];
    c.font = '700 15px ui-monospace, Menlo, monospace';
    const rowY = mob ? H * 0.38 : 350;
    rows.forEach(([k, v], i) => {
      const y = rowY + i * (mob ? 28 : 34);
      c.textAlign = 'right';
      c.fillStyle = 'rgba(160,190,215,0.55)';
      c.fillText(k, W / 2 - 16, y);
      c.textAlign = 'left';
      c.fillStyle = '#eafcff';
      c.fillText(v, W / 2 + 16, y);
    });

    // one-line verdict that sells the mechanic
    let verdict = 'You fired like it was free. It was not.';
    if (acc >= 70) verdict = 'Surgical. The ammo economy was on your side.';
    else if (acc >= 50) verdict = 'Decent aim. The misses are what killed you.';
    else if (acc >= 30) verdict = 'You spent more than you earned.';
    c.textAlign = 'center';
    c.font = 'italic 400 16px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(255,209,102,0.9)';
    c.fillText(verdict, W / 2, rowY + (mob ? 190 : 190));

    const blink = (Math.sin(this.t * 3.4) + 1) / 2;
    c.globalAlpha = 0.5 + blink * 0.5;
    c.font = '800 20px ui-monospace, Menlo, monospace';
    c.fillStyle = '#9ffcff';
    c.fillText(mob ? 'TAP TO RUN IT BACK' : 'PRESS R / TAP TO RUN IT BACK', W / 2, rowY + (mob ? 240 : 250));
    c.restore();
  }
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
