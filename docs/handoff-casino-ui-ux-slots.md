# Handoff: Shrine Slots animation pass

You are improving the look and feel of **Shrine Slots**, one of the six
games in the Shell Smash gambling den ("Shell's Gambit"): **Fortune Wheel,
Shell Flip, Three-Shell Monte, Shrine Slots, Koi Dice, Shell Drop** — all
server-authoritative, provably fair, sharing one wager engine. The economy,
math and backend are **not in scope**. This is presentation-layer work only:
how an already-resolved spin is *shown* to the player.

Shell Drop (Plinko) already went through this same treatment and was
approved — it's your quality bar and, more usefully, your toolkit. A
brainstorm already happened with the person you're working with to decide
the direction for all five remaining games; you don't need to re-run that
brainstorm for Slots, but you do need to **restate the plan below back to
them in your own words and get an explicit go-ahead before writing code**.
If anything here seems to call for a bigger change than described (new
backend fields, new dependencies), that's a scope change — name it and ask,
don't just do it.

---

## 1. Non-negotiables — true for every game in this den

- **The animation is purely cosmetic.** `POST /casino/slots` returns the
  complete `SpinResolution` synchronously — outcome, payout, new balance,
  provably-fair reveal — before any animation starts. You are only choosing
  *how* to visually delay showing an already-known result. Nothing you build
  can make the outcome depend on the animation or vice versa. Every reel's
  final symbol is already known the instant the response comes back — no
  reel "decides" anything as it spins.
- **Provably fair must keep working.** The modal's "Verify this spin" button
  calls `verifySlots` (`frontend/src/components/casino/fairness.ts`), which
  recomputes each reel roll from the revealed seeds and checks it against
  the server. Don't change that contract; the fairness panel must keep
  rendering exactly as it does today.
- **`prefers-reduced-motion` must be respected**, checked before the
  animation starts, short-circuiting straight to the resolved reels. Use the
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

If you drive the reels with a `useEffect` keyed on some "pending outcome"
state (the pattern Shell Drop uses — see §3), **do not put `onCoinsChange` in
that effect's dependency array.** `HomePage.tsx` passes it as a fresh inline
closure on every render (`onCoinsChange={(coins) => setPlayer(...)}`, not
memoized). If it's a dependency, any unrelated re-render of the hub page
tears down and restarts your `requestAnimationFrame` loop mid-spin — this
exact bug shipped in Shell Drop's first pass and looked like the shell token
"glitching" and never finishing its drop. Fix used there: mirror
`onCoinsChange` (and any other prop/state the effect reads but shouldn't
restart on) into a `useRef`, updated by its own tiny effect, and key the
animation effect only on the thing that should actually restart it (there,
`pendingOutcome`; here, whatever pending-spin state you introduce).

---

## 2. Shared toolkit already prepared for you

These were built while doing Shell Drop's pass and are ready to use — please
don't modify them (read-only; other agents depend on them staying stable
while working in parallel). If one seems to be missing something you need,
say so rather than editing it yourself.

