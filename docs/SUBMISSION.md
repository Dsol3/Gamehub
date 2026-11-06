# Submission — Loadout Protocol AI Game Competition

**Deadline:** 6 Nov 2026, 15:00 UTC (16:00 Lagos)
**Play:** https://github.com/Dsol3/Gamehub — `docs/index.html` is a single self-contained
file with zero dependencies; it runs from a `file://` path, a static host, or the
included `serve.py`.
**Clip:** `docs/overdraft-gameplay.mp4` — 87s, 1280x720, 30fps, captured from the real
renderer (not a mock-up).

---

## The idea

**OVERDRAFT — your health bar is the magazine.**

Every shot is paid for out of your own PULSE. A hit costs 1, a kill pays 2, and a miss
bounces off the wall and comes back at you. So accuracy is not a score multiplier, it is
your ammunition supply: the worse you shoot, the faster you die. At zero the bar turns
red and you keep playing **in overdraft**, below zero, until something kills you.

That single rule generates the rest:

| Mode | What changes | Why it exists |
|---|---|---|
| **MARKSMAN** | You aim. 1 per shot, 3 back per kill. Misses ricochet. | The pure version of the idea. Aiming pays best — measured +2 net per hit. |
| **AUTO-AIM** | The gun aims itself. 1 per shot, 2 back per kill. | Same idea, one crutch, one tax. Loses to a good aim and is the only mode that survives a bad one (0/30 clear rate at 8° of aim error vs 4/30). |
| **SIEGE** | Endless. The gun aims *and* fires; enemies evolve every 10s, you evolve every 20s. | Health-as-ammo needs the player to choose when to spend. A gun that fires itself cannot choose, so SIEGE drops the ammo rule, keeps PULSE as pure health, and becomes a survival game instead. |

Nine campaign levels, each teaching one rule: ricochet, leading a mover, body-checking,
armour, a shot budget, and finally surviving 12 seconds in overdraft to win.

## Solo, and honest about it

Everything — sim, renderer, layout, audio, tests, the build — is hand-written ES modules
with no frameworks and no assets: 179 KB in one HTML file. Art is drawn procedurally on a
2D canvas, so there is nothing to load and nothing to break. 11 test suites and 42 audit
checks run headless against the real simulation, which is what makes it safe to change
balance numbers late.

## What "done" meant

The last three rounds were almost entirely *finding things that were wrong*, not adding:

- Level 3 **cleared itself** with no input, because the ram rule counted any contact.
- Level 6 was **unwinnable on a phone** — spawn density was fixed per level rather than
  per arena area, so a phone faced three times the crowding.
- Level 7's win condition was **dead content**: the floor was −3, so 12 seconds of
  overdraft was unsurvivable, and a live kill quota meant every clear happened the
  ordinary way. It could also dead-end: the clock only ticked below zero, so healing up
  left a level with no reachable win.
- Tab cycled into a **deleted mode**, so the HUD told you that you were in TURRET while
  the simulation ran MARKSMAN.
- The README claimed PULSE "slowly regenerates". It does not, and never did.
- SIEGE looked hard but was unlosable: a dodging bot survived the whole 900-second cap
  at wave 29-31, and took 11 damage across a 300-second run. The cause was that
  **kills healed you** — hundreds of kills paid back hundreds of PULSE, so the ring
  could never close.

Every number in this repo was measured by driving the real `step()`/`stepSiege()`, not
estimated from reading the code.

## The result

- 9 levels x 2 modes x 3 seeds x desktop **and** phone: every combination clearable.
- SIEGE: a player who never moves reaches wave 5; one who dodges bodies and bullets
  reaches wave 7 (52s vs 113s average). Moving is the mechanic.
- 42/42 audit checks, 11/11 suites.
