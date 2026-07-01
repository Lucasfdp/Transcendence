# Handoff: Implement three new casino games (Shell Flip, Three-Shell Monte, Shrine Slots)

You are implementing three new gambling games for the **Shell Smash** dojo's
gambling den. A first game — the **Fortune Wheel** — already exists and works.
Your job is to add three more **by following the wheel's proven patterns**, after
a small shared refactor so each new game stays tiny.

Treat this as a brownfield task: read the existing casino module first, copy its
conventions exactly, and do not re-architect anything that already works.

---

## 0. Non-negotiable working agreement

- **TDD, red-green-refactor.** Write the failing test first, watch it fail for a
  meaningful reason, then implement. The existing casino specs are your template.
- **Server-authoritative.** The client never computes an outcome. All randomness
  and all coin movement happen on the server inside a single DB transaction.
- **Provably fair.** Every resolved spin commits a server-seed hash and reveals
  the seed so the player can recompute the result.
- **Net-neutral economy (RTP = 1.0).** No house edge — games only redistribute
  coins via variance. Each game ships with a unit test asserting its RTP.
- **Atomic + locked.** Reuse the existing pessimistic-lock + transaction pattern.
- **House style:** tabs for indentation; `private readonly` deps; explicit return
  types; wrap async/external calls in try/catch and surface meaningful errors; no
  magic numbers (extract named constants); no dead/commented-out code; merge
  consecutive `arr.push`; prefer `globalThis` over `window`. Run ESLint before
  declaring done.
- **Every spin's positive net winnings are credited to `profile.totalCoinsEarned`**
  (losses/pushes never reduce it) — the wheel already does this; the shared engine
  below preserves it.

### How to run things

```bash
cd backend
npx jest casino                 # run the casino suite
npx jest casino --coverage --coverageReporters=text   # per-file coverage
npx tsc --noEmit -p tsconfig.json                      # typecheck
npx eslint "src/modules/casino/**/*.ts"                # lint
```

Frontend: there is **no test runner installed**. Verify frontend logic by (a)
keeping pure logic in plain `.ts` modules and exercising it with a throwaway Node
script, and (b) running `npm run build` (Vite) locally to typecheck `.tsx`.
In the dev container the DB `synchronize` is ON, so new entity columns/tables are
created automatically; the migration you write is for production.

**After backend changes, the user must rebuild/restart the backend container**
(`docker compose up -d --build backend`) for them to take effect.

---

## 1. The existing codebase (read these first)

Backend module — `backend/src/modules/casino/`:

| File | Purpose |
|---|---|
| `casino.constants.ts` | Wheel layout, RTP helpers, shared types (`Rng`, `SpinMode`, `SpinResult`, `SpinFairness`, `SpinOptions`), `selectSegment`. |
| `casino.fair.ts` | Provably-fair primitives: `generateServerSeed()`, `hashSeed(seed)`, `computeRoll(serverSeed, clientSeed, nonce)`. |
| `casino.service.ts` | `getWheelView`, `freeSpin`, `wageredSpin`, the locked/atomic `resolve`, daily-free-spin check, `totalCoinsEarned` credit. |
| `casino.controller.ts` | `GET /casino/wheel`, `POST /casino/wheel/free`, `POST /casino/wheel/spin`; JWT + CSRF guards; rate limiting via `RateLimiterService`. |
| `casino.module.ts` | Wires `Wager` + `User`, imports `UsersModule` + `AuthModule`. |
| `dto/spin.dto.ts` | `FreeSpinDto`, `SpinDto` (class-validator). |
| `entities/wager.entity.ts` | Immutable audit row per spin. |
| `*.spec.ts` | TDD specs — **your templates**. |

Frontend:

| File | Purpose |
|---|---|
| `frontend/src/features/hub/api.ts` | Typed REST client. Casino types + `getWheel`/`spinFreeWheel`/`spinWheel` live here (~line 490). CSRF handled by `apiFetch`; call `api.getCsrfToken()` before POSTs. |
| `frontend/src/components/casino/FortuneWheelModal.tsx` | The wheel modal — **template for each new game modal**. |
| `frontend/src/components/casino/wheel.ts` | Pure wheel geometry + `selectSegmentFrom`. |
| `frontend/src/components/casino/fairness.ts` | Browser Web-Crypto verifier (`sha256Hex`, `computeRollBrowser`, `verifySpin`). |
| `frontend/src/pages/HomePage.tsx` | Hub. `activeModal` union (~line 430), the courtyard shrine grid (`gameCards.map`, ~line 1129 — the Fortune Wheel shrine card is right after it), and the modal render blocks (~line 1847). |
| `frontend/src/styles/global.css` | `.hub-wheel__*` styles at the end — template for new game styles. |

### Provably-fair recap (must stay byte-identical client/server)

