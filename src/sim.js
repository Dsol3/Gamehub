// OVERDRAFT — pure simulation. No DOM, no canvas, no audio.
// Runs identically in the browser and in Node (used by the headless balance tests).
//
// CORE RULE: your health bar IS your magazine.
//   - Every shot spends 1 PULSE.
//   - Taking a hit spends 2-3 PULSE and knocks you back.
//   - Every kill refunds PULSE (more than a kill costs you, if you don't miss).
//   - At 0 PULSE you enter OVERDRAFT: you may keep firing on credit down to -3.
//   - In overdraft a kill refunds 1.5x. You are always one bad hit from death.
// So: accuracy is survival. Missing is the only way to lose health for free.

// Default world is landscape; setWorld() reshapes it (portrait phones, etc.)
export const W = 1280;
export const H = 720;
export const MIN_W = 320;
export const MIN_H = 480;
// reference size the gameplay numbers were tuned against
export const REF_MIN = 720;
export const MAX_PULSE = 8;
export const OVERDRAFT_FLOOR = -3;
export const STEP = 1 / 60;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export const ENEMY_TYPES = {
  scrapper: { r: 13, hp: 1, speed: 108, dmg: 2, refund: 2, score: 100, color: '#ff5f6d' },
  drifter:  { r: 17, hp: 2, speed: 76,  dmg: 2, refund: 2, score: 150, color: '#ffa14a' },
  lancer:   { r: 15, hp: 2, speed: 58,  dmg: 1, refund: 2, score: 200, color: '#c46bff' },
  brute:    { r: 30, hp: 6, speed: 52,  dmg: 3, refund: 4, score: 400, color: '#ff2d55' },
  // SIEGE only: the wall that arrives when the wave escalates. Big, slow, and it
  // has to be shot a lot — the mode's answer to a player who has rockets.
  eternal:  { r: 44, hp: 20, speed: 40, dmg: 4, refund: 4, score: 900, color: '#ff2d55' },
};

// ---------------------------------------------------------------------------
// SIEGE — endless mode
//
// The campaign is a set of puzzles with a quota and a clock. SIEGE is the other
// kind of game: no levels, no clock, no augments. You hold a position with a gun
// that auto-fires and evolves, and waves get heavier until they bury you.
//
// THE CURVE IS THE POINT: the enemy tier climbs every 10 seconds, your weapon
// tier every 20. You are always getting stronger and always falling further
// behind, and the run ends exactly when that gap catches you. That is what
// "endless" means here — not that it goes on forever, but that it never relents.
// si/e the arena the level numbers were tuned against (levels are spawned against
// a 1280x720 desktop; phones are 0.36x that area). Used to keep crowd DENSITY
// constant across devices instead of crowd COUNT.
export const REF_ARENA_W = 1280;
export const REF_ARENA_H = 720;

export const ENEMY_TIER_SECONDS = 10;    // enemies upgrade every 10s
export const PLAYER_TIER_SECONDS = 20;   // you upgrade every 20s — half as fast
export const PULSE_REFILL_SECONDS = 60;  // +2 PULSE every minute survived
export const SIEGE_WAVE_BREATH = 3.2;   // seconds between waves
export const SIEGE_SQUAD_MAX = 6;       // bodies entering together at high waves
export const SIEGE_SQUAD_INTERVAL = 2.6; // seconds between squads in a wave
// enemies close in slightly faster each tier, so the ring tightens instead of
// politely waiting to be shot
export const SIEGE_CLOSE_BASE = 1.0;
export const SIEGE_CAP_BASE = 5;
export const SIEGE_CAP_MAX = 14;
// how long a freshly spawned body fades in AND is immune — one number, used by the
// sim and the renderer, so "it is still appearing" always means "it cannot be hit"
export const SPAWN_FADE = 0.28;
export const SIEGE_SPAWN_BASE = 1.5;
export const SIEGE_SPAWN_MIN = 0.34;

// The campaign modes are not a difficulty slider. They change what the game asks
// of you, and each one costs something the other does not:
//
//   MARKSMAN  - YOU aim. 1 PULSE per shot, 3 back per kill. The gun points where
//     your mouse/thumb points, so a shot that hits nothing ricochets off the wall
//     and comes back at you. Cheap trigger, unforgiving aim: accuracy IS your
//     ammo supply.
//
//   AUTO-AIM  - the gun aims. 2 PULSE per shot, 3 back per kill. You never miss,
//     but you fire half as often for the same budget, so the economy is the
//     difficulty. Measured against MARKSMAN at four aim qualities: it LOSES at
//     perfect aim, wins at good aim, and is the only survivable pick with a
//     sloppy thumb — which is what makes it a real choice and not an easy mode.
//
//   SIEGE     - not a fire mode at all: its own endless step (stepSiege).
//
export const FIRE_MODES = {
  manual: {
    id: 'manual', name: 'MARKSMAN', blurb: 'You aim. Misses ricochet back at you.',
    // accurate play is genuinely harder here, so a hit pays more
    cost: 1, refund: 3, ricochet: true, fireRate: 0.16, autoAim: false, autoFire: false, assist: true,
  },
  assisted: {
    // The trade that makes this a MODE and not an easier difficulty: the gun
    // finds the target for you, and a kill only REPAYS the shot instead of paying
    // a profit. MARKSMAN is self-funding when you are accurate and bankrupts you
    // when you are not; AUTO-AIM never leaves you rich, so its ceiling is lower and
    // its floor is much higher. Measured across 9 levels x 3 seeds x 2 devices:
    // with perfect aim MARKSMAN clears far more, with sloppy aim AUTO-AIM is the
    // only one that clears anything.
    id: 'assisted', name: 'AUTO-AIM', blurb: 'Gun aims itself. A kill only repays the shot.',
    cost: 1, refund: 2, ricochet: true, fireRate: 0.20, autoAim: true, autoFire: false, assist: false,
  },

  // SIEGE (the third chip) is NOT a fire mode — it is a separate endless mode.
  // It reuses this shape so the shared aim code has something to read, but its
  // trigger, its economy and its spawn director all live in stepSiege().
  siege: {
    id: 'siege', name: 'SIEGE', blurb: 'Endless. Auto-fires. Evolves until it buries you.',
    cost: 1, refund: 1, ricochet: false, fireRate: 0.24, autoAim: true, autoFire: true, assist: false,
  },
};

// SIEGE weapon ladder. Bullets are cheap and pay for themselves; rockets are
// free but slow, so evolution never taxes the PULSE economy (see stepSiege).
export const SIEGE_WEAPONS = [
  { name: 'SINGLE',       shots: 1, rocket: false, rate: 0.26, spread: 0.02 },
  { name: 'DOUBLE',       shots: 2, rocket: false, rate: 0.25, spread: 0.07 },
  { name: 'TRIPLE',       shots: 3, rocket: false, rate: 0.24, spread: 0.11 },
  { name: 'ROCKET',       shots: 1, rocket: true,  rate: 0.52, spread: 0.02 },
  { name: 'TWIN ROCKET',  shots: 2, rocket: true,  rate: 0.50, spread: 0.09 },
  { name: 'PIERCE ROCKET',shots: 2, rocket: true,  rate: 0.46, spread: 0.09, pierce: 2 },
  { name: 'ROCKET STORM', shots: 4, rocket: true,  rate: 0.42, spread: 0.15 },
];
export const SIEGE_WEAPON_MAX = SIEGE_WEAPONS.length;

