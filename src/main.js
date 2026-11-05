// OVERDRAFT — input, loop, glue.
import { createState, startRun, step, chooseCard, W, H } from './sim.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';

const canvas = document.getElementById('c');
const renderer = new Renderer(canvas);
const sfx = new Sfx();

const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const AUTOSTART = params.get('autostart') === '1';

const state = createState((Date.now() % 100000) | 0);
state.hermes = DEMO;

const input = {
  ax: 0, ay: 0,
  aimX: W / 2, aimY: H / 2 - 100,
  fire: false,
  dash: false,
};

const keys = new Set();
let paused = false;

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

  if (k === 'm') { const m = sfx.toggleMute(); toast(m ? 'MUTED' : 'SOUND ON'); }
  if (k === 'p') { paused = !paused; }
  if (k === 'r' && state.mode !== 'title') { sfx.ensure(); startRun(state); }
  if (k === ' ' || k === 'enter') {
    sfx.ensure();
    if (state.mode === 'title') startRun(state);
    else if (state.mode === 'dead') startRun(state);
  }
  if (['1', '2', '3'].includes(k) && state.mode === 'pick') {
    chooseCard(state, Number(k) - 1);
  }
  if (k === 'shift') input.dash = true;
  if (k === ' ' && state.mode === 'play') input.dash = true;
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'shift' || e.key === ' ') input.dash = false;
});
window.addEventListener('blur', () => { keys.clear(); input.fire = false; });

// ---------------------------------------------------------------------------
// pointer: mouse aim + fire, touch sticks
// ---------------------------------------------------------------------------
let mouse = { x: W / 2, y: H / 2 - 100, down: false, active: false };
let isTouch = false;

const touches = new Map(); // pointerId -> { kind:'move'|'aim', ox, oy, x, y }
let moveStick = null;

