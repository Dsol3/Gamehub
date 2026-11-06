// OVERDRAFT — screen geometry, shared by the renderer and the input handler.
//
// WHY THIS FILE EXISTS: the augment picker used to be laid out in drawPick() and
// hit-tested in cardIndexAt(), as two independent copies of the same arithmetic.
// On a landscape phone one copy stacked the cards vertically from H * 0.3, which
// put cards 2 and 3 below the bottom edge — and the OTHER copy agreed they were
// off-screen, so every tap returned -1 and was silently swallowed. The screen
// became unexitable. One function, called by both, makes that class of bug
// impossible: they cannot disagree because there is nothing to disagree with.
//
// Everything here is pure: no DOM, no globals. `W`/`H` are CSS pixels.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// augment cards
// ---------------------------------------------------------------------------
// Landscape phones get a ROW of three; portrait phones get a fitted COLUMN;
// desktop gets a wide row with real height. Height is always capped so all three
// cards AND the header fit, which is what broke before.
export function pickLayout(W, H, mobile) {
  const land = W > H;
  const gap = mobile ? 12 : 30;
  const headerH = mobile ? 58 : 0;
  let cw, ch, y, vertical;

  if (mobile && land) {
    vertical = false;
    // SHORTER, AND CENTRED, ON A LANDSCAPE PHONE.
    // The old row stretched to the full width and stood 168px tall, so the three
    // cards filled the entire screen and the screen read as a wall of text rather
    // than three things to choose between. Capping BOTH dimensions leaves air
    // above and below, which is what makes the choice legible.
    //
    // It stays a ROW. A column is what broke this screen before: cards 2 and 3
    // fell below the bottom edge and every tap missed, so the screen could not be
    // exited. Only the size changes — the arrangement that made it tappable stays.
    cw = Math.min((W - 24 - gap * 2) / 3, 236);
    ch = Math.min(128, H - headerH - 46);
    y = headerH + 6;
  } else if (mobile) {
    vertical = true;
    cw = Math.min(W - 40, 340);
    ch = Math.min(132, (H - headerH - 60 - gap * 2) / 3);
    y = headerH + 10;
  } else {
    vertical = false;
    cw = 260;
    ch = Math.min(220, H * 0.46);
    y = H * 0.34;
  }

  cw = Math.max(80, cw);
  ch = Math.max(64, ch);

  const totalW = vertical ? cw : 3 * cw + 2 * gap;
  const x0 = W / 2 - totalW / 2;

  // Landscape phones: shorten the cards AND then centre the whole group, cards
  // plus the SKIP button, in the space left below the header. Shrinking alone
  // left the block glued to the top with a dead band underneath, which read as a
  // layout bug rather than as breathing room.
  let landscapeY = y;
  if (mobile && land) {
    const skipHh = 40, skipGap = 10;
    const groupH = ch + skipGap + skipHh;
    const top = headerH + 6;
    const room = H - top - 8;
    landscapeY = top + Math.max(0, (room - groupH) / 2);
  }

  const cards = [];
  for (let i = 0; i < 3; i++) {
    cards.push({
      x: x0 + (vertical ? 0 : i * (cw + gap)),
      y: (mobile && land ? landscapeY : y) + (vertical ? i * (ch + gap) : 0),
      w: cw,
      h: ch,
    });
  }
  const bottom = vertical ? y + 3 * ch + 2 * gap : (mobile && land ? landscapeY : y) + ch;

  // The escape hatch. If a device is so short that even the fitted row will not
  // sit above a skip button, the button goes to the bottom-left and the cards
  // lose height to make room. There is always a way out of this screen.
  const skipH = 40;
  const skipW = Math.min(190, W - 32);
  const skipY = Math.min(H - skipH - 8, bottom + (mobile ? 10 : 16));
  return {
    cards, vertical, gap, headerH, bottom,
    skip: { x: 16, y: skipY, w: skipW, h: skipH },
  };
}

