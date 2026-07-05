# Handoff: Fortune Wheel finishing-touch pass

You are improving the look and feel of **Fortune Wheel**, one of the six
games in the Shell Smash gambling den ("Shell's Gambit"): **Fortune Wheel,
Shell Flip, Three-Shell Monte, Shrine Slots, Koi Dice, Shell Drop** — all
server-authoritative, provably fair, sharing one wager engine. The economy,
math and backend are **not in scope**. This is presentation-layer work only:
how an already-resolved spin is *shown* to the player.

**This game is in noticeably better shape than the other four getting this
treatment right now.** It already has real SVG segments, a real weighted
rotation that lands on the correct segment, and a `cubic-bezier` ease-out —
it was already close to the bar Shell Drop's redo set. The person explicitly
chose to give this one a **lighter finishing-touch pass**, not a rebuild —
don't restructure what already works.

A brainstorm already happened with the person you're working with to decide
the direction for all five remaining games; you don't need to re-run that
brainstorm for Wheel, but you do need to **restate the plan below back to
them in your own words and get an explicit go-ahead before writing code**.
If anything here seems to call for a bigger change than described (new
backend fields, new dependencies, reworking the segment layout), that's a
scope change — name it and ask, don't just do it.

---

## 1. Non-negotiables — true for every game in this den

- **The animation is purely cosmetic.** `POST /casino/wheel` (and the free
  daily spin endpoint) returns the complete `SpinResult` synchronously —
  outcome, payout, new balance, provably-fair reveal — before any animation
  starts. You are only choosing *how* to visually delay showing an
  already-known result. Nothing you build can make the outcome depend on the
  animation or vice versa.
- **Provably fair must keep working.** The modal's "Verify this spin" button
  calls `verifySpin` (`frontend/src/components/casino/fairness.ts`), which
  recomputes the roll from the revealed seeds and checks it against the
  server. Don't change that contract; the fairness panel must keep
  rendering exactly as it does today.
- **`prefers-reduced-motion` must be respected**, checked before the
  animation starts, short-circuiting straight to the resolved rotation. Use
  the shared `useReducedMotion()` hook (see §2) rather than a one-off
  `matchMedia` check — this game's CSS-only reduced-motion handling
  (`transition: none !important` on `.hub-wheel__face`) may need to become a
  JS check too, depending on the approach you take in §4.
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

If you drive the spin with a `useEffect` keyed on some "pending outcome"
state (the pattern Shell Drop uses — see §3), **do not put `onCoinsChange` in
that effect's dependency array.** `HomePage.tsx` passes it as a fresh inline
closure on every render (`onCoinsChange={(coins) => setPlayer(...)}`, not
memoized). If it's a dependency, any unrelated re-render of the hub page
tears down and restarts your `requestAnimationFrame` loop mid-spin — this
exact bug shipped in Shell Drop's first pass and looked like the shell token
"glitching" and never finishing its drop. Fix used there: mirror
`onCoinsChange` (and any other prop/state the effect reads but shouldn't
restart on) into a `useRef`, updated by its own tiny effect, and key the
animation effect only on the thing that should actually restart it. This
game currently uses a plain `setTimeout` inside the click handler (not an
effect), which isn't vulnerable to this specific bug — but if you switch the
rotation itself to a JS-driven `requestAnimationFrame` loop (see §4), the
same care applies to whatever state that loop reads.

---

## 2. Shared toolkit already prepared for you

These were built while doing Shell Drop's pass and are ready to use — please
don't modify them (read-only; other agents depend on them staying stable
while working in parallel). If one seems to be missing something you need,
say so rather than editing it yourself.