// ---------------------------------------------------------------------------
// LEVELS
//
// A level is a fixed-length fight with a clear win condition: kill the quota
// before the clock runs out. Clear it and you pick an augment and get a breather.
// Fail and you keep the PULSE you have and try the same level again — you are
// never sent backwards, so the run never stalls.
//
// Each level introduces one idea, then the next one builds on it. The player is
// supposed to finish a level and be able to say in one sentence what it was
// about, which is why every entry has a `teach` line surfaced on the card.
//
//   time      seconds on the clock
//   quota     kills required to clear
//   kinds     enemy types that may spawn
//   spawn     seconds between spawn attempts (lower = more pressure)
//   cap       max enemies alive at once
//   waveSpeed multiplier on enemy movement speed
//   rule      optional special rule, see LEVEL_RULES
// ---------------------------------------------------------------------------
export const LEVELS = [
  {
    n: 1, name: 'OPENING BELL', teach: 'Shoot the scrappers. Every shot costs PULSE.',
    time: 30, quota: 5, kinds: ['scrapper'], spawn: 1.5, cap: 3, waveSpeed: 1,
    noRicochet: true,
  },
  {
    n: 2, name: 'RETURN TO SENDER', teach: 'Misses bounce back. Aim, or pay twice.',
    time: 30, quota: 7, kinds: ['scrapper'], spawn: 1.35, cap: 3, waveSpeed: 1,
    rule: 'ricochet',
  },
  {
    n: 3, name: 'TOO CLOSE', teach: 'You touched it. It died. Shooting costs PULSE.',
    time: 30, quota: 8, kinds: ['scrapper'], spawn: 1.2, cap: 4, waveSpeed: 1,
    rule: 'ram',
  },
  {
    n: 4, name: 'DRIFTERS', teach: 'They soak two shots. Line them up.',
    time: 32, quota: 9, kinds: ['scrapper', 'drifter'], spawn: 1.3, cap: 4, waveSpeed: 1,
  },
  {
    n: 5, name: 'GUNNERS', teach: 'The purple ones shoot back. Dash through it.',
    time: 32, quota: 10, kinds: ['scrapper', 'drifter', 'lancer'], spawn: 1.2, cap: 4, waveSpeed: 1,
  },
  {
    n: 6, name: 'TIGHT BUDGET', teach: 'Every shot costs 2. Make them count.',
    time: 36, quota: 8, kinds: ['scrapper', 'drifter'], spawn: 1.35, cap: 3, waveSpeed: 0.95,
    rule: 'budget',
  },
  {
    // DEBT COLLECTOR: the one level won by being BROKE, not by killing.
    // The first version was unwinnable through its own rule: the overdraft floor
    // is -3, so one hit killed you before 12 seconds passed, and the normal kill
    // quota stayed live so every clear happened the ordinary way instead. Now the
    // quota is switched off (quota 0) and the floor is raised on this level only.
    n: 7, name: 'DEBT COLLECTOR', teach: 'You start in debt. Survive 12s in OVERDRAFT.',
    time: 40, quota: 0, kinds: ['scrapper', 'drifter'], spawn: 1.15, cap: 4, waveSpeed: 1.12,
    rule: 'overdraftWindow', floor: -6,
  },
  {
    n: 8, name: 'THE WALL', teach: 'Armoured. Only weak spots finish it.',
    time: 40, quota: 10, kinds: ['scrapper', 'drifter', 'lancer', 'brute'], spawn: 1.05, cap: 5, waveSpeed: 1.15,
    rule: 'armour',
  },
  {
    n: 9, name: 'CHECKOUT', teach: 'Everything at once. Nothing held back.',
    time: 48, quota: 8, kinds: ['scrapper', 'drifter', 'lancer', 'brute'], spawn: 1.1, cap: 4, waveSpeed: 1.12,
  },
];

// Levels past the table reuse the last entry with a difficulty multiplier, so the
// run never ends on its own — you die, or you keep going.
export function levelFor(n) {
  const base = LEVELS[Math.min(n, LEVELS.length) - 1];
  if (n <= LEVELS.length) return { ...base, index: n, scaled: false };
  const over = n - LEVELS.length;
  return {
    ...base,
    index: n,
    scaled: true,
    name: base.name + ' +' + over,
    time: Math.min(70, base.time + over * 3),
    quota: base.quota + Math.round(over * 2.5),
    spawn: Math.max(0.45, base.spawn - over * 0.05),
    cap: Math.min(11, base.cap + over),
    waveSpeed: Math.min(1.6, base.waveSpeed + over * 0.05),
  };
}

export const CARDS = [
  { id: 'surplus',  name: 'SURPLUS',      desc: '+3 max PULSE, topped up now.',        apply: (s) => { s.player.maxHp += 3; s.player.hp = s.player.maxHp; } },
  { id: 'vampire',  name: 'VAMPIRE',      desc: 'Kills refund +1 PULSE.',              apply: (s) => { s.mods.refundBonus += 1; } },
  { id: 'quick',    name: 'QUICK HANDS',  desc: 'Fire rate +35%.',                     apply: (s) => { s.mods.fireRate *= 1.35; } },
  { id: 'pierce',   name: 'RICOCHET',     desc: 'Shots pass through 1 extra enemy.',   apply: (s) => { s.mods.pierce += 1; } },
  { id: 'ghost',    name: 'GHOST STEP',   desc: 'Dash cooldown -40%, longer i-frames.', apply: (s) => { s.mods.dashCd *= 0.6; s.mods.iFrames += 0.15; } },
  { id: 'thrift',   name: 'THRIFT',       desc: 'Every 4th shot is free.',             apply: (s) => { s.mods.freeEvery = 4; } },
];

export function createState(seed = 1) {
  const rng = mulberry32(seed);
  return {
    rng,
    time: 0,
    mode: 'title', // title | play | pick | dead
    world: { w: W, h: H },
    es: 1,            // entity scale: keeps the game readable on small screens
    aimAssist: 0,     // radians of snap-assist (touch only)
    fireMode: 'assisted', // 'assisted' (auto-aim) | 'manual' (marksman) | 'auto' (turret)
    autoTarget: null, // id of the enemy the turret is tracking
    player: {
      x: W / 2, y: H / 2, vx: 0, vy: 0, r: 15,
      aim: -Math.PI / 2,
      hp: MAX_PULSE, maxHp: MAX_PULSE,
      fireCd: 0, dashCd: 0, dashT: 0, invuln: 0,
      lastShot: -99, lastHurt: -99,
      alive: true, hitFlash: 0, shotCount: 0,
    },
    mods: { fireRate: 1, pierce: 0, refundBonus: 0, dashCd: 1.15, iFrames: 0.28, freeEvery: 0 },
    bullets: [],
    enemies: [],
    particles: [],
    floaters: [],
    wallMarks: [],
    events: [],
    // level state
    level: 1,          // current level number (1-based)
    levelKills: 0,     // kills banked toward this level's quota
    levelT: 0,         // seconds elapsed inside the level
    levelState: 'fight', // fight | clear | fail | teach
    teachT: 0,         // time left on the level card
    failT: 0,          // time left on the fail card
    clearT: 0,
    banked: 0,         // PULSE carried into the next level
    overdraftT: 0,     // seconds spent below zero (level 7 win condition)
    levelsCleared: 0,
    retries: 0,
    best: null,
    // ---- SIEGE state (all zero/1 in campaign, so shared code is safe) ----
    siege: false,          // true => this run is endless
    siegeT: 0,             // seconds survived
    wave2: 0,              // SIEGE wave number (distinct from campaign `wave`)
    waveLeft: 0,           // enemies still to spawn this wave
    squadLeft: 0,          // enemies left across all squads of this wave
    squadSize: 3,          // bodies per squad entry
    openAngle: null,       // the gap in the ring, re-rolled each wave
    waveBreath: 0,         // seconds until the next wave
    playerTier: 1,         // weapon tier, +1 every 20s
    weapon: null,          // SIEGE weapon record (SIEGE_WEAPONS[i])
    siegeKills: 0,         // kills THIS run (s.kills is shared with the campaign)
    siegeClear: 0,         // waves fully cleared THIS run
    enemyTier: 1,          // enemy tier, +1 every 10s
    refills: 0,            // pulses granted by the 60s clock
    killsAtRefill: 0,
    // kept for the HUD/test contract: wave mirrors the level number
    wave: 1,
    waveT: 0,
    waveLen: 30,
    spawnT: 1.2,
    kills: 0,
    streak: 0,
    streakT: 0,
    bestStreak: 0,
    score: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageTaken: 0,
    shake: 0,
    hitstop: 0,
    slowmo: 0,
    flashRed: 0,
    pick: null,
    cardsTaken: [],
    nextId: 1,
    deadT: 0,
    lastKill: -99,
  };
}