| File | What it gives you |
|---|---|
| `frontend/src/components/casino/board-canvas.ts` | `setupCanvas` (DPR-aware canvas sizing — you'll want this for the reel strips); `lerp`, `easeInQuad`, `easeOutQuad`, **`easeOutCubic`** (a smooth, weighted deceleration — good fit for a reel coasting to a stop), `easeInOutCubic`, `easeOutBack`, `easeOutBounce`; `BoardStep`/`runBoardAnimation` — a generic `requestAnimationFrame` scheduler that steps through timed segments and calls your `onFrame(data, linearProgress, stepIndex)` each frame. |
| `frontend/src/components/casino/useReducedMotion.ts` | `useReducedMotion()` — reactive hook wrapping the `prefers-reduced-motion` media query. Use this instead of a one-off check. |

Nothing pre-built exists for "reel strip" scroll-position maths — that's
domain logic specific to this game (like `pegLattice`/`computeDropPath` were
specific to Plinko), so it belongs in `slots.ts` alongside the existing
`selectSymbolFrom`/`reelSymbols`/`slotGlyph`, not in the shared files above.

---

## 3. Where everything lives

| File | Relevance |
|---|---|
| `frontend/src/components/casino/ShrineSlotsModal.tsx` | The modal you're changing. Currently: each `.hub-slots__reel` just flickers a spinning-slot-machine emoji (`🎰`) in place via a CSS `is-spinning` class for `SPIN_DURATION_MS` (1500ms), all three reels perfectly in sync, then a single `setTimeout` reveals all three final symbols at once via `slotGlyph(id)`. No real reel strip, no independent per-reel timing. |
| `frontend/src/components/casino/slots.ts` | Pure logic mirror: `selectSymbolFrom(symbols, roll)`, `slotsOutcomeId(symbolIds)`, `reelSymbols(symbols, rolls)`, `slotGlyph(id)` (emoji per symbol id — `dragon`, `lantern`, `koi`, `bamboo`, `bell`, `shell`). No React/DOM — reuse, don't duplicate. Add any new reel-strip-position maths here. |
| `frontend/src/components/casino/fairness.ts` | `verifySlots(result, symbols)` — don't break this contract. |
| `frontend/src/features/hub/api.ts` | `SlotsView` (`symbols: SlotSymbolView[]` — each with `id`, `label`, `weight`, `probability`, `payout`; `reelCount`, `rtp`, `minWager`, `maxWager`, `coins`), `api.getSlots()`, `api.spinSlots(stake, clientSeed?)`. `SpinResolution.outcomeId` is pipe-joined symbol ids, e.g. `"bell|bell|bell"` — the modal already has `reelsFromOutcome(outcomeId)` to parse it. `result.fairness.rolls` has one roll per reel (`rolls.length === reelCount`). |
| `frontend/src/styles/global.css` | Search `/* ── Shrine Slots ── */` for the current `.hub-slots__*` block: `.hub-slots__reels` (flex row), `.hub-slots__reel` (72×84px, `overflow: hidden`), `.hub-slots__symbol` (2.4rem emoji), `.hub-slots__reel.is-spinning .hub-slots__symbol` → `hub-slots-spin` keyframe (a small in-place `translateY` jitter, not a real scroll). |
| `frontend/src/pages/HomePage.tsx` | Renders `<ShrineSlotsModal coins={...} onCoinsChange={(coins) => setPlayer(...)} />` inside its `activeModal === "slots"` block — this is the un-memoized `onCoinsChange` closure mentioned above. |
| `frontend/src/components/casino/ShellDropModal.tsx` + `docs/handoff-casino-ui-ux-plinko.md` | Reference implementation: how a resolved outcome is held back (`pendingOutcome` state) until a `requestAnimationFrame`-driven canvas animation finishes, then revealed via `setResult`/`onCoinsChange`. Copy the *shape* of this pattern for your own canvas-driven reels. |

---

## 4. The decided direction: vertical reel strips, staggered stop

The person chose a **staggered left-to-right stop** over all-reels-together
— reel 1 stops, then reel 2, then reel 3, the way real slot machines build
suspense (especially valuable for near-miss moments, e.g. two matching
symbols locking in before the third reveals a miss).

- **Tech approach: canvas**, per the "match complexity to each game"
  decision — independent per-reel scroll position and deceleration timing is
  exactly what `board-canvas.ts`'s `runBoardAnimation` was built for. A
  single `<canvas>` spanning all `reelCount` reels (rather than one per
  reel) is likely the simplest way to keep the stagger timing centrally
  coordinated, but that's your call.
- **Build each reel as a scrolling vertical strip** of symbol glyphs
  (`slotGlyph(id)` for each of `view.symbols`), long enough that it visibly
  spins through several full loops of the symbol set before landing — the
  classic construction is: repeat the full symbol set some number of times,
  then append the target symbol (from `reelsFromOutcome(result.outcomeId)`)
  at the very end of the strip, and animate the strip's vertical offset so
  it decelerates (`easeOutCubic` is a good starting curve) and lands exactly
  with the target symbol centered in the reel window.
- **Stagger the reels**: give each reel a later start-of-deceleration (or a
  longer total spin duration) than the one before it — something like a
  250–400ms offset between reels is a reasonable starting point, tune by
  feel. All three reels can start spinning at the same instant; it's the
  *stopping* that staggers.
- **Duration**: today's placeholder is 1500ms for all reels simultaneously;
  with staggering, expect the *last* reel to land somewhat later than that —
  something in the 1.8–2.4s range for the last reel to settle is a
  reasonable target, tune by feel.
- Once all three reels have landed, everything else (the result text, the
  paytable `<details>`, the fairness panel) stays exactly as it is today.

---

## 5. Suggested working process

1. Restate this plan back to the person in a few sentences and get a nod
   before coding.
2. Keep the modal's external contract identical: `{ coins, onCoinsChange }`
   props, same API call.
3. Build `prefers-reduced-motion` handling in from the start via
   `useReducedMotion()`, not as an afterthought.
4. Keep any new reel-strip-position maths in `slots.ts`, framework-free, and
   sanity-check it with a throwaway Node script the way `drop-path.ts` and
   `shuffle.ts` were checked against known invariants during Plinko's pass —
   in particular, verify that whatever strip-offset formula you use always
   lands each reel exactly on `reelsFromOutcome(result.outcomeId)[reelIndex]`,
   for every symbol and every reel, not just the cases you happen to eyeball.
5. There is no frontend test runner exercising this area. Verify visually —
   browser tools/screenshots if available, and/or ask the person to run
   `make rebuild-front` and click through it locally, ideally spinning enough
   times to see a three-of-a-kind win, a near-miss, and a clean loss. Don't
   declare this done without having seen it render.
6. Before wrapping up, confirm: the Verify button still passes; every reel's
   landed symbol always matches `reelsFromOutcome(result.outcomeId)` exactly;
   reduced motion short-circuits correctly; the other five games'
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
