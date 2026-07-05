# Handoff: Three-Shell Monte animation pass

You are improving the look and feel of **Three-Shell Monte**, one of the six
games in the Shell Smash gambling den ("Shell's Gambit"): **Fortune Wheel,
Shell Flip, Three-Shell Monte, Shrine Slots, Koi Dice, Shell Drop** — all
server-authoritative, provably fair, sharing one wager engine. The economy,
math and backend are **not in scope**. This is presentation-layer work only:
how an already-resolved guess is *shown* to the player.

Shell Drop (Plinko) already went through this same treatment and was
approved — it's your quality bar and, more usefully, your toolkit. A
brainstorm already happened with the person you're working with to decide
the direction for all five remaining games; you don't need to re-run that
brainstorm for Monte, but you do need to **restate the plan below back to
them in your own words and get an explicit go-ahead before writing code**.
If anything here seems to call for a bigger change than described (new
backend fields, new dependencies, changing *when* the player picks a shell),
that's a scope change — name it and ask, don't just do it.

---

## 1. Non-negotiables — true for every game in this den

- **The animation is purely cosmetic.** `POST /casino/monte` returns the
  complete `SpinResolution` synchronously — outcome, payout, new balance,
  provably-fair reveal — before any animation starts. You are only choosing
  *how* to visually delay showing an already-known result. Nothing you build
  can make the outcome depend on the animation or vice versa. **This
  includes the shuffle you're about to build** — see §4, this is the
  single most important thing to get right for this game.
- **Provably fair must keep working.** The modal's "Verify this guess"
  button calls `verifyMonte` (`frontend/src/components/casino/fairness.ts`),
  which recomputes the roll from the revealed seeds and checks it against
  the server. Don't change that contract; the fairness panel must keep
  rendering exactly as it does today.
- **`prefers-reduced-motion` must be respected**, checked before the
  animation starts, short-circuiting straight to the resolved reveal. Use
  the shared `useReducedMotion()` hook (see §2) rather than a one-off
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

If you drive the reveal with a `useEffect` keyed on some "pending outcome"
state (the pattern Shell Drop uses — see §3), **do not put `onCoinsChange` in
that effect's dependency array.** `HomePage.tsx` passes it as a fresh inline
closure on every render (`onCoinsChange={(coins) => setPlayer(...)}`, not
memoized). If it's a dependency, any unrelated re-render of the hub page
tears down and restarts your `requestAnimationFrame` loop mid-shuffle — this
exact bug shipped in Shell Drop's first pass and looked like the shell token
"glitching" and never finishing its drop. Fix used there: mirror
`onCoinsChange` (and any other prop/state the effect reads but shouldn't
restart on) into a `useRef`, updated by its own tiny effect, and key the
animation effect only on the thing that should actually restart it (there,
`pendingOutcome`; here, whatever pending-guess state you introduce).

---

## 2. Shared toolkit already prepared for you

These were built while doing Shell Drop's pass and are ready to use — please
don't modify them (read-only; other agents depend on them staying stable
while working in parallel). If one seems to be missing something you need,
say so rather than editing it yourself.