| File | What it gives you |
|---|---|
| `frontend/src/components/casino/board-canvas.ts` | `lerp`, `easeInQuad`, `easeOutQuad`, `easeOutCubic`, `easeInOutCubic`, **`easeOutBack`** (overshoots past 1 then settles back to exactly 1 — built specifically with this wheel's rock-back landing in mind), `easeOutBounce`; `BoardStep`/`runBoardAnimation` — a generic `requestAnimationFrame` scheduler that steps through timed segments and calls your `onFrame(data, linearProgress, stepIndex)` each frame. **None of this requires a `<canvas>`** — it's just as useful for setting the wheel `<g>`'s `transform: rotate(...)deg` every frame as it is for drawing pixels. |
| `frontend/src/components/casino/spin-rotation.ts` | `mod360(angle)` and `spinToAngle(previous, targetDeg, turns)` — this is the maths `wheel.ts`'s `nextRotation` already used inline; it's now extracted here and `nextRotation` is a thin wrapper around it (verified behaviorally identical to the original across 50,000 random inputs before the extraction was kept). No change needed on your end unless you want to call `spinToAngle` directly for something new. |
| `frontend/src/components/casino/useReducedMotion.ts` | `useReducedMotion()` — reactive hook wrapping the `prefers-reduced-motion` media query. Use this instead of the current CSS-only handling if you move to a JS-driven rotation. |

---

## 3. Where everything lives

| File | Relevance |
|---|---|
| `frontend/src/components/casino/FortuneWheelModal.tsx` | The modal you're changing. Currently: `WheelFace` renders `segments` as SVG `<path>` pie slices inside a `<g className="hub-wheel__face">`, rotated via an inline `style.transform = rotate(${rotation}deg)` with a plain CSS `transition: transform ${SPIN_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` (`SPIN_DURATION_MS` = 4200ms) when `spinning`. `runSpin` computes the next rotation via `nextRotation(prev, index, segments.length)` (`wheel.ts`) *before* the transition starts, then a `setTimeout` reveals the result once the transition should be finished. There's already a fixed `.hub-wheel__pointer` at the top. |
| `frontend/src/components/casino/wheel.ts` | Pure logic mirror: `SPIN_TURNS` (5 full turns), `segmentAtTop(rotation, count)` (which segment is currently under the pointer — **useful for tick-pulse detection, see §4**), `nextRotation(previous, segmentIndex, count, turns?)`, `selectSegmentFrom`, `segmentColor(multiplier)`. No React/DOM — reuse, don't duplicate. |
| `frontend/src/components/casino/fairness.ts` | `verifySpin(result, segments)` — don't break this contract. |
| `frontend/src/features/hub/api.ts` | `WheelView` (`segments: WheelSegmentView[]`, `rtp`, `freeStake`, `minWager`, `maxWager`, `coins`, `freeSpinAvailable`), `api.getWheel()`, `api.spinWheel(stake, clientSeed?)`, `api.spinFreeWheel(clientSeed?)`. `SpinResult` extends `SpinResolution` with `segment: WheelSegment`. |
| `frontend/src/styles/global.css` | Search `/* ── Fortune Wheel (gambling den) ── */` for the current `.hub-wheel__*` block: `.hub-wheel__stage`, `.hub-wheel__pointer`, `.hub-wheel__face` (the rotated `<g>`), `.hub-wheel__hub` (center circle), the existing `@media (prefers-reduced-motion: reduce) { .hub-wheel__face { transition: none !important; } }` block. |
| `frontend/src/pages/HomePage.tsx` | Renders `<FortuneWheelModal coins={...} onCoinsChange={(coins) => setPlayer(...)} />` inside its `activeModal === "wheel"` block — this is the un-memoized `onCoinsChange` closure mentioned above. |
| `frontend/src/components/casino/ShellDropModal.tsx` + `docs/handoff-casino-ui-ux-plinko.md` | Reference implementation: how a resolved outcome is held back (`pendingOutcome` state) until a `requestAnimationFrame`-driven animation finishes, then revealed via `setResult`/`onCoinsChange`. Only relevant here if you decide to move the rotation to a JS-driven loop (see §4) — the wheel's overall reveal-timing shape can stay as it is otherwise. |

---

## 4. The decided direction: finishing touches, not a rebuild

Three additions, layered onto what already exists:

1. **A settle bounce/overshoot at the end of the spin.** A plain CSS
   `transition` can only ease *toward* its end value — it can't overshoot
   past the target and rock back, because that requires the animated value
   to temporarily exceed, then return to, the final value within a single
   timeline. To get that, replace the CSS `transition` with a **JS-driven
   rotation**: track `rotation` in state exactly as today (still computed via
   `nextRotation`), but animate it with `runBoardAnimation` + `easeOutBack`,
   writing `rotate(${angle}deg)` to the `<g>`'s inline style every frame
   instead of relying on the CSS transition. `easeOutBack` is built exactly
   for this — it swings past 1 (i.e. slightly past the final rotation) before
   settling back to exactly 1, which reads as the wheel spinning slightly
   past the winning segment and rocking back into place.
2. **Small tick pulses as segment dividers pass the pointer.** Since you'll
   now have the current rotation on every frame (from the `runBoardAnimation`
   loop above), you can call the already-existing `segmentAtTop(rotation, count)`
   each frame and compare it to the previous frame's value — every time it
   changes, a divider just crossed the pointer. Trigger a small, brief visual
   pulse on `.hub-wheel__pointer` (e.g. a quick scale-up-and-back, or a
   momentary brightness bump) each time that happens. No new dependency or
   shared helper needed — this reuses a function that already exists in
   `wheel.ts`.
3. **A glow/flourish on landing a big-win segment.** `segmentColor(multiplier)`
   already tiers segments by multiplier (bust, partial loss, push, modest
   win, big win, jackpot — see the function body for the exact thresholds).
   Once the spin settles, if the landed segment is in the "big win" or
   "jackpot" tier, add a brief glow/pulse effect on that slice or on the
   pointer/hub — keep it simple (a CSS animation triggered by a class toggle
   is fine here; this piece doesn't need to be JS-driven).

**What NOT to change**: the SVG slice geometry (`slicePath`/`pointOnCircle`),
the segment layout, `nextRotation`'s maths, the odds table, or the overall
reveal-timing shape (reveal still happens once the spin visually completes).
This is additive polish on top of a wheel that already works.

---

## 5. Suggested working process

1. Restate this plan back to the person in a few sentences and get a nod
   before coding.
2. Keep the modal's external contract identical: `{ coins, onCoinsChange }`
   props, same API calls, same free-spin button behavior.
3. If you move the rotation to a JS-driven loop, build `prefers-reduced-motion`
   handling in via `useReducedMotion()` from the start (short-circuit
   straight to the final `rotation` with no animation, same as today's CSS
   `transition: none` does, just enforced in JS now) — don't leave the old
   CSS-only media query as the only guard once the transition is gone.
4. No new pure logic is expected here beyond what's already in `wheel.ts`;
   if you do add any, keep it framework-free and sanity-check it the way
   `drop-path.ts`/`shuffle.ts` were checked during Plinko's pass.
5. There is no frontend test runner exercising this area. Verify visually —
   browser tools/screenshots if available, and/or ask the person to run
   `make rebuild-front` and click through several spins, ideally landing on
   at least one big-win/jackpot segment to see the glow. Don't declare this
   done without having seen it render.
6. Before wrapping up, confirm: the Verify button still passes; the wheel
   still lands exactly on `result.segment.id` every time (no drift from the
   overshoot — `easeOutBack` returns exactly 1 at `t=1`, so the final
   rotation is unaffected, only the path to get there); reduced motion
   short-circuits correctly; the other five games' CSS/modals are untouched;
   `npx tsc --noEmit` is clean.
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
