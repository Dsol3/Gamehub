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
};

// The two modes are not a difficulty slider. They change the rules:
//
//   MANUAL (marksman) - you aim. Shots cost 1 PULSE, kills refund 2, and a shot
//     that hits nothing ricochets off the wall and comes back at you. Precision
//     is the whole game: accuracy IS your ammo supply.
//
//   AUTO (turret)     - the gun aims and fires itself at the nearest target.
//     You only position and dash. Shots still cost PULSE but kills refund less,
//     and misses do NOT ricochet (the turret rarely misses). The economy is
//     tighter and there is no precision to save you, so RUNNING OUT is the real
//     threat. You are managing a budget, not an aim.
export const FIRE_MODES = {
  manual: {
    id: 'manual', name: 'MARKSMAN', blurb: 'You aim. Misses ricochet back at you.',
    // accurate play is genuinely harder here, so a hit pays more
    cost: 1, refund: 3, ricochet: true, fireRate: 0.16, autoAim: false, autoFire: false, assist: true,
  },
  assisted: {
    // the middle road the user asked for: the gun finds the target, you keep the
    // trigger. Aiming anxiety gone, ammo decisions still yours.
    id: 'assisted', name: 'AUTO-AIM', blurb: 'Gun aims itself. You still pull the trigger.',
    cost: 1, refund: 2, ricochet: true, fireRate: 0.20, autoAim: true, autoFire: false, assist: false,
  },
  auto: {
    id: 'auto', name: 'TURRET', blurb: 'Aims AND fires. You position and dash.',
    // auto-fire cannot be aimed, so it pays on refunds instead of per shot
    cost: 1, refund: 1, ricochet: false, fireRate: 0.26, autoAim: true, autoFire: true, assist: false,
  },
};

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
    n: 6, name: 'TIGHT BUDGET', teach: 'Caps are 3 until you clear it.',
    time: 36, quota: 11, kinds: ['scrapper', 'drifter', 'lancer'], spawn: 1.05, cap: 5, waveSpeed: 1.05,
    rule: 'budget',
  },
  {
    n: 7, name: 'DEBT COLLECTOR', teach: 'Win by surviving 12 seconds in OVERDRAFT.',
    time: 40, quota: 10, kinds: ['scrapper', 'drifter'], spawn: 1.0, cap: 5, waveSpeed: 1.1,
    rule: 'overdraftWindow',
  },
  {
    n: 8, name: 'THE WALL', teach: 'Armoured. Only weak spots finish it.',
    time: 40, quota: 10, kinds: ['scrapper', 'drifter', 'lancer', 'brute'], spawn: 1.05, cap: 5, waveSpeed: 1.1,
    rule: 'armour',
  },
  {
    n: 9, name: 'CHECKOUT', teach: 'Everything at once. Nothing held back.',
    time: 48, quota: 10, kinds: ['scrapper', 'drifter', 'lancer', 'brute'], spawn: 1.0, cap: 5, waveSpeed: 1.1,
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

// Card screens freeze the fight but must not freeze the debris: a hard cut to a
// static screen reads as a bug, a settling screen reads as a beat.
function tickCosmetics(s, dt) {
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
  s.shake = Math.max(0, s.shake - dt * 40);
  s.flashRed = Math.max(0, s.flashRed - dt * 3);
  s.hitstop = 0;
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

// Called when the player takes an augment between levels: the next fight begins,
// and the health banked from the clear is paid back as a small top-up.
export function beginNextLevel(s) {
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

// ---------------------------------------------------------------------------
// input: { ax, ay, aimX, aimY, fire, dash }
export function step(s, dt, input) {
  s.events.length = 0;
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
    tickCosmetics(s, dt);
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
  // level 7's win condition: the overdraft clock only counts once you are under
  if (L.rule === 'overdraftWindow') {
    if (s.player.hp < 0) s.overdraftT += dt;
    // the fight starts you in debt if you arrived healthy, so the goal is reachable
    else if (s.levelT > 1.2 && s.player.hp > 0 && s.overdraftT === 0 && s.levelKills === 0) {
      // a nudge: the level pays nothing for staying safe
    }
  }

  // ---- level outcome --------------------------------------------------------
  const quotaDone = s.levelKills >= L.quota;
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
    s.levelState = 'fail';
    s.failT = 1.6;
    emit(s, 'levelFail', { level: s.level, kills: s.levelKills, quota: L.quota });
    return s;
  }

  // ---- player movement -----------------------------------------------------
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

  // ---- shooting ------------------------------------------------------------
  p.fireCd -= dt;
  const over = p.hp <= 0;
  const mode = FIRE_MODES[s.fireMode] || FIRE_MODES.manual;

  // TURRET mode: the gun aims itself. Pick the nearest enemy, aim at it, and
  // fire automatically. The player's job becomes positioning, not precision.
  let fireWanted = input.fire;
  if (mode.autoAim) {
    let tgt = null, bestD = Infinity;
    for (const e of s.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d2e = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2e < bestD) { bestD = d2e; tgt = e; }
    }
    if (tgt) {
      // lead the target slightly, and snap the aim so the turret reads as a machine
      p.aim = Math.atan2(tgt.y + tgt.vy * 0.06 - p.y, tgt.x + tgt.vx * 0.06 - p.x);
      s.autoTarget = tgt.id;
      // TURRET fires for you; AUTO-AIM only points the gun and waits for your
      // trigger. `autoFire` is the whole difference between the two modes.
      if (mode.autoFire) fireWanted = p.hp > 0.6;
      else fireWanted = input.fire;
    } else {
      s.autoTarget = null;
      fireWanted = false;
    }
  } else {
    s.autoTarget = null;
  }

  if (fireWanted && p.fireCd <= 0 && p.hp > OVERDRAFT_FLOOR) {
    const fm = FIRE_MODES[s.fireMode] || FIRE_MODES.manual;
    const free = s.mods.freeEvery > 0 && p.shotCount > 0 && p.shotCount % s.mods.freeEvery === 0;
    // RULE 'budget' (level 6): every shot costs 2 until you clear it
    const budgetRule = s._lv && s._lv.rule === 'budget';
    const cost = free ? 0 : (budgetRule ? 2 : fm.cost);
    // You cannot fire the shot that would push you past the floor.
    if (p.hp - cost > OVERDRAFT_FLOOR) {
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
  const aliveCap = L.cap;
  if (s.spawnT <= 0 && s.enemies.length < aliveCap) {
    spawnEnemy(s, L);
    s.spawnT = L.spawn * (0.7 + s.rng() * 0.6);
  }

  // ---- bullets -------------------------------------------------------------
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

  // ---- enemies -------------------------------------------------------------
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
      e.vx = ux * e.speed * boost;
      e.vy = uy * e.speed * boost;
    }
    e.x = clamp(e.x + e.vx * dt, -40, s.world.w + 40);
    e.y = clamp(e.y + e.vy * dt, -40, s.world.h + 40);

    if (e.spawnT <= 0 && e.hitCd <= 0 && p.invuln <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
      // Contact HURTS you and costs you ammo. It never kills the enemy.
      // The only way to remove an enemy from the field is a bullet.
      // RULE 'ram': body-checking a scrapper destroys it. It still hurts. This is
      // the level that teaches you ammo is not the only resource you have.
      const ram = (s._lv && s._lv.rule === 'ram') && e.type === 'scrapper' && p.invuln <= 0;
      if (ram) {
        e.hp = 0;
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

  // ---- streak / timers -----------------------------------------------------
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

export function killEnemy(s, e) {
  e.dead = true;
  s.kills++;
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
  if (over) refund = Math.round(refund * 1.5);
  // streak bonus: consecutive kills pay more, so accurate players stay alive
  if (s.streak >= 5) refund += 1;
  if (s.streak >= 10) refund += 1;
  s.player.hp = Math.min(s.player.maxHp, s.player.hp + refund);

  s.particles.push(...[]);
  for (let k = 0; k < 18; k++) spawnParticle(s, e.x, e.y, e.color, 380);
  s.floaters.push({ x: e.x, y: e.y - e.r, text: '+' + refund, color: over ? '#ffd166' : '#7dffb2', life: 0.85, size: (over ? 22 : 17) * s.es });
  s.hitstop = 0.032;
  s.shake = Math.min(18, s.shake + 7);
  if (over) { emit(s, 'overdraftKill'); }
  emit(s, 'kill', { kind: e.type, streak: s.streak, refund });
}

export function damagePlayer(s, amount) {
  const p = s.player;
  if (p.hp <= OVERDRAFT_FLOOR) return;
  p.hp = Math.max(OVERDRAFT_FLOOR, p.hp - amount);
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

function spawnEnemy(s, L) {
  const lv = L || levelFor(s.level);
  const kinds = lv.kinds || ['scrapper'];
  // weighted pick: the newest kind is the rarest, so a new enemy reads as an event
  const roll = s.rng();
  let type = kinds[0];
  if (kinds.length > 1 && roll > 0.62) type = kinds[1];
  if (kinds.length > 2 && roll > 0.84) type = kinds[2];
  if (kinds.length > 3 && roll > 0.955) type = kinds[3];

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

  s.enemies.push({
    id: s.nextId++, type, x, y, vx: 0, vy: 0,
    r: t.r * s.es, hp: t.hp + Math.floor((lv.index - 1) / 4),
    speed: t.speed * (lv.waveSpeed || 1), dmg: t.dmg, refund: t.refund, score: t.score,
    color: t.color, hitFlash: 0, spawnT: 0.28, fireCd: 1.2 + s.rng(),
    phase: s.rng() * TAU, dead: false,
  });
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
