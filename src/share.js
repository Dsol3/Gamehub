// OVERDRAFT — the share card.
//
// A player who just died should be able to post the proof in one tap. No video, no
// recorder, no permissions: this draws a 1200x630 PNG (the size X, Facebook and
// Discord all unfurl into a wide card) onto an offscreen canvas, and the browser
// saves it.
//
// Three constraints shaped everything here:
//
//   1. IT MUST BE HONEST. Every number on the card comes from the finished run, and
//      the "beat this" line only appears if there is actually something to beat.
//      A share card that flatters you is a share card nobody trusts.
//   2. IT MUST READ AT A GLANCE. Someone scrolls past this at thumbnail size. The
//      one number that matters (waves survived / score) is the biggest thing on the
//      card, and the title is at the top-left where the eye starts.
//   3. IT MUST NOT BREAK THE GAME. No new dependencies, no network, no async image
//      loading — the whole thing is canvas drawing calls, same as the game.
//
// The module is deliberately DOM-free apart from `document.createElement('canvas')`
// so the headless tests can drive it with @napi-rs/canvas instead.

const CARD_W = 1200;
const CARD_H = 630;

// The same palette the game uses. Kept local so this file has zero imports and can
// be exercised on its own.
const INK = '#eafcff';
const DIM = '#8ba3bb';
const CYAN = '#6ff5ff';
const AMBER = '#ffd166';
const GREEN = '#7dffb2';
const RED = '#ff2d55';

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function pad2(n) { return String(Math.max(0, Math.floor(n))).padStart(2, '0'); }

export function clockText(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(s / 60) + ':' + pad2(s % 60);
}

// ---------------------------------------------------------------------------
// what goes on the card
// ---------------------------------------------------------------------------
// `run` is the object the leaderboard already files, plus what the death screen
// knows. Deliberately boring data in, boring layout out.
export function cardModel(run) {
  const siege = !!run.siege;
  const score = Math.max(0, Math.round(run.score || 0));
  const wave = Math.max(0, Math.round(run.wave || 0));
  const level = Math.max(1, Math.round(run.level || 1));
  const time = Math.max(0, Math.round(run.time || 0));
  const acc = Math.max(0, Math.min(100, Math.round(run.acc || 0)));

  // The hero number. On SIEGE the score is "how long did you last", and the wave is
  // the thing players actually compare, so the wave leads and the timer supports it.
  // In the campaign the score is the run.
  const hero = siege
    ? { value: String(wave), label: 'WAVE', unit: 'SURVIVED ' + clockText(time) }
    : { value: String(score), label: 'SCORE', unit: 'LEVEL ' + level };

  const stats = siege
    ? [
        ['SURVIVED', clockText(time)],
        ['KILLS', String(Math.round(run.kills || 0))],
        ['WEAPON', run.weapon || 'SINGLE'],
        ['SCORE', String(score)],
      ]
    : [
        ['LEVEL', String(level)],
        ['CLEARED', String(Math.round(run.levelsCleared || 0))],
        ['KILLS', String(Math.round(run.kills || 0))],
        ['ACCURACY', acc + '%'],
      ];

  const verdict = run.verdict
    || (siege ? 'You lasted. The ladder climbs faster.' : 'You fired like it was free.');

  return {
    siege,
    score, wave, level, time, acc,
    mode: siege ? 'SIEGE' : (run.fireMode === 'assisted' ? 'AUTO-AIM' : 'MARKSMAN'),
    hero, stats, verdict,
    // only present when the player actually has a board to point at
    rank: run.rank > 0 ? run.rank : 0,
    beaten: run.rank === 1 && run.previousBest > 0 ? run.previousBest : 0,
    isBest: run.rank === 1,
    cameFrom: run.cameFrom || '',
  };
}