// `data` must never contain a `type` key: spreading it after `type` silently
// renames the event and every handler that switches on it stops matching.
export function emit(s, type, data = {}) {
  if (data && 'type' in data) throw new Error(`emit('${type}') data must not contain 'type'`);
  s.events.push({ type, ...data });
}

// Reshape the arena. Keeps entities inside the new bounds and pulls the player
// toward the middle so a rotation never traps them in a wall.
export function setWorld(s, w, h) {
  s.world.w = clamp(Math.round(w), MIN_W, 4000);
  s.world.h = clamp(Math.round(h), MIN_H, 4000);
  // One scale for everything that moves, so a 390px phone plays like the 1280px build.
  s.es = clamp(Math.min(s.world.w, s.world.h) / REF_MIN, 0.62, 1.25);
  s.player.r = 15 * s.es;
  const p = s.player;
  p.x = clamp(p.x, 24, s.world.w - 24);
  p.y = clamp(p.y, 24, s.world.h - 24);
  for (const e of s.enemies) {
    e.x = clamp(e.x, -40, s.world.w + 40);
    e.y = clamp(e.y, -40, s.world.h + 40);
  }
}

export function startRun(s) {
  const world = { w: s.world.w, h: s.world.h };
  const fresh = createState(Math.floor(s.rng() * 1e9));
  Object.assign(s, fresh, { mode: 'play', world });
  // start the player in the middle of *this* screen
  setWorld(s, world.w, world.h);
  s.player.x = world.w / 2;
  s.player.y = world.h / 2;
  // open on the level card so the player always knows what this level wants
  s.level = 1;
  s.wave = 1;
  s._lv = levelFor(1);
  s.levelState = 'teach';
  s.teachT = 1.7;
  emit(s, 'start');
  return s;
}

// ---------------------------------------------------------------------------
// SIEGE start
// ---------------------------------------------------------------------------
// A clean slate, then the endless run. Everything the campaign relies on (level
// cards, quota, clock, augments) is explicitly switched OFF here so a stray
// shared code path cannot leak campaign rules into an endless run.
export function startSiege(s) {
  const world = { w: s.world.w, h: s.world.h };
  const fresh = createState(Math.floor(s.rng() * 1e9));
  Object.assign(s, fresh, { mode: 'play', world });
  setWorld(s, world.w, world.h);
  s.player.x = world.w / 2;
  s.player.y = world.h / 2;
  s.siege = true;
  s.fireMode = 'siege';
  s.level = 1;
  s.wave = 1;
  s._lv = siegeRules(1);
  s.levelState = 'fight';     // no teach card, no level card: you land in it
  s.teachT = 0;
  s.siegeT = 0;
  s.wave2 = 0;
  s.waveLeft = 0;
  s.waveBreath = 0.8;         // a breath of empty arena before wave 1 lands
  s.playerTier = 1;
  s.weapon = SIEGE_WEAPONS[0];
  s.enemyTier = 1;
  s.refills = 0;
  s.siegeKills = 0;
  s.siegeClear = 0;
  s.killsAtRefill = 0;
  // SIEGE has no refund-per-kill economy the way the campaign does, but it still
  // needs a heartbeat: without this the player starts at max PULSE and the first
  // shot is free of consequence.
  s.player.hp = 4;
  s.player.maxHp = MAX_PULSE;
  s.banked = 0;
  emit(s, 'start');
  return s;
}

// A synthetic level record so the shared HUD/aim/aim-assist code has the shape
// it expects. SIEGE ignores quota and time entirely.
function siegeRules(wave) {
  return {
    index: wave, name: 'SIEGE', quota: 0, time: 1e9,
    kinds: siegeKindsFor(wave), spawn: SIEGE_SPAWN_BASE, cap: SIEGE_CAP_BASE,
    waveSpeed: 1, rule: null, scaled: true,
  };
}

// Which enemy kinds a wave can spawn. The heavy (brute) shows up at wave 3 and
// the ETERNAL at wave 6, so escalation is visible, not just numeric.
function siegeKindsFor(wave) {
  if (wave >= 6) return ['scrapper', 'drifter', 'lancer', 'brute', 'eternal'];
  if (wave >= 3) return ['scrapper', 'drifter', 'lancer', 'brute'];
  if (wave >= 2) return ['scrapper', 'drifter', 'lancer'];
  return ['scrapper'];
}

// Called when the player takes an augment between levels: the next fight begins,
// and the health banked from the clear is paid back as a small top-up.
export function beginNextLevel(s) {
  // DEBT COLLECTOR starts you in debt: the level is about being broke, so the run
  // should not open with a full bar and require you to bankrupt yourself first.
  if (s._lv && s._lv.rule === 'overdraftWindow') s.player.hp = Math.min(s.player.hp, -1);
  s.levelState = 'fight';
  s.enemies.length = 0;
  s.spawnT = 0.5;
  s.levelT = 0;
  s.levelKills = 0;
  s.overdraftT = 0;
  // clearing a level heals 1; keeping the augment pick means you choose your power
  s.player.hp = Math.min(s.player.maxHp, s.player.hp + 1);
  s._lv = levelFor(s.level);
  s.teachT = 1.5;
  emit(s, 'levelStart', { level: s.level, name: s._lv.name });
}

// Restart the current level after a timeout. No progress is lost, no health is
// taken: the only cost of failing is the thirty seconds you spent.
export function retryLevel(s) {
  if (s._lv && s._lv.rule === 'overdraftWindow') s.player.hp = Math.min(s.player.hp, -1);
  s.levelState = 'fight';
  s.enemies.length = 0;
  s.levelT = 0;
  s.levelKills = 0;
  s.overdraftT = 0;
  s.spawnT = 0.5;
  s.retries += 1;
  s._lv = levelFor(s.level);
  emit(s, 'levelStart', { level: s.level, name: s._lv.name });
}

// Bullet integration + collision, shared by the campaign and SIEGE. Extracted so
// an endless run cannot drift from the campaign's rules (ricochet, armour, pierce).
function updateBullets(s, dt) {
  const es = s.es;
  const p = s.player;
  for (let i = s.bullets.length - 1; i >= 0; i--) {
    const b = s.bullets[i];
    b.life -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.trail) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 4) b.trail.shift(); }
    // WALL BOUNCE: a shot that hits nothing ricochets and comes back at YOU.
    // This is the whole concept made physical — a miss does not just cost a pulse,
    // it returns as a threat you have to dodge. Your own accuracy is your ammo.
    const bw = s.world.w, bh = s.world.h, wallPad = 8;
    let bouncedX = false, bouncedY = false;
    // ricochet is a mechanic, not a constant: level 1 switches it off so a new
    // player learns the ammo rule before the punishment rule.
    const ricochetOn = (FIRE_MODES[s.fireMode] || FIRE_MODES.manual).ricochet
      && !(s._lv && s._lv.noRicochet);
    if (ricochetOn && b.friendly && b.bounces > 0) {
      if (b.x < wallPad) { b.x = wallPad; b.vx = Math.abs(b.vx); bouncedX = true; }
      else if (b.x > bw - wallPad) { b.x = bw - wallPad; b.vx = -Math.abs(b.vx); bouncedX = true; }
      if (b.y < wallPad) { b.y = wallPad; b.vy = Math.abs(b.vy); bouncedY = true; }
      else if (b.y > bh - wallPad) { b.y = bh - wallPad; b.vy = -Math.abs(b.vy); bouncedY = true; }
      if (bouncedX || bouncedY) {
        b.bounces--;
        b.friendly = false;          // now it can hurt you
        b.life = 1.15;               // time to react, not a lingering sniper
        b.dmg = 1;                   // a stray shot should not decide a level
        b.vx *= 0.86; b.vy *= 0.86;   // loses energy off the wall
        emit(s, 'bounce');
        for (let k = 0; k < 9; k++) spawnParticle(s, b.x, b.y, k % 2 ? '#ff3b5c' : '#ffd166', 260 * es);
        if (!s.wallMarks) s.wallMarks = [];
        if (s.wallMarks.length < 24) s.wallMarks.push({ x: b.x, y: b.y, life: 2.5 });
      }
    }
    if (b.life <= 0 || b.x < -20 || b.x > bw + 20 || b.y < -20 || b.y > bh + 20) { s.bullets.splice(i, 1); continue; }

    if (b.friendly) {
      for (const e of s.enemies) {
        if (e.dead || b.hitIds.includes(e.id)) continue;
        // touch players get a wider hit radius: a thumb cannot be pixel-accurate,
        // and a near-miss that visually connects should count as a hit
        const grace = s.aimAssist > 0 ? 7 * es : 0;  // (touch only)
        const hitR = b.r + e.r + grace;
        if (dist2(b.x, b.y, e.x, e.y) < hitR * hitR) {
          // RULE 'armour': a brute shrugs off everything until it has been hit 3
          // times, then its plating cracks and normal damage applies. The skill is
          // burst damage, not steady chip.
          const armoured = (s._lv && s._lv.rule === 'armour') && e.type === 'brute' && !e.cracked;
          if (armoured) {
            e.armourHits = (e.armourHits || 0) + 1;
            if (e.armourHits >= 3) { e.cracked = true; e.hp -= b.dmg; emit(s, 'crack'); }
            else { e.hitFlash = 1; emit(s, 'clang'); }
          } else {
            e.hp -= b.dmg;
            e.hitFlash = 1;
          }
          s.shotsHit++;
          b.hitIds.push(e.id);
          for (let k = 0; k < 6; k++) spawnParticle(s, b.x, b.y, e.color, 200);
          if (b.splash) explode(s, b.x, b.y, b.splash, b.dmg, e.id);
          if (e.hp <= 0) killEnemy(s, e);
          else { emit(s, 'hit'); s.shake = Math.min(8, s.shake + 1); }
          if (b.hitIds.length > b.pierce) { s.bullets.splice(i, 1); }
          break;
        }
      }
    } else {
      if (p.invuln <= 0 && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) * (b.r + p.r)) {
        s.bullets.splice(i, 1);
        damagePlayer(s, 1);
      }
    }
  }

}

