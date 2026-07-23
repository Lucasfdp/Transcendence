# Three-Shell Monte — Server-Authoritative Shuffle Hardening

## Why

The two-step Monte round leaked the answer. The round-start response
(`POST /casino/monte/rounds`) returned `ballCupId`, and the resolve endpoint
decided win/loss purely by `selectedCupId === ballCupId`. A player could read
`ballCupId` from the Network tab (or console) and resolve with it for a
guaranteed 3× — no tracking, no skill. A later change randomised the *visual*
shuffle but left `ballCupId` in the start payload, so the exploit was untouched;
it only invalidated a fixed by-position lookup.

Chosen direction: keep the game genuinely realistic (ball shown → shuffle →
pick → reveal, honestly trackable) and accept it is *theoretically* crackable by
a determined attacker reading the bundle — while raising the bar so casual
Network-tab / console cheating no longer works.

## What changed

Server-authoritative round, resolved by **slot position**, never by a leaked id:

- **Winning slot never leaves the server before resolve.** The start payload now
  carries only the ball's *start* slot (`ballStartSlot`, public — the point of
  the preview), the shuffle's shape/timeline, and the seed commitment. No
  `ballCupId`, no winning slot, no swaps.
- **Server authors the shuffle** from the provably-fair seed
  (`monte-shuffle.ts`: `deriveBallStartSlot`, `deriveShuffle`, `applyShuffle`).
  The winning slot is recomputed server-side and compared to the slot the player
  clicked. Client-sent values are never trusted.
- **Just-in-time swap streaming.** `GET /casino/monte/rounds/:id/steps` releases
  each swap only once its scheduled time has elapsed, so the full sequence — and
  therefore the winning slot — cannot be precomputed at round start. The client
  polls while it animates.
- **Resolve timing gate.** A resolve arriving before the shuffle could have
  finished on screen is rejected ("Round is still shuffling"), blocking
  start→instant-resolve bots. Tolerance: `MONTE_RESOLVE_GRACE_MS`.
- **Reduced-motion auto-win fixed.** The old reduced-motion path skipped the
  shuffle entirely, leaving the ball where the preview showed it (a free win by
  memory). The ball is now hidden through the shuffle for everyone, and the
  server gate applies uniformly — reduced-motion play is an honest 1/3 guess.
- **Production bundle hardening** (`vite.config.mjs`): console/debugger stripped
  and identifiers mangled in the prod build only. Explicitly *not* a security
  boundary — see the residual risk below.

## Resume & cleanup (follow-up)

- **Resume in-flight rounds.** Monte is the only two-phase casino game (start
  debits + persists a `pending` round; resolve settles it) — the other five
  resolve atomically in one transaction, so none can be left half-finished. A
  client that reloaded mid-round used to abandon its already-debited stake to
  the TTL. `GET /casino/monte` now returns `activeRound` (via
  `MonteRoundService.getActiveRound`, which expires stale rounds first), and the
  modal resumes straight into the shuffle/choice instead of forfeiting. No
  double-spend risk: `startRound` already refuses to open a second round while
  one is pending.
- **Background sweeper.** `MonteRoundSweeper` ticks every
  `MONTE_SWEEP_INTERVAL_MS` (1 min) and calls `expireStaleRounds`, which settles
  any round past its TTL as the loss it already is — so abandoned rounds are
  booked proactively instead of lingering until the owner next touches Monte.
  Each round is expired under its owner's row lock, so it's race-safe against a
  concurrent resolve and idempotent across multiple backend replicas. Built on a
  plain unref'd interval + Nest lifecycle hooks (no `@nestjs/schedule`
  dependency); the timer is cleared on shutdown.
- **Removed dead code.** The unreachable single-shot `MonteService.monte()` and
  its `MonteDto` (no route, no caller) were deleted — they duplicated the old
  one-call-reveals-outcome pattern and were a latent footgun. `MonteService` now
  only provides the config; the playable round is entirely `MonteRoundService`.

## API changes

- `GET /casino/monte` → `MonteConfig` now includes `activeRound`
  (`MonteRoundStartResult | null`) for resume.
- `POST /casino/monte/rounds` → `MonteRoundStartResult`: removed `ballCupId` and
  `winningCupHash`; added `ballStartSlot`, `stepCount`, `stepDurations`,
  `shuffleLeadMs`, `totalShuffleMs`, `commitHash`.
- `GET /casino/monte/rounds/:roundId/steps` → **new**, `MonteRoundStepsResult`
  (`steps`, `stepCount`, `ready`). Read-only, outside the spin throttle.
- `POST /casino/monte/rounds/:roundId/resolve` → body is now `{ selectedSlot }`
  (0..2), not `{ selectedCupId }`. Response adds `ballStartSlot`, `winningSlot`,
  `selectedSlot`, `shuffle`; `fairness.winningCupHash` → `fairness.commitHash`.
- DB: migration `20260712120000-monte-server-shuffle` adds nullable
  `ballStartSlot`, `winningSlot`, `shuffle`, `stepCount`, `commitHash` columns.
  Pre-existing rows keep loading (their new columns are null and inert).

## Residual (accepted) risk

To animate an honestly trackable shuffle, the browser must ultimately receive
the swaps and the start slot, so a determined attacker can replay them to compute
the winning slot. That is inherent to a real tracking game on the web and is
accepted. The bar is now "reverse-engineer the bundle and simulate the shuffle
within the just-in-time window and beat the timing gate", not "copy one field".
The provably-fair commitment (`commitHash`, revealed seed) still lets any player
verify the round was not altered after they committed.

## Validation

- Backend: `cd backend && npm run test` — `monte-round.service.spec.ts` and
  `casino.controller.spec.ts` cover start (no leaked answer), just-in-time step
  gating, slot-based win/loss, the resolve timing gate, and out-of-range slots.
- Frontend: `monte.test.ts` (`applyShuffle`), `ThreeShellMonteModal.test.tsx`
  (preview→covering→shuffling→choosing driven by the poll), `fairness.ts`
  (`verifyMonteRound` recomputes start slot, shuffle and winning slot from the
  seed). Full modal UX validated manually per `CLAUDE.md`.
