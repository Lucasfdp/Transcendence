# Handoff: Koi Dice animation pass

You are improving the look and feel of **Koi Dice**, one of the six games in
the Shell Smash gambling den ("Shell's Gambit"): **Fortune Wheel, Shell
Flip, Three-Shell Monte, Shrine Slots, Koi Dice, Shell Drop** — all
server-authoritative, provably fair, sharing one wager engine. The economy,
math and backend are **not in scope**. This is presentation-layer work only:
how an already-resolved roll is *shown* to the player.

Shell Drop (Plinko) already went through this same treatment and was
approved — it's your quality bar and, more usefully, your toolkit. A
brainstorm already happened with the person you're working with to decide
the direction for all five remaining games; you don't need to re-run that
brainstorm for Dice, but you do need to **restate the plan below back to
them in your own words and get an explicit go-ahead before writing code**.
If anything here seems to call for a bigger change than described (new
backend fields, new dependencies), that's a scope change — name it and ask,
don't just do it.

---

## 1. Non-negotiables — true for every game in this den

- **The animation is purely cosmetic.** `POST /casino/dice` returns the
  complete `SpinResolution` synchronously — outcome, payout, new balance,
  provably-fair reveal — before any animation starts. You are only choosing
  *how* to visually delay showing an already-known result. Nothing you build
  can make the outcome depend on the animation or vice versa.
- **Provably fair must keep working.** The modal's "Verify this roll" button
  calls `verifyDice` (`frontend/src/components/casino/fairness.ts`), which
  recomputes the roll from the revealed seeds and checks it against the
  server. Don't change that contract; the fairness panel must keep
  rendering exactly as it does today.
- **`prefers-reduced-motion` must be respected**, checked before the
  animation starts, short-circuiting straight to the resolved value. Use the
  shared `useReducedMotion()` hook (see §2) rather than a one-off
  `matchMedia` check.
- **No backend changes without an explicit go-ahead.**
- **Don't touch the other five games.** Their modals, their `.hub-*` CSS
  blocks, and the shared engine files below are off-limits except to *read*.
  Several agents are working on the other four games in parallel right now
  — editing a shared file is how two agents' work collides.
- **House style** (from this repo's `CLAUDE.md`): tabs; explicit return
  types; no magic numbers (named constants); no dead/commented-out code; run
  `npx tsc --noEmit` before calling anything done. Reply to the person in
  whatever language they're using.

### A pitfall already hit once this session — read this before you write an effect

If you drive the roll with a `useEffect` keyed on some "pending outcome"
state (the pattern Shell Drop uses — see §3), **do not put `onCoinsChange` in
that effect's dependency array.** `HomePage.tsx` passes it as a fresh inline
closure on every render (`onCoinsChange={(coins) => setPlayer(...)}`, not
memoized). If it's a dependency, any unrelated re-render of the hub page
tears down and restarts your `requestAnimationFrame` loop mid-roll — this
exact bug shipped in Shell Drop's first pass and looked like the shell token
"glitching" and never finishing its drop. Fix used there: mirror
`onCoinsChange` (and any other prop/state the effect reads but shouldn't
restart on) into a `useRef`, updated by its own tiny effect, and key the
animation effect only on the thing that should actually restart it (there,
`pendingOutcome`; here, whatever pending-roll state you introduce).

---

## 2. Shared toolkit already prepared for you

These were built while doing Shell Drop's pass and are ready to use — please
don't modify them (read-only; other agents depend on them staying stable
while working in parallel). If one seems to be missing something you need,
say so rather than editing it yourself.