// The SIEGE gun: aims and fires on its own, and shapes every shot from the
// current weapon tier. Bullets cost PULSE and hits pay it back; rockets are free
// but slow. Evolution therefore never taxes the ammo economy it is racing.
function siegeFire(s, dt) {
  const p = s.player;
  const es = s.es;
  const w = s.weapon || SIEGE_WEAPONS[0];
  p.fireCd -= dt;
  if (p.fireCd > 0) return;

  // nearest live target
  let tgt = null, bestD = Infinity;
  for (const e of s.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < bestD) { bestD = d2; tgt = e; }
  }
  if (!tgt) { s.autoTarget = null; return; }
  s.autoTarget = tgt.id;
  p.aim = Math.atan2(tgt.y + tgt.vy * 0.06 - p.y, tgt.x + tgt.vx * 0.06 - p.x);

  // SIEGE SHOTS ARE FREE — and this is a design decision, not an oversight.
  // Health-as-ammo only works when the player chooses when to pull the trigger.
  // SIEGE fires itself, so charging per shot made the mode a fixed countdown to
  // bankruptcy that no amount of skill could affect (measured: every run died at
  // ~30s with 0 PULSE decisions available). Here PULSE is purely HEALTH, and the
  // only things that spend it are getting hit and the enemies you fail to kill.
  // The ammo economy stays where it belongs: the two campaign modes.
  p.shotCount++;
  s.shotsFired++;
  p.fireCd = w.rate / s.mods.fireRate;
  p.lastShot = s.time;

  const n = w.shots;
  const spd = w.rocket ? 620 * es : 1080 * es;
  for (let i = 0; i < n; i++) {
    // fan the shots symmetrically around the aim line
    const off = n === 1 ? 0 : (i - (n - 1) / 2) * w.spread;
    const a = p.aim + off + (s.rng() - 0.5) * 0.02;
    s.bullets.push({
      x: p.x + Math.cos(a) * 20 * es, y: p.y + Math.sin(a) * 20 * es,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      r: (w.rocket ? 8 : 5) * es,
      life: w.rocket ? 1.5 : 0.85,
      friendly: true,
      dmg: w.rocket ? 3 : 1,
      pierce: w.pierce != null ? w.pierce : s.mods.pierce,
      hitIds: [], trail: [], over: false, bounces: 0,
      rocket: !!w.rocket,
      splash: w.rocket ? 78 : 0,
    });
  }
  p.vx -= Math.cos(p.aim) * 20 * es; p.vy -= Math.sin(p.aim) * 20 * es;
  s.shake = Math.min(10, s.shake + (w.rocket ? 3.4 : 1.2));
  emit(s, w.rocket ? 'rocket' : 'shoot', { over: false });
  for (let k = 0; k < 3; k++) {
    spawnParticle(s, p.x + Math.cos(p.aim) * 18 * es, p.y + Math.sin(p.aim) * 18 * es,
      w.rocket ? '#ffd166' : '#bffcff', 240 * es, p.aim);
  }
}

// ---------------------------------------------------------------------------
// SIEGE step — the endless run
// ---------------------------------------------------------------------------
// Reuses the campaign's movement, bullet and enemy code so the feel is identical,
// and owns only the things that make it endless: the wave director, the weapon
// ladder, and the two clocks racing each other.
export function stepSiege(s, dt, input) {
  s.events.length = 0;
  // stepMovement() reads s.input — without this the player could not move at all
  // in SIEGE, which also made every dodging strategy measure as "no strategy".
  s.input = input || s.input || {};
  s.time += dt;
  s.siegeT += dt;
  const p = s.player;
  const es = s.es;

  if (s.hitstop > 0) { s.hitstop -= dt; s.shake = Math.max(0, s.shake - dt * 40); return s; }

  // ---- the two clocks ------------------------------------------------------
  // ENEMY_TIER_SECONDS (10) is half of PLAYER_TIER_SECONDS (20): the enemies
  // upgrade exactly twice as fast. This is the whole design of the mode.
  // the clock constants live in layout.js so the HUD, the sim and the tests all
  // read the same numbers; if they ever drift, the "2x faster" claim is a lie.
  s.enemyTier = 1 + Math.floor(s.siegeT / ENEMY_TIER_SECONDS);
  const newTier = Math.min(SIEGE_WEAPON_MAX, 1 + Math.floor(s.siegeT / PLAYER_TIER_SECONDS));
  if (newTier !== s.playerTier) {
    s.playerTier = newTier;
    s.weapon = SIEGE_WEAPONS[Math.min(newTier, SIEGE_WEAPON_MAX) - 1];
    emit(s, 'evolve', { tier: newTier, name: s.weapon.name });
    s.floaters.push({
      x: p.x, y: p.y - 40 * es, text: s.weapon.name, color: '#6ff5ff',
      life: 1.4, size: 20 * es,
    });
    s.shake = Math.min(16, s.shake + 5);
  }

  // ---- the 60s health refill ----------------------------------------------
  // A pure survival clock: no aiming, no quota, just time. It is scheduled, not
  // random, so the HUD can count down to it and the player can play around it.
  if (s.siegeT >= (s.refills + 1) * PULSE_REFILL_SECONDS) {
    s.refills += 1;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + 3);
    s.floaters.push({
      x: p.x, y: p.y - 52 * es, text: '+' + (p.hp - before) + ' REFILL',
      color: '#7dffb2', life: 1.5, size: 19 * es,
    });
    emit(s, 'refill', { n: s.refills });
  }

  // ---- wave director -------------------------------------------------------
  if (s.waveBreath > 0) {
    s.waveBreath -= dt;
    if (s.waveBreath <= 0) beginWave(s);
  } else {
    // SQUADS, not a drip. The campaign feeds you one body at a time, which is why
    // standing still works there. SIEGE throws a GROUP: a whole squad enters on
    // the same beat from the same side, takes an approach slot, and closes the
    // ring. Standing still is death; you have to break out through the gap.
    if (s.squadLeft > 0 && s.spawnT <= 0) {
      const n = Math.min(s.squadLeft, s.squadSize);
      for (let i = 0; i < n; i++) spawnSiegeEnemy(s, i, n);
      s.squadLeft -= n;
      s.spawnT = SIEGE_SQUAD_INTERVAL * (0.85 + s.rng() * 0.3);
    }
    // a wave is over only when everything it spawned is dead
    if (s.squadLeft <= 0 && s.enemies.length === 0) {
      endWave(s);
    }
  }
  s.spawnT -= dt;
  updateBullets(s, dt);

  // ---- movement (shared with the campaign via the same equations) ----------
  stepMovement(s, dt);
  // ---- the gun: aims and fires itself, no trigger, no PULSE gate -----------
  siegeFire(s, dt);
  // ---- enemies -------------------------------------------------------------
  stepEnemies(s, dt);

  // ---- cosmetics, streak decay --------------------------------------------
  stepCosmetics(s, dt);

  // ---- death ---------------------------------------------------------------
  if (p.hp <= OVERDRAFT_FLOOR) {
    p.alive = false;
    s.mode = 'dead';
    s.deadT = 0;
    s.shake = 22;
    emit(s, 'death');
    for (let k = 0; k < 46; k++) spawnParticle(s, p.x, p.y, k % 3 ? '#ff3b5c' : '#bffcff', 460);
  }
  return s;
}