- Commit: `serverSeedHash = sha256(serverSeed)`.
- Roll: `HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>")`, take the top 32 bits of
  the hex digest (`parseInt(hex.slice(0,8), 16)`), divide by `2**32` → `[0,1)`.
- `nonce` = the player's prior wager count (monotonic).
- Reveal `serverSeed`, `serverSeedHash`, `clientSeed`, `nonce`, `roll` in the
  result. The browser verifier recomputes and checks all of it.

### Known gotcha (do not reintroduce)

`User` eager-loads `Profile`. A `findOne` with `lock: pessimistic_write` then
emits a `LEFT JOIN` and Postgres rejects `FOR UPDATE` on the nullable side of an
outer join. The locked read **must** pass `loadEagerRelations: false`. The shared
engine already does this — don't remove it.

---

## 2. Batch 1 (do this first): extract a shared wager engine

Goal: make each new game ≈ "a constants table + an outcome function + a thin
service method + a controller route + a frontend modal." Refactor the wheel onto
the shared core **without changing its behaviour** (its tests must stay green).

### 2a. Add a `game` discriminator to the audit table

- Entity `wager.entity.ts`: add `game: CasinoGame` (`type CasinoGame = "wheel" |
  "flip" | "monte" | "slots"`, define in `casino.constants.ts`). Column
  `@Column({ type: "varchar", default: "wheel" })`.
- Migration `backend/src/migrations/<timestamp>-add-wager-game.ts` (timestamp >
  `20260628000000`): `ALTER TABLE wagers ADD COLUMN IF NOT EXISTS game VARCHAR NOT
  NULL DEFAULT 'wheel'`; reversible `down`. Follow the style of
  `20260628000000-create-wagers.ts`.
- Repurpose existing generic columns: `segmentId` stores the **outcome id**
  (e.g. `"heads"`, `"shell-1"`, `"bell|bell|bell"`); `multiplier` stays the payout
  multiplier. No new outcome columns needed.

### 2b. Add a multi-roll fairness helper (for slots)

In `casino.fair.ts` add, with its own spec:

```ts
/** `count` independent rolls for one spin: HMAC over "<clientSeed>:<nonce>:<i>". */
export function computeRolls(
  serverSeed: string, clientSeed: string, nonce: number, count: number,
): number[]
```

Implement it with the same top-32-bits scheme as `computeRoll`, appending `:i`.
Single-roll games keep using `computeRoll` unchanged. **Mirror this exactly in
`frontend/src/components/casino/fairness.ts`** so the browser verifier works for
slots.

### 2c. Extract the engine

Create `casino.engine.ts` (an injectable) that owns the locked/atomic core:

```ts
interface ResolveInput {
  game: CasinoGame;
  mode: SpinMode;       // "free" | "wagered"
  stake: number;        // coins the payout scales from
  paid: number;         // coins actually debited (0 for free)
  options: SpinOptions; // clientSeed?, serverSeed?
}
// `decide` receives a roll accessor (rollAt(0), rollAt(1), …) and returns the
// outcome. 1-roll games read rollAt(0); slots read rollAt(0..2).
type Decide = (rollAt: (index: number) => number) =>
  { outcomeId: string; multiplier: number };

resolveSpin(user: User, input: ResolveInput, decide: Decide): Promise<SpinResult>
```

`resolveSpin` must, inside one `dataSource.transaction`:
1. Lock the user row (`findOne` with `lock: pessimistic_write`,
   **`loadEagerRelations: false`**).
2. `nonce = wagers.count({ where: { user: { id } } })`.
3. Generate/commit the server seed; build `rollAt` via `computeRolls(seed,
   clientSeed, nonce, N)` (use a small max N, or pass N in).
4. Call `decide(rollAt)` → `{ outcomeId, multiplier }`.
5. `payout = Math.floor(stake * multiplier)`, `net = payout - paid`; apply
   `user.coins = coins - paid + payout`; save.
6. If `net > 0`, credit `profile.totalCoinsEarned += net` (load `Profile` via
   `manager.getRepository(Profile).findOne({ where: { user: { id } } })`).
7. Write the `Wager` audit row (`game`, `mode`, `stake`, `paid`,
   `segmentId: outcomeId`, `multiplier`, `payout`, `net`, seeds, `nonce`).
8. Return a `SpinResult` (extend the type with `game` and, for multi-roll games,
   `rolls: number[]` in `fairness`, or keep `roll` as `rollAt(0)` plus a `rolls`
   array — pick one and use it consistently).

Then refactor `CasinoService.resolve` (wheel) to call `engine.resolveSpin(..., (rollAt) =>
{ const s = selectSegment(rollAt(0)); return { outcomeId: s.id, multiplier: s.multiplier }; })`.
Keep stake-bounds validation, the daily-free-spin guard, and `getWheelView` where
they are. **Wheel tests must remain green** — this is a pure refactor for the wheel.

