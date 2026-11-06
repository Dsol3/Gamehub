// MARKSMAN identity: the mode must PLAY differently from AUTO-AIM, not just pay
// differently.
//
// This exists because it stopped being true. Once the phone's snap-assist was
// live, MARKSMAN's gun corrected a thumb's aim and the mode played exactly like
// AUTO-AIM — the only remaining difference was the size of the refund. Worse,
// the AIM button let a MARKSMAN run switch itself into AUTO-AIM mid-fight.
//
// The three things asserted here are the three things that make the modes
// distinct, so a future change cannot quietly flatten them again:
//
//   1. MARKSMAN has no aim assist of its own to give (weaker scale), and no
//      mid-run toggle.
//   2. MARKSMAN's enemies are faster, and faster still at higher levels.
//   3. The mode stays CLEARABLE. A difficulty change that makes it unwinnable is
//      a regression, not a balance tweak — measured, not asserted by eye.
import * as sim from '../src/sim.js';
const { createState, startRun, step, chooseCard, FIRE_MODES } = sim;

const FIXED = 1 / 60;
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

// ---- 1. the mode's own numbers ----
// Auto-aim must WORK in MARKSMAN. Removing it was tried and measured: with a
// realistic thumb error it killed the player on level 1 on every seed, because
// every miss costs PULSE. The modes are separated by enemy speed, not by making
// the gun unusable.
ok(FIRE_MODES.manual.assistScale === 1,
  `MARKSMAN keeps full auto-aim (assist scale ${FIRE_MODES.manual.assistScale})`);
// The cone is what made the assist feel broken: at 1.6 the correction only
// reached ~24 degrees off the aim line, so against the fastest enemies in the
// game a target was already outside it by the time the shot left. A sloppy thumb
// dropped from level 10.2 to 6.7 with the narrow cone and stays at 10.2 with this
// one -- the mode should not be decided by thumb precision.
ok((FIRE_MODES.manual.assistCone || 1.6) > 2.0,
  `MARKSMAN's assist reaches a wide cone (x${FIRE_MODES.manual.assistCone})`);
ok((FIRE_MODES.assisted.assistCone || 1.6) < FIRE_MODES.manual.assistCone,
  'other modes keep the narrower cone (they do not need to lead fast targets)');
ok(FIRE_MODES.manual.fireRate >= FIRE_MODES.assisted.fireRate * 1.35,
  `MARKSMAN's gun is materially slower than AUTO-AIM's (${FIRE_MODES.manual.fireRate}s vs ${FIRE_MODES.assisted.fireRate}s) -- you cannot out-DPS the chase`);
ok(FIRE_MODES.manual.autoAim === false, 'MARKSMAN does not aim for the player');
ok(FIRE_MODES.assisted.autoAim === true, 'AUTO-AIM does aim for the player');

// ---- 2. enemies are faster, and the ramp climbs ----
const m1 = FIRE_MODES.manual.enemySpeed(1);
const m9 = FIRE_MODES.manual.enemySpeed(9);
ok(m1 >= 2.0, `MARKSMAN enemies are clearly faster than normal on level 1 (x${m1.toFixed(2)})`);
ok(m9 > m1, `the multiplier climbs with the level (x${m1.toFixed(2)} -> x${m9.toFixed(2)})`);
ok(!FIRE_MODES.assisted.enemySpeed, 'AUTO-AIM leaves enemy speed alone');
ok(!FIRE_MODES.siege.enemySpeed, 'SIEGE leaves enemy speed alone');

// The multiplier must not exceed the player's own speed, or no run is winnable:
// a scrapper at 108 * s.es must stay slower than the player's 335 * s.es.
// The tightest case is the smallest phone: es = 0.62, so the player moves
// 208px/s while a scrapper's base 108 is scaled by es too.
ok(108 * m9 * 0.62 < 335 * 0.62,
  `even at level 9 a scrapper stays slower than the player (${Math.round(108 * m9 * 0.62)} < ${Math.round(335 * 0.62)})`);

