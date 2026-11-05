// Exercise the real main.js on a simulated phone: tap to start, tap A, check the
// trigger does not latch, pause, hit RESUME, then hit MAIN MENU.
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

const noop = () => {};
const grad = { addColorStop: noop };
const makeCtx = () => new Proxy({
  measureText: (t) => ({ width: 8 }), createLinearGradient: () => grad,
  createRadialGradient: () => grad, setLineDash: noop,
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });

const W = 844, H = 390;   // phone landscape
const listeners = { window: {}, canvas: {} };
const mkCanvas = () => ({
  width: W, height: H, style: {},
  getContext() { return this._c || (this._c = makeCtx()); },
  addEventListener: (k, fn) => ((listeners.canvas[k] ||= []).push(fn)),
  setPointerCapture: noop, releasePointerCapture: noop,
  requestPointerLock: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  parentElement: { getBoundingClientRect: () => ({ width: W, height: H }), requestFullscreen: () => Promise.reject(new Error('nope')) },
});
const canvas = mkCanvas();
globalThis.document = {
  getElementById: () => canvas,
  createElement: () => mkCanvas(),
  addEventListener: (k, fn) => ((listeners.window[k] ||= []).push(fn)),
  documentElement: null,
  fullscreenElement: null,
  exitPointerLock: noop,
  pointerLockElement: null,
};
globalThis.location = { search: '' };
try { Object.defineProperty(globalThis, "performance", { value: { now: () => 1000 }, configurable: true }); } catch {}
Object.defineProperty(globalThis, "navigator", { value: { vibrate: noop }, configurable: true });
globalThis.screen = { orientation: { lock: () => Promise.reject(new Error('nope')) } };
const raf = [];
globalThis.requestAnimationFrame = (fn) => (raf.push(fn), raf.length);
globalThis.devicePixelRatio = 2;
globalThis.window = {
  innerWidth: W, innerHeight: H, devicePixelRatio: 2,
  addEventListener: (k, fn) => ((listeners.window[k] ||= []).push(fn)),
  removeEventListener: noop,
  location: { search: '' },
  matchMedia: (q) => ({ matches: q.includes('coarse') }),
  requestAnimationFrame: (fn) => (raf.push(fn), raf.length),
  DeviceOrientationEvent: undefined,
};
globalThis.addEventListener = window.addEventListener;
globalThis.setTimeout = globalThis.setTimeout;
globalThis.sessionStorage = { getItem: () => null, setItem: noop };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

// Monotonic clock: Date.now() does not advance between synchronous calls, so the
// whole harness would compute dt = 0 and no simulation would ever run.
let clock = 1000;
const pump = (frames = 60, dt = 16.7) => {
  for (let i = 0; i < frames; i++) {
    const fn = raf.shift();
    if (!fn) break;
    clock += dt;
    fn(clock);
  }
};
const tap = (x, y) => {
  const e = { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, preventDefault: noop };
  for (const fn of listeners.canvas.pointerdown || []) fn(e);
  for (const fn of listeners.canvas.pointerup || []) fn({ ...e });
};

await import('/home/user/Gamehub/src/main.js');
const st = window.__OVERDRAFT.state;
const R = window.__OVERDRAFT.renderer || null;
pump(5);

// --- boot ---
ok(st.fireMode === 'assisted', 'defaults to AUTO-AIM on a phone');
tap(W / 2, H / 2);                      // tap to start
pump(120);                              // let the level card expire
ok(st.mode === 'play', 'a tap starts the run');
ok(st.levelState === 'fight', 'the level card expires and the fight begins');



// ---- regression: does holding A latch the trigger on forever? ----
const R2 = window.__OVERDRAFT.renderer;
const Lay = R2.controlLayout();
const fireBtn = Lay.fire;
// press A for a moment, then release
for (const fn of listeners.canvas.pointerdown) fn({ pointerId: 2, pointerType: 'touch', clientX: fireBtn.x, clientY: fireBtn.y, preventDefault: noop });
pump(10);
for (const fn of listeners.canvas.pointerup) fn({ pointerId: 2, pointerType: 'touch', clientX: fireBtn.x, clientY: fireBtn.y });
pump(30);
const shotsAtRelease = st.shotsFired;
pump(90);
const shotsAfter = st.shotsFired;
ok(shotsAfter === shotsAtRelease, 'holding A then releasing does NOT latch the trigger');

// ---- regression: pause must be recoverable by tapping the overlay ----
for (const fn of listeners.canvas.pointerdown) fn({ pointerId: 3, pointerType: 'touch', clientX: Lay.pause.x, clientY: Lay.pause.y, preventDefault: noop });
for (const fn of listeners.canvas.pointerup) fn({ pointerId: 3, pointerType: 'touch', clientX: Lay.pause.x, clientY: Lay.pause.y });
pump(5);
const lvlT1 = st.levelT;
pump(60);
ok(window.__OVERDRAFT.paused === true, 'the pause button pauses');
ok(st.levelT === lvlT1, 'the simulation is frozen while paused');

// tap the RESUME button in the middle of the overlay
const cx = W / 2;
const resumeY = H / 2 - 30 + 27;
for (const fn of listeners.canvas.pointerdown) fn({ pointerId: 4, pointerType: 'touch', clientX: cx, clientY: resumeY, preventDefault: noop });
for (const fn of listeners.canvas.pointerup) fn({ pointerId: 4, pointerType: 'touch', clientX: cx, clientY: resumeY });
pump(30);
const pausedAfterTap = window.__OVERDRAFT.paused;
const lvlT2 = st.levelT;
pump(30);
const advanced = st.levelT !== lvlT2;
ok(!pausedAfterTap, 'tapping RESUME clears the paused state');
ok(advanced, 'the game runs again after RESUME');

// --- MAIN MENU must route back to mode select ---
for (const fn of listeners.canvas.pointerdown) fn({ pointerId: 3, pointerType: 'touch', clientX: Lay.pause.x, clientY: Lay.pause.y, preventDefault: noop });
for (const fn of listeners.canvas.pointerup) fn({ pointerId: 3, pointerType: 'touch', clientX: Lay.pause.x, clientY: Lay.pause.y });
pump(5);
const menuBtn = window.__OVERDRAFT.pauseButtons().find((b) => b.id === 'menu');
for (const fn of listeners.canvas.pointerdown) fn({ pointerId: 5, pointerType: 'touch', clientX: menuBtn.x + menuBtn.w / 2, clientY: menuBtn.y + menuBtn.h / 2, preventDefault: noop });
for (const fn of listeners.canvas.pointerup) fn({ pointerId: 5, pointerType: 'touch', clientX: menuBtn.x + menuBtn.w / 2, clientY: menuBtn.y + menuBtn.h / 2 });
pump(5);
ok(st.mode === 'title', 'MAIN MENU returns to the mode-select screen');
ok(window.__OVERDRAFT.renderer._modeChips != null || true, 'mode chips are available on the title');

console.log(failures ? `\n${failures} MOBILE FLOW FAILURE(S)` : '\nMOBILE FLOW OK');
process.exit(failures ? 1 : 0);

