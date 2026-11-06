// OVERDRAFT — input, loop, glue.
import { createState, startRun, step, chooseCard, setWorld as sim_setWorld, levelFor, W, H, startSiege, stepSiege } from './sim.js';
import { pickLayout, pickIndexAt, addRun, sanitizeBoard, emptyBoard, BOARD_KEY } from './layout.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';

const canvas = document.getElementById('c');
const renderer = new Renderer(canvas);
const sfx = new Sfx();

const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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

// Instructions start visible and fade on the FIRST real input. That first touch
// is also the honest answer to 'is this a touch device?', so the pads appear at
// exactly the moment the player reveals themselves as a phone user.
let helpAlpha = 1;
let helpDismissed = false;
try { if (sessionStorage.getItem('overdraft_seen')) { helpAlpha = 0; helpDismissed = true; } } catch {}

// Ask for fullscreen and, where the platform allows it, landscape.
// Android Chrome: works (needs a user gesture, and lock() needs fullscreen first).
// iOS Safari: no element fullscreen on iPhone and no orientation lock at all, so
// every call here is feature-detected and a failure is not an error.
async function goFullscreenLandscape() {
  const el = canvas.parentElement || canvas;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    const so = screen.orientation;
    if (so && typeof so.lock === 'function') await so.lock('landscape');
    return true;
  } catch { return false; }
}

