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
  pointerLockElement: null,
  exitPointerLock: noop,
};
globalThis.location = { search: '?debug=1' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.devicePixelRatio = 2;
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = noop;

const listeners = {};
globalThis.pointerLockElement = null;
document.addEventListener = (k, fn) => { (listeners[k] ||= []).push(fn); };
document.exitPointerLock = noop;
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
  addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); },
  removeEventListener: noop,
  matchMedia: (q) => ({
    // coarse-pointer only on small (phone-sized) viewports, so tests can
    // exercise both layouts by changing innerWidth/innerHeight
    matches: /coarse/.test(q) && window.innerWidth < 720,
    addEventListener: noop, removeEventListener: noop,
  }),
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


// ---- portrait phone pass: world must fill the screen, touch path must work ----
{
  const saveW = window.innerWidth, saveH = window.innerHeight;
  window.innerWidth = 390; window.innerHeight = 844;
  const { Renderer } = await import('../src/render.js');
  const r2 = new Renderer(makeCanvas());
  ok(r2.mobile === true, 'detects a coarse-pointer (phone) layout');
  // The arena no longer fills the screen: a HUD band is reserved at the top so
  // SCORE and PULSE sit above the playfield instead of on top of it. The world
  // plus the band must equal the screen exactly -- no gaps, no overlap.
  ok(r2.worldW === 390 && r2.worldH + r2.hudH === 844,
    `arena + HUD band fill the phone exactly (${r2.worldW}x${r2.worldH} + ${r2.hudH})`);
  ok(r2.oy === r2.hudH && r2.hudH > 0,
    `the arena starts below the HUD band (oy ${r2.oy})`);

  const st = sim.createState(9);
  st.world = { w: r2.worldW, h: r2.worldH };
  sim.startRun(st);
  for (let i = 0; i < 200 && st.levelState !== 'fight'; i++) {
    sim.step(st, 1 / 60, { ax: 0, ay: 0, aimX: st.world.w / 2, aimY: 0, fire: false, dash: false });
  }
  st.aimAssist = 0.34;
  st.touchUi = true;
  st.fireMode = 'manual';   // assist only exists in MARKSMAN mode
  let err2 = null;
  try {
    for (let i = 0; i < 60 * 90; i++) {
      if (st.mode === 'pick') { sim.chooseCard(st, 0); continue; }
      if (st.levelState !== 'fight') {
        sim.step(st, 1 / 60, { ax: 0, ay: 0, aimX: 195, aimY: 0, fire: false, dash: false });
        continue;
      }
      // a realistic phone player: thumb-stick strafing, aim with ~20 degrees of slop
      const pl = st.player;
      let near = null, nd = Infinity;
      for (const e of st.enemies) {
        const d = (e.x - pl.x) ** 2 + (e.y - pl.y) ** 2;
        if (d < nd) { nd = d; near = e; }
      }
      let ax = 0, ay = 0, fire = false, aimX = pl.x, aimY = pl.y - 100;
      if (near) {
        const d = Math.sqrt(nd) || 1;
        const ux = (near.x - pl.x) / d, uy = (near.y - pl.y) / d;
        // back off when they close in, otherwise strafe
        const radial = d < 120 ? -1 : d > 200 ? 1 : 0;
        ax = ux * radial - uy * 0.9;
        ay = uy * radial + ux * 0.9;
        const wob = Math.sin(i / 23) * 0.26;   // ±15 degrees of thumb slop
        const ang = Math.atan2(uy, ux) + wob;
        aimX = pl.x + Math.cos(ang) * Math.max(d, 120);
        aimY = pl.y + Math.sin(ang) * Math.max(d, 120);
        fire = d < 320;
      }
      // thumbs cannot reach under the pads, so the bot aims at a reachable point
      const reach = Math.min(aimY, st.world.h - 170);
      sim.step(st, 1 / 60, { ax, ay, aimX, aimY: reach, fire, dash: near && Math.sqrt(nd) < 90 && i % 90 === 0 });
      if (i % 2 === 0) r2.draw(st, { x: 0, y: 0 }, 1 / 60);
      if (st.mode === 'dead') break;
    }
  } catch (e) { err2 = e; }
  ok(!err2, 'portrait session runs + renders' + (err2 ? ': ' + err2.message : ''));
  const accWith = st.shotsHit / Math.max(1, st.shotsFired);
  // same sloppy thumb, no assist
  const st2 = sim.createState(9);
  st2.world = { w: 390, h: 844 };
  sim.startRun(st2);
  for (let i = 0; i < 200 && st2.levelState !== 'fight'; i++) {
    sim.step(st2, 1 / 60, { ax: 0, ay: 0, aimX: 195, aimY: 0, fire: false, dash: false });
  }
  st2.aimAssist = 0;
  st2.fireMode = 'manual';
  for (let i = 0; i < 60 * 90; i++) {
    if (st2.mode === 'pick') { sim.chooseCard(st2, 0); continue; }
    if (st2.mode === 'dead') break;
    // level cards freeze the fight: hold still rather than waste shots into them
    if (st2.levelState !== 'fight') {
      sim.step(st2, 1 / 60, { ax: 0, ay: 0, aimX: 195, aimY: 0, fire: false, dash: false });
      continue;
    }
    const p2 = st2.player;
    let n2 = null, d2 = Infinity;
    for (const e of st2.enemies) { const dd = (e.x - p2.x) ** 2 + (e.y - p2.y) ** 2; if (dd < d2) { d2 = dd; n2 = e; } }
    let ax2 = 0, ay2 = 0, f2 = false, ix = p2.x, iy = p2.y - 100;
    if (n2) {
      const d = Math.sqrt(d2) || 1, ux = (n2.x - p2.x) / d, uy = (n2.y - p2.y) / d;
      const radial = d < 120 ? -1 : d > 200 ? 1 : 0;
      ax2 = ux * radial - uy * 0.9; ay2 = uy * radial + ux * 0.9;
      const ang = Math.atan2(uy, ux) + Math.sin(i / 23) * 0.26;
      ix = p2.x + Math.cos(ang) * Math.max(d, 120);
      iy = p2.y + Math.sin(ang) * Math.max(d, 120);
      f2 = d < 320;
    }
    sim.step(st2, 1 / 60, { ax: ax2, ay: ay2, aimX: ix, aimY: Math.min(iy, st2.world.h - 170), fire: f2, dash: false });
  }
  const accWithout = st2.shotsHit / Math.max(1, st2.shotsFired);
  console.log(`      portrait acc: ${Math.round(accWith * 100)}% with assist vs ${Math.round(accWithout * 100)}% without`);
  console.log(`      portrait: ${st.kills} kills · wave ${st.wave}`);
  ok(accWith > accWithout + 0.05, 'aim assist converts sloppy thumbs into hits');
  ok(st.kills > 3, `a thumb player can clear enemies (${st.kills} kills, level ${st.level})`);
  ok(st.player.x <= st.world.w && st.player.y <= st.world.h, 'player stays inside the portrait arena');
  window.innerWidth = saveW; window.innerHeight = saveH;
}


