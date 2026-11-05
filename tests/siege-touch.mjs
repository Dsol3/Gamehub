import { Renderer } from '/home/user/Gamehub/src/render.js';
import { createState, startSiege, stepSiege } from '/home/user/Gamehub/src/sim.js';
const noop = () => {};
const grad = { addColorStop: noop };
function mkCtx(log) {
  return new Proxy({ measureText: (t) => ({ width: 7 * String(t).length }),
    createLinearGradient: () => grad, createRadialGradient: () => grad, setLineDash: noop,
    fillText: (t, x, y) => log.push({ t: String(t), x, y }) },
    { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => ((o[k] = v), true) });
}
function mkCanvas(W, H, log) {
  return { width: W, height: H, style: {},
    getContext() { return this._c || (this._c = mkCtx(log)); },
    parentElement: { getBoundingClientRect: () => ({ width: W, height: H }) } };
}
const g = globalThis;
Object.defineProperty(g, 'document', { value: { createElement: () => mkCanvas(8,8,[]), documentElement: null }, configurable: true });
Object.defineProperty(g, 'window', { value: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, addEventListener: noop, matchMedia: (q) => ({ matches: q.includes('coarse') }) }, configurable: true });
Object.defineProperty(g, 'localStorage', { value: { getItem: () => null, setItem: noop }, configurable: true });

let fails=0;
for (const [W,H,name] of [[844,390,'iPhone 13 landscape'],[667,375,'SE landscape'],[390,844,'portrait']]) {
  const log=[];
  const r = new Renderer(mkCanvas(W,H,log));
  const s = createState(4); s.world={w:r.worldW,h:r.worldH};
  startSiege(s);
  // run a bit so a wave is live and the tier has moved
  for (let i=0;i<60*45;i++) stepSiege(s,1/60,{ax:0,ay:0});
  log.length = 0;
  let err=null;
  try { r.draw(s,{x:0,y:0},1/60); } catch(e){ err=e.message; }
  const txt = new Set(log.map(l=>l.t));
  const hasClock = [...txt].some(t=>/^\d+:\d\d$/.test(t));
  const hasWave = txt.has('WAVE');
  const hasTier = [...txt].some(t=>/^TIER \d$/.test(t)) || [...txt].some(t=>/^(SINGLE|DOUBLE|TRIPLE|ROCKET|TWIN|PIERCE|STORM)$/.test(t));
  const touch = r.mobile;
  const okAll = !err && hasClock && hasWave && (touch ? true : hasTier);
  console.log(`${okAll?'PASS':'FAIL'} ${name}: clock=${hasClock} wave=${hasWave} tier=${hasTier} touchUi=${touch} hp=${s.player.hp} tier=${s.playerTier}` + (err?' ERR '+err:''));
  if(!okAll) fails++;
  // pause button must still exist in SIEGE
  const L = r.controlLayout();
  if (touch) {
    // the pause icon is two filled rects, not text — check the geometry exists
    const pauseOk = L && L.pause && L.pause.r > 0 &&
      L.pause.x > 0 && L.pause.y > 0 && L.pause.x < W && L.pause.y < H;
    console.log(`  ${pauseOk?'PASS':'FAIL'} ${name}: pause control geometry is on screen in SIEGE`);
    if(!pauseOk) fails++;
  }
}
console.log(fails? `\n${fails} SIEGE TOUCH FAILURE(S)` : '\nSIEGE TOUCH OK');
process.exit(fails?1:0);