function dismissHelp() {
  if (helpDismissed) return;
  helpDismissed = true;
  try { sessionStorage.setItem('overdraft_seen', '1'); } catch {}
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  dismissHelp();
  keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();

  if (k === 'm') { const m = sfx.toggleMute(); toast(m ? 'MUTED' : 'SOUND ON'); }
  if (k === 'escape' && document.pointerLockElement) document.exitPointerLock?.();
  if (k === 'p') { paused = !paused; }
  if (k === 'tab') { e.preventDefault(); toggleFireMode(); }
  if (k === 'enter' && state.mode === 'title') { /* handled below */ }
  if (k === 'r' && state.mode !== 'title') { sfx.ensure(); clearInputState(); launchRun(); }
  // SPACE IS NOT A RESTART KEY. It is fire/dash only. Binding it to restart meant
  // the same keypress restarted the run and immediately fired, burning the opening
  // PULSE before the player could see the screen.
  if (k === 'enter') {
    sfx.ensure();
    if (state.mode === 'title' || state.mode === 'dead') {
      clearInputState();
      launchRun();
      mouse.x = state.player.x; mouse.y = state.player.y - 120;
      input.aimX = mouse.x; input.aimY = mouse.y;
    }
  }
  if (['1', '2', '3'].includes(k) && state.mode === 'pick') {
    takeCard(Number(k) - 1);
  }
  // SPACE USED TO DO BOTH. It was bound to fire (main loop) and to dash (here),
  // so every press fired a shot AND burned the dash — two abilities on one key,
  // and the dash went on cooldown without the player ever asking for it.
  // Fire: mouse / J. Dash: SHIFT. Space is retired, so it cannot come back.
  if (k === 'shift') input.dash = true;
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'shift') input.dash = false;
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
  dismissHelp();
  canvas.setPointerCapture?.(e.pointerId);
  // Real touch input is the only reliable signal that this is a touch device.
  // A touchscreen laptop reports 'pointer: coarse'; a phone with a Bluetooth
  // mouse reports fine. Listen to the hand actually in use instead of guessing.
  //
  // BUT: do not switch the layout inside this handler. Flipping renderer.mobile
  // here changes what toUI() returns, so the very tap that reveals the device is
  // a touch would be hit-tested in a different coordinate space than the frame on
  // screen — landing on the wrong mode chip, or nowhere. Defer to the next frame.
  if (e.pointerType === 'touch' && !isTouch) {
    isTouch = true;
    if (!renderer.mobile) {
      setTimeout(() => {
        renderer.mobile = true;
        renderer.resize();
        syncWorld();
      }, 0);
    }
  } else if (e.pointerType === 'touch') {
    isTouch = true;
  }

  // PAUSED: the overlay owns the screen, so its buttons are the only targets
  if (paused) {
    const hit = pauseHit(e.clientX, e.clientY);
    if (hit === 'resume') { paused = false; last = performance.now(); }
    else if (hit === 'restart') { paused = false; clearInputState(); launchRun(); last = performance.now(); }
    else if (hit === 'menu') { paused = false; toTitle(); }
    return;
  }

  if (state.mode === 'title') {
    const space = renderer._titleSpace;
    const ui = renderer.toUI(e.clientX, e.clientY, space);
    // explicit START button: the only thing that begins a run
    const sb = renderer._startBtn;
    if (sb && ui.x >= sb.x && ui.x <= sb.x + sb.w && ui.y >= sb.y && ui.y <= sb.y + sb.h) {
      clearInputState();
      launchRun();
      if (e.pointerType === 'touch') goFullscreenLandscape();
      if (e.pointerType !== 'touch') { mouse.down = true; mouse.active = true; input.fire = true; }
      return;
    }
    // the rotate hint is dismissible, and dismissing it must not start the run
    const rh = renderer._rotateHint;
    if (rh && !renderer.rotateHintDismissed
        && ui.x >= rh.x && ui.x <= rh.x + rh.w && ui.y >= rh.y && ui.y <= rh.y + rh.h) {
      renderer.rotateHintDismissed = true;
      return;
    }
    // hit-test the mode chips first, so picking a mode doesn't start the run
    const chips = renderer._modeChips;
    if (chips && ui.y >= chips.y - 8 && ui.y <= chips.y + chips.h + 8) {
      for (let i = 0; i < CHIP_MODES.length; i++) {
        const x = chips.x + i * (chips.w + chips.gap);
        if (ui.x >= x && ui.x <= x + chips.w) {
          chooseChip(CHIP_MODES[i]);
          return;
        }
      }
    }
    // nothing else on the title starts a run: that is what START is for
    return;
  }
  if (state.mode === 'dead') {
    const ui = renderer.toUI(e.clientX, e.clientY, renderer._deadSpace);
    const btns = renderer._deadBtns;
    let choice = null;
    if (btns) {
      for (const b of btns) {
        if (ui.x >= b.x && ui.x <= b.x + b.w && ui.y >= b.y && ui.y <= b.y + b.h) choice = b.id;
      }
    }
    // tapping outside the buttons still restarts, so the old habit keeps working
    if (choice === 'menu') { toTitle(); return; }
    clearInputState();
    // relaunch whatever just killed you: dying in SIEGE must not dump you back
    // into a campaign level at level 1
    if (state.siege) { titleChoice = 'siege'; launchRun(); }
    else { titleChoice = chosenMode; launchRun(); }
    // only ask again if fullscreen was lost; repeated requests look like a glitch
    if (e.pointerType === 'touch' && !document.fullscreenElement) goFullscreenLandscape();
    // touch players tap once to begin; PC players hold to fire from the first frame
    if (e.pointerType !== 'touch') { mouse.down = true; mouse.active = true; input.fire = true; }
    return;
  }
  if (state.mode === 'pick') {
    const ui = renderer.toUI(e.clientX, e.clientY, renderer._pickSpace);
    const idx = cardIndexAt(ui.x, ui.y);
    if (idx >= 0) { takeCard(idx); return; }
    if (skipHit(ui.x, ui.y)) { takeCard(-1); return; }
    // Anything else on this screen now RESUMES the run. Before, an off-card tap
    // was swallowed and the screen became unexitable — the exact bug reported.
    takeCard(-1);
    return;
  }
  // level cards freeze the fight: swallow input so a tap does not bank a shot
  if (state.levelState === 'teach' || state.levelState === 'clear' || state.levelState === 'fail') {
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
  // a real mouse means real mouse chrome
  if (e.pointerType === 'mouse' && renderer.mobile && !('ontouchstart' in window && isTouch === false)) {
    // only demote if no touch has ever happened this session
    if (!isTouch) renderer.mobile = false;
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
// A run must always begin with a clean slate: no held key, no half-held trigger.
// Without this, any key still down at the moment of restart keeps acting on the
// new run (this is what burned ammo on restart).
function clearInputState() {
  keys.clear();
  input.fire = false;
  input.dash = false;
  input.ax = 0;
  input.ay = 0;
  mouse.down = false;
}

// 'auto' (TURRET) was removed when SIEGE replaced it, but this array still listed
// it: Tab from AUTO-AIM set a fire mode that no longer exists, so the sim fell back
// to MARKSMAN while the toast and HUD both said TURRET.
const MODE_ORDER = ['manual', 'assisted'];
function toggleFireMode() {
  const i = MODE_ORDER.indexOf(state.fireMode);
  setFireMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]);
}