| File | What it gives you |
|---|---|
| `frontend/src/components/casino/board-canvas.ts` | `lerp`, `easeInQuad`, `easeOutQuad`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack`, `easeOutBounce`; `BoardStep`/`runBoardAnimation` — a generic `requestAnimationFrame` scheduler that steps through timed segments and calls your `onFrame(data, linearProgress, stepIndex)` each frame. **You almost certainly don't need `setupCanvas`/`<canvas>` for this game** — a digit odometer and a track marker are both just DOM elements animated frame-by-frame via `style.transform`/`style.left`. |
| `frontend/src/components/casino/useReducedMotion.ts` | `useReducedMotion()` — reactive hook wrapping the `prefers-reduced-motion` media query. Use this instead of a one-off check. |

---

## 3. Where everything lives

| File | Relevance |
|---|---|
| `frontend/src/components/casino/KoiDiceModal.tsx` | The modal you're changing. Currently: `.hub-dice__readout` shows a literal `"?"` while `is-rolling` (a small CSS `translateY`/opacity jitter, `ROLL_DURATION_MS` = 1200ms), then hard-snaps to the resolved number. Separately, `.hub-dice__track` already renders a 0–99 win-chance bar with a `.hub-dice__track-marker` positioned at the player's chosen `target` — but nothing currently marks *where the roll landed* on that track. |
| `frontend/src/components/casino/dice.ts` | Pure logic mirror: `DICE_RANGE` (100), `DICE_MAX_VALUE` (99), `diceValue(roll)`, `diceOutcomeId(value)`, `diceWinningOutcomes`, `diceWin`, `diceMultiplier`, `diceWinChance`. No React/DOM — reuse, don't duplicate. |
| `frontend/src/components/casino/fairness.ts` | `verifyDice(result, direction, target)` — don't break this contract. |
| `frontend/src/features/hub/api.ts` | `DiceConfig` (`range`, `minTargetUnder`/`maxTargetUnder`, `minTargetOver`/`maxTargetOver`, `minWager`, `maxWager`, `coins`), `api.getDice()`, `api.dice(stake, direction, target, clientSeed?)`. `SpinResolution.outcomeId` is `"roll-<value>"` — the modal already has `valueFromOutcome(outcomeId)` to parse it. |
| `frontend/src/styles/global.css` | Search `/* ── Koi Dice ── */` for the current `.hub-dice__*` block: `.hub-dice__readout` (96×96px box), `.hub-dice__readout.is-rolling .hub-dice__readout-value` → `hub-dice-roll` keyframe (a tiny in-place jitter, not a real roll); `.hub-dice__track`/`.hub-dice__track-fill`/`.hub-dice__track-marker` (the existing win-chance bar and target marker — you're adding a *second* marker for the landed value, not replacing this one). |
| `frontend/src/pages/HomePage.tsx` | Renders `<KoiDiceModal coins={...} onCoinsChange={(coins) => setPlayer(...)} />` inside its `activeModal === "dice"` block — this is the un-memoized `onCoinsChange` closure mentioned above. |
| `frontend/src/components/casino/ShellDropModal.tsx` + `docs/handoff-casino-ui-ux-plinko.md` | Reference implementation: how a resolved outcome is held back (`pendingOutcome` state) until a `requestAnimationFrame`-driven animation finishes, then revealed via `setResult`/`onCoinsChange`. Copy the *shape* of this pattern. |

---

## 4. The decided direction: odometer + track marker, combined

The person was shown three options (odometer-only, track-marker-only, or
both) as a live mockup and picked **both, combined** — driven by the same
single `result.fairness.roll` / landed value, so the two pieces can't fall
out of sync with each other.

- **Odometer digit roll (in `.hub-dice__readout`)**: build a vertical strip
  of two-digit numbers (a handful of "spin-through" values ending on the
  actual landed value), and animate the strip's vertical offset with
  `runBoardAnimation` + an easing curve that decelerates into the final
  value (`easeOutCubic` or `easeOutBounce` for a little settle-bounce at the
  end) — same construction idea as an odometer or a slot reel, just for a
  single readout instead of three reels. `overflow: hidden` on the readout
  box (already present) clips the strip to one visible row.
- **Track marker (in `.hub-dice__track`)**: add a new marker element
  (distinct from the existing target marker) that slides from one end of
  the track to its landed position — `left: ${landedValue}%` of the
  0–99-wide track — with the same kind of decelerating/bouncing easing.
  Since the track already visually encodes win/lose zones via
  `track-fill`, watching the marker slide in and land inside or outside the
  filled region *is* the win/lose reveal — no extra UI needed for that.
- **Keep both in sync trivially**: both are driven from the exact same
  `landedValue` (`valueFromOutcome(result.outcomeId)`), so there's no
  separate "sync" logic to write — just don't let one branch start
  animating before the other.
- **Duration**: today's placeholder is 1200ms; something in the 1.5–1.8s
  range gives both pieces enough time to read clearly without dragging —
  tune by feel, this isn't a hard number from the brainstorm.

---

## 5. Suggested working process

1. Restate this plan back to the person in a few sentences and get a nod
   before coding.
2. Keep the modal's external contract identical: `{ coins, onCoinsChange }`
   props, same API call, same direction/target controls.
3. Build `prefers-reduced-motion` handling in from the start via
   `useReducedMotion()`, not as an afterthought.
4. If you introduce new pure logic (e.g. odometer strip construction), keep
   it in a plain `.ts` file (`dice.ts` is the natural home), framework-free,
   and sanity-check it with a throwaway Node script the way `drop-path.ts`
   and `shuffle.ts` were checked against known invariants during Plinko's
   pass.
5. There is no frontend test runner exercising this area. Verify visually —
   browser tools/screenshots if available, and/or ask the person to run
   `make rebuild-front` and click through it locally, trying both "under"
   and "over" directions and a few different targets. Don't declare this
   done without having seen it render.
6. Before wrapping up, confirm: the Verify button still passes; both the
   odometer and the track marker always land on `valueFromOutcome(result.outcomeId)`
   exactly; reduced motion short-circuits correctly; the other five games'
   CSS/modals are untouched; `npx tsc --noEmit` is clean.
7. After this ships and is approved, don't move on to another game's
   animation — a separate agent is handling each of the other four in
   parallel.

---

## 6. House reminders (from this repo's `CLAUDE.md`)

- Reply to the person in whatever language they're using.
- Any new project document goes in `docs/`.
- After frontend changes, the person needs `make restart-front` or
  `make rebuild-front` (not a raw restart) to see them — mention this rather
  than assuming it's automatic.
- Keep commits short and concrete, one idea per commit.
- Don't expand functional scope beyond what's described here — if the work
  drifts into new game mechanics, new backend fields, or new dependencies,
  that's a scope change worth naming out loud before proceeding.
