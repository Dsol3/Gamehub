// OVERDRAFT — input, loop, glue.
import { createState, startRun, step, chooseCard, setWorld as sim_setWorld, W, H } from './sim.js';
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
// the arena becomes whatever screen we're on
sim_setWorld(state, renderer.worldW, renderer.worldH);
if (renderer.mobile) state.aimAssist = 0.26;

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
  if (k === 'escape' && document.pointerLockElement) document.exitPointerLock?.();
  if (k === 'p') { paused = !paused; }
  if (k === 'tab') { e.preventDefault(); toggleFireMode(); }
  if (k === 'r' && state.mode !== 'title') { sfx.ensure(); startRun(state); }
  if (k === ' ' || k === 'enter') {
    sfx.ensure();
    if (state.mode === 'title' || state.mode === 'dead') {
      startRun(state);
      state.fireMode = chosenMode;
      mouse.x = state.player.x; mouse.y = state.player.y - 120;
      input.aimX = mouse.x; input.aimY = mouse.y;
    }
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

  if (state.mode === 'title') {
    // hit-test the two mode chips first, so picking a mode doesn't start the run
    const ui = renderer.toUI(e.clientX, e.clientY);
    const chips = renderer._modeChips;
    if (chips && ui.y >= chips.y - 8 && ui.y <= chips.y + chips.h + 8) {
      for (let i = 0; i < 2; i++) {
        const x = chips.x + i * (chips.w + chips.gap);
        if (ui.x >= x && ui.x <= x + chips.w) {
          setFireMode(i === 0 ? 'manual' : 'auto');
          return;
        }
      }
    }
    startRun(state);
    state.fireMode = chosenMode;
    if (e.pointerType !== 'touch') { mouse.down = true; mouse.active = true; input.fire = true; }
    return;
  }
  if (state.mode === 'dead') {
    startRun(state);
    state.fireMode = chosenMode;
    if (e.pointerType !== 'touch') { mouse.down = true; mouse.active = true; input.fire = true; }
    return;
  }
  if (state.mode === 'pick') {
    const ui = renderer.toUI(e.clientX, e.clientY);
    const idx = cardIndexAt(ui.x, ui.y, state);
    if (idx >= 0) chooseCard(state, idx);
    return;
  }

  if (e.pointerType === 'touch') {
    const w = renderer.toWorld(e.clientX, e.clientY);
    const L = renderer.controlLayout();

    // top corner buttons first: they overlap nothing else
    if (renderer.hit(w.x, w.y, L.pause)) { paused = !paused; return; }
    if (renderer.hit(w.x, w.y, L.gyro)) {
      if (gyro.on) { disableGyro(); renderer.gyroOn = false; }
      else enableGyro().then((ok) => { renderer.gyroOn = ok; });
      return;
    }
    if (renderer.hit(w.x, w.y, L.mode)) { toggleFireMode(); return; }
    if (renderer.hit(w.x, w.y, L.dash)) { input.dash = true; return; }

    // A button = fire. In AUTO it only records a tap; the turret fires anyway.
    if (renderer.hit(w.x, w.y, L.fire)) {
      const t = { kind: 'fire', ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
      touches.set(e.pointerId, t);
      input.fire = true;
      return;
    }

    // right side but outside the A button = aim (MANUAL only)
    if (w.x > L.W * 0.5 && state.fireMode === 'manual') {
      const t = { kind: 'aim', ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
      touches.set(e.pointerId, t);
      input.aimX = w.x; input.aimY = w.y;
      input.fire = true;
      return;
    }

    // left side = movement stick
    const t = { kind: 'move', ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
    touches.set(e.pointerId, t);
    moveStick = t;
    return;
  } else {
    // desktop chrome: pause circle and mode badge are clickable
    const ui = renderer.toUI(e.clientX, e.clientY);
    const dp = renderer._deskPause;
    if (dp && (ui.x - dp.x) ** 2 + (ui.y - dp.y) ** 2 < (dp.r + 8) ** 2) { paused = !paused; return; }
    const dm = renderer._deskMode;
    if (dm && ui.x >= dm.x && ui.x <= dm.x + dm.w && ui.y >= dm.y && ui.y <= dm.y + dm.h) {
      toggleFireMode(); return;
    }
    mouse.down = true;
    mouse.active = true;
    input.fire = true;
    if (state.wantLock && state.mode === 'play' && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
      state.wantLock = false;
    }
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
    } else if (t.kind === 'aim') {
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
    const ui = renderer.toUI(e.clientX, e.clientY);
    state.hoverCard = cardIndexAt(ui.x, ui.y, state);
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
    if (t && (t.kind === 'aim' || t.kind === 'fire')) {
      const stillHeld = [...touches.values()].some((q) => q.kind === 'aim' || q.kind === 'fire');
      if (!stillHeld) input.fire = false;
    }
  } else {
    mouse.down = false;
    input.fire = false;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Mouse aim works two ways: locked (relative movement, ideal for a shooter) and
// free (absolute position, used before the first click and on the menus).
document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === canvas;
  canvas.style.cursor = state.locked ? 'none' : 'crosshair';
});

document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  // relative -> world deltas, scaled the same way the arena is scaled
  const k = 1 / renderer.scale;
  mouse.x = Math.max(0, Math.min(renderer.worldW, mouse.x + e.movementX * k));
  mouse.y = Math.max(0, Math.min(renderer.worldH, mouse.y + e.movementY * k));
  input.aimX = mouse.x;
  input.aimY = mouse.y;
});

// ---------------------------------------------------------------------------
// fire modes
// ---------------------------------------------------------------------------
function toggleFireMode() {
  const next = state.fireMode === 'auto' ? 'manual' : 'auto';
  setFireMode(next);
}

let chosenMode = 'auto';
function setFireMode(mode) {
  chosenMode = mode;
  state.fireMode = mode;
  const m = mode === 'auto' ? 'TURRET · AUTO-FIRE' : 'MARKSMAN · YOU AIM';
  toast(m);
  renderer.modeFlash = 1;
}

// ---------------------------------------------------------------------------
// gyroscope: tilt the phone to steer (opt-in, needs a user gesture on iOS)
// ---------------------------------------------------------------------------
const gyro = { on: false, x: 0, y: 0, base: null, supported: false, asked: false };

gyro.supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

function onOrientation(e) {
  if (!gyro.on) return;
  // beta = front/back tilt, gamma = left/right tilt, in degrees
  const beta = e.beta || 0;
  const gamma = e.gamma || 0;
  if (!gyro.base) gyro.base = { beta, gamma };
  // 22 degrees of tilt = full speed; inverted so tilting away moves up
  const nx = Math.max(-1, Math.min(1, (gamma - gyro.base.gamma) / 22));
  const ny = Math.max(-1, Math.min(1, (beta - gyro.base.beta) / 22));
  gyro.x = nx; gyro.y = ny;
}

async function enableGyro() {
  if (!gyro.supported) { toast('NO GYROSCOPE'); return false; }
  try {
    // iOS 13+ requires an explicit permission prompt from a gesture
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') { toast('GYRO DENIED'); return false; }
    }
    window.addEventListener('deviceorientation', onOrientation);
    gyro.on = true;
    gyro.base = null;
    toast('GYRO ON · TILT TO MOVE');
    return true;
  } catch (err) {
    toast('GYRO UNAVAILABLE');
    return false;
  }
}

