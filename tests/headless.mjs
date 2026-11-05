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
  out.fire = d < 520 && aimErr < 0.2 && p.hp > 1.2;
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

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