function beginWave(s) {
  s.wave2 += 1;
  s.wave = s.wave2;
  // squad size grows with the wave, so the ring gets thicker as you tier up
  s.squadSize = Math.min(SIEGE_SQUAD_MAX, 3 + Math.floor(s.wave2 / 2));
  s.squadLeft = 4 + Math.round(s.wave2 * 1.6);
  s.waveLeft = s.squadLeft;         // HUD keeps showing "N LEFT"
  s.squadSlot = 0;
  s.spawnT = 0;
  s._lv = siegeRules(s.wave2);
  s.level = s.wave2;
  emit(s, 'waveStart', { wave: s.wave2 });
  s.floaters.push({
    x: s.world.w / 2, y: s.world.h * 0.3, text: 'WAVE ' + s.wave2,
    color: '#eafcff', life: 1.3, size: 26 * s.es,
  });
}

function endWave(s) {
  // Between waves: a short breather, and clearing a wave pays out in PULSE so a
  // good wave genuinely funds the next one.
  s.siegeClear += 1;
  s.openAngle = s.rng() * 6.283;      // a different gap every wave
  s.waveBreath = SIEGE_WAVE_BREATH;
  s.player.hp = Math.min(s.player.maxHp, s.player.hp + 1);
  s.score += 200 * s.wave2;
  emit(s, 'waveClear', { wave: s.wave2 });
}

// SIEGE enemies are the campaign's enemies with the tier multiplier applied.
// Every 10 seconds of survival makes them tougher, so the ceiling keeps moving.
//
// PLACEMENT IS THE MODE. Each squad member claims an approach slot on a ring
// around the player, so a squad lands fanned out and closes the circle. One
// wedge of the ring is always left empty: a ring with no exit is a coin flip,
// not a skill test, and the whole mode is built on you seeing the gap and
// dashing through it.
function spawnSiegeEnemy(s, indexInSquad, squadTotal) {
  const t = s.enemyTier;
  const wave = s.wave2;
  const L = s._lv || siegeRules(wave);
  s._siegeCap = Math.min(SIEGE_CAP_MAX, SIEGE_CAP_BASE + Math.floor(wave / 2));
  const e = spawnEnemy(s, L, {
    hpBonus: Math.floor((t - 1) * 0.9),
    speedMul: Math.min(1.7, 1 + (t - 1) * 0.035),
    scoreMul: 1 + (t - 1) * 0.15,
    cap: s._siegeCap,
  });
  if (!e) return null;

  // the squad storms in from one direction, spread into neighbouring slots
  const p = s.player;
  const radius = Math.max(s.world.w, s.world.h) * 0.62 + 40;
  const wrap = s.world.w + s.world.h;
  const sweep = 6.283;
  const gapArc = s.squadSize >= 6 ? 0.55 : 0.8;         // radians of guaranteed exit
  const openAngle = s.openAngle != null ? s.openAngle : (s.openAngle = s.rng() * sweep);
  const usable = sweep - gapArc;
  const slot = (indexInSquad + (squadTotal > 1 ? 0 : 0)) / Math.max(1, squadTotal);
  // start the squad just past the gap so it forms an arc, not a full circle
  const a = openAngle + gapArc / 2 + usable * (0.15 + 0.7 * slot) + (s.rng() - 0.5) * 0.12;
  e.x = clamp(p.x + Math.cos(a) * radius, -60, s.world.w + 60);
  e.y = clamp(p.y + Math.sin(a) * radius, -60, s.world.h + 60);
  e.siegeAngle = a;
  e.slot = (indexInSquad % 6) / 6;                       // keeps them fanned while advancing
  // the renderer fades a body in over its whole spawnT, and while spawnT > 0 the
  // body cannot be hit. Keep the two in lockstep so nothing is ever 90% drawn and
  // 100% immune — that reads to the player as a shot that simply did not register.
  e.spawnT = SPAWN_FADE;
  return e;
}

// Shared movement: identical in the campaign and SIEGE, so the endless mode
// does not accidentally feel different to steer.
function stepMovement(s, dt) {
  const p = s.player;
  const es = s.es;
  const input = s.input || {};
  const ax = input.ax || 0, ay = input.ay || 0;
  const mag = Math.hypot(ax, ay) || 1;
  const nx = ax / mag, ny = ay / mag;
  const speed = 335 * es;
  const accel = 14;
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.invuln = Math.max(p.invuln, 0.05);
    // aim latches through the dash: your thumb is on B, not on the aim
    if (p.latchAim != null) p.aim = p.latchAim;
  } else {
    p.vx += (nx * speed * (ax || ay ? 1 : 0) - p.vx) * Math.min(1, accel * dt);
    p.vy += (ny * speed * (ax || ay ? 1 : 0) - p.vy) * Math.min(1, accel * dt);
  }
  if (p.dashT <= 0) p.latchAim = null;
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt * 4);

  if (input.dash && p.dashCd <= 0) {
    p.latchAim = p.aim;
    const dx = ax || ay ? nx : Math.cos(p.aim);
    const dy = ax || ay ? ny : Math.sin(p.aim);
    p.vx = dx * 1100 * es; p.vy = dy * 1100 * es;
    p.dashT = 0.15;
    p.dashCd = s.mods.dashCd;
    p.invuln = s.mods.iFrames;
    emit(s, 'dash');
    for (let i = 0; i < 10; i++) spawnParticle(s, p.x, p.y, '#6ff5ff', 120);
  }

  p.x += p.vx * dt; p.y += p.vy * dt;
  const m = 24;
  const ww = s.world.w, wh = s.world.h;
  if (p.x < m) { p.x = m; p.vx *= -0.4; }
  if (p.x > ww - m) { p.x = ww - m; p.vx *= -0.4; }
  if (p.y < m) { p.y = m; p.vy *= -0.4; }
  if (p.y > wh - m) { p.y = wh - m; p.vy *= -0.4; }

  // aim: a thumb cannot reach under the control pads, so clamp the REQUESTED
  // point (not the resolved shot angle) into the reachable area. Only when the
  // on-screen pads are actually there — on desktop this would corrupt aim.
  if (p.dashT > 0 && p.latchAim != null) {
    // dashing with a thumb on B: keep the line you had when you pressed it
    p.aim = p.latchAim;
  } else if (input.aimX != null) {
    let tx = input.aimX, ty = input.aimY;
    const limitY = s.world.h - 170 * es;
    if (s.touchUi && ty > limitY) ty = limitY;
    const dx0 = tx - p.x, dy0 = ty - p.y;
    if (Math.abs(dx0) + Math.abs(dy0) > 8) p.aim = Math.atan2(dy0, dx0);
  }

  // ---- NO PASSIVE REGEN ----
  // PULSE only comes back from kills. Standing still and dodging cannot heal you,
  // so running away is never a strategy: if you stop shooting, you only bleed.
}

