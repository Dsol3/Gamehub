// Headless balance + saneness check. No browser needed.
//   node tests/headless.mjs
import { createState, startRun, step, chooseCard, accuracy, W, H } from '../src/sim.js';

const FIXED = 1 / 60;

function run({ bot, seconds = 180, seed = 1234, card = 0, verbose = false }) {
  const s = createState(seed);
  startRun(s);
  let t = 0;
  let picks = 0;
  while (t < seconds && s.mode !== 'dead') {
    let input;
    if (s.mode === 'pick') {
      chooseCard(s, card % s.pick.length);
      picks++;
      continue;
    }
    input = bot(s);
    step(s, FIXED, input);
    t += FIXED;
    // demo bot is competent but not superhuman: it aims with error
    if (s.mode === 'dead') break;
  }
  return { s, t, picks };
}

const nearest = (s) => {
  const p = s.player;
  let best = null, bd = Infinity;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};

// A competent player: aims at the nearest enemy, keeps distance, dodges.
function goodBot(s) {
  const p = s.player;
  const e = nearest(s);
  const out = { ax: 0, ay: 0, aimX: p.x, aimY: p.y - 100, fire: false, dash: false };
  if (!e) return out;
  const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
  const ux = (e.x - p.x) / d, uy = (e.y - p.y) / d;
  out.aimX = e.x + e.vx * 0.06;
  out.aimY = e.y + e.vy * 0.06;
  const want = 240;
  const radial = d < want - 60 ? -1 : d > want + 60 ? 1 : 0;
  out.ax = ux * radial + -uy * 0.5;
  out.ay = uy * radial + ux * 0.5;
  const aimErr = Math.abs(Math.atan2(out.aimY - p.y, out.aimX - p.x) - p.aim);
  // no passive regen exists: a low player must keep killing to heal,
  // so never voluntarily stop firing while enemies are close
  out.fire = d < 520 && aimErr < 0.2 && (p.hp > 1.2 || d < 300);
  if (d < 110 && p.dashCd <= 0) out.dash = true;
  return out;
}

// A panicky player: sprays at whatever is nearest, never stops firing.
function sprayBot(s) {
  const p = s.player;
  const e = nearest(s);
  const out = { ax: 0, ay: 0, aimX: p.x, aimY: p.y - 100, fire: true, dash: false };
  if (!e) return out;
  const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
  out.aimX = e.x; out.aimY = e.y;
  out.ax = -(e.x - p.x) / d; out.ay = -(e.y - p.y) / d;
  return out;
}

// A camper: stands still, never fires.
function idleBot(s) {
  return { ax: 0, ay: 0, aimX: s.player.x, aimY: s.player.y - 100, fire: false, dash: false };
}

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};

// 1) the sim actually ticks and produces entities
const probe = createState(7);
startRun(probe);
for (let i = 0; i < 240; i++) step(probe, FIXED, idleBot(probe));
ok(probe.enemies.length > 0, `enemies spawn (${probe.enemies.length} on field after 4s)`);
ok(probe.score >= 0 && probe.time > 3.9, 'clock advances');
ok(probe.player.hp <= probe.player.maxHp, 'hp within bounds');

// 2) an idle player eventually dies — the game can lose
const idle = run({ bot: idleBot, seconds: 240 });
ok(idle.s.mode === 'dead', `standing still is fatal (died at ${idle.t.toFixed(1)}s, wave ${idle.s.wave})`);

// 3) shooting costs pulse: firing into empty space drains health
const drain = createState(11);
startRun(drain);
const before = drain.player.hp;
for (let i = 0; i < 60; i++) step(drain, FIXED, { ax: 0, ay: 0, aimX: W / 2, aimY: 0, fire: true, dash: false });
ok(drain.player.hp < before, `firing costs PULSE (${before} -> ${drain.player.hp.toFixed(2)})`);
ok(drain.shotsFired > 0, `shots registered (${drain.shotsFired})`);

// 4) you cannot fire past the overdraft floor
const floorTest = createState(12);
startRun(floorTest);
for (let i = 0; i < 60 * 20; i++) step(floorTest, FIXED, { ax: 0, ay: 0, aimX: W / 2, aimY: 0, fire: true, dash: false });
ok(floorTest.player.hp >= -3, `PULSE floor respected (${floorTest.player.hp.toFixed(2)})`);

