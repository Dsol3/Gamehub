// Executes the SHIPPED single-file build in a stubbed DOM.
// This is what Vercel/GitHub Pages actually serve, so it must run, not just parse.
//   node tests/bundle-run.mjs [path]
import { readFileSync } from 'node:fs';

const noop = () => {};
const grad = { addColorStop: noop };
const ctx = () => new Proxy({
  measureText: (t) => ({ width: String(t).length * 8 }),
  createLinearGradient: () => grad, createRadialGradient: () => grad,
  setLineDash: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
const cv = () => ({
  width: 1280, height: 720, style: {},
  getContext() { return (this._c ||= ctx()); },
  addEventListener: noop, setPointerCapture: noop, requestPointerLock: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
});

const raf = [];
const canvas = cv();
globalThis.document = { getElementById: () => canvas, createElement: () => cv(),
  addEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
globalThis.location = { search: '' };
globalThis.requestAnimationFrame = (fn) => raf.push(fn);
globalThis.devicePixelRatio = 1;
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop, location: { search: '' },
  matchMedia: () => ({ matches: false }) };
globalThis.addEventListener = noop;

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

const file = process.argv[2] || 'docs/index.html';
const html = readFileSync(file, 'utf8');
const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
ok(!!m, `${file} has an inline script`);
if (!m) process.exit(1);

try { new Function(m[1])(); ok(true, 'bundle executes'); }
catch (e) { ok(false, 'bundle executes: ' + e.message); process.exit(1); }

let t = 0;
for (let i = 0; i < 180 && raf.length; i++) { const fn = raf.shift(); t += 16.7; fn(t); }
ok(true, 'animation loop runs');

const hook = window.__OVERDRAFT;
ok(!!hook, 'test hooks exposed');
if (hook) {
  hook.start();
  for (let i = 0; i < 60 * 20; i++) {
    if (hook.state.mode === 'pick') { hook.state.mode = 'play'; hook.state.pick = null; continue; }
    hook.step(1, { ax: 0.5, ay: 0.2, aimX: 700, aimY: 300, fire: i % 3 === 0, dash: i % 150 === 0 });
  }
  const s = hook.state;
  ok(s.time > 15, `played ${s.time.toFixed(0)}s of simulated time`);
  console.log(`      wave ${s.wave} · ${s.kills} kills · score ${s.score}`);
}

console.log(fail === 0 ? '\nBUNDLE OK' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);