Stop and get a review checkpoint after Batch 1.

---

## 3. Game specs

Each game follows the same shape: a constants file (config + RTP test), a service
method calling `engine.resolveSpin`, a `GET` config endpoint + a `POST` spin
endpoint, a DTO, an `api.ts` method + types, a modal, a courtyard shrine card, and
CSS. Build one game fully (backend → frontend) and get a review before the next.

### 3a. Shell Flip — simplest

- **Rules:** player picks a side, `"heads"` or `"tails"` (theme it as gold vs jade
  shell). One roll → `side = rollAt(0) < 0.5 ? "heads" : "tails"`. Win (pick ==
  side) pays **2×**; otherwise 0.
- **RTP:** p(win) = 0.5, payout 2× → EV = 1.0 exactly. Net-neutral. ✔
- **Backend:** `flip.constants.ts` (`FLIP_MULTIPLIER = 2`, reuse `MIN_WAGER_COINS`
  / `MAX_WAGER_COINS`). Service `flip(user, pick, stake, options)` → validate stake
  bounds + `pick ∈ {heads,tails}` → `engine.resolveSpin({ game:"flip", ... },
  rollAt => { const side = rollAt(0) < 0.5 ? "heads":"tails"; return { outcomeId:
  side, multiplier: side === pick ? FLIP_MULTIPLIER : 0 }; })`.
