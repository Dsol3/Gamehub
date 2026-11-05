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
    cost: 1, refund: 2, ricochet: true, fireRate: 0.17, autoAim: false, assist: true,
  },
  auto: {
    id: 'auto', name: 'TURRET', blurb: 'Auto-fire. Position and dash. No aim, thinner budget.',
    cost: 1, refund: 1, ricochet: false, fireRate: 0.24, autoAim: true, assist: false,
  },
};

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
    fireMode: 'auto', // 'auto' (turret) | 'manual' (marksman) - different rules, see below
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
    events: [],
    wave: 1,
    waveT: 0,
    waveLen: 22,
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

export function emit(s, type, data = {}) { s.events.push({ type, ...data }); }

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
  emit(s, 'start');
  return s;
}

// ---------------------------------------------------------------------------
// input: { ax, ay, aimX, aimY, fire, dash }
export function step(s, dt, input) {
  s.events.length = 0;
  if (s.mode !== 'play') { s.time += dt; return s; }

  if (s.hitstop > 0) { s.hitstop -= dt; s.shake = Math.max(0, s.shake - dt * 40); return s; }

  s.time += dt;
  s.waveT += dt;
  const p = s.player;
  const es = s.es;

  // ---- waves ---------------------------------------------------------------
  if (s.waveT >= s.waveLen) {
    s.waveT = 0;
    s.wave += 1;
    s.waveLen = Math.max(14, 22 - s.wave * 0.7);
    s.player.hp = Math.min(p.maxHp, p.hp + 1);
    emit(s, 'wave', { wave: s.wave });
    if (s.wave % 3 === 0 && s.cardsTaken.length < 3) openCardPick(s);
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
  } else {
    p.vx += (nx * speed * (ax || ay ? 1 : 0) - p.vx) * Math.min(1, accel * dt);
    p.vy += (ny * speed * (ax || ay ? 1 : 0) - p.vy) * Math.min(1, accel * dt);
  }
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt * 4);

  if (input.dash && p.dashCd <= 0) {
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

  // aim
  if (input.aimX != null) p.aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);

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
      // hold fire unless the budget is about to run dry (it defends itself)
      fireWanted = p.hp > 0.6;
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
    const cost = free ? 0 : fm.cost;
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
  const aliveCap = 5 + s.wave * 2;
  if (s.spawnT <= 0 && s.enemies.length < aliveCap) {
    spawnEnemy(s);
    const pressure = clamp(1.55 - s.wave * 0.13, 0.32, 1.55);
    s.spawnT = pressure * (0.6 + s.rng() * 0.8);
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
    const ricochetOn = (FIRE_MODES[s.fireMode] || FIRE_MODES.manual).ricochet;
    if (ricochetOn && b.friendly && b.bounces > 0) {
      if (b.x < wallPad) { b.x = wallPad; b.vx = Math.abs(b.vx); bouncedX = true; }
      else if (b.x > bw - wallPad) { b.x = bw - wallPad; b.vx = -Math.abs(b.vx); bouncedX = true; }
      if (b.y < wallPad) { b.y = wallPad; b.vy = Math.abs(b.vy); bouncedY = true; }
      else if (b.y > bh - wallPad) { b.y = bh - wallPad; b.vy = -Math.abs(b.vy); bouncedY = true; }
      if (bouncedX || bouncedY) {
        b.bounces--;
        b.friendly = false;          // now it can hurt you
        b.life = 2.4;
        b.vx *= 0.86; b.vy *= 0.86;   // loses energy off the wall
        emit(s, 'bounce');
        for (let k = 0; k < 5; k++) spawnParticle(s, b.x, b.y, '#ff3b5c', 180);
      }
    }
    if (b.life <= 0 || b.x < -20 || b.x > bw + 20 || b.y < -20 || b.y > bh + 20) { s.bullets.splice(i, 1); continue; }

    if (b.friendly) {
      for (const e of s.enemies) {
        if (e.dead || b.hitIds.includes(e.id)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) * (b.r + e.r)) {
          e.hp -= b.dmg;
          e.hitFlash = 1;
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
  emit(s, 'kill', { type: e.type, streak: s.streak });
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
}

function spawnEnemy(s) {
  const w = s.wave;
  const roll = s.rng();
  let type = 'scrapper';
  if (w >= 2 && roll > 0.72) type = 'drifter';
  if (w >= 3 && roll > 0.86) type = 'lancer';
  if (w >= 4 && roll > 0.955) type = 'brute';

  const t = ENEMY_TYPES[type];
  // spawn just outside the arena edge
  const edge = Math.floor(s.rng() * 4);
  let x, y;
  const pad = 30;
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
    r: t.r * s.es, hp: t.hp * (1 + Math.floor(w / 5) * 0.25),
    speed: t.speed, dmg: t.dmg, refund: t.refund, score: t.score,
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
