# Shell Smash — Senior-Dev Deep Dive & 42 Module Scorecard

> Date: 2026-06-27 · Reviewer pass over `backend/`, `frontend/`, `infra/`, docker, docs.
> Subject version: **21.1** (14 points to pass; major = 2, minor = 1).

---

## TL;DR

The codebase is genuinely strong for a 42 project: NestJS is cleanly modularised,
auth is done properly (scrypt + salt, timing-safe compare, enumeration
resistance, double-gated dev login), the multiplayer loop is **server-authoritative**,
secrets/lockfiles/`node_modules` are all handled correctly, and there is real test
coverage. You are comfortably **over 14 points on solid modules alone** — roughly
**23 points** of work I'd defend without hesitation, before counting the contestable ones.

The risks are not "will it pass" — it's a handful of specific holes an evaluator
can poke, plus two mandatory-part wording traps. Fix those and the grade is safe.

The three things I'd fix before evaluation:
1. The `POST /api/game-results` endpoint is **fully client-trusted** — anyone can POST themselves wins → corrupts stats, leaderboard, achievements, coins.
2. The mandatory spec says **"email and password authentication"**; your local auth is **username + password** (email is `null`). That's a rejection-risk wording trap.
3. The rate limiter trusts a **client-spoofable** `X-Forwarded-For`, so the limits are bypassable.

---

## Part 1 — Bugs, Issues & Risks (senior-dev view)

### 🔴 High — fix before evaluation

**1. Client-trusted match results (`game-results.controller.ts`)**
The authoritative websocket path (`GameSessionService.persistFinishedRoom`) correctly
derives win/loss from server state — good. But the standalone REST endpoint accepts
an arbitrary outcome from the client:

```ts
@Post() @UseGuards(JwtAuthGuard, CsrfGuard)
submitResult(@Body() dto: SubmitResultDto)  // dto.outcome = "win" ← trusted verbatim
```

Any authenticated user can `POST {gameId, outcome:"win"}` in a loop and farm XP,
coins, levels, achievements, card drops and **leaderboard position**. `gameId` is an
unvalidated free string, so they can also create stats rows for games that don't exist.
There's no rate limit on this route. This directly undermines the integrity that the
*Game Statistics*, *Gamification* and *Leaderboard* modules are supposed to demonstrate —
exactly the kind of thing an evaluator probes.
*Fix:* either remove the public endpoint and only record results from the authoritative
session, or sign a short-lived per-match token server-side and require it here, plus
whitelist `gameId` against the engine registry.

**2. Non-transactional writes inside an "atomic" transaction (`game-session.service.ts`)**
`persistFinishedRoom` opens `dataSource.transaction(manager => …)` and then, inside it,
calls `gameResultsService.submitResult()`, which uses its **own injected repositories /
`usersService.save`** — i.e. the default connection, *not* `manager`. So XP/coins/
achievement/card writes run outside the surrounding transaction. If the transaction rolls
back after them, those rewards persist and the match row doesn't → split-brain state. The
`// Persist atomically` comment is misleading.
*Fix:* thread the `manager` through `submitResult`, or move reward granting outside the
transaction and make it idempotent.

**3. Rate-limit bypass via spoofed `X-Forwarded-For`**
`RateLimiterService.getIp()` takes `xForwardedFor.split(",")[0]` (the first hop), and nginx
uses `$proxy_add_x_forwarded_for` which **appends** the client-supplied value. A client
sending `X-Forwarded-For: <random>` gets a fresh bucket every request → the 5/min register,
10/min login, 10/min guest limits are all bypassable.
*Fix:* trust `X-Real-IP` (nginx sets it from `$remote_addr`) instead of the first XFF entry,
or take the **last** XFF entry given a known proxy count.

### 🟠 Medium

**4. Engine input trust (`matchmaking.gateway.ts` `game:input`)**
Throw events broadcast `vx`/`vy` straight from `payload.payload` to peers. The authoritative
state is computed in `engine.handleInput`, so this is only safe **if every engine clamps the
incoming velocity/power server-side**. If any engine simulates physics from the raw client
`vx/vy`, a client can send an enormous velocity and cheat the authoritative result. Worth a
deliberate check across `kame-knock`, `bell-clash`, `bamboo-bash`, `shell-curl` engines.

