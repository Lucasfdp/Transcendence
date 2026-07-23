# Wave B Hand-Off — Hub And Casino Rendering

Date: 23 July 2026
Workstream: B — Hub and casino rendering (`perf/workstream-hub-casino`)
Source plan: [`frontend-performance-profiler-report-and-plan-2026-07-23.md`](frontend-performance-profiler-report-and-plan-2026-07-23.md)
Base commit: `3034ba523321d86b33efa125e136f4bf580e2645` (clean `main`, equal to `origin/main` at branch time; no separate coordinator SHA was supplied)
Branch: `perf/workstream-hub-casino`
Head commit: the pushed tip of `perf/workstream-hub-casino` (this document is part of the final commit).

## 1. Scope Delivered

Phase 5 (extracted, bounded, suspendable hub backdrop) and the casino portion
of Phase 7 (imperative Fortune Wheel rotation, retained static Shell Drop
board, audit of the remaining casino animations).

## 2. Changed Files

New:

- `frontend/src/features/backdrop/cycleEngine.ts` — pure day/night engine
  (`computeCycleVisuals`, `applyCycleVisuals`, time helpers), extracted from
  the inline `HomePage.tsx` implementation with identical constants.
- `frontend/src/features/backdrop/starField.ts` — bounded star budget
  (`resolveBackdropQuality`), star generation, prerendered glow sprites,
  canvas drawing, and the cached software-renderer probe.
- `frontend/src/features/backdrop/CycleBackdrop.tsx` — the extracted backdrop
  runtime component.
- `frontend/src/features/backdrop/index.ts` — the feature's public API.
- `frontend/src/styles/modules/hub-backdrop.css` — star canvas and
  transform-driven cloud strip styles, suspension and reduced-motion rules.
- `frontend/src/features/gambling/drop-board.ts` — Shell Drop board renderer
  with a retained static peg layer.
- Tests: `frontend/src/features/backdrop/cycleEngine.test.ts`,
  `frontend/src/features/backdrop/starField.test.ts`,
  `frontend/src/features/backdrop/CycleBackdrop.test.tsx`,
  `frontend/src/features/gambling/drop-board.test.ts`,
  `frontend/src/components/gambling/FortuneWheelModal.rotation.test.tsx`.

Modified:

- `frontend/src/components/gambling/FortuneWheelModal.tsx` — spin frames
  write the face rotation imperatively through a ref; only the settled angle
  is committed to React state; `WheelFace` memoised.
- `frontend/src/components/gambling/ShellDropModal.tsx` — board drawing
  delegated to `createDropBoardRenderer`, cached per
  (rows, size, pixel-ratio); the local per-frame full redraw was removed.
- `frontend/src/components/gambling/ShellDropModal.test.tsx` — the canvas
  stub gained `drawImage` (the static-layer blit calls it every frame).
- `frontend/src/features/gambling/index.ts` — exports `drop-board`.
- `frontend/src/styles/modules/index.css` — registers `hub-backdrop.css`
  directly after `hub.css`.

No forbidden file changed: `HomePage.tsx`, `hub.css`, replay-common, game
scenes, routes/session ownership, `AGENTS.md`, `CLAUDE.md`, the canonical
checkpoint, and `docs/modules-progress.md` are untouched. (A temporary local
mount of the extracted backdrop in `HomePage.tsx` was used for visual
validation only and was reverted before committing; see §5.)

## 3. Design Decisions And Assumed Integration APIs

- **Backdrop component API**:
  `<CycleBackdrop theme manualMinutes covered quality?>` from
  `frontend/src/features/backdrop`. `theme` is the existing `CycleTheme`;
  `manualMinutes` matches the debug-clock contract of the inline version;
  `covered` is new — the host page must pass "an opaque surface currently
  hides the backdrop" (for the current hub this is `activeModal !== null`).
  `quality` optionally overrides the resolved visual budget.
- **Star field**: one canvas replaces 420 animated DOM stars. The budget is
  viewport-scaled and clamped to 36–160 stars (36–80 with a software WebGL
  renderer, where glow halos are also disabled and the backing store is
  capped at device pixel ratio 1; hardware caps at 1.5). Glow is baked into
  five prerendered sprites, so a frame is only `drawImage` calls. The
  twinkle loop runs at most ~30 FPS and only while stars are visible
  (night), the document is visible, and the backdrop is uncovered; under
  reduced motion the field renders once, statically.
- **Clouds**: the drift animates `transform` on an oversized strip inside a
  clipping container instead of `background-position` on a full-screen
  layer; suspension pauses it via `animation-play-state`.
- **Shared static layers**: sky, sun, moon, glow, and foreground reuse the
  existing `.hub-cycle` classes from `hub.css` unchanged, so art, masks, and
  theme overrides remain pixel-identical. The legacy `.hub-cycle__star`
  rules and the `.hub-cycle__clouds` animation in `hub.css`, the
  `cycle-star-twinkle` keyframes in `gameplay.css`, and the inline
  `CycleBackdrop`/`createCycleStars`/`applyCycleVisuals` code in
  `HomePage.tsx` become dead once the integrator mounts this feature; they
  were deliberately left in place because they are forbidden files for this
  wave, and removing the styles early would break the still-mounted inline
  backdrop.
