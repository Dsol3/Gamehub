// Regression suite for the three things reported after the title fix:
//
//  1. the augment picker trapped the player on a landscape phone (cards 2 and 3
//     were drawn below the bottom edge, and an off-card tap was swallowed);
//  2. SPACE fired AND dashed at the same time;
//  3. TURRET was just AUTO-AIM with worse numbers — replaced by SIEGE, an endless
//     mode with its own escalation clock, evolution ladder and 60s refill.
//
// Everything here talks to the real modules; nothing is re-implemented.
import { readFileSync } from 'node:fs';
import { createState, startSiege, stepSiege, SIEGE_WEAPONS, SIEGE_WEAPON_MAX } from '../src/sim.js';
import {
  pickLayout, pickIndexAt, addRun, sanitizeBoard, emptyBoard, BOARD_SIZE,
  enemyTierAt, playerTierAt, ENEMY_TIER_SECONDS, PLAYER_TIER_SECONDS, PULSE_REFILL_SECONDS,
} from '../src/layout.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

// ---------------------------------------------------------------------------
console.log('-- 1. the picker must fit, and always have a way out --');
const DEVICES = [
  [844, 390, true, 'iPhone 13 landscape'],
  [667, 375, true, 'iPhone SE landscape'],
  [915, 412, true, 'Pixel landscape'],
  [568, 320, true, 'iPhone SE landscape (shortest supported)'],
  [390, 844, true, 'iPhone 13 portrait'],
  [375, 667, true, 'iPhone SE portrait'],
  [1024, 768, true, 'tablet landscape'],
  [1280, 720, false, 'desktop'],
  [1568, 730, false, 'wide desktop'],
];
for (const [W, H, mob, name] of DEVICES) {
  const lay = pickLayout(W, H, mob);
  let onScreen = true;
  for (const c of lay.cards) {
    if (c.x < 0 || c.y < 0 || c.x + c.w > W || c.y + c.h > H) onScreen = false;
  }
  ok(onScreen, `${name}: all 3 augment cards are on screen`);

  // and the centre of each card must hit-test to itself — the actual reported bug
  let selfHits = true;
  lay.cards.forEach((c, i) => {
    if (pickIndexAt(lay, c.x + c.w / 2, c.y + c.h / 2) !== i) selfHits = false;
  });
  ok(selfHits, `${name}: tapping a card selects that card`);

  const sk = lay.skip;
  const skipOn = sk.x >= 0 && sk.y >= 0 && sk.x + sk.w <= W && sk.y + sk.h <= H;
  ok(skipOn, `${name}: SKIP button is on screen`);
  ok(lay.bottom <= sk.y, `${name}: the cards never overlap the SKIP button`);
}

// landscape phones must lay the cards out as a ROW (that is the fix)
{
  const land = pickLayout(844, 390, true);
  ok(!land.vertical, 'landscape phone puts the cards in a row');
  const ys = new Set(land.cards.map((c) => Math.round(c.y)));
  ok(ys.size === 1, 'landscape cards share one row (no column stacking)');
  const port = pickLayout(390, 844, true);
  ok(port.vertical, 'portrait phone still stacks the cards');
}

