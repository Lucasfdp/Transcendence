# Handoff: Implement two new casino games (Koi Dice, Shell Drop)

You are adding two more gambling-den games to the **Shell Smash** dojo: a
single-roll **Koi Dice** (over/under) and a multi-roll **Shell Drop** (Plinko).
Four games already exist and work — **Fortune Wheel, Shell Flip, Three-Shell
Monte, Shrine Slots** — built on a shared engine. Your job is to add these two
**by following the existing games' proven patterns exactly**.

Treat this as a brownfield task: read the existing casino module first, copy its
conventions, and **do not re-architect anything that already works**. In
particular, the shared wager engine, the provably-fair primitives, the `game`
discriminator, and the per-game service pattern are all already in place — you
are only adding two thin games on top.

---

## 0. Non-negotiable working agreement

- **TDD, red-green-refactor.** Write the failing test first, watch it fail for a
  meaningful reason, then implement. The existing casino specs are your template.
- **Server-authoritative.** The client never computes an outcome. All randomness
  and all coin movement happen on the server inside a single DB transaction —
  via the shared `CasinoEngine`.
- **Provably fair.** Every resolved spin commits a server-seed hash and reveals
  the seed(s) so the player can recompute the result in the browser.
- **Net-neutral economy (RTP = 1.0).** No house edge — games only redistribute
  coins via variance. Each game ships with a unit test asserting its RTP.
- **Atomic + locked.** Reuse `CasinoEngine.resolveSpin` — it already owns the
  pessimistic-lock + transaction + audit-row + `totalCoinsEarned` credit. **Do
  not write your own transaction or lock.**
- **Positive net winnings credit `profile.totalCoinsEarned`** (losses/pushes
  never reduce it). The engine already does this — you get it for free.
- **House style:** tabs for indentation; `private readonly` deps; explicit
  return types; wrap async/external calls so meaningful errors surface (the
  engine normalises unexpected failures to a 500); no magic numbers (extract
  named constants); no dead/commented-out code; merge consecutive `arr.push`;
  prefer `globalThis` over `window`. Run ESLint before declaring done.

### How to run things

```bash
cd backend
npx jest casino                 # run the casino suite
npx jest casino --coverage --coverageReporters=text   # per-file coverage
npx tsc --noEmit -p tsconfig.json                      # typecheck
npx eslint "src/modules/casino/**/*.ts"                # lint
```

Frontend: there is **no test runner installed**. Verify pure frontend logic by
(a) keeping pure math in plain `.ts` modules and exercising it with a throwaway
Node script, and (b) running `npm run build` (Vite) locally to typecheck the
`.tsx`. In the sandbox, Prettier and the full Vite/tsc build can't run (registry
blocked); note this and have the user run `npm run build` locally — ESLint
enforces formatting in the meantime.

In the dev container the DB `synchronize` is ON, so entity changes apply
automatically. **No migration is needed for these two games** — the `wagers`
table already has a `game VARCHAR` column, and adding new string values to it
requires no schema change. (The production migration that created the column is
`20260628010000-add-wager-game.ts`; you do not add another.)

**After backend changes, the user must rebuild/restart the backend container**
(`docker compose up -d --build backend`) for them to take effect.

---

## 1. What already exists (read these first)

Backend module — `backend/src/modules/casino/`:

