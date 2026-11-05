// Smoke test: run the renderer + full game loop against a stubbed DOM/canvas.
// Catches runtime errors (typos, undefined refs, bad API use) without a browser.
//   node tests/smoke-dom.mjs

const noop = () => {};
const gradient = { addColorStop: noop };

function makeCtx() {
  const target = {
    canvas: null,
    measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
    setLineDash: noop,
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      // any unknown property read is a no-op method or a writable slot
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeCanvas(w = 1280, h = 720) {
  const el = {
    width: w, height: h,
    style: {},
    _ctx: null,
    getContext() { if (!this._ctx) { this._ctx = makeCtx(); this._ctx.canvas = this; } return this._ctx; },
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }),
  };
  return el;
}

const gameCanvas = makeCanvas();
const rafQueue = [];

globalThis.document = {
  getElementById: (id) => (id === 'c' ? gameCanvas : makeCanvas()),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(128, 128) : {}),
  body: { appendChild: noop },
};
globalThis.location = { search: '?debug=1' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.devicePixelRatio = 2;
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = noop;

const listeners = {};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
  addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); },
  removeEventListener: noop,
  AudioContext: undefined, // exercise the "no WebAudio" path
  webkitAudioContext: undefined,
  location: { search: '' },
};
globalThis.addEventListener = window.addEventListener;

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

// ---- import modules under the stub -----------------------------------------
const { Renderer } = await import('../src/render.js');
const sim = await import('../src/sim.js');

const canvas = makeCanvas();
const r = new Renderer(canvas);
ok(!!r.ctx, 'renderer constructed');

// ---- draw every screen ------------------------------------------------------
const s = sim.createState(3);
s.hermes = true;

const screens = ['title', 'play', 'pick', 'dead'];
for (const mode of screens) {
  if (mode === 'play') sim.startRun(s);
  if (mode === 'pick') { s.mode = 'pick'; s.pick = sim.CARDS.slice(0, 3); }
  if (mode === 'dead') { s.mode = 'dead'; s.player.hp = -3; }
  let threw = null;
  try { for (let i = 0; i < 3; i++) r.draw(s, { x: 400, y: 300 }, 1 / 60); }
  catch (e) { threw = e; }
  ok(!threw, `draws "${mode}" screen without throwing${threw ? ': ' + threw.message : ''}`);
}

// ---- simulate a full fight, drawing along the way ---------------------------
sim.startRun(s);
let frames = 0, err = null;
try {
  for (let i = 0; i < 60 * 40; i++) {
    sim.step(s, 1 / 60, { ax: Math.sin(i / 40), ay: Math.cos(i / 55), aimX: 400, aimY: 200, fire: i % 11 === 0, dash: i % 220 === 0 });
    if (i % 3 === 0) r.draw(s, { x: 400, y: 300 }, 1 / 60);
    frames++;
    if (s.mode === 'dead') break;
  }
} catch (e) { err = e; }
ok(!err, `played + rendered ${frames} frames without throwing${err ? ': ' + err.message + '\n' + err.stack : ''}`);
console.log(`      ended: mode=${s.mode} wave=${s.wave} kills=${s.kills} score=${s.score}`);

// ---- now boot the real main.js loop ---------------------------------------
try {
  await import('../src/main.js');
  ok(true, 'main.js boots');
} catch (e) {
  ok(false, 'main.js boots: ' + e.message + '\n' + e.stack);
}

// drive ~4s of real frames
try {
  let t = 0;
  for (let i = 0; i < 240 && rafQueue.length; i++) {
    const fn = rafQueue.shift();
    t += 16.7;
    fn(t);
  }
  ok(true, 'requestAnimationFrame loop runs');
  ok(window.__OVERDRAFT && typeof window.__OVERDRAFT.step === 'function', 'test hooks exposed');
} catch (e) {
  ok(false, 'raf loop: ' + e.message + '\n' + e.stack);
}

// ---- keyboard path: start a run via the exposed hook, draw pick screen ----
try {
  const st = window.__OVERDRAFT.state;
  window.__OVERDRAFT.start();
  for (let i = 0; i < 60 * 30; i++) {
    window.__OVERDRAFT.step(1, { ax: 1, ay: 0.4, aimX: 700, aimY: 200, fire: true, dash: false });
    if (st.mode === 'pick') { sim.chooseCard(st, 0); }
  }
  ok(true, 'long scripted session runs');
} catch (e) {
  ok(false, 'long scripted session: ' + e.message + '\n' + e.stack);
}

console.log(fail === 0 ? '\nSMOKE OK' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);
