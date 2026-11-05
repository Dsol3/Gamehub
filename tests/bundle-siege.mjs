// Run the SHIPPED bundle and prove an endless run progresses there too.
import { readFileSync } from 'node:fs';
const html = readFileSync('/home/user/Gamehub/docs/index.html', 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];
const noop = () => {};
const grad = { addColorStop: noop };
const mkCtx = () => new Proxy({ measureText: (t) => ({ width: 8 * String(t).length }),
  createLinearGradient: () => grad, createRadialGradient: () => grad, setLineDash: noop },
  { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => ((o[k] = v), true) });
function mkCanvas(W, H) {
  return { width: W, height: H, style: {},
    getContext() { return this._c || (this._c = mkCtx()); },
    addEventListener: noop, setPointerCapture: noop, releasePointerCapture: noop,
    requestPointerLock: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    parentElement: { getBoundingClientRect: () => ({ width: W, height: H }), requestFullscreen: () => Promise.reject(new Error('no')) } };
}
const W = 844, H = 390;
const g = globalThis;
const canvas = mkCanvas(W, H);
Object.defineProperty(g, 'document', { value: {
  getElementById: () => canvas, createElement: () => mkCanvas(8, 8), addEventListener: noop,
  documentElement: null, fullscreenElement: null, exitPointerLock: noop, pointerLockElement: null,
}, configurable: true });
Object.defineProperty(g, 'location', { value: { search: '' }, configurable: true });
Object.defineProperty(g, 'performance', { value: { now: () => Date.now() }, configurable: true });
Object.defineProperty(g, 'navigator', { value: { vibrate: noop }, configurable: true });
Object.defineProperty(g, 'screen', { value: { orientation: { lock: () => Promise.reject(new Error('no')) } }, configurable: true });
const raf = [];
Object.defineProperty(g, 'requestAnimationFrame', { value: (fn) => (raf.push(fn), raf.length), configurable: true });
Object.defineProperty(g, 'devicePixelRatio', { value: 2, configurable: true });
Object.defineProperty(g, 'window', { value: {
  innerWidth: W, innerHeight: H, devicePixelRatio: 2, addEventListener: noop, removeEventListener: noop,
  location: { search: '' }, matchMedia: (q) => ({ matches: q.includes('coarse') }),
  requestAnimationFrame: (fn) => (raf.push(fn), raf.length), DeviceOrientationEvent: undefined,
}, configurable: true });
Object.defineProperty(g, 'addEventListener', { value: noop, configurable: true });
Object.defineProperty(g, 'localStorage', { value: { getItem: () => null, setItem: noop, removeItem: noop }, configurable: true });
new Function(js)();
const O = g.window.__OVERDRAFT;

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

O.startSiege();
ok(O.state.siege === true, 'bundle: SIEGE starts');
ok(O.state.levelState === 'fight', 'bundle: no level card');
const evos = [];
for (let i = 0; i < 60 * 70; i++) {
  O.step(1, { ax: 0, ay: 0 });
  for (const e of O.state.events) if (e.type === 'evolve') evos.push(e.name);
  if (O.state.mode === 'dead') break;
}
ok(O.state.wave2 >= 2, `bundle: waves advance (wave ${O.state.wave2})`);
ok(evos.length >= 1, `bundle: weapon evolves in the bundle (${evos.join(', ') || 'none'})`);
ok(O.state.player.hp !== undefined, 'bundle: state is coherent');
// a death must file a leaderboard row
O.state.player.hp = -3;
O.step(1, { ax: 0, ay: 0 });
ok(O.state.mode === 'dead', 'bundle: reaching the floor ends the run');
const board = O.board;
ok(board.siege.length === 1, 'bundle: the finished run is filed on the SIEGE board');
ok(board.campaign.length === 0, 'bundle: it does not land on the campaign board');
ok(board.siege[0].wave >= 1 && board.siege[0].time >= 0, 'bundle: the row records wave and time');
console.log(fails ? `\n${fails} BUNDLE SIEGE FAILURE(S)` : '\nBUNDLE SIEGE OK');
process.exit(fails ? 1 : 0);
