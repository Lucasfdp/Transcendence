# Casino (Gambling Den) — Deep-Dive Audit Report

**Date:** 2026-07-07
**Scope:** The full gambling subsystem as mapped by `graphify-out/graph.json` — backend `backend/src/modules/casino/` (wheel, flip, monte, slots, dice, plinko + shared engine/fairness + wager audit table), frontend `frontend/src/components/gambling/` (six modals; pure-logic helpers live in `frontend/src/features/gambling/`), the API layer in `frontend/src/features/hub/api.ts`, wiring in `frontend/src/pages/HomePage.tsx`, and the adjacent modules that share the `users.coins` wallet (cards, customization, game-results).
**Audience:** This report is written for an agent to execute the fixes. Every finding has file:line references, a reproduction path, and a concrete fix instruction. Findings are ordered by priority. A "verified safe" section at the end lists things that were checked and should NOT be "fixed".

**Overall assessment:** the casino core is well-engineered — pessimistic row lock, single transaction, provably-fair seeds, whitelisted DTOs, strong spec coverage. The bugs live at the edges: animation/unmount interactions, cross-module wallet writers that don't use the engine's locking discipline, rate-limit keying, and integer flooring of payouts.

---

## Priority 1 — user-visible correctness bugs

### 1.1 Closing a casino modal mid-animation permanently desyncs the hub coin balance

**Severity:** High. Affects all six games.

The server settles the wager the moment the POST returns, but every modal defers `onCoinsChange(outcome.coins)` until the cosmetic animation completes:

- `runBoardAnimation`'s cancel function sets `cancelled = true` and never invokes `onComplete` — `frontend/src/features/gambling/board-canvas.ts:170-173` (consolidated into `features/gambling` in Phase 4; line numbers unchanged).
- Each modal calls `onCoinsChange` only inside its `finish()` callback, which is `runBoardAnimation`'s `onComplete` (Fortune Wheel), or inside a `syncCoins` helper reached from both `finish()` and the active-animation effect's cleanup (Koi Dice, Shell Flip, Shrine Slots, Shell Drop):
  - `FortuneWheelModal.tsx` — mount-effect cleanup (`cancelled = true`) at `components/gambling/FortuneWheelModal.tsx:193-200`; `finish()` at `:230-252`.
  - `KoiDiceModal.tsx` — load-effect cleanup at `components/gambling/KoiDiceModal.tsx:140-142`; `finish()` (in the separate active-roll effect) at `:194-202`.
  - `ShellFlipModal.tsx` — load-effect cleanup at `components/gambling/ShellFlipModal.tsx:159-161`; `finish()` (in the separate active-flip effect) at `:194-202`.
  - `ShrineSlotsModal.tsx` — load-effect cleanup at `components/gambling/ShrineSlotsModal.tsx:195-197`; `finish()` (in the separate active-spin effect) at `:256-263`.
  - `ShellDropModal.tsx` — load-effect cleanup at `components/gambling/ShellDropModal.tsx:250-252`; `finish()` (in the separate active-drop effect) at `:322-329`.
  - `ThreeShellMonteModal.tsx` does **not** belong in this list — it has no `board-canvas`/`finish()` pattern at all; `onCoinsChange` is called directly inline in `startRound`/`resolveRound` (`ThreeShellMonteModal.tsx:233`, `:253`). This entry was already wrong before Phase 4.

  **Note (Phase 7, 2026-07-15):** the ranges above are freshly re-verified against the post-rename `components/gambling/` files (Phase 4's line-number drift, called out here as of the Phase 4 gate, predated that migration and was unrelated to it). For Koi Dice, Shell Flip, Shrine Slots, and Shell Drop specifically, `finish()` lives in a *different* effect than the one with the `cancelled = true` cleanup — a "load config" effect vs. a "active animation" effect keyed on `pendingOutcome` — and that second effect now has a `settled`/`syncCoins` guard that flushes the pending outcome's coins on unmount even if `finish()` never runs. That flush-on-cleanup pattern wasn't present when this finding was first written; whether it fully closes out 1.1 for those four modals (as opposed to just Fortune Wheel's `pendingCoinsRef` flush) wasn't re-verified as part of this documentation pass and should be checked before acting on this finding.