// 5) a competent player survives a while
const good = run({ bot: goodBot, seconds: 180, seed: 99 });
console.log(`      good bot: ${good.t.toFixed(1)}s · wave ${good.s.wave} · ${good.s.kills} kills · ${Math.round(accuracy(good.s) * 100)}% acc · score ${good.s.score}`);
ok(good.t > 40, `competent play survives past 40s (${good.t.toFixed(1)}s)`);

// 6) spraying blindly should be punished vs aiming
const spray = run({ bot: sprayBot, seconds: 180, seed: 99 });
console.log(`      spray bot: ${spray.t.toFixed(1)}s · wave ${spray.s.wave} · ${spray.s.kills} kills · ${Math.round(accuracy(spray.s) * 100)}% acc`);
ok(accuracy(spray.s) < accuracy(good.s), 'spraying is less accurate than aiming');

// 7) difficulty actually ramps
const ramp = run({ bot: goodBot, seconds: 300, seed: 5 });
ok(ramp.s.wave >= 3, `waves escalate (reached wave ${ramp.s.wave})`);

// 8) determinism — same seed, same outcome
const a = run({ bot: goodBot, seconds: 30, seed: 42 });
const b = run({ bot: goodBot, seconds: 30, seed: 42 });
ok(a.s.score === b.s.score && a.s.kills === b.s.kills, 'runs are deterministic per seed');

// 9) nothing explodes numerically
const finite = [good.s.player.x, good.s.player.y, good.s.score, good.s.time].every(Number.isFinite);
ok(finite, 'no NaN / Infinity in state');

// ---------------------------------------------------------------------------
// THE CORE DESIGN CONTRACT
// The whole pitch is "your health bar is your magazine". That only means
// anything if the mechanic is MANDATORY. These assertions are what stop it
// silently turning back into a game you can win by running away.
// ---------------------------------------------------------------------------
console.log('\n-- design contract: the mechanic must be mandatory --');

function strategy(mode, seed, secs = 300) {
  const s = createState(seed);
  s.world = { w: 1280, h: 720 };
  startRun(s);
  for (let i = 0; i < secs * 60 && s.mode !== 'dead'; i++) {
    if (s.mode === 'pick') { s.mode = 'play'; s.pick = null; continue; }
    const p = s.player;
    let near = null, nd = Infinity;
    for (const e of s.enemies) {
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < nd) { nd = d; near = e; }
    }
    if (!near) { step(s, FIXED, { ax: 0, ay: 0, aimX: p.x, aimY: p.y - 100, fire: false, dash: false }); continue; }
    const d = Math.sqrt(nd) || 1;
    const ux = (near.x - p.x) / d, uy = (near.y - p.y) / d;
    if (mode === 'dodge') {
      step(s, FIXED, { ax: -ux, ay: -uy, aimX: near.x, aimY: near.y, fire: false, dash: d < 90 });
      continue;
    }
    const ring = d > 340 ? 1 : d < 240 ? -1 : 0;
    const spread = mode === 'spray' ? Math.sin(s.time * 7) * 1.1 : 0;
    const a = Math.atan2(uy, ux) + spread;
    step(s, FIXED, {
      ax: ux * ring - uy * 0.5, ay: uy * ring + ux * 0.5,
      aimX: p.x + Math.cos(a) * d, aimY: p.y + Math.sin(a) * d,
      fire: d < 440, dash: d < 95,
    });
  }
  return s;
}

const SEEDS = [11, 22, 33, 44, 55];
const mean = (mode, key) => SEEDS.reduce((a, sd) => a + strategy(mode, sd)[key], 0) / SEEDS.length;
const dodgeT = mean('dodge', 'time');
const shootT = mean('shoot', 'time');
const sprayT = mean('spray', 'time');
const dodgeKills = mean('dodge', 'kills');
const shootKills = mean('shoot', 'kills');

console.log(`      dodge ${dodgeT.toFixed(0)}s · aim ${shootT.toFixed(0)}s · spray ${sprayT.toFixed(0)}s`);
ok(sprayT < dodgeT, `spraying is punished (${sprayT.toFixed(0)}s < ${dodgeT.toFixed(0)}s)`);
ok(dodgeT < shootT, `running away loses to aiming (${dodgeT.toFixed(0)}s < ${shootT.toFixed(0)}s)`);
ok(dodgeKills === 0, 'no free kills: touching an enemy cannot remove it');
ok(shootKills > 25, `aiming clears the field (${shootKills.toFixed(0)} kills/run)`);
ok(shootT > 55, `a competent run is long enough to be a game (${shootT.toFixed(0)}s)`);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