// ---- desktop pass: arena scales to the window, HUD uses screen space ----
{
  const saveW = window.innerWidth, saveH = window.innerHeight;
  window.innerWidth = 1920; window.innerHeight = 1080;
  const { Renderer } = await import('../src/render.js');
  const r3 = new Renderer(makeCanvas());
  ok(r3.mobile === false, 'detects a desktop (fine pointer) layout');
  ok(r3.scale > 1.1, `arena scales up on a big monitor (scale ${r3.scale.toFixed(2)})`);
  ok(r3.uiW === 1920 && r3.uiH === 1080, `HUD lays out in screen space (${r3.uiW}x${r3.uiH})`);
  // letterbox offset must be invertible: world -> screen -> world round-trips
  const px = 640, py = 360;
  const sx = r3.ox + px * r3.scale, sy = r3.oy + py * r3.scale;
  const back = r3.toWorld(sx, sy);
  ok(Math.abs(back.x - px) < 0.01 && Math.abs(back.y - py) < 0.01,
     'mouse aim round-trips through the letterbox (no aim offset)');
  ok(r3.ox >= 0 && r3.oy >= 0, 'arena is centred with non-negative margins');

  const st = sim.createState(21);
  st.world = { w: r3.worldW, h: r3.worldH };
  sim.startRun(st);
  let err3 = null;
  try {
    for (let i = 0; i < 60 * 40; i++) {
      if (st.mode === 'pick') { sim.chooseCard(st, 0); continue; }
      const pl = st.player;
      let tgt = null, td = Infinity;
      for (const e of st.enemies) {
        const d = (e.x - pl.x) ** 2 + (e.y - pl.y) ** 2;
        if (d < td) { td = d; tgt = e; }
      }
      const tdx = tgt ? tgt.x : pl.x, tdy = tgt ? tgt.y : pl.y - 100;
      const tdist = Math.sqrt(td);
      sim.step(st, 1 / 60, {
        ax: tdx < pl.x ? -0.8 : 0.8, ay: tdy < pl.y ? -0.5 : 0.5,
        aimX: tdx, aimY: tdy,
        fire: tgt && tdist < 420 && i % 3 === 0,
        dash: tdist < 120 && i % 150 === 0,
      });
      if (i % 3 === 0) r3.draw(st, { x: 900, y: 300 }, 1 / 60);
      if (st.mode === 'dead') break;
    }
  } catch (e) { err3 = e; }
  ok(!err3, 'desktop session runs + renders' + (err3 ? ': ' + err3.message : ''));
  console.log(`      desktop: ${st.kills} kills · wave ${st.wave} · ${Math.round(100 * st.shotsHit / Math.max(1, st.shotsFired))}% acc`);
  ok(st.kills > 5, 'desktop session is playable, not just renderable');
  window.innerWidth = saveW; window.innerHeight = saveH;
}