// Hit test against a pickLayout result. Integer index, or -1.
export function pickIndexAt(layout, x, y) {
  for (let i = 0; i < layout.cards.length; i++) {
    const c = layout.cards[i];
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// SIEGE scaling
// ---------------------------------------------------------------------------
// The whole point of endless mode is that the enemy curve outruns yours, so the
// player's upgrade clock is exactly twice the enemy's. Enemy tier climbs every
// 10s of survival; player tier every 20s. The lead therefore widens forever.
export const ENEMY_TIER_SECONDS = 10;
export const PLAYER_TIER_SECONDS = 20;
export const PULSE_REFILL_SECONDS = 60;

export const enemyTierAt = (t) => 1 + Math.floor(Math.max(0, t) / ENEMY_TIER_SECONDS);
export const playerTierAt = (t) => 1 + Math.floor(Math.max(0, t) / PLAYER_TIER_SECONDS);

// Weapon evolution. Each step is a visible upgrade, not a number change.
export const WEAPON_TIERS = [
  { tier: 1, name: 'SINGLE', desc: 'one shot' },
  { tier: 2, name: 'DOUBLE', desc: 'two shots' },
  { tier: 3, name: 'TRIPLE', desc: 'three shots' },
  { tier: 4, name: 'ROCKET', desc: 'explosive' },
  { tier: 5, name: 'TWIN ROCKET', desc: 'two rockets' },
  { tier: 6, name: 'PIERCE ROCKET', desc: 'rockets punch through' },
  { tier: 7, name: 'ROCKET STORM', desc: 'four rockets' },
];
export const MAX_WEAPON_TIER = WEAPON_TIERS.length;
export const weaponFor = (tier) => WEAPON_TIERS[clamp(tier, 1, MAX_WEAPON_TIER) - 1];

// ---------------------------------------------------------------------------
// leaderboard
// ---------------------------------------------------------------------------
export const BOARD_SIZE = 5;
export const BOARD_KEY = 'overdraft_board_v1';

export function emptyBoard() {
  return { campaign: [], siege: [] };
}

// Keep only well-formed rows, newest-first ordering preserved, capped at 5.
export function sanitizeBoard(raw) {
  const board = emptyBoard();
  if (!raw || typeof raw !== 'object') return board;
  for (const k of ['campaign', 'siege']) {
    const rows = Array.isArray(raw[k]) ? raw[k] : [];
    board[k] = rows
      .filter((r) => r && typeof r === 'object' && Number.isFinite(r.score))
      .slice(0, BOARD_SIZE)
      .map((r) => ({
        score: Math.round(r.score),
        // both boards carry every stat; unused ones are simply zero
        level: Number.isFinite(r.level) ? Math.round(r.level) : 0,
        wave: Number.isFinite(r.wave) ? Math.round(r.wave) : 0,
        time: Number.isFinite(r.time) ? Math.max(0, Math.round(r.time)) : 0,
        acc: Number.isFinite(r.acc) ? clamp(Math.round(r.acc), 0, 100) : 0,
        ts: Number.isFinite(r.ts) ? r.ts : 0,
      }));
  }
  return board;
}

// Insert a run, sort by score, keep the top N. Returns { board, rank, isBest }.
// rank is 1-based, or 0 when the run did not make the board.
export function addRun(board, kind, run) {
  const b = sanitizeBoard(board);
  if (!b[kind]) return { board: b, rank: 0, isBest: false };
  const prev = b[kind];
  const row = sanitizeBoard({ [kind]: [run] })[kind][0];
  const rows = [...prev, row].sort((a, z) => z.score - a.score || z.time - a.time).slice(0, BOARD_SIZE);
  b[kind] = rows;
  const idx = rows.indexOf(row);
  const rank = idx < 0 ? 0 : idx + 1;
  const isBest = rank === 1;
  return { board: b, rank, isBest };
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