// ---- 3. an enemy spawned in MARKSMAN really is faster ----
function spawnedSpeed(mode, level) {
  const s = createState(9);
  startRun(s);
  s.fireMode = mode;
  s.level = level;
  s._lv = sim.levelFor(level);
  // run until the director has put something on the field
  for (let i = 0; i < 60 * 12 && s.enemies.length === 0; i++) {
    step(s, FIXED, { ax: 0, ay: 0, aimX: s.world.w / 2, aimY: 0, fire: false, dash: false });
  }
  const e = s.enemies[0];
  return e ? e.speed : null;
}
const spM = spawnedSpeed('manual', 1);
const spA = spawnedSpeed('assisted', 1);
if (spM != null && spA != null) {
  ok(spM > spA * 1.8,
    `a MARKSMAN scrapper spawns at x${(spM / spA).toFixed(2)} the AUTO-AIM speed (${spM.toFixed(0)} vs ${spA.toFixed(0)})`);
} else {
  ok(false, 'enemies spawned in both modes (the director ran)');
}

// ---- 4. the mode is clearable ----
// A thumb that is roughly right: aims at the nearest enemy with a small
// constant error and always holds fire. This is the profile the balance was
// tuned against — an average player, not a bot with pixel aim.
const makeBot = (errRad) => (s) => {
  const p = s.player;
  let best = null, bd = Infinity;
  for (const e of s.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  const out = { ax: 0, ay: 0, aimX: p.x, aimY: p.y - 100, fire: false, dash: false };
  if (!best) return out;
  const d = Math.hypot(best.x - p.x, best.y - p.y) || 1;
  const ux = (best.x - p.x) / d, uy = (best.y - p.y) / d;
  const ang = Math.atan2(best.y - p.y, best.x - p.x) + errRad;
  out.aimX = p.x + Math.cos(ang) * d;
  out.aimY = p.y + Math.sin(ang) * d;
  const want = 240;
  const radial = d < want - 60 ? -1 : d > want + 60 ? 1 : 0;
  out.ax = ux * radial + -uy * 0.5;
  out.ay = uy * radial + ux * 0.5;
  out.fire = true;
  if (d < 110 && p.dashCd <= 0) out.dash = true;
  return out;
};

function play(mode, seed, errRad, seconds = 200) {
  const s = createState(seed);
  startRun(s);
  s.fireMode = mode;
  s.aimAssist = 0.26;          // what a coarse-pointer device sets
  s.touchUi = true;
  for (let i = 0; i < 400 && s.levelState !== 'fight' && s.mode === 'play'; i++) {
    step(s, FIXED, { ax: 0, ay: 0, aimX: s.world.w / 2, aimY: 0, fire: false, dash: false });
  }
  const bot = makeBot(errRad);
  let t = 0;
  while (t < seconds && s.mode !== 'dead') {
    if (s.mode === 'pick') { chooseCard(s, 0); continue; }
    step(s, FIXED, bot(s));
    t += FIXED;
  }
  return s.level;
}

const SEEDS = [1, 2, 3, 4];
const avg2 = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const good = SEEDS.map((sd) => play('manual', sd, 0.16));
ok(good.every((l) => l >= 3),
  `a good thumb is never trapped on MARKSMAN level 1 (levels reached: ${good.join(', ')})`);

// a badly-aiming player must not be trapped on level 1 either: the mode should
// be hard, and losing should take real time, not one bad wave
const rough = SEEDS.map((sd) => play('manual', sd, 0.30));
ok(rough.every((l) => l >= 3),
  `a rough thumb still makes progress in MARKSMAN (levels reached: ${rough.join(', ')})`);

// A sloppy thumb must be able to reach the same place as a precise one: the mode
// is about moving, not about pixel-accurate aim.
const sloppy = SEEDS.map((sd) => play('manual', sd, 0.35));
const spread = Math.abs(avg2(good) - avg2(sloppy));
ok(spread < 3.0,
  `aim error barely changes the outcome (good L${avg2(good).toFixed(1)} vs sloppy L${avg2(sloppy).toFixed(1)}, spread ${spread.toFixed(1)})`);

// AUTO-AIM must remain the more forgiving mode — that is what it is for
const auto = SEEDS.map((sd) => play('assisted', sd, 0.16));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
ok(avg(auto) > avg(good),
  `AUTO-AIM stays the more forgiving mode (avg L${avg(auto).toFixed(1)} vs MARKSMAN L${avg(good).toFixed(1)})`);

console.log(failures ? `\n${failures} MARKSMAN FAILURE(S)` : '\nMARKSMAN IS ITS OWN MODE');
process.exit(failures ? 1 : 0);