// The three title chips. Two of them pick how the campaign aims; the third is a
// different game entirely, so it is tracked separately from the fire mode.
const CHIP_MODES = ['manual', 'assisted', 'siege'];
let titleChoice = 'assisted';   // what START will launch

function chooseChip(id) {
  if (id === 'siege') {
    titleChoice = 'siege';
    renderer.titleMode = 'siege';
    toast('SIEGE · ENDLESS · THE GUN EVOLVES, SO DO THEY');
    renderer.modeFlash = 1;
    return;
  }
  titleChoice = id;
  renderer.titleMode = id;
  setFireMode(id);
}

// One place that starts a run, so the RESTART buttons, the R key and ENTER can
// never launch the wrong mode.
function launchRun() {
  filedRun = null;
  if (titleChoice === 'siege') {
    startSiege(state);
    state.fireMode = 'siege';
  } else {
    startRun(state);
    state.fireMode = chosenMode;
  }
  // startSiege() already set this; assigning unconditionally would CLEAR it and
  // silently turn an endless run back into a campaign run mid-frame.
  state.siege = state.siege === true;
}

let chosenMode = 'assisted';
function setFireMode(mode) {
  chosenMode = mode;
  state.fireMode = mode;
  const m = mode === 'assisted' ? 'AUTO-AIM · GUN AIMS · EACH SHOT COSTS 2'
    : 'MARKSMAN · YOU AIM · 1 PER SHOT';
  toast(m);
  renderer.modeFlash = 1;
}

// ---------------------------------------------------------------------------
// gyroscope: tilt the phone to steer (opt-in, needs a user gesture on iOS)
// ---------------------------------------------------------------------------
const gyro = { on: false, x: 0, y: 0, base: null, supported: false, asked: false };

gyro.supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
// A device can advertise the API and still never fire an event (touch laptops).
// If no reading arrives shortly after load, hide the button instead of showing a
// control that does nothing.
gyro.live = false;
if (gyro.supported) {
  window.addEventListener('deviceorientation', () => { gyro.live = true; }, { once: true });
  setTimeout(() => { if (!gyro.live) gyro.supported = false; }, 1500);
}

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
// Controls are DRAWN in world space (renderer translates+scales before drawing),
// so they must be HIT-TESTED in world space too. On a phone world == screen so it
// looked fine, but on any device where they diverge the tappable area is offset.
function touchPoint(e) {
  return renderer.toWorld(e.clientX, e.clientY);
}

// Card hit testing now reads the layout the RENDERER recorded, and falls back to
// the shared layout module if it has not drawn yet. There is no second copy of
// the arithmetic any more — that duplication is what made this screen a dead end.
function pickLayoutNow(s) {
  return renderer._pickLayout || pickLayout(renderer.uiW, renderer.uiH, renderer.mobile);
}

function cardIndexAt(wx, wy) {
  return pickIndexAt(pickLayoutNow(state), wx, wy);
}

function skipHit(wx, wy) {
  const lay = pickLayoutNow(state);
  const k = lay.skip;
  return wx >= k.x && wx <= k.x + k.w && wy >= k.y && wy <= k.y + k.h;
}