**5. In-memory state won't survive a restart or scale-out**
`RateLimiterService`, `PrivateLobbiesService` lobbies, `RoomService` rooms, and the
`room.rewardsGranted` double-reward guard all live in process memory. Single-instance is fine
for evaluation (and you documented the rate-limiter caveat — good), but: a backend restart
mid-match loses all live rooms (you do mark `active`→`abandoned` on boot, which is the right
mitigation), and the reward-idempotency guard is per-process only. Flag, not a blocker.

**6. CSRF token has no integrity binding**
Double-submit cookie/header is the right pattern, but the token is a random value with no HMAC
and the CSRF cookie is `sameSite:lax` in dev. Acceptable for this project; just know it relies
on the SOP + sameSite, not on a signed token. Keep `strict` in production (you do).

**7. `parseCookie` is naïve**
Both copies (gateway + controller) do `startsWith(name=)` and `slice`. A cookie value containing
`=` is fine, but values aren't URL-decoded and a prefix collision (`csrf_token` vs
`csrf_token2`) would mismatch. Low impact; consider a single shared, tested helper instead of
three copies.

### 🟡 Low / polish

- **Magic numbers:** `RECONNECT_TIMEOUT_MS` is a named const (good), but lobby expiry
  `2 * 60 * 1_000` is inlined in three places in the gateway — extract a `LOBBY_TTL_MS`.
- **Duplicate `parseCookie` / `CSRF_COOKIE`** in `auth.controller.ts` and `csrf.guard.ts` —
  DRY into one module.
- **`emitState` re-reads the room** on every input and re-broadcasts full state — fine at this
  scale, but it's O(state) per input; watch it if you add fast-tick games.
- **`leaveQueue`/`onQueueLeave`** assume `socket.data.user` exists; a message arriving before
  `handleConnection` finishes would throw. The connection guard makes this unlikely but not
  impossible under load.

### Mandatory-part checks (these cause *rejection*, not point loss)

- ⚠️ **"Email and password authentication"** — III.3 requires *at minimum* email + password.
  Your local register/login is **username + password**; email is stored as `null`. OAuth covers
  identity, but a strict evaluator can read this as the mandatory email/password requirement not
  being met. *Safest fix:* add an email field to local registration (validated, unique), even if
  optional elsewhere.
- ⚠️ **"No warnings or errors in the browser console"** — can't verify statically. Run Chrome
  devtools across hub + each game + auth flows; this is a common silent rejection.
- ✅ Privacy Policy / ToS pages exist (`public/legal`, `components/legal`) — confirm they're
  linked from the footer and non-placeholder.
- ✅ HTTPS, single-command Docker, `.env`/`.env.example`, ORM schema, lockfiles committed,
  `node_modules` ignored — all good.

---

## Part 2 — Module Scorecard (estimated points)

Legend: ✅ confident · 🟡 contestable / verify in demo · ❌ not implemented.
"Points" = what I'd expect to be awarded if demonstrated cleanly.