- `HomePage.tsx:3896-3961` unmounts the modal on close (conditional render), so closing mid-animation runs the effect cleanup → `cancel()` → `finish()` never fires → `setPlayer(...coins)` never happens.

**Repro:** open Fortune Wheel, spin (4.2 s animation, `SPIN_DURATION_MS` at `FortuneWheelModal.tsx:28`), close the modal within ~4 s. The hub header (`HomePage.tsx:2126`) still shows the pre-spin balance even though the server debited/credited. The stale value persists until something else refetches the player.

**Fix:** sync the wallet as soon as the server responds; keep the animation purely presentational. In each modal, call `onCoinsChange(outcome.coins)` (via the existing `onCoinsChangeRef` where present) immediately after `await api.<spin>()` resolves — i.e. in `runSpin`/`runRoll`/`runFlip`/`runMonte`/`runDrop` next to `setPendingOutcome(outcome)` — and remove the call from `finish()`. `finish()` keeps `setResult`, per-modal view-coin updates, and flag updates (e.g. `freeSpinAvailable` in `FortuneWheelModal.tsx:208-219`, which should also move to the immediate path since it's server truth, not presentation). Do NOT instead make `cancel` fire `onComplete`: `finish` calls `setState` on an unmounting component.

**Tests:** frontend uses Vitest + Testing Library (`frontend/package.json`, `src/test/`). Add a test per modal (or one representative + the shared pattern): mock `api.spinWheel` to resolve, unmount before animation completes, assert `onCoinsChange` was called with the server balance. Name per repo convention, e.g. `it("syncs coins to the hub immediately on server settle, even if unmounted mid-animation")`.

### 1.2 Lost-update race on `users.coins` between the casino and every other wallet writer

**Severity:** High (data integrity). The casino does this correctly; its neighbours don't, and they run concurrently against the same column.

`CasinoEngine.lockUser` takes `pessimistic_write` with `loadEagerRelations:false` (`backend/src/modules/casino/casino.engine.ts:98-113`). But:

- `CardsService.openPack` — `backend/src/modules/cards/cards.service.ts:110-141` — reads the user inside its transaction with a plain `findOne` (no lock, and with `relations:["profile"]`, which would also break `FOR UPDATE` if one were added naively), then does read-modify-write on `coins`.
- `CustomizationService` buy path — `backend/src/modules/customization/customization.service.ts:107-111` — same read-modify-write on `coins`, no lock.
- `GameResultsService.submitResult` — `backend/src/modules/game-results/game-results.service.ts:53-67` — computes `coins = user.coins + coinsGained` from a user entity loaded earlier by the controller (stale by the time it saves), then cascade-saves.

Under READ COMMITTED, a casino spin committing between another writer's read and save (or vice versa) is silently overwritten — coins are minted or destroyed. Repro is scriptable: fire `POST /casino/slots` and `POST /cards/packs/open` concurrently in a loop and diff expected vs actual balance.

**Fix:** reuse the engine's discipline in all three services: inside the transaction, re-fetch the user with `lock: { mode: "pessimistic_write" }, loadEagerRelations: false` (fetch profile/relations separately after the lock, as the engine does for Profile at `casino.engine.ts:160-168`). Alternative for simple deltas: atomic SQL (`UPDATE users SET coins = coins - :price WHERE id = :id AND coins >= :price` and check affected rows). Keep the "Not enough coins" check against the locked row. Consider extracting `lockUser` into a shared helper so the pattern can't drift.

**Tests:** backend Jest (`cd backend && npm run test`). Mirror the engine's locking specs (`casino.engine.spec.ts` "locking" describe block) in `cards.service.spec.ts` / `customization.service.spec.ts` / `game-results.service.spec.ts`: assert the repo receives `lock: { mode: "pessimistic_write" }`.

---

## Priority 2 — will fall over in front of users

### 2.1 Spin rate limit: one shared per-IP bucket for all six games — legit players will hit 429

`backend/src/modules/casino/casino.controller.ts:46-48` — `SPIN_BUCKET = "casino-spin"`, 30 requests / 60 s, keyed by IP via `rateLimiter.allow(req, ...)` (`:223-234`).

Two failure modes:

1. A single legitimate player can exceed it alone. Koi Dice's animation is 1.65 s (`KoiDiceModal.tsx:30`) → ~36 rolls/min is reachable by an engaged player; the bucket also aggregates across all six games, so alternating dice + flip gets there faster. Result: intermittent "Too many spins — slow down." for normal play.
2. The key is the client IP. Players behind one NAT (a campus — this is a 42 project — or any shared egress) share one bucket: one player's spins starve everyone else's.

**Fix:** key by user, not IP: JwtAuthGuard has already populated `req.user.id` when `enforceSpinRate` runs, so switch to `this.rateLimiter.allowKey(SPIN_BUCKET, String(req.user.id), ...)`. `RateLimiterService.allowKey` exists precisely for this (`backend/src/modules/auth/rate-limiter.service.ts:43-62`, its doc cites "Bug Audit M7"). Then either raise `SPIN_MAX_PER_WINDOW` (e.g. 60) or use a per-game bucket suffix so one fast game can't starve the others. Update the controller spec's rate-limit cases (`casino.controller.spec.ts`).

### 2.2 `Math.floor` payouts contradict the advertised "no house cut", and break-even wins render as losses

Engine: `payout = Math.floor(stake × multiplier)` (`casino.engine.ts:151`).

Consequences:

- **Koi Dice** (`dice.constants.ts:77-82`): "under 99" pays 100/99 ≈ 1.0101×. For every stake from 10 to 98, `floor(stake × 1.0101) === stake` → a *winning* roll returns exactly the stake, net 0. The UI (`KoiDiceModal.tsx:299-309`) styles `net > 0 ? is-win : is-loss` and prints `0 ⬡` — a win displayed as a loss. Realized RTP is also below the promised 1.0 (e.g. stake 50 under 99: EV = 49.5, a 1% house edge), while the footer says "fair payout 100%" (`KoiDiceModal.tsx:466-469`).
- **Shell Drop** (`plinko.constants.ts:73-88`): every fractional multiplier is floored on every drop; near-1.0 buckets can also produce net-0 "wins" rendered with `is-loss` (`ShellDropModal.tsx:393-403`). Tier RTP shown as e.g. "fair payout 100%" (`:536-539`) is not what flooring delivers at low stakes.
- **Wheel** "½×" segment: odd stakes lose the extra half-coin. Marginal, same cause. (The wheel already handles multiplier-1 pushes with distinct copy, `FortuneWheelModal.tsx:278-296` — only casino-wide flooring drift remains.)

**Fix (recommended, minimal):** keep `floor` in the engine (integer coins; changing rounding alters the audited economy) and fix the presentation + copy:

1. In KoiDiceModal and ShellDropModal, add a push branch: `net === 0` → neutral styling and copy like "Push — stake returned" (the wheel already has the pattern and a `is-push` class, `FortuneWheelModal.tsx:280-296`).
2. Soften the absolute claims: "fair payout ~100% (payouts round down to whole coins)" in the notices of dice/plinko (and optionally wheel/slots for consistency). The RTP tables/percentages themselves are fine.
3. Optional, nicer for dice: in `KoiDiceModal`, show the *effective* payout for the current stake (`floor(stake × mult)`) next to "Pays X×" so the player sees net-0 targets before betting.

Do NOT change `diceMultiplier`/`bucketMultipliers` maths — specs enumerate RTP = 1.0 by construction and the multipliers are stored on audit rows.

### 2.3 Shell Drop: switching row tier after a result desyncs the whole board

**Already fixed — verify only.** As of the Phase 4 gate (2026-07-15), this bug no longer reproduces: the tier `onClick` (`ShellDropModal.tsx:463-473`) already calls `setResult(null); setVerify(null);` alongside `setRows(option)`, with a comment crediting the same pattern in Monte. `ShellDropModal.test.tsx` has a passing regression test for exactly this ("should clear a landed result when the player switches row tiers afterward"). The line numbers below (`:365-367`, `:393`, `:250-273`, `:408-420`) are stale and predate Phase 4 by a wide margin (the actual lines today are ~405-473) — this is not a Phase 4 side effect, the fix (and the drift) were already in place before this migration started. Leaving the original text for history/traceability:

- ~~`landedView = bucketView(tier.buckets, landedBucket)` (`:365-367`) — after a 20-row drop into bucket 15, selecting the 8-row tier makes `bucketView` return `undefined` → the result line silently disappears (`:393`).~~
- ~~The idle-board redraw effect (`:250-273`) recomputes `computeDropPath(tier.rows, result.fairness.rolls)` with 8 rows against 20 rolls → shell parked at a wrong bucket; no bucket highlight matches.~~

Monte already solved this: `resetBoard` clears `result`/`verify`/round state (`ThreeShellMonteModal.tsx:269-279`). The code comment at `components/gambling/ShellDropModal.tsx:468-469` used to call this function `changeShells` — a name that doesn't exist anywhere in `ThreeShellMonteModal.tsx` (no function or state with that name; Monte has no shell-count selector today, it's fixed at 3 cups). This was a pre-existing rename/removal that predated Phase 4; the comment has now been corrected (Phase 7, 2026-07-15) to say `resetBoard`.

