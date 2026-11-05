// Regression: the mode chips and the start button must respond to the FIRST touch.
//
// The bug: pointerdown set renderer.mobile = true for a touch device, and toUI()
// then read that new flag against title-screen coordinates that had been drawn in
// desktop space. The tap was translated into a different coordinate space, so it
// landed on the wrong chip — or nowhere.
//
// This test boots the real main.js with a FINE pointer (so the title draws in
// desktop coords) and then taps with a TOUCH pointer, which is exactly the case
// that was broken.
const noop = () => {};
const grad = { addColorStop: noop };
const makeCtx = () => new Proxy({
  measureText: () => ({ width: 8 }), createLinearGradient: () => grad,
  createRadialGradient: () => grad, setLineDash: noop,
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

async function boot({ W, H, coarse }) {
  const listeners = { canvas: {} };
  const mkCanvas = () => ({
    width: W, height: H, style: {},
    getContext() { return this._c || (this._c = makeCtx()); },
    addEventListener: (k, fn) => ((listeners.canvas[k] ||= []).push(fn)),
    setPointerCapture: noop, releasePointerCapture: noop, requestPointerLock: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    parentElement: {
      getBoundingClientRect: () => ({ width: W, height: H }),
      requestFullscreen: () => Promise.reject(new Error('unsupported')),
    },
  });
  const canvas = mkCanvas();
  const g = globalThis;
  globalThis.document = {
    getElementById: () => canvas, createElement: () => mkCanvas(),
    addEventListener: noop, documentElement: null,
    fullscreenElement: null, exitPointerLock: noop, pointerLockElement: null,
  };
  globalThis.location = { search: '' };
  Object.defineProperty(g, 'performance', { value: { now: () => 1000 }, configurable: true });
  Object.defineProperty(g, 'navigator', { value: { vibrate: noop }, configurable: true });
  Object.defineProperty(g, 'screen', {
    value: { orientation: { lock: () => Promise.reject(new Error('unsupported')) } },
    configurable: true,
  });
  const raf = [];
  Object.defineProperty(g, 'requestAnimationFrame', { value: (fn) => (raf.push(fn), raf.length), configurable: true });
  Object.defineProperty(g, 'devicePixelRatio', { value: 2, configurable: true });
  Object.defineProperty(g, 'window', {
    value: {
      innerWidth: W, innerHeight: H, devicePixelRatio: 2,
      addEventListener: noop, removeEventListener: noop, location: { search: '' },
      matchMedia: (q) => ({ matches: q.includes('coarse') ? coarse : false }),
      requestAnimationFrame: (fn) => (raf.push(fn), raf.length),
      DeviceOrientationEvent: undefined,
    },
    configurable: true,
  });
  Object.defineProperty(g, 'addEventListener', { value: noop, configurable: true });
  Object.defineProperty(g, 'sessionStorage', { value: { getItem: () => null, setItem: noop }, configurable: true });
  Object.defineProperty(g, 'localStorage', { value: { getItem: () => null, setItem: noop, removeItem: noop }, configurable: true });

  let clock = 1000;
  const pump = (n = 20) => {
    for (let i = 0; i < n; i++) {
      const fn = raf.shift();
      if (!fn) break;
      clock += 16.7;
      fn(clock);
    }
  };
  await import('/home/user/Gamehub/src/main.js?t=' + W + 'x' + H + (coarse ? 'c' : 'f') + Math.random());
  pump(10);
  const O = g.window.__OVERDRAFT;
  const tap = (x, y, type = 'touch') => {
    const e = { pointerId: 1, pointerType: type, clientX: x, clientY: y, preventDefault: noop };
    for (const fn of listeners.canvas.pointerdown || []) fn(e);
    for (const fn of listeners.canvas.pointerup || []) fn({ ...e });
  };
  return { O, tap, pump, renderer: O.renderer, state: O.state };
}

const ORIGINAL_DEFAULT = 'assisted';

// ---- case 1: the exact reported bug -------------------------------------------
// Wide screen + fine pointer: the title draws in desktop coordinates. First input
// is a TOUCH. The chip tap must still select the chip it visually points at.
{
  const { renderer, state, tap, pump } = await boot({ W: 1568, H: 730, coarse: false });
  pump(5);
  const chips = renderer._modeChips;
  ok(!!chips, 'title draws mode chips');

  // tap the MIDDLE chip (AUTO-AIM)
  const cx = chips.x + chips.w + chips.gap + chips.w / 2;
  const cy = chips.y + chips.h / 2;
  const before = state.fireMode;
  tap(cx, cy);
  ok(state.fireMode === 'assisted',
    `first touch selects the chip under the finger (was ${before}, got ${state.fireMode})`);
  ok(state.mode === 'title', 'tapping a chip does not start the run');
}

// ---- case 1b: the third chip selects SIEGE, and START launches it -------------
{
  const { renderer, state, tap, pump } = await boot({ W: 1568, H: 730, coarse: false });
  pump(5);
  const chips = renderer._modeChips;
  const cx = chips.x + 2 * (chips.w + chips.gap) + chips.w / 2;
  const cy = chips.y + chips.h / 2;
  tap(cx, cy);
  ok(renderer.titleMode === 'siege', 'the third chip selects SIEGE');
  ok(state.mode === 'title', 'selecting SIEGE does not start it yet');
  const btn = renderer._startBtn;
  tap(btn.x + btn.w / 2, btn.y + btn.h / 2);
  ok(state.mode === 'play' && state.siege === true, 'START after picking SIEGE begins an endless run');
  ok(state.levelState === 'fight', 'SIEGE has no level card to dismiss');
  pump(30);
  ok(state.siegeT > 0 || state.wave2 >= 0, 'the endless clock is running');
}

// ---- case 2: the START button must work on the first touch --------------------
{
  const { renderer, state, tap, pump } = await boot({ W: 1568, H: 730, coarse: false });
  pump(5);
  const btn = renderer._startBtn;
  ok(!!btn, 'title draws an explicit START button');
  if (btn) {
    tap(btn.x + btn.w / 2, btn.y + btn.h / 2);
    ok(state.mode === 'play', 'first touch on START begins the run');
  }
}

// ---- case 3: a phone that IS detected as coarse from the start ----------------
{
  const { renderer, state, tap, pump } = await boot({ W: 390, H: 844, coarse: true });
  pump(5);
  const btn = renderer._startBtn;
  ok(!!btn, 'portrait phone draws START');
  if (btn) {
    tap(btn.x + btn.w / 2, btn.y + btn.h / 2);
    ok(state.mode === 'play', 'portrait phone starts on first tap');
  }
}

// ---- case 4: landscape phone --------------------------------------------------
{
  const { renderer, state, tap, pump } = await boot({ W: 844, H: 390, coarse: true });
  pump(5);
  const chips = renderer._modeChips;
  const btn = renderer._startBtn;
  ok(!!btn, 'landscape phone draws START');
  // the START button must be fully on screen
  if (btn) ok(btn.y >= 0 && btn.y + btn.h <= 390, 'START is fully on screen in landscape');
  if (chips) ok(chips.y >= 0 && chips.y + chips.h <= 390, 'mode chips are fully on screen in landscape');
  // chips must be thumb-sized
  if (chips) ok(chips.h >= 54, `mode chips are thumb-sized (${chips.h}px tall, need >=54)`);
  if (btn) {
    tap(btn.x + btn.w / 2, btn.y + btn.h / 2);
    ok(state.mode === 'play', 'landscape phone starts on first tap');
  }
}

// ---- case 5: START and the chips must fit on every screen we support ----------
{
  const { Renderer } = await import('/home/user/Gamehub/src/render.js');
  const { createState } = await import('/home/user/Gamehub/src/sim.js');
  const SIZES = [
    [320, 568, 'iPhone SE portrait'], [568, 320, 'iPhone SE landscape'],
    [390, 844, 'iPhone portrait'], [844, 390, 'iPhone landscape'],
    [667, 375, 'small landscape'], [428, 926, 'Pro Max portrait'],
    [1568, 730, 'tablet / your window'], [1920, 1080, 'desktop'],
  ];
  for (const [w, h, name] of SIZES) {
    Object.defineProperty(globalThis, 'window', {
      value: {
        innerWidth: w, innerHeight: h, devicePixelRatio: 2,
        addEventListener: noop,
        matchMedia: (q) => ({ matches: q.includes('coarse') }),
      },
      configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        createElement: () => ({
          width: w, height: h, style: {},
          getContext() { return this._c || (this._c = makeCtx()); },
          parentElement: { getBoundingClientRect: () => ({ width: w, height: h }) },
        }),
        documentElement: null,
      },
      configurable: true, writable: true,
    });
    const r = new Renderer({
      width: w, height: h, style: {},
      getContext() { return this._c || (this._c = makeCtx()); },
      parentElement: { getBoundingClientRect: () => ({ width: w, height: h }) },
    });
    const s = createState(1); s.world = { w: r.worldW, h: r.worldH }; s.mode = 'title';
    r.draw(s, { x: 0, y: 0 }, 1 / 60);
    const sb = r._startBtn, ch = r._modeChips;
    const startOk = sb && sb.x >= 0 && sb.y >= 0 && sb.x + sb.w <= w && sb.y + sb.h <= h;
    const chipsRight = ch ? ch.x + ch.w * 3 + ch.gap * 2 : 1e9;
    const chipsOk = ch && ch.x >= 0 && ch.y >= 0 && chipsRight <= w && ch.y + ch.h <= h;
    ok(!!startOk, `${name}: START is fully on screen`);
    ok(!!chipsOk, `${name}: all three mode chips are on screen`);
    ok(ch && ch.h >= 54, `${name}: chips are thumb-sized (${ch ? ch.h : 0}px)`);
  }
}

console.log(failures ? `\n${failures} TITLE TAP FAILURE(S)` : '\nTITLE TAP OK');
process.exit(failures ? 1 : 0);