// Shared enemy AI: the same four behaviours drive both modes. SIEGE gets its
// escalation from how many arrive and how tough they are, not from new AI.
function stepEnemies(s, dt) {
  const p = s.player;
  const es = s.es;
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    if (e.dead) { s.enemies.splice(i, 1); continue; }
    e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
    e.spawnT = Math.max(0, (e.spawnT || 0) - dt);
    e.hitCd = Math.max(0, (e.hitCd || 0) - dt);
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;

    const want = 300 * es;
    if (e.type === 'lancer') {
      const push = d > want + 40 ? 1 : d < want - 40 ? -1 : 0;
      e.vx = (ux * e.speed * push + -uy * e.speed * 0.55) * es;
      e.vy = (uy * e.speed * push + ux * e.speed * 0.55) * es;
      e.fireCd -= dt;
      if (e.fireCd <= 0 && d < 620 * es) {
        e.fireCd = 1.9;
        const a = Math.atan2(dy, dx);
        s.bullets.push({
          x: e.x, y: e.y, vx: Math.cos(a) * 300 * es, vy: Math.sin(a) * 300 * es,
          r: 8 * es, life: 3.4, friendly: false, dmg: 1,
        });
        emit(s, 'enemyShoot');
      }
    } else if (e.type === 'drifter') {
      const wob = Math.sin(s.time * 2.4 + e.phase) * 0.75;
      e.vx = (ux + -uy * wob) * e.speed * es;
      e.vy = (uy + ux * wob) * e.speed * es;
    } else {
      const boost = (e.type === 'brute' ? 1.15 : 1 + Math.min(0.85, s.wave * 0.07)) * es;
      if (s.siege && e.slot != null) {
        // ENCIRCLE: aim at a point on a ring around the player, offset by this
        // unit's slot, instead of at the player directly. Without it every enemy
        // walks the same straight line and they stack into one conga queue; with
        // it they fan out and the player ends up inside a closing circle.
        const ring = 88 * es;
        // the bearing from the player toward this enemy is its natural side of
        // the circle; it keeps that side while advancing, so the group closes in
        // like a net instead of collapsing into a single point
        const side = Math.atan2(e.y - p.y, e.x - p.x);
        const slotA = side + (e.slot - 0.5) * 0.9;
        const tx = p.x + Math.cos(slotA) * ring;
        const ty = p.y + Math.sin(slotA) * ring;
        const ddx = tx - e.x, ddy = ty - e.y;
        const dd = Math.hypot(ddx, ddy) || 1;
        e.vx = (ddx / dd) * e.speed * boost;
        e.vy = (ddy / dd) * e.speed * boost;
      } else {
        e.vx = ux * e.speed * boost;
        e.vy = uy * e.speed * boost;
      }
    }
    e.x = clamp(e.x + e.vx * dt, -40, s.world.w + 40);
    e.y = clamp(e.y + e.vy * dt, -40, s.world.h + 40);

    if (e.spawnT <= 0 && e.hitCd <= 0 && p.invuln <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
      // Contact HURTS you and costs you ammo. It never kills the enemy.
      // The only way to remove an enemy from the field is a bullet.
      // RULE 'ram': body-checking a scrapper destroys it. It still hurts. This is
      // the level that teaches you ammo is not the only resource you have.
      //
      // THE PLAYER MUST INITIATE. The first version only checked that contact
      // happened, so enemies walking into a stationary player counted as rams and
      // the level cleared itself with zero input (8 bodies, 8 rams, quota met).
      // Now you must be moving INTO the enemy, or dashing through it.
      const closingSpeed = -(ux * p.vx + uy * p.vy);   // >0 when closing on it
      const ram = (s._lv && s._lv.rule === 'ram') && e.type === 'scrapper'
        && p.invuln <= 0 && (p.dashT > 0 || closingSpeed > 60 * es);
      if (ram) {
        e.hp = 0;
        // a ram pays for itself: kill it, take 1, and get 1 back if you have room.
        // Without this the level was survivable only by shooting, which defeats
        // the point of teaching the mechanic.
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + 1);
        killEnemy(s, e);
        damagePlayer(s, 1);
        s.shake = Math.min(24, s.shake + 10);
        emit(s, 'ram');
        continue;
      }
      damagePlayer(s, e.dmg, e);
      const kb = (e.type === 'brute' ? 620 : 380) * es;
      p.vx += ux * kb; p.vy += uy * kb;
      for (let k = 0; k < 10; k++) spawnParticle(s, e.x, e.y, e.color, 320);
      // shove the enemy back too, so it can't sit inside you
      e.x += ux * -26; e.y += uy * -26;
      e.hitCd = 0.6;
    }
  }
}