// One-line caption the game puts on the clipboard, so tapping "copy" and pasting
// into X already reads like a sentence.
export function shareText(run) {
  const m = cardModel(run);
  if (m.siege) {
    return `OVERDRAFT · ${m.mode} — wave ${m.wave}, survived ${clockText(m.time)}, ${m.stats[1][1]} kills.`
      + (m.isBest ? ' Personal best.' : '');
  }
  return `OVERDRAFT · ${m.mode} — ${m.score} points, level ${m.level}, ${m.acc}% accuracy.`
    + (m.isBest ? ' Personal best.' : '');
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
// `makeCanvas` lets the caller supply the canvas factory: the browser has
// document.createElement, the tests pass @napi-rs/canvas. Keeping it injected is
// what makes this testable without stubbing half a DOM.
export function drawCard(run, makeCanvas) {
  const m = cardModel(run);
  const cv = makeCanvas(CARD_W, CARD_H);
  const c = cv.getContext('2d');

  // ---- background: deep navy with a faint grid, same language as the arena ----
  const bg = c.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#070c16');
  bg.addColorStop(0.55, '#0a1220');
  bg.addColorStop(1, '#05070d');
  c.fillStyle = bg;
  c.fillRect(0, 0, CARD_W, CARD_H);

  c.strokeStyle = 'rgba(110,245,255,0.05)';
  c.lineWidth = 1;
  for (let x = 0; x <= CARD_W; x += 40) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, CARD_H); c.stroke();
  }
  for (let y = 0; y <= CARD_H; y += 40) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(CARD_W, y); c.stroke();
  }

  // a slow red bloom bottom-right: the debt, always creeping in
  const bloom = c.createRadialGradient(CARD_W * 0.92, CARD_H * 1.02, 20, CARD_W * 0.92, CARD_H * 1.02, 460);
  bloom.addColorStop(0, 'rgba(255,45,85,0.20)');
  bloom.addColorStop(1, 'rgba(255,45,85,0)');
  c.fillStyle = bloom;
  c.fillRect(0, 0, CARD_W, CARD_H);

  // a cyan bloom top-left, behind the title
  const cool = c.createRadialGradient(90, 40, 10, 90, 40, 380);
  cool.addColorStop(0, 'rgba(110,245,255,0.13)');
  cool.addColorStop(1, 'rgba(110,245,255,0)');
  c.fillStyle = cool;
  c.fillRect(0, 0, CARD_W, CARD_H);

  // ---- frame corner brackets ----
  c.strokeStyle = 'rgba(110,245,255,0.35)';
  c.lineWidth = 3;
  const P = 34, L = 46;
  const corner = (x, y, sx, sy) => {
    c.beginPath();
    c.moveTo(x + sx * L, y); c.lineTo(x, y); c.lineTo(x, y + sy * L);
    c.stroke();
  };
  corner(P, P, 1, 1);
  corner(CARD_W - P, P, -1, 1);
  corner(P, CARD_H - P, 1, -1);
  corner(CARD_W - P, CARD_H - P, -1, -1);

  c.textBaseline = 'alphabetic';

  // ---- title + mode badge ----
  c.textAlign = 'left';
  c.fillStyle = INK;
  c.font = '800 44px ui-monospace, Menlo, monospace';
  c.fillText('OVERDRAFT', 78, 132);

  c.fillStyle = m.siege ? GREEN : (m.mode === 'AUTO-AIM' ? CYAN : AMBER);
  c.font = '700 17px ui-monospace, Menlo, monospace';
  c.fillText(m.mode, 78, 168);

  // tagline: the whole pitch, so a stranger understands the game from the image
  c.fillStyle = 'rgba(160,190,215,0.85)';
  c.font = '400 19px ui-monospace, Menlo, monospace';
  c.fillText('your health bar is the magazine', 78, 200);

  // ---- the hero number ----
  // Right-aligned block, huge, with a glow. This is the thing that gets read while
  // someone is scrolling past at speed.
  c.textAlign = 'right';
  c.shadowColor = m.siege ? GREEN : INK;
  c.shadowBlur = 46;
  c.fillStyle = m.siege ? GREEN : INK;
  c.font = '800 190px ui-monospace, Menlo, monospace';
  c.fillText(m.hero.value, CARD_W - 78, 296);
  c.shadowBlur = 0;

  c.fillStyle = m.siege ? 'rgba(125,255,178,0.95)' : 'rgba(234,252,255,0.9)';
  c.font = '800 30px ui-monospace, Menlo, monospace';
  c.fillText(m.hero.label, CARD_W - 78, 342);

  c.fillStyle = DIM;
  c.font = '700 19px ui-monospace, Menlo, monospace';
  c.fillText(m.hero.unit, CARD_W - 78, 374);

  // ---- stat row ----
  const rowY = 448;
  c.font = '700 13px ui-monospace, Menlo, monospace';
  const colW = 168;
  m.stats.forEach(([k, v], i) => {
    const x = 78 + i * colW;
    c.textAlign = 'left';
    c.fillStyle = 'rgba(160,190,215,0.55)';
    c.fillText(k, x, rowY);
    c.fillStyle = INK;
    c.font = '800 27px ui-monospace, Menlo, monospace';
    c.fillText(v, x, rowY + 32);
    c.font = '700 13px ui-monospace, Menlo, monospace';
  });

  // ---- verdict ----
  c.textAlign = 'left';
  c.fillStyle = 'rgba(255,209,102,0.95)';
  c.font = 'italic 400 21px ui-monospace, Menlo, monospace';
  c.fillText(m.verdict, 78, 536);

  // ---- footer: only claims that are true ----
  c.fillStyle = 'rgba(140,170,200,0.6)';
  c.font = '400 15px ui-monospace, Menlo, monospace';
  c.fillText('free · browser · phone or PC · made with AI', 78, 578);

  // rank / beat-this line, right-aligned, and ONLY when it is real
  c.textAlign = 'right';
  if (m.beaten > 0) {
    c.fillStyle = 'rgba(125,255,178,0.95)';
    c.font = '800 17px ui-monospace, Menlo, monospace';
    c.fillText('NEW BEST · previous ' + m.beaten, CARD_W - 78, 530);
  } else if (m.rank > 1) {
    c.fillStyle = 'rgba(160,190,215,0.75)';
    c.font = '700 17px ui-monospace, Menlo, monospace';
    c.fillText('#' + m.rank + ' PERSONAL BEST', CARD_W - 78, 530);
  }

  // mode colour spine down the left edge — instant read of which mode this was
  c.fillStyle = m.siege ? GREEN : (m.mode === 'AUTO-AIM' ? CYAN : AMBER);
  c.fillRect(0, 0, 8, CARD_H);

  return cv;
}

export const SHARE_CARD_SIZE = { w: CARD_W, h: CARD_H };