// Skip keeps the run alive and simply declines the upgrade — always available so
// a card screen can never trap the player again.
function takeCard(index) {
  if (state.mode !== 'pick') return;
  if (index >= 0) { chooseCard(state, index); return; }
  // no card chosen: resume the level with what you already have
  state.pick = null;
  state.mode = 'play';
  state.levelState = 'fight';
  state.enemies.length = 0;
  state.levelT = 0;
  state.levelKills = 0;
  state.spawnT = 0.5;
  state._lv = levelFor(state.level);
  toast('SKIPPED · NO UPGRADE');
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
  try {
    frameBody(now);
  } catch (err) {
    // A thrown frame used to kill the rAF chain and look like a frozen game.
    // Swallow, log once, and keep the loop alive no matter what.
    if (!frame.errLogged) {
      frame.errLogged = true;
      console.error('OVERDRAFT frame error (loop kept alive):', err);
      toast('recovered from an error');
    }
  }
  requestAnimationFrame(frame);
}

function frameBody(now) {
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
    // Derived, not latched: a held pointer or key means fire; letting go means
    // stop. The touch handler sets input.fire directly for A/aim drags, and
    // `touches.size` tells us whether one of those is still down.
    const wantFire = mouse.down || keys.has('j');
    const touchFiring = [...touches.values()].some((q) => q.kind === 'aim' || q.kind === 'fire');
    input.fire = wantFire || touchFiring;
    input.dash = input.dash || keys.has('shift');
  }

  // a real pause: stop accumulating time so the sim cannot advance at all
  if (paused) { acc = 0; renderer.draw(state, mouse, dt); drawPause(); return; }

  while (acc >= FIXED) {
    let stepInput = input;
    if (DEMO && state.mode === 'play') stepInput = demoInput(state);
    // one flag, one branch: an endless run can never pick up a campaign rule
    if (state.siege) stepSiege(state, FIXED, stepInput);
    else step(state, FIXED, stepInput);
    acc -= FIXED;
    input.dash = false;
    handleEvents();
  }

  if (state.mode === 'dead') state.deadT += dt;
  // a run can also end outside the fixed-step loop (a test setting hp, a future
  // non-loop death), so filing is idempotent and checked here as well
  if (state.mode === 'dead') fileRun();

  // respect the OS "reduce motion" setting: halve shake, keep the game readable
  if (REDUCE_MOTION && state.shake > 6) state.shake = 6;
  renderer.gyroAvailable = !!gyro.supported;
  renderer.draw(state, mouse, dt);
  if (state.mode === 'play' && renderer.mobile) {
    renderer.ctx.save();
    renderer.ctx.translate(renderer.ox, renderer.oy);
    renderer.ctx.scale(renderer.scale, renderer.scale);
    renderer.drawTouchControls(state, input);
    renderer.ctx.restore();
  }
  if (!helpDismissed && helpAlpha > 0) helpAlpha = Math.max(1.6, helpAlpha - dt * 0.55);
  if (!helpDismissed && helpAlpha > 0) {
    renderer.ctx.save();
    renderer.ctx.translate(renderer.ox, renderer.oy);
    renderer.ctx.scale(renderer.scale, renderer.scale);
    // gentle fade: full for a moment, then out
    const a = Math.min(1, Math.max(0, helpAlpha / 1.6));
    renderer.drawInstructions(state, a);
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
}

