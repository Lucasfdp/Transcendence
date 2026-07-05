# Handoff: Shell Flip animation pass

You are improving the look and feel of **Shell Flip**, one of the six games
in the Shell Smash gambling den ("Shell's Gambit"): **Fortune Wheel, Shell
Flip, Three-Shell Monte, Shrine Slots, Koi Dice, Shell Drop** — all
server-authoritative, provably fair, sharing one wager engine. The economy,
math and backend are **not in scope**. This is presentation-layer work only:
how an already-resolved flip is *shown* to the player.

Shell Drop (Plinko) already went through this same treatment and was
approved — it's your quality bar and, more usefully, your toolkit. A
brainstorm already happened with the person you're working with to decide
the direction for all five remaining games; you don't need to re-run that
brainstorm for Shell Flip, but you do need to **restate the plan below back
to them in your own words and get an explicit go-ahead before writing
code** — same working agreement as every other game in this den. If
anything here seems to call for a bigger change than described (new backend
fields, new dependencies, changing when/how the player picks a side), that's
a scope change — name it and ask, don't just do it.

---

## 1. Non-negotiables — true for every game in this den

- **The animation is purely cosmetic.** `POST /casino/flip` returns the
  complete `SpinResolution` synchronously — outcome, payout, new balance,
  provably-fair reveal — before any animation starts. You are only choosing
  *how* to visually delay showing an already-known result. Nothing you build
  can make the outcome depend on the animation or vice versa.
- **Provably fair must keep working.** The modal's "Verify this flip" button
  calls `verifyFlip` (`frontend/src/components/casino/fairness.ts`), which
  recomputes the roll from the revealed seeds and checks it against the
  server. Don't change that contract; the fairness panel (seed, hash, client
  seed, nonce, roll) must keep rendering exactly as it does today.
- **`prefers-reduced-motion` must be respected**, checked before the
  animation starts, short-circuiting straight to the resolved face. Use the
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

If you drive the flip with a `useEffect` keyed on some "pending outcome"
state (the pattern Shell Drop uses — see §3), **do not put `onCoinsChange` in
that effect's dependency array.** `HomePage.tsx` passes it as a fresh inline
closure on every render (`onCoinsChange={(coins) => setPlayer(...)}`, not
memoized). If it's a dependency, any unrelated re-render of the hub page
tears down and restarts your `requestAnimationFrame` loop mid-animation —
this exact bug shipped in Shell Drop's first pass and looked like the coin
"glitching" and never finishing its spin. Fix used there: mirror
`onCoinsChange` (and any other prop/state the effect reads but shouldn't
restart on) into a `useRef`, updated by its own tiny effect, and key the
animation effect only on the thing that should actually restart it (there,
`pendingOutcome`; here, whatever pending-flip state you introduce).

---

## 2. Shared toolkit already prepared for you

These were built while doing Shell Drop's pass and are ready to use — please
don't modify them (read-only; other agents depend on them staying stable
while working in parallel). If one seems to be missing something you need,
say so rather than editing it yourself.