- **Endpoints:** `POST /casino/flip` body `{ stake, pick, clientSeed? }`. (Config is
  trivial; you may add `GET /casino/flip` returning bounds + balance for
  consistency, or just reuse the player's coin balance from `getMe`.)
- **DTO:** `FlipDto { stake: @IsInt @Min @Max; pick: @IsIn(["heads","tails"]);
  clientSeed?: @IsOptional @IsString @MaxLength(64) }`.
- **Tests:** win pays 2×; loss pays 0; net credited to `totalCoinsEarned` on win;
  bad pick / out-of-bounds stake / insufficient coins rejected; RTP test
  (`0.5*2 + 0.5*0 === 1`).

### 3b. Three-Shell Monte

- **Rules:** a pearl hides under one of `N` shells (default `N = 3`; optionally let
  the player choose `N ∈ {3,4,5}` for risk). One roll → `winning =
  Math.min(Math.floor(rollAt(0) * N), N - 1)`. Win (pick == winning) pays **N×**.
- **RTP:** p(win) = 1/N, payout N× → EV = 1.0 for any N. Net-neutral. ✔
- **Backend:** `monte.constants.ts` (`MONTE_SHELL_OPTIONS = [3,4,5]`,
  `DEFAULT_SHELLS = 3`). Service `monte(user, pick, shells, stake, options)` →
  validate `shells ∈ options`, `0 <= pick < shells`, stake bounds → resolve with
  `outcomeId = "shell-"+winning`, `multiplier = pick===winning ? shells : 0`.
- **Endpoints:** `POST /casino/monte` body `{ stake, pick, shells?, clientSeed? }`.
- **DTO:** `MonteDto { stake; pick: @IsInt @Min(0); shells?: @IsOptional @IsIn([3,4,5]);
  clientSeed? }`. (Validate `pick < shells` in the service since it's cross-field.)
- **Tests:** win pays N× for each N; loss 0; pick≥shells rejected; RTP test for
  each N.

### 3c. Shrine Slots — most involved

- **Rules:** 3 reels, identical symbol set. Roll each reel independently via
  `computeRolls(..., 3)` and `selectSymbol(rollAt(i))`. Pay by the resulting
  combination (see paytable). `outcomeId = "<s0>|<s1>|<s2>"`.
- **Reels & symbols:** reuse existing icon names (e.g. `shell, bell, bamboo, koi,
  lantern, dragon`). **Start with uniform weights (each symbol equally likely per
  reel)** — this makes the RTP closed-form and easy to verify.
- **Paytable & RTP (the important part):** with uniform reels (each symbol
  probability `1/6`) and **three-of-a-kind only**, RTP `= Σ_s (1/6)^3 · M_s =
  (1/216)·Σ M_s`. So **`Σ M_s = 216` gives RTP exactly 1.0.** A clean starter
  (rarer-feeling symbols pay more; with uniform weights this is purely flavour):
  `dragon 80, lantern 48, koi 36, bamboo 24, bell 16, shell 12` (sum = 216).
  - Three-of-a-kind only means a win ~1/36 of spins (feels sparse). If you want
    more frequent small wins, add a low payout for "any two matching" (or two of a
    specific low symbol) and **re-tune so the enumerated RTP returns to ~1.0**.
  - **RTP must be verified by enumeration, not by hand.** Write a test that
    enumerates all weighted reel combinations (6³ = 216 for uniform; weight each
    combo by its probability), sums `probability · payoutMultiplier`, and asserts
    the result. Target net-neutral; assert `rtp` is within `[0.99, 1.0]` and
    document the exact value. (If you keep pure 3-of-a-kind it is exactly 1.0.)
- **Backend:** `slots.constants.ts` (`SLOT_SYMBOLS` with weights, `PAYTABLE`,
  `selectSymbol(roll)`, `evaluate(symbols) -> { outcomeId, multiplier }`,
  `slotsRtp()`). Service `slots(user, stake, options)` → resolve with
  `decide = rollAt => evaluate([0,1,2].map(i => selectSymbol(rollAt(i))))`.
- **Endpoints:** `GET /casino/slots` (symbols, paytable, RTP, bounds, balance —
  the client needs the paytable) and `POST /casino/slots` body `{ stake,
  clientSeed? }`.
- **DTO:** `SlotsSpinDto { stake; clientSeed? }`.
- **Tests:** `selectSymbol` band mapping + clamping; `evaluate` pays correct
  multiplier for three-of-a-kind and 0 otherwise (and any-two if added); RTP
  enumeration test; service win credits `totalCoinsEarned`; standard rejection
  cases.

---

## 4. Frontend for each game

For every game, mirror `FortuneWheelModal.tsx`:

1. **`api.ts`** — add result/config types and the methods, e.g.
   `flip(stake, pick, clientSeed?)`, `monte(stake, pick, shells?, clientSeed?)`,
   `getSlots()` / `spinSlots(stake, clientSeed?)`. Reuse `SpinResult` (extended
   with `game`/`rolls`). POST methods rely on `apiFetch`; call
   `await api.getCsrfToken()` before the first POST (the wheel modal shows the
   pattern).
2. **Modal component** in `components/casino/` — load config on mount, take
   `{ coins, onCoinsChange }` props, render the game, animate the result, sync the
   balance, show the provably-fair panel with a **Verify** button (extend
   `fairness.ts` so verification covers each game's roll(s) — for slots use the
   `computeRolls` mirror and the client-side symbol/paytable to recompute the
   outcome). Keep pure logic (reel selection, flip/monte resolution mirror) in a
   small `.ts` module so it can be Node-verified.
3. **HomePage wiring** — add the game id to the `activeModal` union, add a shrine
   card in the courtyard grid (copy the `hub-game-card--casino` Fortune Wheel
   card), and add a modal render block next to the existing ones.
4. **CSS** — add a `.hub-<game>__*` block to `global.css` using the theme vars
   (`--accent`, `--accent-strong`, `--muted`, `--line`, `--panel`); respect
   `prefers-reduced-motion`.
5. Include the **"Play money only — no real-world value, fair payout 100%"**
   notice on each game (as the wheel does).

---

## 5. Build order & checkpoints

1. **Batch 1** — shared engine + `game` column/migration + `computeRolls`
   (+ browser mirror). Wheel refactored, all existing tests green. → review.
2. **Batch 2** — Shell Flip backend (TDD) → frontend. → review.
3. **Batch 3** — Three-Shell Monte backend (TDD) → frontend. → review.
4. **Batch 4** — Shrine Slots backend (TDD, enumeration RTP) → frontend. → review.

Do not start a batch until the previous one's review passes. At each review,
report: plan fidelity, standards, test coverage (aim ≥80% on service logic;
the existing casino service sits at ~100%), and architecture consistency.

---

## 6. Acceptance criteria

- Three new games reachable as courtyard shrine cards, each opening a working
  modal with animated results and a working provably-fair Verify button.
- Each game: server-authoritative, atomic, pessimistic-locked, audited (with the
  `game` discriminator), provably fair, and **net-neutral (RTP test proves it)**.
- Positive net winnings credited to `totalCoinsEarned`; losses/pushes don't.
- `npx jest casino` all green with strong coverage; `tsc --noEmit` and ESLint
  clean; `npm run build` (frontend) typechecks.
- No regression in the Fortune Wheel.
- Remember to tell the user to rebuild/restart the backend container.

---

## 7. Verification techniques available in this environment

- Backend: full Jest + tsc + ESLint work.
- Crypto equivalence (browser vs backend): runnable with Node's `crypto` +
  `globalThis.crypto.subtle` (proven during the wheel build — 36/36 combos matched).
- Pure frontend math: verify with a throwaway Node script (the wheel rotation
  round-trip was checked this way — 192/192).
- Prettier and a full frontend `tsc`/Vite build can't run in the sandbox
  (registry blocked / deps partial) — note this and have the user run
  `npm run build` locally; ESLint enforces formatting in the meantime.