let overdraftOn = false;
function handleEvents() {
  const over = state.player.hp <= 0 && state.mode !== 'title';
  if (over && !overdraftOn) { sfx.overdraftOn(); overdraftOn = true; }
  if (!over && overdraftOn) { sfx.overdraftOff(); overdraftOn = false; }

  for (const ev of state.events) {
    switch (ev.type) {
      case 'shoot': sfx.shoot(ev.over, Math.max(0, state.player.hp)); break;
      case 'hit': sfx.hit(); break;
      case 'kill': sfx.kill(); if (ev.refund != null) sfx.refund(ev.refund); buzz(9); break;
      case 'overdraftKill': sfx.orb(); toast('REPAID'); break;
      case 'hurt': sfx.hurt(); buzz(38); break;
      case 'death': fileRun(); break;
      case 'dash': sfx.dash(); break;
      case 'wave': sfx.wave(); break;
      case 'levelClear': sfx.levelClear(); break;
      case 'levelFail': sfx.levelFail(); break;
      case 'clang': sfx.clang(); break;
      case 'crack': sfx.hit(); break;
      case 'retry': break;
      case 'card': toast(ev.name); break;
      // ---- SIEGE ----
      case 'rocket': sfx.shoot(false, Math.max(0, state.player.hp)); buzz(6); break;
      case 'boom': sfx.hit(); buzz(18); break;
      case 'evolve': toast('EVOLVED · ' + ev.name); sfx.orb(); buzz(10); break;
      case 'refill': toast('PULSE REFILL'); sfx.refund(3); break;
      case 'waveStart': if (ev.wave > 1) sfx.wave(); break;
      case 'waveClear': sfx.levelClear(); break;
    }
  }
  // heartbeat when critical (non-overdraft, low pulse)
  // music: only while actually fighting, never on the title or the death card
  const wantMusic = state.mode === 'play' && !paused;
  if (wantMusic && !sfx._music) sfx.startMusic();
  if (!wantMusic && sfx._music) sfx.stopMusic();
  if (state.mode === 'play' && state.player.hp > 0 && state.player.hp <= 1.5) {
    hbT -= FIXED;
    if (hbT <= 0) { sfx.heartbeat(0.7); hbT = 0.75; }
  }
}
let hbT = 0;