- **Cycle engine duplication**: `cycleEngine.ts` intentionally duplicates
  the page's maths verbatim until integration; any tuning must change both
  or complete the swap.
- **Fortune Wheel**: the per-frame `setRotation` was the defect (a full
  modal reconciliation per animation frame). The pointer tick/landing pulses
  were already imperative and are unchanged; the wheel keeps committing rest
  angles through state so reduced motion and re-mounts behave as before.
- **Shell Drop**: the static peg lattice is prerendered once per
  (tier, size, pixel-ratio) and blitted per frame; only the lit bumper and
  the shell draw dynamically, making frame cost independent of the peg
  count. The nearest-peg hit test now reuses precomputed pixel positions.

### Casino animation audit (Phase 7 audit item)

- Koi Dice — already imperative (odometer strip and marker via DOM refs);
  no change needed.
- Shell Flip — already imperative (`paintFace` writes transform/label via
  refs; state committed only at start/end); no change needed.
- Shrine Slots — canvas reels redraw per frame, but the strip content is
  inherently dynamic (scrolling), no React state per frame, and the spin is
  finite; acceptable as-is.
- Three-Shell Monte — discrete phase/swap state commits with CSS
  transitions doing the motion; acceptable as-is.
- The only infinite casino CSS animation is the Fortune Wheel big-win glow;
  it is modal-scoped, plays only after a result, and is already disabled
  under reduced motion; acceptable as-is.

## 4. Validation Executed

All Node.js commands ran in the pinned `node:24-alpine` container
(Node.js 24.18.0, npm 11.16.0), matching the plan's Node 24 requirement —
the host has no Node runtime.

- `cd frontend && npm run test:run` — pass, 79 files, 450 tests (Phase 1
  baseline was 74 files / 416 tests; this wave adds 5 files / 34 tests).
- `cd frontend && npm run build` — pass, 242 modules, all assets emitted.
- `npx tsc --noEmit` — pass, no errors (none in wave files, none baseline).
- Stylesheet reachability — `hub-backdrop.css` is imported by
  `styles/modules/index.css` and its selectors and `cycle-clouds-drift`
  keyframes are present in the emitted production CSS bundle.
- `git diff --check` — pass.

## 5. Visual Evidence

Environment: the full development stack via `make dev` (all 13 services
healthy), headless Firefox via Selenium at 1440 × 900, fresh registered
account with a targeted SQL coin grant (Phase 1 procedure).

- Fortune Wheel — paid spin: the face transform advanced through four
  distinct sampled angles mid-spin (imperative rotation live), the result
  and balance revealed together after landing (`2× · +10`), no page errors.
- Shell Drop — 8-row and 16-row drops: full lattice rendered crisply from
  the blitted static layer, shell fell with the lit-bumper effect, results
  and balance correct (`Bucket 5 · 0.87× · -2`), tier switch rebuilt the
  renderer, no page errors.
- Backdrop parity — with a temporary, reverted local mount of the extracted
  component, the debug clock was driven to midnight, noon, and dusk in both
  implementations. Cycle CSS variables matched exactly at every point
  (`stars 1.000/0.000/0.165`), the DOM changed from 420 star spans to one
  canvas plus one cloud strip, and screenshots are visually equivalent.
- Screenshots were captured under the session scratchpad
  (`shots/*.png`); they are transient validation artefacts, not committed.

## 6. Environment Differences

- Headless Firefox on this worker uses software WebGL; the backdrop's
  renderer probe therefore selects the reduced star budget here. Acceptance
  profiling on the destination machine must use its recorded graphics
  configuration.
- Worker performance observations are diagnostic only; no profiler
  captures were attempted here (Phase 1 baselines live on the destination
  machine).

## 7. Known Failures And Deferred Integration Points

Known failures: none.

Deferred to the integrator (per the plan's deferred-connection list):

1. Mount `frontend/src/features/backdrop`'s `CycleBackdrop` from the hub
   page (Workstream D owns `HomePage.tsx`), passing
   `covered={activeModal !== null}` (or the equivalent after D's state
   split), and delete the inline backdrop code
   (`CycleBackdrop`, `createCycleStars`, `applyCycleVisuals`,
   `CYCLE_ARCS`, `CYCLE_STAR_*` in `HomePage.tsx`).
2. Remove the then-dead `.hub-cycle__star` rules and the
   `.hub-cycle__clouds` `background-position` animation from `hub.css`, and
   the `cycle-star-twinkle` keyframes from `gameplay.css` (shared with the
   game host — coordinate with Workstream C, which also uses
   `cycle-sky-parallax` in `.game-host--cycle::before`).
3. Re-run the Phase 5 acceptance profile (idle-hub renderer occupancy,
   modal-open cost) on the destination machine after the mount.

## 8. Destination-Machine Checks Still Required

- Isolated idle-hub and modal-open-hub Firefox profiles against the Phase 1
  baseline (target: idle-hub renderer below 10–15% of one core; modal-open
  not more expensive than idle).
- Fortune Wheel and Shell Drop interaction profiles (React commit counts
  during spin/drop should no longer track animation frames).
- Visual checks at the destination's recorded viewport and graphics
  configuration, including the reduced-motion and covered/suspended states.

## 9. Module Scope Review

`docs/modules-progress.md` was reviewed: this wave is performance work and
changes no module claims, so no update is required (the file is in any case
read-only for wave workers).