// ---- the SHIPPED artifact must actually execute --------------------------------
// Testing the ES modules is not enough: the bundler can silently emit invalid JS.
// It did once ('import x as y' was never transpiled) and shipped a dead page.
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  try { execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' }); }
  catch (e) { ok(false, 'build.mjs runs'); }

  for (const file of ['dist/overdraft.html', 'docs/index.html']) {
    ok(existsSync(file), `${file} exists`);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
    ok(!!m, `${file} has an inline script`);
    if (!m) continue;
    let parseErr = null;
    try { new Function(m[1]); } catch (e) { parseErr = e; }
    ok(!parseErr, `${file} contains VALID javascript` + (parseErr ? ': ' + parseErr.message : ''));
    const destructures = m[1].split('\n').filter((l) => l.startsWith('const {')).join('\n');
    ok(!/\w\s+as\s+[A-Za-z_$]/.test(destructures), `${file} has no un-transpiled import aliases`);
    ok(!/<script[^>]+src=/.test(html), `${file} needs no external script (one request)`);
  }
}

console.log(fail === 0 ? '\nSMOKE OK' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);


// ---- portrait phone pass: world must fill the screen, touch path must work ----
{
  const save = { w: window.innerWidth, h: window.innerHeight };
  window.innerWidth = 390; window.innerHeight = 844;
  const { Renderer } = await import('../src/render.js');
  const r2 = new Renderer(makeCanvas());
  ok(r2.mobile === true, 'detects a coarse-pointer (phone) layout');
  ok(r2.worldW === 390 && r2.worldH === 844, `world fills the phone (${r2.worldW}x${r2.worldH})`);

  const st = sim.createState(9);
  st.world = { w: r2.worldW, h: r2.worldH };
  sim.startRun(st);
  for (let i = 0; i < 200 && st.levelState !== 'fight'; i++) {
    sim.step(st, 1 / 60, { ax: 0, ay: 0, aimX: st.world.w / 2, aimY: 0, fire: false, dash: false });
  }
  st.aimAssist = 0.34;
  st.touchUi = true;
  st.fireMode = 'manual';   // assist only exists in MARKSMAN mode
  let err2 = null;
  try {
    for (let i = 0; i < 60 * 90; i++) {
      if (st.mode === 'pick') { sim.chooseCard(st, 0); continue; }
      if (st.levelState !== 'fight') {
        sim.step(st, 1 / 60, { ax: 0, ay: 0, aimX: 195, aimY: 0, fire: false, dash: false });
        continue;
      }
      // emulate a phone player: stick pushed, firing at a point on the right
      // crude phone player: aim near the nearest enemy with ~20 degrees of error
      let near = null, nd = Infinity;
      for (const e of st.enemies) {
        const d = (e.x - st.player.x) ** 2 + (e.y - st.player.y) ** 2;
        if (d < nd) { nd = d; near = e; }
      }
      const wob = Math.sin(i / 17) * 0.35;
      const aimX = near ? near.x + Math.cos(wob) * 90 : st.player.x;
      const aimY = near ? near.y + Math.sin(wob) * 90 : st.player.y - 100;
      sim.step(st, 1 / 60, { ax: st.player.x < 195 ? 1 : -1, ay: 0.2, aimX, aimY, fire: near && Math.sqrt(nd) < 300, dash: i % 200 === 0 });
      if (i % 2 === 0) r2.draw(st, { x: 0, y: 0 }, 1 / 60);
      if (st.mode === 'dead') break;
    }
  } catch (e) { err2 = e; }
  ok(!err2, 'portrait session runs + renders' + (err2 ? ': ' + err2.message : ''));
  ok(st.kills > 5, `aim assist makes touch play viable (${st.kills} kills, wave ${st.wave})`);
  ok(st.player.x <= st.world.w && st.player.y <= st.world.h, 'player stays inside the portrait arena');
  window.innerWidth = save.w; window.innerHeight = save.h;
}
