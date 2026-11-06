// OVERDRAFT — share card tests.
//
// The card is the only thing this game hands to the outside world, so it gets held
// to a higher standard than the rest: every number on it has to be true, and it has
// to render without a DOM. These tests run against @napi-rs/canvas when it is
// available and skip the pixel checks when it is not, so `npm test` still works on a
// machine with no native canvas.

import { cardModel, shareText, clockText, SHARE_CARD_SIZE } from '../src/share.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label); }
}

console.log('\n-- share card: the numbers must be true --');

const siegeRun = {
  siege: true, score: 22940, wave: 12, time: 196, kills: 301,
  weapon: 'ROCKET', rank: 1, previousBest: 21940,
};
const m1 = cardModel(siegeRun);
ok(m1.wave === 12, 'SIEGE card carries the wave the player reached');
ok(m1.time === 196, 'SIEGE card carries the real survival time');
ok(m1.hero.value === '12' && m1.hero.label === 'WAVE',
  'SIEGE leads with WAVE, which is what players compare');
ok(m1.hero.unit === 'SURVIVED 3:16', 'the survival time is shown under the wave');
ok(m1.stats[2][1] === 'ROCKET', 'the weapon the run actually ended on is on the card');

const campRun = {
  siege: false, score: 8420, level: 7, levelsCleared: 6, kills: 88,
  acc: 74, fireMode: 'manual', rank: 1, previousBest: 6100,
};
const m2 = cardModel(campRun);
ok(m2.mode === 'MARKSMAN', 'campaign card names the fire mode');
ok(m2.hero.label === 'SCORE' && m2.hero.value === '8420',
  'campaign leads with the score');
ok(m2.acc === 74, 'accuracy is carried through untouched');
ok(cardModel({ ...campRun, fireMode: 'assisted' }).mode === 'AUTO-AIM',
  'AUTO-AIM runs are labelled AUTO-AIM');

console.log('\n-- share card: never boast about something that is not true --');
ok(cardModel({ ...campRun, rank: 3, previousBest: 0 }).beaten === 0,
  'no "previous best" line unless this run actually took the top spot');
ok(cardModel({ ...siegeRun, rank: 1, previousBest: 0 }).beaten === 0,
  'a first-ever run cannot claim to have beaten anything');
ok(cardModel({ ...siegeRun, rank: 1, previousBest: 21940 }).beaten === 21940,
  'a real new best does show the previous score');
ok(cardModel({ ...siegeRun, rank: 4 }).rank === 4,
  'a non-best run carries its rank so the card can show it');

console.log('\n-- share card: hostile input --');
{
  const z = cardModel({});
  ok(z.score === 0 && z.wave === 0 && z.time === 0, 'an empty run does not produce NaN');
  ok(Number.isFinite(z.level) && z.level >= 1, 'level falls back to 1');
  const weird = cardModel({ score: -500, acc: 999, time: -3, wave: -9, rank: 0 });
  ok(weird.score === 0, 'a negative score is clamped to 0');
  ok(weird.acc === 100, 'accuracy is clamped to 100');
  ok(weird.time === 0 && weird.wave === 0, 'negative times and waves are clamped');
}

console.log('\n-- share card: the caption reads like a sentence --');
{
  const t = shareText(siegeRun);
  ok(t.includes('wave 12') && t.includes('3:16'), 'SIEGE caption states the wave and the time');
  ok(t.includes('Personal best'), 'a new best is mentioned in the caption');
  ok(!shareText({ ...siegeRun, rank: 3 }).includes('Personal best'),
    'a non-best caption makes no such claim');
  ok(shareText(campRun).includes('8420') && shareText(campRun).includes('74%'),
    'campaign caption states score and accuracy');
  ok(clockText(0) === '0:00' && clockText(65) === '1:05' && clockText(196) === '3:16',
    'clock formatting is mm:ss');
}

console.log('\n-- share card: renders to pixels --');
{
  let createCanvas = null;
  try { ({ createCanvas } = await import('@napi-rs/canvas')); } catch { /* not installed */ }
  if (!createCanvas) {
    console.log('SKIP  pixel checks (install @napi-rs/canvas to run them)');
  } else {
    const { drawCard } = await import('../src/share.js');
    const make = (w, h) => createCanvas(w, h);
    const cv = drawCard(siegeRun, make);
    ok(cv.width === SHARE_CARD_SIZE.w && cv.height === SHARE_CARD_SIZE.h,
      `card is ${SHARE_CARD_SIZE.w}x${SHARE_CARD_SIZE.h} (wide social size)`);

    // the card must not be blank: count pixels that are not the background
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 330) bright++;
    }
    ok(bright > 20000, `card has real content on it (${bright} lit pixels)`);

    const cv2 = drawCard(campRun, make);
    ok(cv2.width === SHARE_CARD_SIZE.w, 'campaign card renders too');
    // both modes must look different, or the mode is not legible from the image
    const d1 = cv.getContext('2d').getImageData(0, 300, 4, 1).data;
    const d2 = cv2.getContext('2d').getImageData(0, 300, 4, 1).data;
    ok(d1[0] !== d2[0] || d1[1] !== d2[1] || d1[2] !== d2[2],
      'the mode spine colour differs between SIEGE and MARKSMAN');
  }
}

console.log(`\n${fail ? 'SHARE CARD: ' + fail + ' CHECK(S) FAILED' : 'SHARE CARD OK'}`);
console.log(`(${pass} checks passed)`);
process.exit(fail ? 1 : 0);