| File | Purpose |
|---|---|
| `casino.constants.ts` | Shared types: `Rng`, `SpinMode`, **`CasinoGame`**, `SpinOptions`, `SpinFairness` (`roll` + `rolls: number[]`), **`SpinResolution`** (the engine's generic output), `SpinResult` (wheel-only). Shared wager bounds `MIN_WAGER_COINS`/`MAX_WAGER_COINS`. Wheel layout. |
| `casino.fair.ts` | Provably-fair primitives: `generateServerSeed()`, `hashSeed(seed)`, `computeRoll(serverSeed, clientSeed, nonce)` (single roll), **`computeRolls(serverSeed, clientSeed, nonce, count)`** (multi-roll, appends `:<i>`). |
| `casino.engine.ts` | **`CasinoEngine.resolveSpin(user, input, decide)`** — the locked/atomic/provably-fair core every game reuses. `ResolveInput = { game, mode, stake, paid, options, rolls?, precheck? }`. `Decide = (rollAt) => { outcomeId, multiplier }`. Returns `SpinResolution`. |
| `casino.service.ts` | Fortune Wheel (free + wagered spins, daily-free-spin guard). Uses the engine. |
| `flip.constants.ts` / `flip.service.ts` | **Shell Flip — your single-roll template.** A constants table + `FlipService.flip(user, pick, stake, options)` that validates input and calls `engine.resolveSpin`. |
| `monte.constants.ts` / `monte.service.ts` | **Three-Shell Monte — single-roll with a player-chosen parameter (`shells`) and a cross-field validation.** Closest analogue to Koi Dice's `target`/`direction`. |
| `slots.constants.ts` / `slots.service.ts` | **Shrine Slots — your multi-roll template.** `rolls: SLOT_REEL_COUNT` in the engine input, an `evaluate(...)` outcome function, and an **enumerated RTP test**. |
| `casino.controller.ts` | All routes. JWT + CSRF guards; rate limiting via `RateLimiterService`. Each game has a `GET` config route and a `POST` resolve route, delegating to its service. |
| `casino.module.ts` | Registers `CasinoEngine` + every game service as providers. |
| `dto/{flip,monte,slots}.dto.ts` | class-validator DTOs — your templates. |
| `entities/wager.entity.ts` | Immutable audit row. `game` discriminator; `segmentId` stores the **outcome id** generically; `multiplier` is the payout multiplier. |
| `*.spec.ts` | TDD specs — **your templates**, especially `flip.*.spec.ts` (single-roll) and `slots.*.spec.ts` (multi-roll + enumerated RTP). |

Frontend:

| File | Purpose |
|---|---|
| `frontend/src/features/hub/api.ts` | Typed REST client. Casino types + per-game `getX`/`x` methods. `SpinResolution`, `SpinFairness` (with `rolls`), `CasinoGame`. CSRF handled by `apiFetch`; call `await api.getCsrfToken()` before the first POST. |
| `frontend/src/components/casino/ShellFlipModal.tsx` | Single-roll modal template. |
| `frontend/src/components/casino/ShrineSlotsModal.tsx` | Multi-roll modal template (paytable + reel rolls). |
| `frontend/src/components/casino/{flip,monte,slots,wheel}.ts` | Pure per-game logic mirrors (Node-verifiable). |
| `frontend/src/components/casino/fairness.ts` | Browser verifier. `sha256Hex`, `computeRollBrowser`, `computeRollsBrowser`, generic **`verifyResolution(result, recomputeOutcome)`** (single- vs multi-roll aware), and per-game wrappers `verifyFlip` / `verifyMonte` / `verifySlots`. |
| `frontend/src/pages/HomePage.tsx` | Hub. `activeModal` union; the **gambit-view grid** (`view === "gambit"` → `hub-game-card` buttons, where the four casino shrine cards live); and the modal render blocks (each `activeModal === "<game>"` → `<HubModal>`). |
| `frontend/src/styles/global.css` | `.hub-wheel__*`, `.hub-flip__*`, `.hub-monte__*`, `.hub-slots__*` blocks at the end — templates for new game styles (theme vars `--accent`, `--accent-strong`, `--muted`, `--line`, `--panel`; `prefers-reduced-motion` respected). |

### Provably-fair recap (must stay byte-identical client/server)

- Commit: `serverSeedHash = sha256(serverSeed)`.
- **Single-roll** (`computeRoll`): `HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>")`, top 32 bits of the hex digest, ÷ `2**32` → `[0,1)`.
- **Multi-roll** (`computeRolls`, `count` rolls): same scheme, message `"<clientSeed>:<nonce>:<i>"` for `i = 0..count-1`.
- `nonce` = the player's prior wager count (monotonic).
- The engine puts `rolls[0]` in `fairness.roll` and the whole array in
  `fairness.rolls`. Reveal `serverSeed`, `serverSeedHash`, `clientSeed`,
  `nonce`, `roll`, `rolls`. The browser verifier recomputes and checks all of it.

### How a new game is wired (the shape to copy)

Single-roll game (like Flip/Monte):

```ts
// <game>.service.ts
return this.engine.resolveSpin(
  user,
  { game: "<game>", mode: "wagered", stake, paid: stake, options },
  (rollAt) => {
    const value = /* map rollAt(0) → outcome */;
    return { outcomeId: "<id>", multiplier: /* 0 on loss */ };
  },
);
```

Multi-roll game (like Slots) — add `rolls: N` and read `rollAt(0..N-1)`:

```ts
return this.engine.resolveSpin(
  user,
  { game: "<game>", mode: "wagered", stake, paid: stake, options, rolls: N },
  (rollAt) => evaluate(Array.from({ length: N }, (_, i) => /* rollAt(i) */)),
);
```

### One shared edit both games need

Extend the `CasinoGame` union in **two** places (no DB migration required):

- `backend/src/modules/casino/casino.constants.ts`:
  `export type CasinoGame = "wheel" | "flip" | "monte" | "slots" | "dice" | "drop";`
- `frontend/src/features/hub/api.ts`:
  `export type CasinoGame = "wheel" | "flip" | "monte" | "slots" | "dice" | "drop";`

Use `"dice"` for Koi Dice and `"drop"` for Shell Drop as the `game` ids.

---

## 2. Game spec — Koi Dice (single-roll, do this first)

A clean provably-fair dice game where **the player sets their own odds**: they
pick a target line 0–99 and bet the roll lands **under** or **over** it. The
payout scales with how unlikely their bet is, so the expected return is always
exactly 1.0.

### Rules & maths

- One roll. The shown dice value is `value = min(floor(rollAt(0) * 100), 99)` →
  an integer in `0..99`, each equally likely (uniform roll).
- **Under T:** win if `value < T`. Winning outcomes = `T`. Valid `T` ∈ `1..99`.
- **Over T:** win if `value > T`. Winning outcomes = `99 - T`. Valid `T` ∈ `0..98`.
- **Net-neutral payout:** `multiplier = 100 / winningOutcomes`.
  - Under T → `100 / T`. Over T → `100 / (99 - T)`.
  - EV = `p(win) × multiplier = (winningOutcomes / 100) × (100 / winningOutcomes) = 1.0` for **every** valid target and direction. ✔
- A win pays `floor(stake × multiplier)`; a loss pays 0. (The `floor` is the same
  tiny rounding all games share — RTP is net-neutral pre-floor.)

### Backend

`dice.constants.ts`:
- `DICE_RANGE = 100`, `DICE_MIN_VALUE = 0`, `DICE_MAX_VALUE = 99`.
- `DICE_DIRECTIONS = ["under", "over"] as const`; `type DiceDirection`.
- `diceValue(roll: number): number` → `Math.min(Math.floor(roll * DICE_RANGE), DICE_RANGE - 1)`.
- `diceWinningOutcomes(direction, target): number` → under: `target`; over: `DICE_RANGE - 1 - target`.
- `diceWin(direction, target, value): boolean`.
- `diceMultiplier(direction, target): number` → `DICE_RANGE / diceWinningOutcomes(direction, target)`.
- `diceRtp(direction, target): number` → `p(win) × multiplier` (returns 1.0; assert it).
- `targetBounds(direction)` helper for valid range (under 1..99, over 0..98).
- `DiceConfig` view type: `{ range, minTargetUnder, maxTargetUnder, minTargetOver, maxTargetOver, minWager, maxWager, coins }` (give the client whatever it needs to render the slider and live payout).

`dice.service.ts` (`DiceService`, injects `CasinoEngine`):
- `getDiceConfig(user): DiceConfig`.
- `dice(user, direction, target, stake, options)`:
  - validate `direction ∈ DICE_DIRECTIONS`,
  - validate `target` is an integer within `targetBounds(direction)` (cross-field — do it in the service, like Monte's `pick < shells`),
  - validate stake bounds,
  - `engine.resolveSpin({ game: "dice", mode: "wagered", stake, paid: stake, options }, rollAt => { const value = diceValue(rollAt(0)); const win = diceWin(direction, target, value); return { outcomeId: \`roll-${value}\`, multiplier: win ? diceMultiplier(direction, target) : 0 }; })`.

### Endpoints
- `GET /casino/dice` → config + balance.
- `POST /casino/dice` body `{ stake, direction, target, clientSeed? }`.

### DTO
`DiceDto { stake @IsInt @Min @Max; direction @IsIn(DICE_DIRECTIONS); target @IsInt @Min(0) @Max(99); clientSeed? @IsOptional @IsString @MaxLength(64) }`. The
direction-specific target range is validated in the service (cross-field).

### Tests (mirror `flip`/`monte` specs)
- `diceValue` band mapping (0 → 0, ~0.999 → 99) + clamp.
- `diceWin` / `diceMultiplier` for under and over at a few targets.
- **RTP test:** for every valid `(direction, target)`, `diceRtp` ≈ 1.0 (assert
  `p(win) × multiplier === 1`).
- Service: a win pays `floor(stake × 100/winCount)`; a loss pays 0; win credits
  `totalCoinsEarned`; loss doesn't; audit row tagged `game: "dice"`,
  `segmentId: "roll-<value>"`; bad direction / out-of-range target (per
  direction) / out-of-bounds or non-integer stake / insufficient coins rejected.
  (Use a `seedForValue(target)` helper like `flip`'s `seedForSide`.)

### Frontend
- `api.ts`: `DiceDirection`, `DiceConfig` types; `getDice()` and
  `dice(stake, direction, target, clientSeed?)` returning `SpinResolution`.
- `dice.ts` pure mirror: `diceValue`, `diceWin`, `diceMultiplier` (so the modal
  can show **live win-chance and payout** as the player drags the slider, and the
  verifier can recompute).
- `fairness.ts`: add `verifyDice(result, direction, target)` =
  `verifyResolution(result, rolls => \`roll-${diceValue(rolls[0])}\`)`. (Single
  roll → uses `computeRollBrowser`.)
- `KoiDiceModal.tsx` (mirror `ShellFlipModal`): an under/over toggle, a **target
  slider (0–99)**, a live readout of win-chance % and payout ×, stake input,
  result, balance sync, and the provably-fair panel with a working **Verify**
  button.
- HomePage: add `"dice"` to the `activeModal` union, a **Koi Dice** shrine card
  in the gambit grid, and a modal render block.
- `global.css`: a `.hub-dice__*` block using the theme vars; respect
  `prefers-reduced-motion`.
- Include the **"Play money only — no real-world value, fair payout 100%"**
  notice (as every game does).

Stop and get a review checkpoint after Koi Dice.

---

## 3. Game spec — Shell Drop (Plinko, multi-roll)

A shell falls through `R` rows of pegs; at each row a roll sends it left or
right. It lands in one of `R + 1` buckets — center buckets pay less than the
stake, edge buckets pay big. The bucket distribution is binomial, and the payout
multipliers are derived so the expected return is exactly 1.0.

### Rules & maths

- `R` = risk tier; offer `PLINKO_ROWS_OPTIONS = [8, 12, 16]` (default 8), like
  Monte's shell tiers / Slots' reels.
- Multi-roll: draw `R` rolls (`rolls: R` in the engine input). At row `i`,
  `rollAt(i) < 0.5` → left, else → right (same threshold as Flip). The **bucket
  index** `k` = number of right moves (`0..R`).
- Bucket probability is binomial: `p_k = C(R, k) / 2**R`.
- **Deriving net-neutral multipliers (recommended — exact RTP by construction):**
  choose a symmetric U-shaped *shape weight* `w_k = PLINKO_RISK_BASE ** |k - R/2|`
  (edges weigh more; `PLINKO_RISK_BASE > 1`, e.g. `1.6`), then normalise:
  - `Z = Σ_k p_k · w_k`
  - `M_k = w_k / Z`  ⟹  `Σ_k p_k · M_k = 1.0` exactly, for any base and any `R`.
  - This naturally makes center buckets pay `< 1×` and edges pay big. No bucket
    is a total loss (all `M_k > 0`); variance comes from center-vs-edge. Round
    only for display; the server and the config send the **exact** `M_k` so
    verification matches.
- `outcomeId = "bucket-<k>"`, `multiplier = M_k`. Payout = `floor(stake × M_k)`.

> Alternative if you prefer hand-picked "nice" multipliers (0.5×, 1×, 2×, …,
> big): you may instead hard-code a symmetric paytable per row-count and **tune
> it so the enumerated RTP lands in `[0.99, 1.0]`** (net-neutral, never above
> 1.0), exactly as Shrine Slots documents. If you go this route, the RTP test
> below must still pass by enumeration. The derivation approach above is
> preferred because it is exact and needs no tuning across three row-counts.

### Backend

`plinko.constants.ts`:
- `PLINKO_ROWS_OPTIONS = [8, 12, 16] as const`, `DEFAULT_ROWS = 8`,
  `PLINKO_RISK_BASE = 1.6` (named constant).
- `binomial(n, k)`, `bucketProbability(rows, k)` → `C(rows,k)/2**rows`.
- `bucketMultiplier(rows, k)` → derived `M_k` (memoise per `rows` if you like).
- `bucketIndexFromRolls(rolls)` → count of rolls `>= 0.5`.
- `evaluateDrop(rows, rolls)` → `{ outcomeId: "bucket-"+k, multiplier: bucketMultiplier(rows,k) }`.
- `plinkoRtp(rows)` → `Σ_k bucketProbability(rows,k) · bucketMultiplier(rows,k)` (enumerated; returns ≈1.0).
- `PlinkoView` type with, per selectable row-count, the bucket multipliers and
  probabilities the client needs to render the board + paytable; plus `rtp`,
  bounds, balance.

`plinko.service.ts` (`PlinkoService`, injects `CasinoEngine`):
- `getPlinkoView(user): PlinkoView`.
- `drop(user, rows, stake, options)`: default `rows` to `DEFAULT_ROWS`, validate
  `rows ∈ PLINKO_ROWS_OPTIONS` and stake bounds, then
  `engine.resolveSpin({ game: "drop", mode: "wagered", stake, paid: stake, options, rolls: rows }, rollAt => evaluateDrop(rows, Array.from({ length: rows }, (_, i) => rollAt(i))))`.

### Endpoints
- `GET /casino/plinko` → view (paytables per tier) + balance.
- `POST /casino/plinko` body `{ stake, rows?, clientSeed? }`.

### DTO
`PlinkoDto { stake @IsInt @Min @Max; rows? @IsOptional @IsIn(PLINKO_ROWS_OPTIONS); clientSeed? @IsOptional @IsString @MaxLength(64) }`.

### Tests (mirror `slots` specs)
- `bucketIndexFromRolls`: all-left → 0, all-right → R, a mixed case.
- `bucketProbability` sums to 1 over `k = 0..R`; symmetric (`p_k === p_{R-k}`).
- `evaluateDrop` returns `bucket-<k>` and the matching multiplier.
- **RTP enumeration test (the important part):** for each `R`, enumerate buckets
  `k = 0..R`, sum `bucketProbability(R,k) · bucketMultiplier(R,k)`, assert
  `≈ 1.0` (and within `[0.99, 1.0]`). Optionally also enumerate all `2**8` paths
  for `R = 8` to confirm the path→bucket distribution equals the binomial.
- Service: a center vs edge bucket pays its multiplier; `fairness.rolls` has
  length `R`; win credits `totalCoinsEarned`; loss (center `< 1×`) doesn't;
  audit row tagged `game: "drop"`, `segmentId: "bucket-<k>"`; out-of-bounds
  stake / bad rows / insufficient coins rejected. (Seed-find a jackpot/edge
  bucket with a `computeRolls`-based helper, like `slots`' `seedForJackpot`.)

### Frontend
- `api.ts`: `PlinkoView` type; `getPlinko()` and `dropPlinko(stake, rows?, clientSeed?)`.
- `plinko.ts` pure mirror: `bucketIndexFromRolls` and a helper to read a
  multiplier from the server-supplied paytable (so the modal and verifier use the
  exact server values).
- `fairness.ts`: add `verifyPlinko(result, rows)` =
  `verifyResolution(result, rolls => "bucket-" + bucketIndexFromRolls(rolls))`.
  (Multi-roll → uses `computeRollsBrowser`.)
- `ShellDropModal.tsx` (mirror `ShrineSlotsModal`): a row-count tier selector,
  an animated shell falling through the pegs into the winning bucket, the bucket
  multipliers shown along the bottom, result, balance sync, and the
  provably-fair panel with a working **Verify** button. Keep the falling
  animation behind `prefers-reduced-motion`.
- HomePage: add `"drop"` to the `activeModal` union, a **Shell Drop** shrine
  card, and a modal render block.
- `global.css`: a `.hub-drop__*` block using the theme vars.
- Include the play-money / fair-payout notice.

---

## 4. Build order & checkpoints

1. **Batch 1 — Koi Dice** (backend TDD → frontend). → review.
2. **Batch 2 — Shell Drop** (backend TDD, enumerated RTP → frontend). → review.

Do not start a batch until the previous one's review passes. At each review,
report: plan fidelity, standards, test coverage (aim ≥80% on service logic; the
existing casino services sit near 100%), and architecture consistency.

The shared `CasinoGame` union edit (§1) can land with Batch 1.

---

## 5. Acceptance criteria

- Two new games reachable as gambit shrine cards, each opening a working modal
  with an animated result and a working provably-fair **Verify** button.
- Each game: server-authoritative, atomic, pessimistic-locked, audited (with the
  `game` discriminator), provably fair, and **net-neutral (RTP test proves it)**.
- Koi Dice: payout scales with the player's chosen odds; EV = 1.0 for every
  target/direction. Shell Drop: binomial buckets; enumerated RTP ≈ 1.0 for every
  row-count.
- Positive net winnings credited to `totalCoinsEarned`; losses/pushes don't.
- `npx jest casino` all green with strong coverage; `tsc --noEmit` and ESLint
  clean; `npm run build` (frontend) typechecks locally.
- No regression in the four existing games.
- Remind the user to rebuild/restart the backend container.

---

## 6. Verification techniques available in this environment

- Backend: full Jest + tsc + ESLint work in the sandbox.
- **Crypto equivalence (browser vs backend):** prove the provably-fair Verify
  button will work with a throwaway Node script — reimplement the backend roll
  (`node:crypto`) and the browser mirror (`globalThis.crypto.subtle`) and confirm
  they match across many seeds/nonces. This was done for every existing game
  (e.g. slots multi-roll: 100/100 matched). For Koi Dice use the single-roll
  scheme; for Shell Drop use the multi-roll (`:<i>`) scheme.
- **Pure frontend math:** verify the mirror modules (`dice.ts`, `plinko.ts`)
  against the backend constants with a throwaway Node script.
- Prettier and a full frontend `tsc`/Vite build can't run in the sandbox
  (registry blocked / deps partial) — note this and have the user run
  `npm run build` locally; ESLint enforces formatting in the meantime.
```