// Shared throwaway-state decay (streak, shake, particles, scorch marks).
// Card screens freeze the fight but must not freeze the debris: a hard cut to a
// static screen reads as a bug, a settling screen reads as a beat.
function stepCosmetics(s, dt) {
  if (s.streakT > 0) {
    s.streakT -= dt;
    if (s.streakT <= 0) s.streak = 0;
  }
  s.shake = Math.max(0, s.shake - dt * 34);
  s.flashRed = Math.max(0, s.flashRed - dt * 3.5);

  // ---- particles -----------------------------------------------------------
  for (let i = s.particles.length - 1; i >= 0; i--) {
    const q = s.particles[i];
    q.life -= dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 0.94; q.vy *= 0.94;
    if (q.life <= 0) s.particles.splice(i, 1);
  }
  for (let i = s.floaters.length - 1; i >= 0; i--) {
    const f = s.floaters[i];
    f.life -= dt; f.y -= 44 * dt;
    if (f.life <= 0) s.floaters.splice(i, 1);
  }
  // ricochet scars fade slowly, leaving a visible record of every miss
  for (let i = (s.wallMarks || []).length - 1; i >= 0; i--) {
    s.wallMarks[i].life -= dt;
    if (s.wallMarks[i].life <= 0) s.wallMarks.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// input: { ax, ay, aimX, aimY, fire, dash }
export function step(s, dt, input) {
  s.events.length = 0;
  s.input = input || {};
  if (s.mode !== 'play') { s.time += dt; return s; }

  if (s.hitstop > 0) { s.hitstop -= dt; s.shake = Math.max(0, s.shake - dt * 40); return s; }

  s.time += dt;
  const p = s.player;
  const es = s.es;
  const L = s._lv || (s._lv = levelFor(s.level));

  // ---- level cards freeze the fight while they are up -----------------------
  if (s.levelState === 'teach' || s.levelState === 'clear' || s.levelState === 'fail') {
    s.teachT -= dt; s.clearT -= dt; s.failT -= dt;
    // let particles and floaters settle so the screen does not freeze mid-burst
    stepCosmetics(s, dt);
    const t = s.levelState === 'teach' ? s.teachT : s.levelState === 'clear' ? s.clearT : s.failT;
    if (t <= 0) {
      if (s.levelState === 'clear') {
        s.level += 1;
        s.levelsCleared += 1;
        s.wave = s.level;
        s._lv = levelFor(s.level);
        s.levelKills = 0; s.levelT = 0; s.overdraftT = 0;
        s.levelState = 'pick';
        openCardPick(s);
        if (s.mode === 'play') s.levelState = 'pick';
      } else if (s.levelState === 'fail') {
        // retry the same level: keep the PULSE you have, keep your augments
        s.retries += 1;
        s.levelKills = 0; s.levelT = 0; s.overdraftT = 0;
        s.levelState = 'fight';
        s.enemies.length = 0;
        s.spawnT = 0.6;
        emit(s, 'retry', { level: s.level });
      } else {
        s.levelState = 'fight';
        s.spawnT = 0.5;
      }
    }
    return s;
  }

  s.levelT += dt;
  s.waveT = s.levelT;
  s.waveLen = L.time;
  // DEBT COLLECTOR's clock IS the win condition: it counts down through the whole
  // level. It used to tick only while you were below zero, which meant a player who
  // healed up could never reach 12s and then dead-ended on a kill quota of zero.
  // Now the clock always runs — being in debt is what you spend it in, and shooting
  // your way back above zero is strictly good (you survive the rest of the clock).
  if (L.rule === 'overdraftWindow') s.overdraftT += dt;

  // ---- level outcome --------------------------------------------------------
  // quota 0 means "this level has no kill quota" (DEBT COLLECTOR): without this
  // guard `0 >= 0` is true and the level would clear on its first frame.
  const quotaDone = L.quota > 0 && s.levelKills >= L.quota;
  const clockDone = s.levelT >= L.time;
  // SPECIAL RULE: the overdraft level is won by surviving low, not by killing
  const overdraftDone = L.rule === 'overdraftWindow' && s.overdraftT >= 12;
  if (s.mode === 'play' && (quotaDone || overdraftDone)) {
    s.levelState = 'clear';
    s.clearT = 1.5;
    s.banked = s.player.hp;
    if (!s.best) s.best = { level: s.level, kills: s.kills, score: s.score };
    emit(s, 'levelClear', { level: s.level, name: L.name });
    return s;
  }
  if (s.mode === 'play' && clockDone && !quotaDone) {
    // quota-free levels fail on their own rule, not on a kill count of 0/0
    if (L.quota === 0) { s.levelState = 'clear'; s.clearT = 1.5; s.banked = s.player.hp;
      emit(s, 'levelClear', { level: s.level, name: L.name }); return s; }
    s.levelState = 'fail';
    s.failT = 1.6;
    emit(s, 'levelFail', { level: s.level, kills: s.levelKills, quota: L.quota });
    return s;
  }

  stepMovement(s, dt);

  // ---- shooting ------------------------------------------------------------
  p.fireCd -= dt;
  const over = p.hp <= 0;
  const mode = FIRE_MODES[s.fireMode] || FIRE_MODES.manual;

  // AUTO-AIM: point the gun at the nearest enemy for the player. Automatic FIRE
  // lives in SIEGE's own step (siegeFire); the campaign never fires for you.
  let fireWanted = input.fire;
  if (mode.autoAim) {
    let tgt = null, bestD = Infinity;
    for (const e of s.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d2e = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2e < bestD) { bestD = d2e; tgt = e; }
    }
    if (tgt) {
      // lead the target slightly, and snap the aim so the gun reads as a machine
      p.aim = Math.atan2(tgt.y + tgt.vy * 0.06 - p.y, tgt.x + tgt.vx * 0.06 - p.x);
      s.autoTarget = tgt.id;
      // AUTO-AIM points the gun and waits for your trigger. Automatic fire lives
      // in SIEGE now (see siegeFire) — it is a whole mode, not a fire-mode flag.
      fireWanted = input.fire;
    } else {
      // NO TARGET: the gun still fires where you point. The first version
      // suppressed the shot entirely, which handed AUTO-AIM both free aiming AND
      // free ammo protection — it cleared 17/27 sloppy-aim runs against
      // MARKSMAN's 3/27. A mode cannot be easier in every dimension and still be
      // a choice. Now a wasted auto-shot costs PULSE like any other.
      s.autoTarget = null;
      fireWanted = input.fire;
    }
  } else {
    s.autoTarget = null;
  }

  if (fireWanted && p.fireCd <= 0 && p.hp > overdraftFloor(s)) {
    const fm = FIRE_MODES[s.fireMode] || FIRE_MODES.manual;
    const free = s.mods.freeEvery > 0 && p.shotCount > 0 && p.shotCount % s.mods.freeEvery === 0;
    // RULE 'budget' (level 6): every shot costs 2 and every kill pays 3, whatever
    // mode you are in. The level is about shot discipline, so it flattens the two
    // mode economies on purpose — otherwise AUTO-AIM's 2-in/2-back broke even on
    // every kill and a single miss was unrecoverable (measured: 0/3 on both
    // devices). Flattening it also gives AUTO-AIM one level where it is the sane
    // pick, which is what a mode needs to justify itself.
    const budgetRule = s._lv && s._lv.rule === 'budget';
    const cost = free ? 0 : (budgetRule ? Math.max(2, fm.cost) : fm.cost);
    // You cannot fire the shot that would push you past the floor.
    if (p.hp - cost > overdraftFloor(s)) {
      p.hp -= cost;
      p.shotCount++;
      s.shotsFired++;
      p.fireCd = fm.fireRate / s.mods.fireRate;
      p.lastShot = s.time;
      const spd = 1080 * es;
      const spread = 0.028;
      let aimAngle = p.aim;
      if (s.aimAssist > 0) {
        // 1) prefer the enemy nearest to the aim RAY (not merely angularly closest),
        //    so a thumb pointing roughly at a cluster hits what it is pointing at
        let rayBest = null, rayScore = Infinity;
        for (const e of s.enemies) {
          if (e.dead || e.spawnT > 0) continue;
          const dx = e.x - p.x, dy = e.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 640 * es || dist < 1) continue;
          let delta = Math.atan2(dy, dx) - p.aim;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          if (Math.abs(delta) > s.aimAssist * 1.6) continue;
          // perpendicular miss distance from the aim ray
          const perp = Math.abs(Math.sin(delta)) * dist;
          if (perp < rayScore) { rayScore = perp; rayBest = delta; }
        }
        if (rayBest !== null) {
          aimAngle = p.aim + rayBest;
        }
      }
      if (false) {
        let bestDelta = Infinity, bestDir = 0;
        for (const e of s.enemies) {
          if (e.dead) continue;
          const ddx = e.x - p.x, ddy = e.y - p.y;
          if (ddx * ddx + ddy * ddy > (620 * es) ** 2) continue;
          let delta = Math.atan2(ddy, ddx) - p.aim;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          if (Math.abs(delta) < s.aimAssist * 2.6 && Math.abs(delta) < Math.abs(bestDelta)) {
            bestDelta = delta;
          }
        }
        // snap almost all the way: touch aim should feel generous, not punishing
        if (bestDelta !== Infinity) aimAngle = p.aim + bestDelta * 0.96;
      }
      const a = aimAngle + (s.rng() - 0.5) * spread;
      s.bullets.push({
        x: p.x + Math.cos(a) * 20 * es, y: p.y + Math.sin(a) * 20 * es,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: 5 * es, life: 0.85, friendly: true, dmg: 1,
        pierce: s.mods.pierce, hitIds: [], trail: [], over, bounces: 1,
      });
      p.vx -= Math.cos(a) * 26 * es; p.vy -= Math.sin(a) * 26 * es;
      s.shake = Math.min(10, s.shake + (over ? 3.2 : 1.4));
      emit(s, 'shoot', { over });
      for (let i = 0; i < 4; i++) spawnParticle(s, p.x + Math.cos(a) * 18 * es, p.y + Math.sin(a) * 18 * es, over ? '#ff3b5c' : '#bffcff', 260 * es, a);
    } else {
      p.fireCd = 0.2;
      emit(s, 'click');
    }
  }

  // ---- spawn enemies -------------------------------------------------------
  s.spawnT -= dt;
  // The cap is a DENSITY, not a count. On a phone the whole world is the screen
  // (844x390 = 0.36 of the reference arena), so the same 5 bodies crowd you about
  // three times as hard — which is why TIGHT BUDGET cleared 2/3 on desktop and
  // 0/3 on a phone. Scale by area, with a floor so a small screen still has a fight.
  const areaK = clamp((s.world.w * s.world.h) / (REF_ARENA_W * REF_ARENA_H), 0.45, 1.6);
  const aliveCap = Math.max(2, Math.round(L.cap * areaK));
  if (s.spawnT <= 0 && s.enemies.length < aliveCap) {
    spawnEnemy(s, L);
    s.spawnT = L.spawn * (0.7 + s.rng() * 0.6);
  }

  updateBullets(s, dt);

  stepEnemies(s, dt);

  // separate enemies so they don't stack into one blob
  for (let i = 0; i < s.enemies.length; i++) {
    for (let j = i + 1; j < s.enemies.length; j++) {
      const a = s.enemies[i], b = s.enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = (min - d) / d * 0.5;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;
      }
    }
  }

  stepCosmetics(s, dt);

  // ---- death ---------------------------------------------------------------
  // per-level floor: DEBT COLLECTOR runs a deeper overdraft so its own 12-second
  // win condition is survivable at all
  if (p.hp <= overdraftFloor(s)) {
    p.alive = false;
    s.mode = 'dead';
    s.deadT = 0;
    s.shake = 22;
    emit(s, 'death');
    for (let k = 0; k < 46; k++) spawnParticle(s, p.x, p.y, k % 3 ? '#ff3b5c' : '#bffcff', 460);
  }
  return s;
}

