// Layout regression: the on-screen controls must fit inside the arena on every
// device we claim to support, and must never eat more than a third of the height.
// This exists because the A button was clipped off the bottom of a phone screen.
import { Renderer } from '../src/render.js';

const clamp = () => 0;
const noop = () => {};
const grad = { addColorStop: noop };
const makeCtx = () => new Proxy(
  { measureText: (t) => ({ width: 8 }), createLinearGradient: () => grad, createRadialGradient: () => grad, setLineDash: noop },
  { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) },
);
const makeCanvas = (w, h) => ({
  width: w, height: h, style: {},
  getContext() { return this._c || (this._c = makeCtx()); },
  parentElement: { getBoundingClientRect: () => ({ width: w, height: h }) },
});

const DEVICES = [
  [320, 568, 'iPhone SE portrait'],
  [568, 320, 'iPhone SE landscape'],
  [390, 844, 'iPhone 14 portrait'],
  [844, 390, 'iPhone 14 landscape'],
  [428, 926, 'Pro Max portrait'],
  [926, 428, 'Pro Max landscape'],
  [768, 1024, 'iPad portrait'],
  [1024, 768, 'iPad landscape'],
  [1568, 730, 'tablet / touch laptop'],
  [1920, 1080, 'desktop'],
];

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

let worstBand = 0, worstName = '';
for (const [w, h, name] of DEVICES) {
  globalThis.window = {
    innerWidth: w, innerHeight: h, devicePixelRatio: 2,
    addEventListener: noop,
    matchMedia: (q) => ({ matches: q.includes('coarse') }),
  };
  globalThis.document = { createElement: () => makeCanvas(w, h), documentElement: null };
  const r = new Renderer(makeCanvas(w, h));
  const L = r.controlLayout();

  const inside =
    L.fire.x + L.fire.r <= w + 1 && L.fire.y + L.fire.r <= h + 1 &&
    L.dash.x - L.dash.r >= -1 && L.dash.y + L.dash.r <= h + 1 &&
    L.stick.x - L.stick.r >= -1 && L.stick.y + L.stick.r <= h + 1;
  ok(inside, `${name}: every control is inside the screen`);

  const band = r.controlBand().band / h;
  if (band > worstBand) { worstBand = band; worstName = name; }
  ok(band <= 0.34, `${name}: controls use ${(band * 100).toFixed(0)}% of height (<=34%)`);

  // A must be the biggest target: fire > dash > mode
  ok(L.fire.r > L.dash.r && L.dash.r > L.mode.r, `${name}: A is largest, then B, then mode`);

  // thumb targets must be at least 40px across to be hittable
  ok(L.fire.r * 2 >= 40 && L.dash.r * 2 >= 40, `${name}: A and B are thumb-sized (>=40px)`);

  // A and B sit on a thumb arc, not in a flat row: B is up and to the right of A,
  // the way a right thumb sweeps. It must never be BELOW A (that is the corner of
  // the screen) and must stay left of the right edge.
  ok(L.dash.y < L.fire.y - 1, `${name}: B sits above A on the thumb arc`);
  ok(L.dash.x < L.fire.x, `${name}: B sits left of A`);

  // and must not overlap each other
  const d = Math.hypot(L.fire.x - L.dash.x, L.fire.y - L.dash.y);
  ok(d > L.fire.r + L.dash.r, `${name}: A and B do not overlap`);

  // AIM moved out of the firing cluster, so a mashing thumb cannot hit it by
  // accident. It must be left of B and not touching A.
  ok(L.mode.x < L.dash.x, `${name}: AIM sits left of B, out of the firing cluster`);
  const dAM = Math.hypot(L.fire.x - L.mode.x, L.fire.y - L.mode.y);
  ok(dAM > L.fire.r + L.mode.r, `${name}: AIM does not touch A`);
}
console.log(`\nworst control band: ${worstName} at ${(worstBand * 100).toFixed(0)}% of height`);
console.log(failures ? `\n${failures} LAYOUT FAILURE(S)` : '\nLAYOUT OK');
process.exit(failures ? 1 : 0);