// the old geometry, re-run, to prove the bug existed and is gone
{
  const W = 844, H = 390;
  const oldCw = Math.min(W - 56, 320), oldCh = 132, oldGap = 14, oldY = H * 0.3;
  const oldBottoms = [0, 1, 2].map((i) => oldY + i * (oldCh + oldGap) + oldCh);
  const off = oldBottoms.filter((b) => b > H).length;
  ok(off === 2, `the OLD layout put ${off} of 3 cards off-screen (reproduced)`);
  const lay = pickLayout(W, H, true);
  const nowOff = lay.cards.filter((c) => c.y + c.h > H).length;
  ok(nowOff === 0, 'the new layout puts 0 cards off-screen');
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. SPACE must not fire and dash at the same time --');
{
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const spaceBindings = [...src.matchAll(/keys\.has\(' '\)|k === ' '|e\.key === ' '/g)];
  ok(spaceBindings.length === 0, `space is bound to nothing (${spaceBindings.length} references)`);
  ok(/keys\.has\('j'\)/.test(src), 'J fires');
  ok(/keys\.has\('shift'\)/.test(src), 'SHIFT dashes');
  const dashLine = src.split('\n').find((l) => l.includes("keys.has('shift')") && l.includes('input.dash'));
  ok(!!dashLine && !dashLine.includes('fire'), 'the dash binding cannot fire as a side effect');
  const fireLine = src.split('\n').find((l) => l.includes("keys.has('j')") && l.includes('wantFire'));
  ok(!!fireLine && !fireLine.includes('dash'), 'the fire binding cannot dash as a side effect');
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. SIEGE: the enemies upgrade exactly twice as fast as the player --');
{
  ok(ENEMY_TIER_SECONDS * 2 === PLAYER_TIER_SECONDS,
    `enemy tier every ${ENEMY_TIER_SECONDS}s, player every ${PLAYER_TIER_SECONDS}s`);
  ok(enemyTierAt(0) === 1 && playerTierAt(0) === 1, 'both start at tier 1');
  ok(enemyTierAt(20) === 3, 'at 20s the enemy tier is 3');
  ok(playerTierAt(20) === 2, 'at 20s the player tier is 2');
  let widening = true;
  for (let t = 0; t <= 300; t += 10) {
    if (enemyTierAt(t) < playerTierAt(t)) widening = false;
  }
  ok(widening, 'the enemy tier is never behind the player');
  ok(enemyTierAt(120) - playerTierAt(120) > enemyTierAt(30) - playerTierAt(30),
    'the gap widens over time');
}

console.log('\n-- 3b. the weapon ladder matches the requested evolution --');
{
  const names = SIEGE_WEAPONS.map((w) => w.name);
  ok(names[0] === 'SINGLE', 'starts with a single shot');
  ok(names[1] === 'DOUBLE', 'then double');
  ok(names[2] === 'TRIPLE', 'then triple');
  ok(names[3].includes('ROCKET') && SIEGE_WEAPONS[3].shots === 1, 'then a rocket');
  ok(names[4].includes('TWIN') && SIEGE_WEAPONS[4].shots === 2, 'then double rockets');
  ok(SIEGE_WEAPONS[3].rocket === true && SIEGE_WEAPONS[0].rocket === false,
    'rockets are a real projectile class, not a label');
  ok(SIEGE_WEAPON_MAX === SIEGE_WEAPONS.length, 'the ladder length is the source of truth');
  ok(SIEGE_WEAPONS.every((w, i) => i === 0 || w.rocket === SIEGE_WEAPONS[3].rocket || i < 3),
    'the rocket tier is the point where splash starts');
}

console.log('\n-- 3c. a real SIEGE run: waves, evolution, kills --');
{
  const FIXED = 1 / 60;
  const s = createState(7);
  s.world = { w: 844, h: 390 };
  startSiege(s);
  ok(s.mode === 'play' && s.siege === true, 'SIEGE starts straight into play (no level card)');
  ok(s.levelState === 'fight', 'no teach/clear/fail card can appear in SIEGE');
  ok(s._lv.quota === 0, 'SIEGE has no kill quota');

  const seen = { waveStart: 0, evolve: 0, waveClear: 0 };
  const evoSaw = new Set();
  let t = 0;
  while (s.mode !== 'dead' && t < 400) {
    // stand still: this measures the mode's own pressure, not a bot's dodging
    stepSiege(s, FIXED, { ax: 0, ay: 0 });
    for (const ev of s.events) {
      if (ev.type in seen) seen[ev.type]++;
      if (ev.type === 'evolve') evoSaw.add(ev.name);
    }
    t += FIXED;
  }
  console.log(`      died at ${t.toFixed(0)}s · wave ${s.wave2} · ${s.siegeKills} kills · tier ${s.playerTier}`);
  ok(seen.waveStart >= 2, `waves keep coming (${seen.waveStart} started)`);
  ok(seen.evolve >= 2, `the gun evolves during a run (${seen.evolve} times)`);
  ok(evoSaw.has('DOUBLE'), 'DOUBLE is reached inside a normal run');
  ok(s.wave2 >= 2, 'the run reaches at least wave 2');
  ok(s.siegeKills > 0, `the auto-firing gun kills without input (${s.siegeKills})`);
  ok(seen.waveClear >= 1, `clearing a wave pays out (${seen.waveClear})`);
}

console.log('\n-- 3d. the 60s refill really refills --');
{
  const FIXED = 1 / 60;
  const s = createState(3);
  s.world = { w: 844, h: 390 };
  startSiege(s);
  let refilled = 0;
  let t = 0;
  while (t < PULSE_REFILL_SECONDS + 2) {
    s.enemies.length = 0;      // isolate the refill from combat
    stepSiege(s, FIXED, { ax: 0, ay: 0 });
    for (const ev of s.events) if (ev.type === 'refill') refilled++;
    t += FIXED;
  }
  ok(refilled === 1, `exactly one refill in the first ${PULSE_REFILL_SECONDS}s (got ${refilled})`);
  ok(s.refills === 1, 'the refill counter advanced');
}

console.log('\n-- 3e. SIEGE never leaks into the campaign --');
{
  const s = createState(5);
  ok(s.siege === false && s.siegeT === 0 && s.wave2 === 0, 'a fresh state is a campaign state');
  ok(s.levelState !== 'pick', 'a fresh state is not mid-pick');
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. the mini leaderboard --');
{
  ok(BOARD_SIZE === 5, 'the board keeps five rows');
  let b = emptyBoard();
  let res = addRun(b, 'siege', { score: 1200, wave: 4, time: 61, ts: 1 });
  ok(res.rank === 1 && res.isBest === true, 'the first run ranks 1st and is the best');
  b = res.board;
  res = addRun(b, 'siege', { score: 900, wave: 3, time: 44, ts: 2 });
  b = res.board;
  ok(res.rank === 2, 'a lower score ranks below it');
  res = addRun(b, 'siege', { score: 5000, wave: 9, time: 200, ts: 3 });
  b = res.board;
  ok(res.rank === 1 && res.isBest, 'a better run takes first place');
  ok(b.siege.length === 3, 'all three runs are kept');
  ok(b.siege.map((r) => r.score).join(',') === '5000,1200,900', 'the board is sorted by score');

  ok(b.campaign.length === 0, 'siege runs do not pollute the campaign board');
  const c = addRun(b, 'campaign', { score: 700, level: 4, acc: 68, ts: 4 });
  ok(c.board.campaign.length === 1 && c.board.siege.length === 3, 'both boards coexist');

  let cap = emptyBoard();
  for (let i = 0; i < 9; i++) cap = addRun(cap, 'campaign', { score: 100 + i, level: i + 1, ts: i }).board;
  ok(cap.campaign.length === BOARD_SIZE, 'the board is capped at five rows');
  ok(cap.campaign[0].score === 108, 'the top of a capped board is the best run');

  const junk = sanitizeBoard({ campaign: [{ score: 'nope' }, null, { score: 300 }], siege: 'x' });
  ok(junk.campaign.length === 1 && junk.siege.length === 0, 'corrupt storage is discarded safely');
  ok(sanitizeBoard(null).campaign.length === 0, 'missing storage yields an empty board');
  ok(sanitizeBoard({ campaign: [{ score: 5, acc: 900 }] }).campaign[0].acc === 100,
    'accuracy is clamped into range');
}


// ---------------------------------------------------------------------------
console.log('\n-- 6. SIEGE responds to the player --');
{
  const FIXED = 1 / 60;
  const run = (dodge) => {
    const s = createState(11);
    s.world = { w: 844, h: 390 };
    startSiege(s);
    let t = 0;
    while (s.mode !== 'dead' && t < 600) {
      let ax = 0, ay = 0;
      if (dodge) {
        let near = null, nd = Infinity;
        for (const e of s.enemies) {
          const d = (e.x - s.player.x) ** 2 + (e.y - s.player.y) ** 2;
          if (d < nd) { nd = d; near = e; }
        }
        if (near && nd < 230 * 230) {
          const d = Math.sqrt(nd) || 1;
          ax = -(near.x - s.player.x) / d; ay = -(near.y - s.player.y) / d;
        }
      }
      stepSiege(s, FIXED, { ax, ay });
      t += FIXED;
    }
    return s.siegeT;
  };
  const still = run(false);
  const dodging = run(true);
  console.log(`      standing still: ${still.toFixed(0)}s · dodging: ${dodging.toFixed(0)}s`);
  ok(dodging > still + 10, 'moving actually extends a SIEGE run (input reaches the sim)');

  // and the player must physically move when input is given
  const s = createState(2);
  s.world = { w: 844, h: 390 };
  startSiege(s);
  const x0 = s.player.x;
  for (let i = 0; i < 30; i++) stepSiege(s, FIXED, { ax: 1, ay: 0 });
  ok(Math.abs(s.player.x - x0) > 5, 'holding right moves the player in SIEGE');
}

// ---------------------------------------------------------------------------
console.log('\n-- 7. the endless clock and the wave counter are honest --');
{
  const FIXED = 1 / 60;
  const s = createState(6);
  s.world = { w: 844, h: 390 };
  startSiege(s);
  ok(s.wave2 === 0 && s.waveBreath > 0, 'no wave is live during the opening breath');
  for (let i = 0; i < 60; i++) stepSiege(s, FIXED, { ax: 0.5, ay: 0 });
  ok(s.wave2 === 1, 'wave 1 begins after the breath');
  ok(s.waveLeft > 0 || s.enemies.length > 0, 'wave 1 has enemies to kill');
  const t1 = s.siegeT;
  ok(t1 > 0.9 && t1 < 1.2, `the survival clock runs in real time (${t1.toFixed(2)}s)`);
  // the player tier advances on the 20s beat, the enemy tier on the 10s beat
  ok(s.playerTier === 1 && s.enemyTier === 1, 'both tiers are still 1 in the first 20s');
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. the death screen fits every supported screen --');
{
  const { Renderer } = await import('../src/render.js');
  const noop = () => {};
  const grad = { addColorStop: noop };
  const mkCtx = (log) => new Proxy({
    measureText: (t) => ({ width: 8 * String(t).length }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    setLineDash: noop,
    fillText: (t, x, y) => log.push({ t: String(t), x, y }),
  }, { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => ((o[k] = v), true) });
  const mkCanvas = (W, H, log) => ({
    width: W, height: H, style: {},
    getContext() { return this._c || (this._c = mkCtx(log)); },
    parentElement: { getBoundingClientRect: () => ({ width: W, height: H }) },
  });
  const g = globalThis;
  Object.defineProperty(g, 'document', {
    value: { createElement: () => mkCanvas(8, 8, []), documentElement: null },
    configurable: true, writable: true,
  });
  Object.defineProperty(g, 'window', {
    value: {
      innerWidth: 800, innerHeight: 600, devicePixelRatio: 2,
      addEventListener: noop, matchMedia: () => ({ matches: true }),
    },
    configurable: true, writable: true,
  });
  Object.defineProperty(g, 'localStorage', {
    value: { getItem: () => null, setItem: noop }, configurable: true, writable: true,
  });

  for (const [W, H, name] of [
    [844, 390, 'iPhone 13 landscape'], [667, 375, 'iPhone SE landscape'],
    [568, 320, 'shortest landscape'], [390, 844, 'portrait'], [1280, 720, 'desktop'],
  ]) {
    const log = [];
    const cv = mkCanvas(W, H, log);
    const r = new Renderer(cv);
    const st = createState(7);
    st.world = { w: r.worldW, h: r.worldH };
    Object.assign(st, {
      mode: 'dead', siege: true, siegeT: 134, wave2: 8, siegeKills: 71,
      score: 9800, weapon: { name: 'TWIN ROCKET' }, deadT: 2,
    });
    r.board = { campaign: [], siege: [{ score: 9800, wave: 8, time: 134, ts: 5 }] };
    r.lastRun = { score: 9800, ts: 5 };
    let threw = null;
    try { r.draw(st, { x: 0, y: 0 }, 1 / 60); } catch (e) { threw = e.message; }
    ok(!threw, `${name}: death screen draws without throwing` + (threw ? ' (' + threw + ')' : ''));
    // SHARE + RUN IT BACK + MAIN MENU. All three have to be fully on screen and
    // must not overlap each other, or a tap lands on the wrong action — and the
    // share button is the one that would swallow a restart.
    const btns = r._deadBtns || [];
    ok(btns.length === 3 && btns.every((b) => b.y >= 0 && b.y + b.h <= H && b.x >= 0 && b.x + b.w <= W),
      `${name}: all three death-screen buttons are on screen (${btns.length})`);
    let overlap = null;
    for (let i = 0; i < btns.length && !overlap; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlap = a.id + '/' + b.id; break;
        }
      }
    }
    ok(!overlap, `${name}: death-screen buttons do not overlap` + (overlap ? ' (' + overlap + ')' : ''));
    ok(btns.some((b) => b.id === 'share'), `${name}: the share button exists`);
    // The HUD lives in the reserved strip ABOVE the arena on a phone, which in
    // arena-space coordinates is negative y (down to -this.hudH). Anything drawn
    // above that strip, or past the right/bottom edges, is a real clip.
    const bandTop = -(r.hudH || 0);
    const clipped = log.filter((l) => l.y > H || l.y < bandTop - 2 || l.x < 0 || l.x > W);
    ok(clipped.length === 0, `${name}: nothing is drawn off-screen` +
      (clipped.length ? ' -> ' + clipped.slice(0, 2).map((c) => c.t + '@' + Math.round(c.y)).join(', ') : ''));
  }
}

console.log(failures ? `\n${failures} FEATURE FAILURE(S)` : '\nFEATURES OK');
process.exit(failures ? 1 : 0);