| File | What it gives you |
|---|---|
| `frontend/src/components/casino/board-canvas.ts` | `lerp`, `easeInQuad`, `easeOutQuad`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack`, `easeOutBounce`; `setupCanvas` (DPR-aware canvas sizing); `BoardStep`/`runBoardAnimation` — a generic `requestAnimationFrame` scheduler that steps through timed segments and calls your `onFrame(data, linearProgress, stepIndex)` each frame. This is the piece you'll lean on most — see §4. |
| `frontend/src/components/casino/shuffle.ts` | **Built specifically for this game.** Pure, cosmetic shuffle-choreography maths: `generateSwapSequence(count, swapCount, random?)`, `swapSnapshots(count, steps)`, `positionsAfterSwaps`, `finalPositionOfIdentity`. Read the doc comment at the top of the file carefully — it explains the identity-vs-slot-position model this game needs (see §4). Already sanity-checked (20,000 random sequences: always a valid permutation, no no-op swaps, identity tracking is internally consistent) — reuse it rather than re-deriving the permutation bookkeeping yourself. |
| `frontend/src/components/casino/useReducedMotion.ts` | `useReducedMotion()` — reactive hook wrapping the `prefers-reduced-motion` media query. Use this instead of a one-off check. |

---

## 3. Where everything lives

| File | Relevance |
|---|---|
| `frontend/src/components/casino/ThreeShellMonteModal.tsx` | The modal you're changing. Currently: the whole `.hub-monte__row` jitters left-right together for `REVEAL_DURATION_MS` (1500ms) via a CSS `is-shuffling` class — not a real shuffle, just a shake. The player picks a shell (`pick` state) *before* clicking "Guess", then a `setTimeout` reveals the result and highlights the winning shell + shows a pearl graphic under it. |
| `frontend/src/features/hub/api.ts` | `MonteConfig` (`shellOptions: number[]` — currently `[3, 4, 5]` shells, `defaultShells`, `rtp`, `minWager`, `maxWager`, `coins`), `api.getMonte()`, `api.monte(stake, pick, shells, clientSeed?)`. `SpinResolution.outcomeId` is `"shell-<n>"`; the modal already has `shellFromOutcome(outcomeId)` to parse it. |
| `frontend/src/components/casino/fairness.ts` | `verifyMonte(result, shells)` — don't break this contract; note it needs the shell count the guess was played with, which the modal already tracks (`playedShells` state). |
| `frontend/src/styles/global.css` | Search `/* ── Three-Shell Monte ── */` for the current `.hub-monte__*` block: `.hub-monte__row` (flex row, `is-shuffling` → `hub-monte-shuffle` keyframe, a simple `translateX` shake), `.hub-monte__shell` (72×84px button per shell), `.hub-monte__shell-face`, `.hub-monte__pearl` (revealed under the winning shell). |
| `frontend/src/pages/HomePage.tsx` | Renders `<ThreeShellMonteModal coins={...} onCoinsChange={(coins) => setPlayer(...)} />` inside its `activeModal === "monte"` block — this is the un-memoized `onCoinsChange` closure mentioned above. |
| `frontend/src/components/casino/ShellDropModal.tsx` + `docs/handoff-casino-ui-ux-plinko.md` | Reference implementation: how a resolved outcome is held back (`pendingOutcome` state) until a `requestAnimationFrame`-driven canvas animation finishes, then revealed via `setResult`/`onCoinsChange`. Copy the *shape* of this pattern for your own canvas-driven shuffle. |

---

## 4. The decided direction: a real shell-game shuffle

The person chose **real position swaps** (the classic shell-game illusion)
over the cheaper "shells stay put, just sell it with tilt/wobble" option —
they understood this is the more complex, higher-bookkeeping option and want
it anyway. Read this section carefully before writing code; it's the one
place in this handoff where getting the model wrong would create a subtle
but real bug (a shell landing in the wrong place, or a reveal that
contradicts `result.net`).

**The critical constraint: the player still picks *before* the shuffle, not
after.** Today's flow is pick a slot → click Guess → (currently) shake → reveal.
A "real" shell game is usually watch the dealer shuffle → *then* guess — but
changing *when* the pick happens would be a game-mechanics/UX-flow change,
not a presentation change, and is explicitly out of scope for this pass (flag
it to the person if you think it's worth doing later — don't just do it).
So: **the shuffle you're building is a cosmetic reveal-time flourish that
happens after the guess is already locked in and the server has already
resolved it**, using `shuffle.ts`:

1. The player picks slot `pick` (0..shells-1) and clicks Guess. At this
   instant, "identity" and "slot position" are the same thing — nothing has
   moved yet. So: `pickIdentity = pick`, and the pearl's identity is the
   server-resolved `winningShellIndex` (from `shellFromOutcome(outcomeId)`)
   — again, identity === slot at this instant, since resolution happens
   before any shuffling.
2. Once the outcome comes back, generate a purely cosmetic swap sequence:
   `generateSwapSequence(shells, swapCount)` — `swapCount` is your call
   (enough to feel like a real shuffle; something in the 6–10 range is a
   reasonable starting point, tune by feel).
3. Get `swapSnapshots(shells, steps)` — an array of "which identity is in
   which position" states, one per swap, starting with the identity state.
   Animate every shell smoothly moving to its new position at each snapshot
   transition (a `<canvas>`-drawn board, per the tech-approach decision for
   this game — see below).
4. At the end, `finalPositionOfIdentity(shells, steps, winningShellIndex)`
   tells you which position to reveal the pearl under, and
   `finalPositionOfIdentity(shells, steps, pickIdentity)` tells you which
   position the player's *original* pick physically ended up in — useful if
   you want to visually distinguish "the shell you clicked" from "the shell
   with the pearl" once the dust settles (a nice touch: if they're different
   positions, it visibly shows the player's shell got shuffled away from the
   pearl, or vice versa — but this is flavor, not something to overthink).
5. **`result.net` from the server is still the sole source of truth for
   win/loss** — don't derive win/loss from the shuffle positions yourselves;
   only use the shuffle to decide *where to draw things*.

**Tech approach: canvas**, per the "match complexity to each game" decision
— a multi-shell position-swap choreography is exactly the kind of thing
`board-canvas.ts`'s `runBoardAnimation` + easing was built for (see how
Shell Drop steps a single token through a known path; here you're stepping
`shells` tokens through a known sequence of position snapshots instead). Use
`easeOutQuad`/`easeOutCubic` for each swap's slide, and consider a small
`easeOutBounce`/`easeOutBack` settle on the very last snapshot before
revealing.

**Duration**: today's placeholder is 1500ms; something in the 1.8–2.2s range
is a reasonable target to let `swapCount` swaps read clearly without
dragging — tune by feel, this isn't a hard number from the brainstorm.

---

## 5. Suggested working process

1. Restate this plan back to the person in a few sentences — especially the
   "pick still happens before the shuffle" constraint, so there's no
   confusion later — and get a nod before coding.
2. Keep the modal's external contract identical: `{ coins, onCoinsChange }`
   props, same API calls, same pick-then-guess flow.
3. Build `prefers-reduced-motion` handling in from the start via
   `useReducedMotion()`, not as an afterthought.
4. If you introduce new pure logic beyond what's in `shuffle.ts`, keep it in
   a plain `.ts` file, framework-free, and sanity-check it with a throwaway
   Node script the way `shuffle.ts` itself was checked (valid-permutation
   invariant, no no-op swaps, identity/position consistency) during Plinko's
   pass.
5. There is no frontend test runner exercising this area. Verify visually —
   browser tools/screenshots if available, and/or ask the person to run
   `make rebuild-front` and click through it locally, including the
   `shellOptions` other than 3 (4 and 5 shells) so you've seen the
   choreography at more than one shell count. Don't declare this done
   without having seen it render.
6. Before wrapping up, confirm: the Verify button still passes; the pearl is
   always revealed at the position matching `result.outcomeId` (not wherever
   the shuffle happens to leave things — the shuffle informs *where to draw*
   the already-known answer, it never changes the answer); win/loss text
   still comes from `result.net`; reduced motion short-circuits correctly;
   the other five games' CSS/modals are untouched; `npx tsc --noEmit` is
   clean.
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
  drifts into new game mechanics (especially "shuffle before the pick"), new
  backend fields, or new dependencies, that's a scope change worth naming
  out loud before proceeding.
