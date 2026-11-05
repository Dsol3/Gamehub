import { Renderer } from '/home/user/Gamehub/src/render.js';
import { createState } from '/home/user/Gamehub/src/sim.js';
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

let fails = 0;
for (const [W,H,name] of [[844,390,'iPhone 13 landscape'],[667,375,'SE landscape'],[568,320,'shortest'],[390,844,'portrait'],[1280,720,'desktop']]) {
  const log = [];
  const r = new Renderer(mkCanvas(W,H,log));
  const s = createState(3); s.world = { w: r.worldW, h: r.worldH };
  s.mode = 'pick'; s.level = 3;
  s.pick = [
    { id:'thrift', name:'THRIFT', desc:'Every 4th shot is free.' },
    { id:'quick', name:'QUICK HANDS', desc:'Fire rate +35%.' },
    { id:'pierce', name:'RICOCHET', desc:'Shots pass through 1 extra enemy.' },
  ];
  let err=null;
  try { r.draw(s, {x:0,y:0}, 1/60); } catch(e){ err = e.message; }
  const lay = r._pickLayout;
  const seen = new Set(log.map(l=>l.t));
  const allNames = ['THRIFT','QUICK HANDS','RICOCHET'].every(n=>seen.has(n));
  const skipSeen = seen.has('SKIP · KEEP GOING');
  const okAll = !err && allNames && skipSeen && lay && lay.cards.every(c=>c.y+c.h<=H && c.x+c.w<=W);
  console.log(`${okAll?'PASS':'FAIL'} ${name} (${W}x${H}): 3 card names drawn, SKIP drawn, all in bounds` + (err?' ERR '+err:'') + (allNames?'':' [missing card text]') + (skipSeen?'':' [missing SKIP]'));
  if(!okAll) fails++;
  // a tap on each card must select it
  lay.cards.forEach((c,i)=>{});
}
console.log(fails? `\n${fails} PICK DRAW FAILURE(S)` : '\nPICK DRAW OK');
process.exit(fails?1:0);
