# Implementation Prompt — Fix Critical & Medium Bugs (Shell Smash)

> Paste this into a fresh coding session at the repo root. It is self-contained.
> Reference: `docs/code-review-20260627.md` (Part 1).

---

You are a senior engineer working in the Shell Smash repo (NestJS backend, React/Phaser
frontend, nginx + Vault infra). Implement the fixes below. Work through them **one at a
time**, each as its own commit. After each fix, run `cd backend && npm run lint && npm test`
and do not move on until both pass.

**Standards to uphold (non-negotiable):**
- Every new `async` external call wrapped in `try/catch` with a meaningful error.
- Extract magic numbers as named constants.
- New/changed business logic gets unit tests covering happy path, edge case, and failure path. Aim ≥80% on touched logic.
- No commented-out code; resolve or delete. Constructor-injected deps that are never reassigned → `private readonly`.
- For every change, show a before/after diff and explain *why*.
- If a fix would introduce risk or debt, say so before proceeding and propose the better path.

---

## 🔴 CRITICAL

### Fix 1 — Stop trusting client-submitted match results
**Files:** `backend/src/modules/game-results/game-results.controller.ts`, `game-results.service.ts`, `dto/submit-result.dto.ts`, `backend/src/modules/matchmaking/game-session.service.ts`

The `POST /api/game-results` endpoint accepts `outcome` verbatim from the client, so any
user can farm wins/XP/coins/achievements/leaderboard rank. Pick **one** approach and state
which you chose and why:

- **Preferred:** Remove the public write path entirely. Results are only ever recorded by
  the authoritative `GameSessionService.persistFinishedRoom`. If the frontend needs the
  progression delta for animations, return it from the websocket `game:end` payload instead
  of a client POST.
- **Alternative (if the REST route must stay):** On match end, the server mints a short-lived,
  single-use signed token (HMAC over `{matchId, userId, outcome, exp}`) and pushes it to the
  client. The endpoint requires that token, verifies the signature, checks it hasn't been
  used (Redis `SETNX` with TTL), and rejects mismatches.

Regardless of approach: validate `gameId` against the engine registry (whitelist) instead of
accepting an arbitrary string, and add rate limiting to the route if it survives.

**Acceptance:** A direct `curl -X POST /api/game-results -d '{"gameId":"x","outcome":"win"}'`
with a valid session cannot increment stats. Tests cover: valid authoritative record succeeds;
forged/replayed/invalid-gameId request is rejected (403/400) and writes nothing.

### Fix 2 — Make reward writes share the match transaction
**File:** `backend/src/modules/matchmaking/game-session.service.ts` (+ `game-results.service.ts`)

`persistFinishedRoom` opens `dataSource.transaction(manager => …)` but calls
`gameResultsService.submitResult()`, which writes through its **own** repositories — outside
the transaction. A rollback leaves rewards granted but the match row reverted.

Fix by either (state which):
- Threading the `EntityManager` into `submitResult` (and the achievement/card writes it
  triggers) so all writes use `manager`; **or**
- Moving reward granting outside the transaction and making it **idempotent** (persist a
  per-match `rewardsGranted` flag in the DB, not just in-memory, and short-circuit on replay).

Remove/replace the misleading `// Persist atomically` comment so it matches reality.

**Acceptance:** A forced failure after `matchRepo.update` rolls back *all* reward writes
(prove with a test that throws mid-transaction and asserts XP/coins unchanged). Replaying the
same finished match grants rewards exactly once.

### Fix 3 — Close the X-Forwarded-For rate-limit bypass
**Files:** `backend/src/modules/auth/rate-limiter.service.ts` (+ check `infra/reverse-proxy/conf/default.conf.template`)

`getIp()` trusts `xForwardedFor.split(",")[0]`, but nginx uses `$proxy_add_x_forwarded_for`
(appends the client value), so `X-Forwarded-For: <anything>` from the client yields a fresh
bucket every request.

Switch the client-IP source to **`X-Real-IP`** (nginx already sets it from `$remote_addr`),
falling back to `req.socket.remoteAddress`. Do **not** trust the first XFF entry. Add a test
that a spoofed `X-Forwarded-For` header does not reset the limit when `X-Real-IP` is constant.

**Acceptance:** 11 rapid register attempts from one real IP are blocked even when each request
carries a different forged `X-Forwarded-For`.

---

## 🟠 MEDIUM

### Fix 4 — Clamp client-supplied velocity/power in every engine
**Files:** `backend/src/modules/matchmaking/engines/{kame-knock,bell-clash,bamboo-bash,shell-curl}.engine.ts` and `base.engine.ts`

The gateway broadcasts and the engines may simulate from raw client `vx/vy/power`. Audit each
engine's `handleInput`: any value used for authoritative physics must be clamped to sane
bounds server-side (max speed/power, finite numbers, no NaN/Infinity). Add a shared
`clampThrow()` helper in `base.engine.ts` with named bound constants and use it everywhere.

**Acceptance:** A test sends `vx: 1e9 / NaN / -Infinity`; the resulting authoritative state is
bounded and deterministic, not blown out.

### Fix 5 — Document & harden in-memory state assumptions
**Files:** `rate-limiter.service.ts` (done), `private-lobbies.service.ts`, `room.service.ts`, `game-session.service.ts`

No rewrite required — this is a single-instance project. Do two small things:
- Confirm and keep the boot-time `active → abandoned` match cleanup (already in `onModuleInit`).
- Make the double-reward guard durable per Fix 2 (DB-backed flag), since the in-memory
  `room.rewardsGranted` doesn't survive a restart. Add a one-line comment at each in-memory
  store noting it's single-process-only.

**Acceptance:** Restarting the backend mid-match does not double-grant rewards on the next
finish event.

### Fix 6 — Bind the CSRF token (defence in depth)
**Files:** `backend/src/modules/auth/auth.controller.ts`, `guards/csrf.guard.ts`

Keep the double-submit pattern but stop duplicating logic and add integrity:
- Extract a single shared `parseCookie` + `CSRF_COOKIE` constant used by both the controller
  and the guard (Fix 7 overlaps here).
- Optionally HMAC the CSRF token with a server secret so a token can't be forged client-side;
  verify the HMAC in `validateCsrf`/`CsrfGuard`. Keep `sameSite:strict` + `secure` in prod.

**Acceptance:** Existing CSRF tests still pass; a tampered token fails validation.

### Fix 7 — DRY the cookie/CSRF helpers and extract magic numbers
**Files:** gateway, auth controller, csrf guard

- Single tested `parseCookie(header, name)` in a shared util; delete the three copies.
- Extract the inlined lobby TTL `2 * 60 * 1_000` (appears ≥3× in `matchmaking.gateway.ts`)
  into a `LOBBY_TTL_MS` constant; reuse it for both the `expiresAt` math and the timer.

**Acceptance:** No duplicated `parseCookie`; `LOBBY_TTL_MS` referenced everywhere the literal
appeared; lint clean.

---

## Done criteria for the whole task
- `npm run lint` and `npm test` green in `backend/`.
- Each fix is its own commit with a clear message and a before/after explanation.
- A short summary at the end listing what changed, any debt deliberately left, and anything
  that still needs a live-demo check (e.g. engine clamps, CSRF flow in the browser).