canvas.addEventListener('pointerdown', (e) => {
  sfx.ensure();
  canvas.setPointerCapture?.(e.pointerId);
  if (e.pointerType === 'touch') isTouch = true;

  if (state.mode === 'title' || state.mode === 'dead') {
    startRun(state);
    if (e.pointerType !== 'touch') { mouse.down = true; mouse.active = true; input.fire = true; }
    return;
  }
  if (state.mode === 'pick') {
    const w = renderer.toWorld(e.clientX, e.clientY);
    const idx = cardIndexAt(w.x, w.y, state);
    if (idx >= 0) chooseCard(state, idx);
    return;
  }

  if (e.pointerType === 'touch') {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const leftSide = sx < rect.width * 0.45;
    const kind = leftSide && ![...touches.values()].some((t) => t.kind === 'move') ? 'move' : 'aim';
    const t = { kind, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
    touches.set(e.pointerId, t);
    if (kind === 'move') moveStick = t;
    if (kind === 'aim') {
      const w = renderer.toWorld(e.clientX, e.clientY);
      input.aimX = w.x; input.aimY = w.y;
      input.fire = true;
    }
  } else {
    mouse.down = true;
    mouse.active = true;
    input.fire = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (t.kind === 'move') {
      const dx = t.x - t.ox, dy = t.y - t.oy;
      const max = 62;
      const m = Math.hypot(dx, dy);
      const s = m > max ? max / m : 1;
      const nx = dx * s, ny = dy * s;
      input.ax = m < 10 ? 0 : nx / max;
      input.ay = m < 10 ? 0 : ny / max;
    } else {
      const w = renderer.toWorld(e.clientX, e.clientY);
      input.aimX = w.x; input.aimY = w.y;
      input.fire = true;
    }
    return;
  }
  // mouse
  const w = renderer.toWorld(e.clientX, e.clientY);
  mouse.x = w.x; mouse.y = w.y;
  mouse.active = true;
  if (state.mode === 'pick') {
    state.hoverCard = cardIndexAt(w.x, w.y, state);
    canvas.style.cursor = state.hoverCard >= 0 ? 'pointer' : 'default';
  } else {
    canvas.style.cursor = 'crosshair';
  }
});

function endPointer(e) {
  if (e.pointerType === 'touch') {
    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (t && t.kind === 'move') {
      moveStick = null;
      input.ax = 0; input.ay = 0;
      // double-tap-ish quick tap on the stick = dash
      if (performance.now() - t.t0 < 130 && Math.hypot(t.x - t.ox, t.y - t.oy) < 14) input.dash = true;
    }
    if (t && t.kind === 'aim') {
      const anyAim = [...touches.values()].some((q) => q.kind === 'aim');
      if (!anyAim) input.fire = false;
    }
  } else {
    mouse.down = false;
    input.fire = false;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// card hit testing
// ---------------------------------------------------------------------------
function cardIndexAt(wx, wy, s) {
  const cards = s.pick || [];
  const cw = 260, chh = 190, gap = 30;
  const totalW = cards.length * cw + (cards.length - 1) * gap;
  const startX = W / 2 - totalW / 2;
  const y = 300;
  for (let i = 0; i < cards.length; i++) {
    const x = startX + i * (cw + gap);
    if (wx >= x && wx <= x + cw && wy >= y - 8 && wy <= y + chh) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// demo bot (attract mode) — plays competently so you can record instantly.
// ---------------------------------------------------------------------------
function demoInput(s) {
  const p = s.player;
  let best = null, bd = Infinity;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  const out = { ax: 0, ay: 0, aimX: p.x, aimY: p.y - 100, fire: false, dash: false };
  if (!best) {
    out.aimX = p.x + Math.cos(s.time) * 100;
    out.aimY = p.y + Math.sin(s.time) * 100;
    return out;
  }
  const d = Math.sqrt(bd) || 1;
  const ux = (best.x - p.x) / d, uy = (best.y - p.y) / d;

  // lead the target, then add a little hand-shake so the footage looks human
  const lead = 0.09;
  let tx = best.x + best.vx * lead;
  let ty = best.y + best.vy * lead;
  const shake = Math.sin(s.time * 5.1) * 9 + Math.sin(s.time * 13.7) * 4;
  const perp = Math.atan2(ty - p.y, tx - p.x) + Math.PI / 2;
  tx += Math.cos(perp) * shake;
  ty += Math.sin(perp) * shake;
  out.aimX = tx; out.aimY = ty;

  // keep distance, and strafe so it reads as deliberate play
  const want = 265;
  const radial = d < want - 70 ? -1 : d > want + 70 ? 1 : 0;
  const strafe = p.hp < 2.5 ? 0.9 : 0.55;
  out.ax = ux * radial + -uy * strafe * Math.sign(Math.sin(s.time * 0.9) || 1);
  out.ay = uy * radial + ux * strafe * Math.sign(Math.sin(s.time * 0.9) || 1);

  // hold fire when the pulse is low and nothing is close: let the economy breathe
  const aligned = Math.abs(Math.atan2(out.aimY - p.y, out.aimX - p.x) - p.aim) < 0.20;
  const desperate = p.hp <= 2.5;
  const commit = !desperate || d < 190 || p.hp <= 0;
  out.fire = d < 560 && aligned && commit && p.hp > 0.5;

  if (d < 130 && p.dashCd <= 0) out.dash = true;
  // stay inside the tightest crop (portrait phones) so the demo always reads on camera
  if (p.x < 250) out.ax += 0.9;
  if (p.x > W - 250) out.ax -= 0.9;
  if (p.y < 210) out.ay += 0.9;
  if (p.y > H - 210) out.ay -= 0.9;
  // small deadzone so it doesn't jitter like a machine
  const m = Math.hypot(out.ax, out.ay);
  if (m > 0 && m < 0.18) { out.ax = 0; out.ay = 0; }
  return out;
}

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;
const FIXED = 1 / 60;
let fpsT = 0, frames = 0;

function frame(now) {
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, rawDt);
  acc += dt;

  // gather keyboard into input
  if (!isTouch) {
    const kbx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const kby = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (kbx || kby) { input.ax = kbx; input.ay = kby; }
    else if (!touches.size) { input.ax = 0; input.ay = 0; }
    if (mouse.active) { input.aimX = mouse.x; input.aimY = mouse.y; }
    if (mouse.down) input.fire = true;
    input.dash = input.dash || keys.has('shift') || (keys.has(' ') && state.mode === 'play');
  }

  while (acc >= FIXED) {
    let stepInput = input;
    if (DEMO && state.mode === 'play') stepInput = demoInput(state);
    step(state, FIXED, stepInput);
    acc -= FIXED;
    input.dash = false;
    handleEvents();
  }

  if (state.mode === 'dead') state.deadT += dt;

  renderer.draw(state, mouse, dt);
  if (paused) drawPause();

  // fps badge (dev only via ?debug=1)
  frames++; fpsT += dt;
  if (params.get('debug') === '1' && fpsT > 0.5) {
    const c = renderer.ctx;
    c.save();
    c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    c.font = '11px monospace';
    c.fillStyle = '#4ade80';
    c.fillText(`${Math.round(frames / fpsT)} fps · ${state.enemies.length} ent`, 8, 14);
    c.restore();
    frames = 0; fpsT = 0;
  }

  requestAnimationFrame(frame);
}

let overdraftOn = false;
function handleEvents() {
  const over = state.player.hp <= 0 && state.mode !== 'title';
  if (over && !overdraftOn) { sfx.overdraftOn(); overdraftOn = true; }
  if (!over && overdraftOn) { sfx.overdraftOff(); overdraftOn = false; }

  for (const ev of state.events) {
    switch (ev.type) {
      case 'shoot': sfx.shoot(ev.over); break;
      case 'hit': sfx.hit(); break;
      case 'kill': sfx.kill(); break;
      case 'overdraftKill': sfx.orb(); toast('REPAID'); break;
      case 'hurt': sfx.hurt(); break;
      case 'dash': sfx.dash(); break;
      case 'wave': sfx.wave(); break;
      case 'card': toast(ev.name); break;
    }
  }
  // heartbeat when critical (non-overdraft, low pulse)
  if (state.mode === 'play' && state.player.hp > 0 && state.player.hp <= 1.5) {
    hbT -= FIXED;
    if (hbT <= 0) { sfx.heartbeat(0.7); hbT = 0.75; }
  }
}
let hbT = 0;

function drawPause() {
  const c = renderer.ctx;
  c.save();
  c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  const w = canvas.width / renderer.dpr, h = canvas.height / renderer.dpr;
  c.fillStyle = 'rgba(4,5,10,0.72)';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#9ffcff';
  c.font = '800 28px ui-monospace, monospace';
  c.textAlign = 'center';
  c.fillText('PAUSED', w / 2, h / 2);
  c.font = '400 13px ui-monospace, monospace';
  c.fillStyle = 'rgba(160,190,215,0.7)';
  c.fillText('press P to resume', w / 2, h / 2 + 26);
  c.restore();
}

// tiny transient toast
let toastMsg = '', toastT = 0;
function toast(m) { toastMsg = m; toastT = 1.1; }
(function toastLoop() {
  if (toastT > 0) {
    const c = renderer.ctx;
    c.save();
    c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    const w = canvas.width / renderer.dpr, h = canvas.height / renderer.dpr;
    c.globalAlpha = Math.min(1, toastT * 2);
    c.font = '700 12px ui-monospace, monospace';
    c.fillStyle = '#ffd166';
    c.textAlign = 'center';
    c.fillText(toastMsg, w / 2, h - 24);
    c.restore();
  }
  requestAnimationFrame(toastLoop);
})();

// resize canvas backing store on orientation change
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 120));

if (AUTOSTART) startRun(state);
requestAnimationFrame(frame);

// test / automation hooks
window.__OVERDRAFT = {
  state,
  start: () => startRun(state),
  step: (n, inp) => { for (let i = 0; i < n; i++) step(state, 1 / 60, inp || input); },
  renderer,
};