| File | What it gives you |
|---|---|
| `frontend/src/components/casino/board-canvas.ts` | `lerp`, `easeInQuad`, `easeOutQuad`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack` (overshoot-then-settle), `easeOutBounce`; `BoardStep`/`runBoardAnimation` — a generic `requestAnimationFrame` scheduler that steps through timed segments and calls your `onFrame(data, linearProgress, stepIndex)` each frame. **None of this requires an actual `<canvas>`** — it's just as useful for setting a DOM element's `style.transform` every frame. `setupCanvas` is the one canvas-specific piece; you likely don't need it for a coin flip. |
| `frontend/src/components/casino/spin-rotation.ts` | `mod360(angle)` and `spinToAngle(previous, targetDeg, turns)` — "spin forward from wherever the dial currently rests, at least `turns` full turns, and land exactly on `targetDeg`." Originally the Fortune Wheel's rotation maths, now extracted so you don't have to re-derive it for a coin (which is really just a 2-face version of the same problem: `targetDeg` is `0` for heads or `180` for tails). |
| `frontend/src/components/casino/useReducedMotion.ts` | `useReducedMotion()` — reactive hook wrapping the `prefers-reduced-motion` media query. Use this instead of a one-off check. |

---

## 3. Where everything lives

| File | Relevance |
|---|---|
| `frontend/src/components/casino/ShellFlipModal.tsx` | The modal you're changing. Currently: a `.hub-flip__coin` div gets an `is-flipping` class that triggers an *infinite* 0.32s CSS `rotateY` loop for `FLIP_DURATION_MS` (1600ms), then the class is removed and the coin's label/color hard-snaps to the resolved face. No deterministic rotation, no landing motion. |
| `frontend/src/components/casino/flip.ts` | Pure logic mirror: `flipSide(roll)`, `flipSideColor(side)`, `flipSideLabel(side)`. No React/DOM — reuse, don't duplicate. |
| `frontend/src/components/casino/fairness.ts` | `verifyFlip` — don't break this contract. |
| `frontend/src/features/hub/api.ts` | `FlipConfig` (`multiplier`, `rtp`, `minWager`, `maxWager`, `coins`), `api.getFlip()`, `api.flip(stake, pick, clientSeed?)`. `SpinResolution.outcomeId` is `"heads"` or `"tails"`. |
| `frontend/src/styles/global.css` | Search `/* ── Shell Flip ── */` for the current `.hub-flip__*` block: `.hub-flip__stage` (140px tall, `perspective: 600px`), `.hub-flip__coin` (110px circle, radial gradient using `--flip-face`, `transform-style: preserve-3d`), `.hub-flip__coin.is-flipping` → `hub-flip-spin` keyframe (infinite `rotateY`). |
| `frontend/src/pages/HomePage.tsx` | Renders `<ShellFlipModal coins={...} onCoinsChange={(coins) => setPlayer(...)} />` inside its `activeModal === "flip"` block — this is the un-memoized `onCoinsChange` closure mentioned above. |
| `frontend/src/components/casino/ShellDropModal.tsx` + `docs/handoff-casino-ui-ux-plinko.md` | Reference implementation: how a resolved outcome is held back (`pendingOutcome` state) until a `requestAnimationFrame`-driven animation finishes, then revealed via `setResult`/`onCoinsChange`. Copy the *shape* of this pattern, not the canvas specifics — Flip doesn't need a `<canvas>`. |

---

## 4. The decided direction

- **Pace: quick, ~1.5–2s total** (matching today's snappiness, not Plinko's
  more deliberate ~4s) — a coin flip should read as a fast, punchy action,
  not a suspenseful one.
- **Deterministic rotation, not an infinite loop + snap.** Track a
  persistent `rotation` number in state (same idea as `FortuneWheelModal`'s
  `rotation` state). When a flip resolves, compute the target with
  `spinToAngle(rotation, outcome.outcomeId === "heads" ? 0 : 180, turns)`
  for some small number of `turns` (a full turn = 360°, i.e. 2 face-flips;
  pick something that reads as a quick flip in ~1.5–2s — a handful of turns,
  not Wheel's 5) — this always advances the rotation forward, so it never
  has to snap backward to land on the right face.
- **Animate the rotation with `runBoardAnimation`**, updating the coin's
  `transform: rotateY(...)` every frame instead of relying on a CSS
  `transition`/keyframe loop. Use `easeOutCubic` (or similar) for the spin
  itself so it decelerates smoothly into the landing angle.
- **Don't let the rotation itself overshoot past the landing angle** — an
  `easeOutBack`-style overshoot on a 3D Y-rotation would visually read as
  flipping past the resolved face and back, which is confusing for a coin
  (unlike a wheel, where overshoot-then-rock-back on the *same* axis still
  clearly reads as "landing"). Instead, once the rotation animation
  completes, consider a **separate short squash/settle** — e.g. a brief
  `scale` bounce (`easeOutBounce` or `easeOutBack` applied to a scale
  transform, not the rotation) — so the coin visibly "thumps" down without
  ambiguity about which face is showing.
- **Face color/label**: `flipSideColor`/`flipSideLabel` from `flip.ts`
  already exist and don't need to change — just make sure whichever face is
  showing at `rotation`'s final resting angle (0° vs 180°, accounting for
  `rotateY` mirroring the label at 180°) visually matches the resolved side.
  You'll likely want to flip which label/color is "front-facing" partway
  through the rotation (at the 90°/270° points where the coin is edge-on) so
  the correct face is shown once it's actually facing the viewer again —
  check how a real coin flip reads before committing to exact timing.
- **Reveal timing**: mirror Shell Drop's `pendingOutcome` pattern — hold the
  resolved outcome back from `result` (and therefore from the result text and
  fairness panel) until the rotation + settle animation completes, then
  reveal. Remember the ref-mirroring fix from §1 for `onCoinsChange`.

---

## 5. Suggested working process

1. Restate this plan back to the person in a few sentences and get a nod
   before coding.
2. Keep the modal's external contract identical: `{ coins, onCoinsChange }`
   props, same API calls.
3. Build `prefers-reduced-motion` handling in from the start via
   `useReducedMotion()`, not as an afterthought.
4. If you introduce new pure logic beyond what's in `flip.ts`/`spin-rotation.ts`,
   keep it in a plain `.ts` file, framework-free, and sanity-check it with a
   throwaway Node script the way `drop-path.ts` and `shuffle.ts` were checked
   against known invariants during Plinko's pass.
5. There is no frontend test runner exercising this area. Verify visually —
   browser tools/screenshots if available, and/or ask the person to run
   `make rebuild-front` and click through it locally. Don't declare this done
   without having seen it render.
6. Before wrapping up, confirm: the Verify button still passes; the face
   shown at rest always matches `result.outcomeId`; reduced motion
   short-circuits correctly; the other five games' CSS/modals are untouched;
   `npx tsc --noEmit` is clean.
7. After this ships and is approved, don't move on to another game's
   animation — a separate agent is handling each of the other four in
   parallel, and Fortune Wheel is getting its own lighter finishing-touch
   pass, not a full rebuild.

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