**Fix:** in the rows-tier `onClick` (`ShellDropModal.tsx:408-420`), clear round state like Monte does: `setResult(null); setVerify(null);` alongside `setRows(option)`. (Alternatively persist the played tier on the result like Monte's `PendingReveal`, but clearing is simpler and matches sibling behaviour.)

---

## Priority 3 — robustness / maintainability

### 3.1 Engine catch block swallows all diagnostics

`casino.engine.ts:91-94`: any non-`HttpException` (DB failure, the `RangeError` from `rollAt`, a bug in a game's `decide`) becomes a bare 500 "Failed to resolve the spin" with **no logging anywhere**. Production spins that fail will be undiagnosable. Same pattern in `cards.service.ts:143-145`.

**Fix:** add a `private readonly logger = new Logger(CasinoEngine.name)` and `this.logger.error("resolveSpin failed", err instanceof Error ? err.stack : String(err))` before throwing the 500. Same in CardsService. Add a spec asserting the logger is called on unexpected failure.

### 3.2 Daily free-spin lookup isn't filtered by game

`casino.service.ts:123-134` — `findTodaysFreeSpin` matches `mode: "free"` for the user with no `game` filter. Today only the wheel writes `mode: "free"`, so it works; the moment any other game gains a free mode, it consumes the wheel's daily spin (and vice versa). Silent latent trap in a shared audit table that already has a `game` discriminator.

**Fix:** add `game: "wheel"` to the `where`. One-line; update the two freeSpin specs if they assert the query shape.

### 3.3 Nonce derivation: per-user `count(*)` per spin + inaccurate doc

`casino.engine.ts:131-133` — nonce = `wagersRepo.count({ user })` on every spin. Correctness is fine (serialized under the row lock; seeds are per-spin so uniqueness isn't load-bearing), but: (a) the count query scans the user's entire wager history on every spin — unbounded growth per spin; (b) `wager.entity.ts` documents nonce as "Per-(user, serverSeed) monotonic counter", which is wrong — it's a per-user lifetime counter.

**Fix:** cheapest: fix the entity comment. Better: keep a `wagerCount` counter column on `users` (incremented under the existing lock) and use it as the nonce — O(1) and identical semantics. Either way, don't change the roll derivation (`casino.fair.ts`) — revealed historical fairness data must stay recomputable.

### 3.4 `Wager.multiplier` stored as `REAL` (float4)

`wager.entity.ts` (`@Column({ type: "real" })`) and migration `20260628000000-create-wagers.ts`. Dice multipliers like 100/99 lose precision in the audit row. `payout`/`net` are already-computed integers so money is unaffected; this only degrades the audit trail. **Fix (optional):** migrate the column to `double precision`. Low priority.

### 3.5 ShellDropModal bypasses the shared reduced-motion hook

`ShellDropModal.tsx:308-310` does a one-shot `matchMedia` read at animation start instead of using `useReducedMotion` like the other five games — non-reactive, and `useReducedMotion.ts`'s doc even claims Shell Drop follows the contract. **Fix:** use the hook via a ref like `KoiDiceModal.tsx:110-116` does.

### 3.6 Small UX papercuts (batch, optional)

- Stake inputs: `setStake(Math.floor(Number(e.target.value)))` in all six modals — clearing the field snaps to `0` and flashes "Stake must be 10–1000 coins". Consider holding the raw string and validating on blur/submit.
- Load-failure states ("Could not load the wheel." etc.) have no retry button in any modal — a transient failure forces close/reopen.
- `ShellFlipModal.tsx:160-164`: if `coinRef`/`labelRef` were ever null the effect returns early with `flipping` stuck true and the settled outcome never revealed. Unreachable today (elements always render), but a `finish()`-without-animation fallback (like slots' `allCanvasesReady` path, `ShrineSlotsModal.tsx:276-287`) is cheap hardening.
- Wheel free-spin availability computed at open; a modal left open across UTC midnight shows stale "Free spin used today". Label could say "resets at midnight UTC".

---

## Verified safe — do not "fix" these

Checked explicitly during this audit; listed so the fixing agent doesn't chase them:

- **`serverSeed` override cannot be injected by clients.** `SpinOptions.serverSeed` exists for tests only; controllers pass only `dto.clientSeed`, and the global `ValidationPipe({ whitelist: true })` (`backend/src/main.ts:20-22`) strips unknown body fields.
- **No double-spend via HTTP retries.** `apiFetch` retries non-GET only when `idempotent: true`, which no casino call sets (`frontend/src/services/api/apiClient.ts:104-120` — moved from `features/hub/api.ts` when the shared HTTP transport was extracted, see `docs/frontend-cards-and-gambling-migration-phases.md` Phase 1); the CSRF-failure replay only fires when the original request was rejected *by CSRF* and therefore never executed.
- **Concurrent spins by one user are safe.** The pessimistic user-row lock serializes them; the free-spin precheck runs inside the transaction after the lock (`casino.service.ts:62-72`), so double-claiming the daily spin is not possible.
- **`verifyDice` is immune to post-roll slider changes.** It ignores `direction`/`target` (underscored params, `frontend/src/features/gambling/fairness.ts:278-286`; the old `:201-209` anchor predates this migration and was already stale before the move) and recomputes only the rolled value. The `playedShells`/`ThreeShellMonteModal.tsx:537` claim in the previous revision of this line does not correspond to any code in the current modal (no shell-count selector exists — Monte is fixed at 3 cups, and the round-reset logic lives in `resetBoard`, `ThreeShellMonteModal.tsx:269-279`); this predates the Phase 4 migration and is flagged in `docs/frontend-cards-and-gambling-migration-phases.md` Phase 7 for a full rewrite rather than a line-shift patch.
- **Client fairness maths mirrors the server.** `dice.ts`/`flip.ts`/`monte.ts`/`plinko.ts`/`slots.ts`/`wheel.ts` (now `frontend/src/features/gambling/`, consolidated out of the modal directory in Phase 4) were diffed against the backend constants — thresholds, clamps and outcome-id formats match, including the single-roll vs multi-roll HMAC message scheme (`frontend/src/features/gambling/fairness.ts:150-171` vs `casino.fair.ts`).
- **Slots reskin assets all exist** (`public/assets/character/{godly,reaper,samurai}-turtle.*`, `public/assets/power-ups/{rocket,mirror,tiny}Power.png`).
- **Rate limiter IP extraction is not spoofable** — it deliberately uses `req.ip` under `trust proxy 1` rather than parsing `X-Forwarded-For` (documented in `rate-limiter.service.ts:81-96`).

## Execution notes for the fixing agent

- Work order: 1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 3.x. Items 1.1/2.2/2.3/3.5/3.6 are frontend-only; 1.2/2.1/3.1–3.4 are backend-only. They can be done as independent commits (repo convention: short, direct messages, one idea per commit — see CLAUDE.md).
- Backend tests: `cd backend && npm run test` (Jest, `*.spec.ts`). The casino specs are comprehensive — extend them rather than working around them; 2.1 and 3.2 will require updating existing assertions.
- Frontend tests: `cd frontend && npm run test:run` (Vitest). Targeted component,
  gambling API, fairness and animation synchronisation suites now cover this area;
  document manual validation for animation-timing behaviour per `AGENTS.md`'s testing rule.
- 3.4 requires a new migration in `backend/src/migrations/` following the existing `IF EXISTS`-guarded style.
- Per CLAUDE.md: review `docs/modules-progress.md` after the fixes land and update if a module's status changes.
