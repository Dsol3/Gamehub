# Loadout AI Game Competition — what actually wins, and the 1-day plan

Research compiled 5 Nov 2026, ~28 hours before the 6 Nov 15:00 UTC deadline.
Everything here is from the competition page and observed jam-winner patterns.

---

## 1. The hard facts

| | |
|---|---|
| Host | Loadout (`@loadoutprotocol`) — Solana game-funding launchpad, from the Illuvium founders |
| Prize pool | $5,000 — 1st $2,500 / 2nd $1,500 / 3rd $1,000, paid in **USDC on Solana** |
| Closes | **6 Nov 2026, 15:00 UTC** |
| Entry | Post a **public X clip, 15+ seconds, real gameplay, tagging @loadoutprotocol** → then submit the post link + form at `app.loadout.xyz/jam` |
| Eligibility | 18+, authorised to submit, **one entry per person**, existing/released games welcome |
| Judging | **Gameplay potential 40% · Originality 25% · Execution 20% · Development plan 15%** |

The three things people get wrong:

1. **Likes do not count.** Judges state plainly that likes and token-launch interest
   don't affect scoring. Don't burn hours on X engagement.
2. **No token needed.** Token launch is optional and explicitly does not affect judging.
   If anyone tells you to launch a coin to win, they're wrong.
3. **Concept trailers don't qualify.** It must be *actual game footage*. A real build,
   running, filmed.

---

## 2. What wins these things (observed patterns)

Across the winners of comparable AI-game jams — Vibe Jam 2026 ($25k, capybara delivery
game), VibeBlitz (Idle Tactics: Ascension), the AI Browser Game Jams, and the HPP AI Jam —
the same five signals show up every time:

**a) One legible mechanic, not a big world.**
Every winner can be explained in one sentence. "Capybaras deliver food on scooters."
"Idle auto-battler where you manage gear, not clicks." Judges watch dozens of entries
in one sitting; if they can't state your hook after 5 seconds, you're out.

**b) Instant load, browser-based.**
Every single winner was playable with zero install. Judges are clicking dozens of links
in a chat window. A download or a build step is a disqualification in practice.

**c) It must feel *juicy* in 15 seconds.**
Screen shake, hit-stop, particles, sound, numbers popping off. Winners were
overwhelmingly "juicy" first and deep second. Polish is what 20% execution buys.

**d) Originality that is structural, not cosmetic.**
The "most original" awards went to games whose *rule* was novel (a death-preview
platformer, an ASCII Antarctic descent), not games with novel art.

**e) A visible development plan.**
Judges give weight to "can this become a real game." Winners' pages almost always had a
roadmap, a repo, and a clear next step. This is the cheapest 15% on the table.

**What loses:** generic random-defence / tower-defence / survivor clones, "AI made my
art" showcases with no rule, anything that needs 3 minutes of explanation, and polished
trailers that hide the fact there's no game underneath.

---

## 3. The idea to build

### OVERDRAFT — *your health bar is the magazine*

> A top-down arena shooter where every bullet is paid for with your own HP.
> Every kill repays it. Miss enough and you die of your own trigger finger.

**Why this one, specifically for this competition:**

- **Fits 40% "gameplay potential".** The pulse economy is a tuning surface, not a
  one-trick gimmick. More enemies, more expensive shots, rarer refunds — it scales.
- **Fits 25% "originality".** Shooters are the most saturated genre in AI jams; the
  *rule* here is genuinely rare. It is not a visual reskin of Vampire Survivors.
- **Fits 20% "execution".** This is the killer: the mechanic is **legible in under two
  seconds of silent footage**. A viewer sees the HP bar drop as the gun fires and jump
  back on a kill. No narration needed. That is exactly what a 15-second clip needs.
- **Fits 15% "development plan".** Weapons that price shots differently, a boss that can
  only be killed while solvent, debt-spiral multipliers. Deep, obvious roadmap.
- **It is honest about scope.** One arena, four enemies, six augments. Nothing pretends
  to be an open world.

**The clip writes itself:** start with a full bar, fire seven shots into a crowd,
the bar goes red and reads OVERDRAFT, a kill refund pops +3 in gold, the bar climbs,
then a brute knocks you to the floor. Fifteen seconds, one story, no words needed.

---

## 4. Can it be finished in one day? Realistically.

**Yes — but only in the shape above, and only if "finished" means finished.**

The honest breakdown for a solo dev with AI tooling, ~10 usable hours:

| Hours | Work | Risk |
|---|---|---|
| 0–1 | Scope lock: one arena, one rule, four enemies. No new ideas past this point. | **High** — scope creep is the #1 killer |
| 1–3 | Simulation + the PULSE economy + the "OVERDRAFT" state | Low |
| 3–5 | Renderer, juice (shake, hit-stop, particles), HUD that teaches the rule | Medium |
| 5–6 | Audio synthesis, waves, augments, death screen | Low |
| 6–7 | Mobile touch controls + responsive framing | **Medium-high** — always underestimated |
| 7–8 | Playtest, balance pass, fix the one thing that feels bad | Medium |
| 8–9 | Record the clip, submit the form, write the pitch line | Low |
| 9–10 | Buffer | — |

**What genuinely cannot be done in a day**, and you should not try:

- A 3D world (Three.js scene, assets, lighting, camera) — that's 3–5 days minimum.
- Multiplayer of any kind.
- A real art pipeline (sprites, animation, tilesets).
- Anything with a story, dialogue, NPCs, or a quest structure.
- A Steam/itch page, a trailer edit, a Discord, a community.

**The realistic outcome**, if you're honest with yourself: you get to the top ~20% by
having a *finished, instant-loading, juicy game with a novel rule*, which is where a
$2,500 prize becomes plausible. You do not get there by having the most content —
you get there by being the entry the judge remembers and can describe to a colleague.

Judge criteria weight originality + gameplay potential at **65%**. A small game with one
great rule beats a big game with six average ones. That is the entire strategy.

---

## 5. Submission checklist

- [ ] Game runs from a public link, zero install, on a phone and a desktop
- [ ] 15+ seconds of **live gameplay footage** (not a concept trailer)
- [ ] Clip posted publicly on X, **tagging @loadoutprotocol in the post body**
- [ ] Form filled at `app.loadout.xyz/jam` with the X post link
- [ ] Game title: `OVERDRAFT`
- [ ] One-line pitch: *"Your health bar is your ammo. Every shot costs PULSE, every kill repays it — and you can borrow past zero."* (106/120 chars)
- [ ] "How did you use AI?" answered concretely (design, code, audio synthesis, balance testing)
- [ ] Development stage: **Playable demo**
- [ ] Project page / repo link ready
- [ ] Submitted **before 6 Nov 15:00 UTC** — that's 16:00 your time (Lagos)

**One entry per person.** Submit the best thing you have, not two things.

---

## 6. What to do in the next hour

1. Play the build (`dist/overdraft.html` or `npm start`). If the rule doesn't land in
   the first 10 seconds, tell me and I'll retune it — that's the highest-leverage change.
2. Record 20–25 seconds with `?demo=1&autostart=1` (the bot plays so the screen is
   never idle, and it's honestly labelled). Trim to the best 15–18 seconds.
3. Deploy `dist/overdraft.html` anywhere static (Vercel drop, GitHub Pages, Netlify) and
   put the link in the "Steam or project page" field.
4. Post the clip, tag, submit. Don't polish further — submit.

The gap between 1st and not-place is usually not quality. It's whether the entry got
submitted with a clip that showed the game.