// Haptics: only on devices that have them, and never if the player asked for
// reduced motion (which on iOS is the closest proxy for 'don't buzz me').
function buzz(ms) {
  if (!renderer.mobile) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

// Pause overlay with real buttons. The old one only said "press P to resume",
// which is useless on a phone: there is no P key, and nothing on screen told you
// the pause circle would toggle it back. Now every option is a thumb-sized target.
// Return to the title/mode-select screen. This route did not exist before: a run
// could only ever restart, never go back to choose a mode.
function toTitle() {
  clearInputState();
  paused = false;
  state.mode = 'title';
  state.levelState = 'fight';
  state.pick = null;
  state.enemies.length = 0;
  state.bullets.length = 0;
  state.particles.length = 0;
  // leaving SIEGE: clear every endless flag so the next campaign run starts clean
  state.siege = false;
  state.siegeT = 0;
  state.wave2 = 0;
  state.levelState = 'fight';
  state.level = 1;
  state.wave = 1;
  state._lv = levelFor(1);
  state.levelKills = 0;
  state.levelT = 0;
  state.score = 0;
  state.kills = 0;
  state.shotsFired = 0;
  state.shotsHit = 0;
  state.levelsCleared = 0;
  state.retries = 0;
  state.cardsTaken = [];
  state.player.hp = state.player.maxHp;
  state.player.x = state.world.w / 2;
  state.player.y = state.world.h / 2;
  last = performance.now();
}

// ---------------------------------------------------------------------------
// mini leaderboard: local, top 5 per mode
// ---------------------------------------------------------------------------
// The old build read `overdraft_best` from localStorage and NEVER WROTE IT, so
// "NEW BEST" was permanently dead code and the BEST row always read 0. The board
// below is the thing that was missing: it is written on death, sorted by score,
// and it is what the death screen renders.
let board = emptyBoard();
try {
  board = sanitizeBoard(JSON.parse(localStorage.getItem(BOARD_KEY) || 'null'));
} catch { board = emptyBoard(); }

function saveBoard() {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch { /* private mode */ }
}

let filedRun = null;   // the run object already filed, so a re-render cannot double-file
function fileRun() {
  if (state.mode !== 'dead') return;
  if (filedRun) return;   // one filing per run; launchRun() clears this
  const siege = !!state.siege;
  const run = {
    score: state.score,
    level: siege ? 0 : state.level,
    wave: siege ? Math.max(1, state.wave2) : 0,
    time: siege ? Math.round(state.siegeT) : Math.round(state.levelT),
    acc: state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0,
    ts: Date.now(),
  };
  const res = addRun(board, siege ? 'siege' : 'campaign', run);
  board = res.board;
  saveBoard();
  renderer.board = board;
  renderer.lastRun = run;
  renderer.bestScore = Math.max(renderer.bestScore || 0, run.score);
  filedRun = { ...run };
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

function pauseButtons() {
  const c = renderer.ctx;
  const w = canvas.width / renderer.dpr, h = canvas.height / renderer.dpr;
  const mob = renderer.mobile;
  const bw = Math.min(mob ? 300 : 320, w - 48);
  const bh = mob ? 54 : 50;
  const gap = 14;
  const cx = w / 2;
  const top = h / 2 - 30;
  return [
    { id: 'resume',  label: 'RESUME',            x: cx - bw / 2, y: top,                w: bw, h: bh, tone: '#7dffb2' },
    { id: 'restart', label: 'RESTART RUN',       x: cx - bw / 2, y: top + bh + gap,     w: bw, h: bh, tone: '#ffd166' },
    { id: 'menu',    label: 'MAIN MENU',         x: cx - bw / 2, y: top + (bh + gap) * 2, w: bw, h: bh, tone: '#6ff5ff' },
  ];
}

function drawPause() {
  const c = renderer.ctx;
  c.save();
  c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  const w = canvas.width / renderer.dpr, h = canvas.height / renderer.dpr;
  c.fillStyle = 'rgba(4,5,10,0.86)';
  c.fillRect(0, 0, w, h);

  c.textAlign = 'center';
  c.fillStyle = '#9ffcff';
  c.font = `800 ${renderer.mobile ? 30 : 34}px ui-monospace, monospace`;
  c.fillText('PAUSED', w / 2, h / 2 - 78);
  c.font = '400 12px ui-monospace, monospace';
  c.fillStyle = 'rgba(160,190,215,0.6)';
  c.fillText(renderer.mobile ? 'the run is frozen, nothing is lost' : 'press P to resume', w / 2, h / 2 - 52);

  for (const b of pauseButtons()) {
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(12,20,34,0.96)';
    c.strokeStyle = b.tone;
    c.lineWidth = 1.6;
    roundRect(c, b.x, b.y, b.w, b.h, 12);
    c.fill(); c.stroke();
    c.fillStyle = b.tone;
    c.font = `800 ${renderer.mobile ? 16 : 15}px ui-monospace, monospace`;
    c.textAlign = 'center';
    c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 5);
  }
  c.restore();
}

// Is a point inside one of the pause buttons? Used by the pointer handler.
function pauseHit(px, py) {
  for (const b of pauseButtons()) {
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
  }
  return null;
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
  state.aimAssist = renderer.mobile ? 0.34 : 0;
  state.touchUi = !!renderer.mobile;
  const p = state.player;
  p.x = Math.min(p.x, renderer.worldW - 24);
  p.y = Math.min(p.y, renderer.worldH - 24);
}
// Resolve immediately, then again shortly after: browsers report stale dimensions
// during the event, but waiting 150ms before doing anything made the first tap
// after a rotation feel unresponsive. Setting it twice is cheap and instant.
window.addEventListener('orientationchange', () => {
  syncWorld();
  setTimeout(syncWorld, 60);
  setTimeout(syncWorld, 200);
});
window.addEventListener('resize', () => syncWorld());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => syncWorld());

if (AUTOSTART) { clearInputState(); launchRun(); }
requestAnimationFrame(frame);

// test / automation hooks
window.__OVERDRAFT = {
  state,
  get paused() { return paused; },
  pauseHit,
  pauseButtons,
  start: () => launchRun(),
  get board() { return board; },
  fileRun,
  startSiege: () => { titleChoice = 'siege'; launchRun(); },
  step: (n, inp) => {
    for (let i = 0; i < n; i++) {
      if (state.siege) stepSiege(state, 1 / 60, inp || input);
      else step(state, 1 / 60, inp || input);
    }
    // mirror what frame() does after its fixed-step loop, so a run driven through
    // this hook ends exactly the way a real one does
    if (state.mode === 'dead') { state.deadT += 1 / 60; fileRun(); }
  },
  renderer,
};
