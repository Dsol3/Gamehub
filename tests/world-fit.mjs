// World-fit regression: the playfield must never be larger than the canvas.
//
// This exists because MIN_H was 480, so setWorld() silently grew the world
// taller than the visible canvas on every phone in landscape (the most common
// way this game is played). The canvas measured correctly, so a dimension test
// passed — but 90px of the arena on an 844x390 phone, and 160px on a 568x320
// phone, was drawn BELOW the bottom edge and could not be reached or seen. The
// player got clamped to coordinates that were off-screen.
//
// The invariant: whatever the canvas is, the world the simulation uses must fit
// inside it. No hidden rows, no hidden columns.
import { createState, setWorld, MIN_W, MIN_H } from '../src/sim.js';

// Every screen we claim to support, plus the degenerate ones a browser will
// genuinely hand us (iOS keyboard open, a short iframe, a tiny embedded view).
const SCREENS = [
  [844, 390, 'iPhone 13/14 landscape'],
  [667, 375, 'iPhone SE landscape'],
  [568, 320, 'shortest landscape we support'],
  [932, 430, 'Pro Max landscape'],
  [926, 428, 'older Pro Max landscape'],
  [780, 360, 'small Android landscape'],
  [390, 844, 'iPhone 14 portrait'],
  [320, 568, 'iPhone SE portrait'],
  [428, 926, 'Pro Max portrait'],
  [1024, 768, 'iPad landscape'],
  [768, 1024, 'iPad portrait'],
  [1568, 730, 'tablet / touch laptop'],
  [1280, 720, 'desktop'],
  [1920, 1080, 'large desktop'],
  [400, 200, 'short embedded frame'],
  [320, 120, 'absolute minimum'],
];

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

for (const [w, h, name] of SCREENS) {
  const s = createState(1);
  setWorld(s, w, h);

  ok(s.world.w <= w, `${name}: world width ${s.world.w} fits canvas width ${w}`);
  ok(s.world.h <= h, `${name}: world height ${s.world.h} fits canvas height ${h}`);

  // The player must be reachable: every coordinate the movement clamp allows
  // has to fall inside the visible canvas.
  const m = 24;
  const maxX = Math.min(s.world.w - m, w);
  const maxY = Math.min(s.world.h - m, h);
  ok(maxX > m && maxY > m,
    `${name}: player has room to move inside the frame (x<=${maxX}, y<=${maxY})`);
}

// Degenerate sizes must not throw or produce a zero/negative arena.
for (const [w, h] of [[0, 0], [1, 1], [320, 1]]) {
  const s = createState(1);
  let threw = null;
  try { setWorld(s, w, h); } catch (e) { threw = e; }
  ok(!threw, `degenerate ${w}x${h}: setWorld does not throw`);
  ok(s.world.w >= MIN_W && s.world.h >= MIN_H,
    `degenerate ${w}x${h}: world stays above the ${MIN_W}x${MIN_H} floor`);
}

console.log(failures ? `\n${failures} WORLD-FIT FAILURE(S)` : '\nWORLD FITS EVERY SCREEN');
process.exit(failures ? 1 : 0);