| # | Category / Module | Status | Pts | Note |
|---|---|---|---|---|
| Web | **Framework F+B** (React + NestJS) | ✅ | 2 | Clear winner. |
| Web | **Real-time WebSockets** | ✅ | 2 | socket.io, reconnect, broadcast, graceful disconnect. |
| Web | **User interaction** (chat + profile + friends) | 🟡 | 0 | Profile ✅ + Friends ✅ but **no chat** → module is incomplete as defined → likely 0. |
| Web | **Public API** (5+ ep, GET/POST/PUT/DELETE, API key, rate limit, docs) | 🟡 | 0–2 | Swagger ✅, rate limit ✅, many endpoints ✅. But auth is JWT cookie, not a **secured API key**; confirm PUT+DELETE examples. Contestable. |
| Web | Minor: **ORM** (TypeORM) | ✅ | 1 | |
| Web | Minor: **Notification system** (C/U/D) | ✅ | 1 | Module + real-time push; verify it covers create/update/delete. |
| UserMgmt | **Standard user management** | ✅ | 2 | Profile edit, avatar upload (multer) + default, friends + online status, profile page. |
| UserMgmt | Minor: **Game stats & match history** | ✅ | 1 | Wins/losses/level/rating, history, achievements, leaderboard. *Integrity at risk — see bug #1.* |
| UserMgmt | Minor: **OAuth** (42 + GitHub) | ✅ | 1 | |
| Cyber | **WAF/ModSecurity + Vault** | ✅ | 2 | `SecRuleEngine On`, modsec wired into nginx, Vault present. Verify rules are strict + Vault actually holds secrets at runtime. |
| Gaming | **Web-based game vs each other** | ✅ | 2 | Server-authoritative real-time. |
| Gaming | **Remote players** | ✅ | 2 | Reconnect logic, disconnect handling, abandon flow. |
| Gaming | **Multiplayer 3+** | 🟡 | 2 | Matchmaking supports up to 5 (`MAX_PLAYERS=5`). Must **demonstrate** a fair, synced 3–5 player match in at least one game. |
| Gaming | **Add another game** (history + matchmaking) | ✅ | 2 | 4 games (kame-knock, bell-clash, bamboo-bash, shell-curl), shared matchmaking, per-game ratings. |
| Gaming | **Advanced 3D** (Three.js/Babylon) | ❌ | 0 | Phaser is 2D. |
| Gaming | Minor: **Advanced chat** | ❌ | 0 | Depends on basic chat, which is absent. |
| Gaming | Minor: **Tournament** | ❌ | 0 | No tournament/bracket code found. |
| Gaming | Minor: **Game customisation** | ✅ | 1 | Shells, cosmetics, card packs, maps; defaults exist. |
| Gaming | Minor: **Gamification** | ✅ | 1 | Achievements + XP/levels + leaderboard + coins/cards (≥3). |
| Gaming | Minor: **Spectator mode** | ✅ | 1 | `spectator:join/leave` + live state push; verify spectators get real-time updates. |
| AI | AI opponent / RAG / LLM | ❌ | 0 | None found (only "aiming" false positives). |
| DevOps | **Monitoring** (Prometheus + Grafana) | ✅ | 2 | Metrics module + interceptor + infra/monitoring. Verify Grafana dashboards, alert rules, secured access. |
| DevOps | Minor: **Health + status + backups** | 🟡 | 1 | Health module ✅; confirm automated backups + DR for the full minor. |
| DevOps | **Microservices** | ❌ | 0 | Single NestJS monolith (modular ≠ microservices). |

### Totals

| Bucket | Points |
|---|---|
| **Confident (✅ only)** | **~21** |
| Confident + likely-demoable 🟡 (3+ players, health minor) | **~24** |
| Theoretical ceiling if chat + public-API-key gaps closed | **~28** |

**You need 14. You're sitting on ~21 you can defend without touching anything.** The
missing modules (chat, AI, tournament, 3D, microservices) only matter if you were
banking on them — you aren't. Spend the remaining time on **integrity and the two
mandatory traps**, not on adding modules.

---

## Recommended priority order before evaluation

1. **Lock down `POST /game-results`** (bug #1) — protects the stats/leaderboard/gamification modules from a 30-second cheat demo.
2. **Add email to local auth** — closes the mandatory "email + password" wording risk.
3. **Fix the XFF rate-limit bypass** (bug #3) — cheap, and it's a security module you're claiming points for.
4. **Thread the transaction manager through reward writes** (bug #2).
5. **Verify in a live demo:** 3–5 player match sync, spectator live updates, zero console errors, footer links to Privacy/ToS, Grafana secured + alerting.
6. Polish: extract lobby TTL constant, DRY the `parseCookie`/CSRF helpers, confirm each engine clamps client `vx/vy`.

*Caveat: point estimates reflect the spec wording and the code as written; actual
awards depend on the live demo. "Implemented" ≠ "validated" until an evaluator sees it run.*