// Rockets: area damage. Kinetic bullets stay single-target — splash is what makes
// an evolution visible, not just "more bullets" (which is what DOUBLE/TRIPLE do).
function explode(s, x, y, radius, dmg, skipId) {
  const es = s.es;
  const r2 = (radius * es) ** 2;
  for (const e of s.enemies) {
    if (e.dead || e.id === skipId) continue;
    if (dist2(e.x, e.y, x, y) > r2) continue;
    e.hp -= dmg;
    e.hitFlash = 1;
    if (e.hp <= 0) killEnemy(s, e);
  }
  for (let k = 0; k < 16; k++) spawnParticle(s, x, y, k % 2 ? '#ffd166' : '#ff8a3d', 420);
  s.shake = Math.min(20, s.shake + 6);
  s.hitstop = Math.max(s.hitstop, 0.02);
  emit(s, 'boom');
}

export function killEnemy(s, e) {
  e.dead = true;
  s.kills++;
  if (s.siege) s.siegeKills++;
  s.levelKills++;
  s.streak++;
  s.streakT = 2.6;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  const mult = 1 + Math.min(3, Math.floor(s.streak / 3) * 0.5);
  s.score += Math.round(e.score * mult);
  s.lastKill = s.time;

  const over = s.player.hp <= 0;
  const fm = FIRE_MODES[s.fireMode] || FIRE_MODES.manual;
  let refund = Math.max(1, Math.round((e.refund / 2) * fm.refund)) + s.mods.refundBonus;
  // TIGHT BUDGET pays every mode the same 3 per kill (see the fire gate above)
  if (s._lv && s._lv.rule === 'budget') refund = 3 + s.mods.refundBonus;
  // SIEGE KILLS DO NOT HEAL. This was the balance bug that made the mode
  // unlosable: at +1 PULSE per kill the player was earning hundreds of PULSE over
  // a run while taking a few dozen damage, so the ring could never close. In
  // SIEGE a kill is score and nothing else — PULSE comes from wave clears and the
  // 60-second refill, so getting surrounded actually costs you the run.
  const siegeNoHeal = !!s.siege;
  if (s.siege) refund = 0;
  if (over) refund = Math.round(refund * 1.5);
  // streak bonus: consecutive kills pay more, so accurate players stay alive
  if (s.streak >= 5) refund += 1;
  if (s.streak >= 10) refund += 1;
  if (!siegeNoHeal) s.player.hp = Math.min(s.player.maxHp, s.player.hp + refund);

  s.particles.push(...[]);
  for (let k = 0; k < 18; k++) spawnParticle(s, e.x, e.y, e.color, 380);
  s.floaters.push({ x: e.x, y: e.y - e.r, text: '+' + refund, color: over ? '#ffd166' : '#7dffb2', life: 0.85, size: (over ? 22 : 17) * s.es });
  s.hitstop = 0.032;
  s.shake = Math.min(18, s.shake + 7);
  if (over) { emit(s, 'overdraftKill'); }
  emit(s, 'kill', { kind: e.type, streak: s.streak, refund });
}

// The overdraft floor is per-level: DEBT COLLECTOR needs enough headroom to
// survive its own 12-second win condition.
export function overdraftFloor(s) {
  return (s && s._lv && s._lv.floor != null) ? s._lv.floor : OVERDRAFT_FLOOR;
}

export function damagePlayer(s, amount) {
  const p = s.player;
  const floor = overdraftFloor(s);
  // DEBT COLLECTOR: in debt means already as low as it gets, and the whole level
  // is not being killed. Without this the first contact ends the run on the spot.
  if (s._lv && s._lv.rule === 'overdraftWindow' && p.hp < 0) { p.invuln = Math.max(p.invuln, 0.3); return; }
  if (p.hp <= floor) return;
  p.hp = Math.max(floor, p.hp - amount);
  p.invuln = 0.75;
  p.lastHurt = s.time;
  p.hitFlash = 1;
  s.damageTaken += amount;
  s.streak = 0;
  s.streakT = 0;
  s.flashRed = 1;
  s.shake = Math.min(24, s.shake + 13);
  s.hitstop = 0.045;
  s.floaters.push({ x: p.x, y: p.y - 26 * s.es, text: '-' + amount, color: '#ff4d6d', life: 0.7, size: 19 * s.es });
  emit(s, 'hurt', { hp: p.hp });
}

function openCardPick(s) {
  const pool = CARDS.filter((c) => !s.cardsTaken.includes(c.id));
  const choices = [];
  const copy = pool.slice();
  for (let i = 0; i < 3 && copy.length; i++) {
    choices.push(copy.splice(Math.floor(s.rng() * copy.length), 1)[0]);
  }
  if (!choices.length) return;
  s.mode = 'pick';
  s.pick = choices;
}

export function chooseCard(s, index) {
  if (s.mode !== 'pick' || !s.pick) return;
  const card = s.pick[index];
  if (!card) return;
  card.apply(s);
  s.cardsTaken.push(card.id);
  s.pick = null;
  s.mode = 'play';
  emit(s, 'card', { name: card.name });
  beginNextLevel(s);
}

// `opt` is SIEGE's tier scaling. The campaign passes nothing and behaves exactly
// as before, which is why the endless mode could be added without retuning levels.
function spawnEnemy(s, L, opt) {
  const lv = L || levelFor(s.level);
  const o = opt || null;
  const kinds = lv.kinds || ['scrapper'];
  // weighted pick: the newest kind is the rarest, so a new enemy reads as an event
  const roll = s.rng();
  let type = kinds[0];
  if (kinds.length > 1 && roll > 0.62) type = kinds[1];
  if (kinds.length > 2 && roll > 0.84) type = kinds[2];
  if (kinds.length > 3 && roll > 0.955) type = kinds[3];
  if (kinds.length > 4 && roll > 0.99) type = kinds[4];

  const t = ENEMY_TYPES[type];
  // spawn just INSIDE the edge. Off-screen spawns are invisible on a phone: the
  // player cannot see what they are supposed to shoot, which reads as a dead game.
  const edge = Math.floor(s.rng() * 4);
  let x, y;
  const pad = -t.r * s.es - 6;
  const ww = s.world.w, wh = s.world.h;
  if (edge === 0) { x = s.rng() * ww; y = -pad; }
  else if (edge === 1) { x = ww + pad; y = s.rng() * wh; }
  else if (edge === 2) { x = s.rng() * ww; y = wh + pad; }
  else { x = -pad; y = s.rng() * wh; }

  // never spawn on top of the player
  if (dist2(x, y, s.player.x, s.player.y) < (260 * s.es) ** 2) {
    x = s.world.w - x; y = s.world.h - y;
  }

  const hpBonus = o ? o.hpBonus : Math.floor((lv.index - 1) / 4);
  const speedMul = (o ? o.speedMul : 1);
  s.enemies.push({
    id: s.nextId++,
    // SIEGE: at higher tiers, elites arrive escorted by their lesser kin
    escort: false, type, x, y, vx: 0, vy: 0,
    r: t.r * s.es, hp: Math.max(1, t.hp + hpBonus),
    speed: t.speed * (lv.waveSpeed || 1) * speedMul, dmg: t.dmg, refund: t.refund,
    score: Math.round(t.score * (o ? o.scoreMul : 1)),
    color: t.color, hitFlash: 0, spawnT: 0.28, fireCd: 1.2 + s.rng(),
    phase: s.rng() * TAU, dead: false,
  });
  return s.enemies[s.enemies.length - 1];
}

function spawnParticle(s, x, y, color, speed, dir) {
  const a = dir != null ? dir + (s.rng() - 0.5) * 0.9 : s.rng() * TAU;
  const v = speed * (0.25 + s.rng() * 0.75);
  s.particles.push({
    x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
    life: 0.22 + s.rng() * 0.3, max: 0.52, color, size: (1.6 + s.rng() * 2.4) * s.es,
  });
}

export function accuracy(s) {
  return s.shotsFired ? s.shotsHit / s.shotsFired : 0;
}