function disableGyro() {
  window.removeEventListener('deviceorientation', onOrientation);
  gyro.on = false; gyro.x = 0; gyro.y = 0; gyro.base = null;
}

// ---------------------------------------------------------------------------
// card hit testing
// ---------------------------------------------------------------------------
function cardIndexAt(wx, wy, s) {
  const cards = s.pick || [];
  const mob = renderer.mobile;
  const W = renderer.uiW, H = renderer.uiH;
  const cw = mob ? Math.min(W - 56, 320) : 260;
  const chh = mob ? 132 : 190;
  const gap = mob ? 14 : 30;
  const totalW = mob ? cw : cards.length * cw + (cards.length - 1) * gap;
  const startX = W / 2 - totalW / 2;
  const y = mob ? H * 0.3 : 300;
  for (let i = 0; i < cards.length; i++) {
    const x = mob ? startX : startX + i * (cw + gap);
    const yy = y + (mob ? i * (chh + gap) : 0);
    if (wx >= x && wx <= x + cw && wy >= yy - 8 && wy <= yy + chh) return i;
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
  const want = 265 * (s.es || 1);
  const radial = d < want - 70 ? -1 : d > want + 70 ? 1 : 0;
  const strafe = p.hp < 2.5 ? 0.9 : 0.55;
  out.ax = ux * radial + -uy * strafe * Math.sign(Math.sin(s.time * 0.9) || 1);
  out.ay = uy * radial + ux * strafe * Math.sign(Math.sin(s.time * 0.9) || 1);

  // hold fire when the pulse is low and nothing is close: let the economy breathe
  const aligned = Math.abs(Math.atan2(out.aimY - p.y, out.aimX - p.x) - p.aim) < 0.20;
  const desperate = p.hp <= 2.5;
  const commit = !desperate || d < 190 * (s.es || 1) || p.hp <= 0;
  out.fire = d < 560 * (s.es || 1) && aligned && commit && p.hp > 0.5;

  if (d < 130 * (s.es || 1) && p.dashCd <= 0) out.dash = true;
  // stay inside the tightest crop (portrait phones) so the demo always reads on camera
  const ww = s.world.w, wh = s.world.h;
  const margin = Math.min(250, ww * 0.22);
  if (p.x < margin) out.ax += 0.9;
  if (p.x > ww - margin) out.ax -= 0.9;
  if (p.y < Math.min(210, wh * 0.2)) out.ay += 0.9;
  if (p.y > wh - Math.min(210, wh * 0.2)) out.ay -= 0.9;
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
    // gyro takes over when the stick is idle, so both can coexist
    if (gyro.on && !touches.size && !kbx && !kby) {
      input.ax = gyro.x; input.ay = gyro.y;
    }
    if (mouse.active) { input.aimX = mouse.x; input.aimY = mouse.y; }
    // MANUAL: hold left mouse OR space OR J. AUTO: the turret fires itself, so
    // the player never has to click to shoot (this was the 'press Esc to shoot' bug:
    // every click was being eaten by a pointer-lock request).
    const wantFire = mouse.down || keys.has(' ') || keys.has('j');
    if (wantFire) input.fire = true;
    input.dash = input.dash || keys.has('shift') || (keys.has(' ') && state.mode === 'play');
  }

  // a real pause: stop accumulating time so the sim cannot advance at all
  if (paused) { acc = 0; renderer.draw(state, mouse, dt); drawPause(); requestAnimationFrame(frame); return; }

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
  if (state.mode === 'play' && renderer.mobile) {
    renderer.ctx.save();
    renderer.ctx.translate(renderer.ox, renderer.oy);
    renderer.ctx.scale(renderer.scale, renderer.scale);
    renderer.drawTouchControls(state, input);
    renderer.ctx.restore();
  }
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
function syncWorld() {
  renderer.resize();
  sim_setWorld(state, renderer.worldW, renderer.worldH);
  state.aimAssist = renderer.mobile ? 0.26 : 0;
  const p = state.player;
  p.x = Math.min(p.x, renderer.worldW - 24);
  p.y = Math.min(p.y, renderer.worldH - 24);
}
window.addEventListener('orientationchange', () => setTimeout(syncWorld, 150));
window.addEventListener('resize', () => syncWorld());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => syncWorld());

if (AUTOSTART) startRun(state);
requestAnimationFrame(frame);

// test / automation hooks
window.__OVERDRAFT = {
  state,
  start: () => startRun(state),
  step: (n, inp) => { for (let i = 0; i < n; i++) step(state, 1 / 60, inp || input); },
  renderer,
};
