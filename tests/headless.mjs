// Headless balance + saneness check. No browser needed.
//   node tests/headless.mjs
import * as sim from '../src/sim.js';
const { createState, startRun, step, chooseCard, accuracy, W, H, levelFor } = sim;

const FIXED = 1 / 60;

// Skip the opening level card: it is a deliberate beat, not part of the fight.
function skipCards(s) {
  for (let i = 0; i < 400 && s.levelState !== 'fight' && s.mode === 'play'; i++) {
    step(s, FIXED, { ax: 0, ay: 0, aimX: s.world.w / 2, aimY: 0, fire: false, dash: false });
  }
  return s;
}

function run({ bot, seconds = 180, seed = 1234, card = 0, verbose = false }) {
  const s = createState(seed);
  startRun(s);
  s.fireMode = 'manual';
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
drain.fireMode = 'manual';
skipCards(drain);
const before = drain.player.hp;
for (let i = 0; i < 60; i++) step(drain, FIXED, { ax: 0, ay: 0, aimX: W / 2, aimY: 0, fire: true, dash: false });
ok(drain.player.hp < before, `firing costs PULSE (${before} -> ${drain.player.hp.toFixed(2)})`);
ok(drain.shotsFired > 0, `shots registered (${drain.shotsFired})`);

// 4) you cannot fire past the overdraft floor
const floorTest = createState(12);
startRun(floorTest);
floorTest.fireMode = 'manual';
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

function strategy(mode, seed, secs = 300, fireMode = 'manual') {
  const s = createState(seed);
  s.world = { w: 1280, h: 720 };
  startRun(s);
  s.fireMode = fireMode;   // the contract is defined for MARKSMAN
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

// ---------------------------------------------------------------------------
// THE TWO MODES MUST PLAY DIFFERENTLY
// MARKSMAN: you aim, misses ricochet back, kills pay 2.
// TURRET:   the gun fires itself, no ricochet, kills pay 1.
// If these numbers converge the modes are a difficulty slider, not mechanics.
// ---------------------------------------------------------------------------
console.log('\n-- levels must be clearable, gated, and escalate --');

// 1) every level's quota must be reachable inside its own clock, or the game is
//    unwinnable and the failure looks like the player's fault.
for (const spec of sim.LEVELS) {
  // DEBT COLLECTOR has no kill quota: its goal is surviving 12s in overdraft, and
  // a live quota there meant every clear happened the ordinary way instead.
  const hasGoal = spec.rule === 'overdraftWindow' ? spec.time > 0 : spec.quota > 0;
  ok(hasGoal && spec.time > 0, `L${spec.n} ${spec.name} has a goal and a clock`);
  if (spec.quota > 0) {
    const rate = spec.quota / spec.time;         // kills per second required
    ok(rate <= 0.55, `L${spec.n} quota is physically reachable (${rate.toFixed(2)} kills/s)`);
  }
}
ok(sim.LEVELS.length === 9, 'nine taught levels before the run goes endless');

// 2) the first level must not teach ricochet and punishment at the same time
ok(sim.LEVELS[0].noRicochet === true, 'level 1 withholds ricochet until the ammo rule lands');

// 3) difficulty must actually increase, not just grow longer
// quota-free levels skip the quota term; speed and body count must still climb
// A level's real load is how fast it throws bodies at you, so compare spawn rate
// (lower = harder) alongside quota; waveSpeed alone called two identical levels a ramp.
const ramps = sim.LEVELS.slice(1).every((lv, i) => {
  const prev = sim.LEVELS[i];
  const quotaOk = lv.quota === 0 || prev.quota === 0 || lv.quota >= prev.quota - 2;
  const pressureOk = lv.spawn <= prev.spawn + 0.25 && lv.cap >= prev.cap - 1;
  return quotaOk && pressureOk;
});
ok(ramps, 'later levels are not easier than earlier ones');

// 4) endless scaling keeps going and keeps getting harder
const l10 = sim.levelFor(10), l20 = sim.levelFor(20);
ok(l10.quota > sim.LEVELS[8].quota && l20.quota > l10.quota, 'levels past nine keep scaling');
ok(l20.spawn <= l10.spawn, 'endless levels spawn at least as fast');

// 5) clearing a level advances; failing retries without losing progress
function playLevel(lv, fireMode = 'manual') {
  const s = createState(5); s.world = { w: 1280, h: 720 }; startRun(s);
  for (let i = 0; i < 200 && s.levelState !== 'fight'; i++) {
    step(s, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
  }
  s.level = lv; s._lv = sim.levelFor(lv); s.levelKills = 0; s.levelT = 0;
  s.levelState = 'fight'; s.fireMode = fireMode;
  return s;
}
const clearMe = playLevel(1);
clearMe.levelKills = sim.LEVELS[0].quota;
step(clearMe, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
ok(clearMe.levelState === 'clear', 'hitting the quota clears the level');
for (let i = 0; i < 200 && clearMe.levelState !== 'pick'; i++) {
  step(clearMe, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
}
ok(clearMe.levelState === 'pick' && clearMe.mode === 'pick', 'clearing leads to an augment pick');

const failMe = playLevel(2);
failMe.levelT = sim.levelFor(2).time + 0.1;
step(failMe, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
ok(failMe.levelState === 'fail', 'running out of clock fails the level');
const lvBefore = failMe.level, retriesBefore = failMe.retries;
for (let i = 0; i < 300 && failMe.levelState !== 'fight'; i++) {
  step(failMe, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
}
ok(failMe.level === lvBefore, 'failing does not send you backwards a level');
ok(failMe.retries === retriesBefore + 1, 'failing is recorded as a retry, not a death');

// 6) each level's special rule must actually do something, or the level is just
//    'the same fight with a different number' and the design claim is a lie.
function atLevel(lv) {
  const s = createState(4); s.world = { w: 1280, h: 720 }; startRun(s);
  for (let i = 0; i < 200 && s.levelState !== 'fight'; i++) {
    step(s, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
  }
  s.level = lv; s._lv = sim.levelFor(lv); s.levelState = 'fight';
  s.levelKills = 0; s.levelT = 0; s.enemies.length = 0;
  s.fireMode = 'manual';
  return s;
}

// RAM: body-checking a scrapper destroys it — but only if YOU are the one moving.
// The first version counted any contact, so eight enemies walking into a
// stationary player cleared the level with zero input.
const ramStill = atLevel(3);
ramStill.enemies.push({ id: 1, type: 'scrapper', x: ramStill.player.x + 18, y: ramStill.player.y, vx: -120, vy: 0,
  r: 13 * ramStill.es, hp: 1, speed: 120, dmg: 2, refund: 2, score: 100, color: '#f0f',
  hitFlash: 0, spawnT: 0, fireCd: 99, phase: 0, dead: false, hitCd: 0 });
for (let i = 0; i < 20; i++) step(ramStill, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 200, fire: false, dash: false });
ok(ramStill.kills === 0, 'level 3: an enemy walking into a standing player is NOT a ram');

const ram = atLevel(3);
ram.enemies.push({ id: 1, type: 'scrapper', x: ram.player.x + 60, y: ram.player.y, vx: 0, vy: 0,
  r: 13 * ram.es, hp: 1, speed: 0, dmg: 2, refund: 2, score: 100, color: '#f0f',
  hitFlash: 0, spawnT: 0, fireCd: 99, phase: 0, dead: false, hitCd: 0 });
for (let i = 0; i < 40; i++) step(ram, FIXED, { ax: 1, ay: 0, aimX: 640, aimY: 200, fire: false, dash: false });
ok(ram.kills >= 1, 'level 3 ram rule: charging into a scrapper kills it');

// BUDGET: a shot costs 2 instead of 1 -- in the mode where you are not already
// paying for your aim. In MARKSMAN the level keeps the normal price, because the
// doubled cost stacked on faster enemies emptied the bar before anything closed
// (measured: 0 kills in 2.6 seconds, the level dying on arrival).
const bud = atLevel(6);
bud.fireMode = 'assisted';
const budHp = bud.player.hp;
for (let i = 0; i < 60; i++) step(bud, FIXED, { ax: 0, ay: 0, aimX: 0, aimY: 360, fire: true, dash: false });
const perShot = (budHp - bud.player.hp) / Math.max(1, bud.shotsFired);
ok(Math.abs(perShot - 2) < 0.01, `level 6 budget rule: shots cost 2 in AUTO-AIM (measured ${perShot.toFixed(2)})`);

const budM = atLevel(6);
budM.fireMode = 'manual';
const budMHp = budM.player.hp;
for (let i = 0; i < 60; i++) step(budM, FIXED, { ax: 0, ay: 0, aimX: 0, aimY: 360, fire: true, dash: false });
const perShotM = (budMHp - budM.player.hp) / Math.max(1, budM.shotsFired);
ok(Math.abs(perShotM - 1) < 0.01, `level 6 budget rule: MARKSMAN keeps the normal price (measured ${perShotM.toFixed(2)})`);

// ARMOUR: a brute ignores everything until the third hit cracks it
const arm = atLevel(8);
const brute = { id: 9, type: 'brute', x: 640, y: 200, vx: 0, vy: 0, r: 30 * arm.es, hp: 6,
  speed: 0, dmg: 3, refund: 4, score: 400, color: '#f2d', hitFlash: 0, spawnT: 0,
  fireCd: 99, phase: 0, dead: false, hitCd: 0 };
arm.enemies.push(brute);
arm.player.x = 640; arm.player.y = 500;
for (let i = 0; i < 30; i++) step(arm, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 200, fire: true, dash: false });
ok(!brute.cracked && brute.hp > 0, 'level 8 armour rule: early hits bounce off a brute');
for (let i = 0; i < 120 && brute.hp > 0; i++) {
  step(arm, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 200, fire: true, dash: false });
}
ok(brute.cracked, 'level 8 armour rule: enough hits crack the plating');

// OVERDRAFT WINDOW: surviving in debt clears the level with ZERO kills.
// The rule used to be dead content: the floor was -3, so one hit killed you before
// 12 seconds, and the kill quota stayed live so every clear happened the normal
// way. Now the level runs a deeper floor (-6) and has no quota at all, so the
// special win is the ONLY win — verified here with no enemies to muddy it.
const od = atLevel(7);
ok(od._lv.quota === 0, 'L7 has no kill quota: the overdraft window is the only win');
ok(sim.overdraftFloor(od) === -6, 'L7 runs a deeper overdraft floor so the window is survivable');
od.player.hp = -1; od.overdraftT = 0;
od.spawnT = 999; od.enemies.length = 0;
for (let i = 0; i < 60 * 25 && od.levelState === 'fight'; i++) {
  step(od, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 200, fire: false, dash: false });
}
ok(od.levelState === 'clear' && od.levelKills === 0,
  'level 7 overdraft rule: 12s of clock clears the level with zero kills');
// the clock must run even when you are NOT in debt, or a player who heals up is
// stuck on a level with no kill quota and no reachable win
const odSafe = atLevel(7);
odSafe.player.hp = 4; odSafe.overdraftT = 0; odSafe.spawnT = 999; odSafe.enemies.length = 0;
for (let i = 0; i < 60 * 14 && odSafe.levelState === 'fight'; i++) {
  step(odSafe, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 200, fire: false, dash: false });
}
ok(odSafe.levelState === 'clear',
  'level 7 cannot dead-end: the clock still runs while you are above zero');

console.log('\n-- events must keep their names --');

// A kill used to emit { type: 'scrapper' } because the enemy type was spread over
// the event name, so the kill sound and haptics never fired. Guard the contract.
{
  const ev = createState(3); ev.world = { w: 1280, h: 720 }; startRun(ev);
  for (let i = 0; i < 200 && ev.levelState !== 'fight'; i++) {
    step(ev, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
  }
  ev.enemies.length = 0; ev.player.x = 640; ev.player.y = 500; ev.fireMode = 'manual';
  ev.enemies.push({
    id: 1, type: 'scrapper', x: 640, y: 300, vx: 0, vy: 0, r: 13 * ev.es, hp: 1,
    speed: 0, dmg: 2, refund: 2, score: 100, color: '#f00', hitFlash: 0, spawnT: 0,
    fireCd: 99, phase: 0, dead: false, hitCd: 0,
  });
  let killEv = null;
  for (let i = 0; i < 140 && !killEv; i++) {
    step(ev, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 300, fire: true, dash: false });
    killEv = ev.events.find((e) => e.type === 'kill') || null;
  }
  ok(!!killEv, 'a kill emits an event named "kill"');
  ok(killEv && typeof killEv.refund === 'number', 'the kill event carries the refund it paid');
  ok(killEv && killEv.kind === 'scrapper', 'the kill event reports the enemy kind separately');
}

console.log('\n-- fire modes must be genuinely different --');
{
  const { FIRE_MODES } = sim;
  ok(FIRE_MODES.manual.ricochet === true && FIRE_MODES.assisted.ricochet === true,
     'ricochet exists in the two campaign modes');
  // The modes are separated by the PROFIT PER HIT, not the trigger price. MARKSMAN
  // earns +2 per hit and so funds itself with accuracy; AUTO-AIM earns +1 and so
  // can never build a buffer. Both are positive or the mode is unplayable, and
  // MARKSMAN's must be strictly larger or aiming is not worth doing.
  ok(FIRE_MODES.manual.refund > FIRE_MODES.manual.cost,
     'a MARKSMAN hit leaves you ahead, so accuracy is self-funding');
  ok(FIRE_MODES.assisted.refund > FIRE_MODES.assisted.cost,
     'an AUTO-AIM hit leaves you ahead, so it is playable at all');
  ok(FIRE_MODES.manual.refund - FIRE_MODES.manual.cost >
     FIRE_MODES.assisted.refund - FIRE_MODES.assisted.cost,
     `aiming pays better per hit (MARKSMAN +${FIRE_MODES.manual.refund - FIRE_MODES.manual.cost} vs AUTO-AIM +${FIRE_MODES.assisted.refund - FIRE_MODES.assisted.cost})`);

  // SIEGE is a MODE, not a fire-mode flag: it must never leak automatic fire
  // into the campaign. (It replaced TURRET, which was just this flag with worse
  // numbers — the reason it "felt useless".)
  ok(!FIRE_MODES.manual.autoFire && !FIRE_MODES.assisted.autoFire,
     'no campaign fire mode fires on its own');

  // MARKSMAN must NOT fire on its own
  const manual = createState(9);
  manual.world = { w: 1280, h: 720 };
  startRun(manual);
  manual.fireMode = 'manual';
  for (let i = 0; i < 60 * 20 && manual.mode !== 'dead'; i++) {
    if (manual.mode === 'pick') { manual.mode = 'play'; manual.pick = null; continue; }
    step(manual, FIXED, { ax: 0.6, ay: 0.2, aimX: manual.player.x, aimY: manual.player.y - 100, fire: false, dash: false });
  }
  ok(manual.shotsFired === 0, 'MARKSMAN never fires by itself');

  // a missed manual shot must come back as a hostile bullet
  const bounce = createState(3);
  bounce.world = { w: 1280, h: 720 };
  startRun(bounce);
  bounce.fireMode = 'manual';
  for (let i = 0; i < 200 && bounce.levelState !== 'fight'; i++) {
    step(bounce, FIXED, { ax: 0, ay: 0, aimX: 640, aimY: 0, fire: false, dash: false });
  }
  // level 1 deliberately switches ricochet off to teach the ammo rule first
  bounce.level = 2; bounce._lv = levelFor(2);
  bounce.enemies.length = 0;
  bounce.player.x = 300; bounce.player.y = 360;
  let everHostile = false;
  for (let i = 0; i < 200; i++) {
    step(bounce, FIXED, { ax: 0, ay: 0, aimX: 0, aimY: 360, fire: true, dash: false });
    if (bounce.bullets.some((b) => !b.friendly)) everHostile = true;
  }
  ok(everHostile, 'a missed MARKSMAN shot ricochets back as a hostile bullet');
}

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
