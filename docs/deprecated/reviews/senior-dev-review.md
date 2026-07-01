# ft_transcendence — Senior Developer Review

> **Date:** 2026-06-24  
> **Reviewer:** Claude (Anthropic) — senior dev perspective  
> **Scope:** Full codebase audit — backend, frontend, infra, security, testing, module scoring

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Issues by Severity](#3-issues-by-severity)
   - [Critical](#31-critical)
   - [High](#32-high)
   - [Medium](#33-medium)
   - [Low / Style](#34-low--style)
4. [Module Assessment & Score](#4-module-assessment--score)
5. [Per-Service Verdicts](#5-per-service-verdicts)
6. [What Is Done Well](#6-what-is-done-well)

---

## 1. Executive Summary

The project is well above the 14-point threshold on paper and demonstrates genuine engineering ambition: four real-time multiplayer games, a full Vault-backed secrets pipeline, ModSecurity WAF, Prometheus+Grafana observability, a progression/achievement system, and a friend network. The code is generally clean, the NestJS modules are well-structured, and security fundamentals (scrypt, httpOnly cookies, CSRF, constant-time comparison) are implemented correctly.

That said, there are **two critical bugs** that could cause a failed evaluation, **several high-severity issues** that undermine claimed modules, and a **test coverage gap** (8 spec files for 15 services) that leaves core game logic completely untested. These need attention before evaluation day.

---

## 2. Architecture Overview

```
Internet → Nginx (TLS 1.2/1.3 + ModSecurity WAF)
              ├── /          → React/Vite frontend (Phaser 3 games)
              ├── /api/      → NestJS REST API (port 8000)
              └── /ws/       → Socket.IO gateway (matchmaking + game state)

NestJS ←→ PostgreSQL  (TypeORM, migrations)
NestJS ←→ Redis       (presence, rate limiting, sessions)
Vault  ←→ All services (AppRole auth, secrets via agent + ctmpl)

Observability: Prometheus scrape → Grafana dashboards
```

**Stack:** React 18 + Vite + Phaser 3 | NestJS + TypeORM | PostgreSQL | Redis | HashiCorp Vault | Nginx + ModSecurity | Prometheus + Grafana | Docker Compose

---

## 3. Issues by Severity

### 3.1 Critical

---

#### C1 — WebSocket gateway accepts connections from any origin

**File:** `backend/src/modules/matchmaking/matchmaking.gateway.ts:45`

```ts
// CURRENT — allows any origin with credentials
@WebSocketGateway({ path: "/ws/", cors: { origin: true, credentials: true } })

// SHOULD BE
@WebSocketGateway({
  path: "/ws/",
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["https://localhost"],
    credentials: true,
  },
})
```

`origin: true` is a Socket.IO shorthand that echoes back whatever `Origin` header the client sends — it is effectively `*` with credentials, which allows any website to open a WebSocket connection as the logged-in user. The REST API already correctly restricts origins in `main.ts`; the gateway must match.

**Risk:** Cross-site WebSocket hijacking. An attacker's page can silently join the victim's queue or receive their game state.

---

#### C2 — `GET /api/users` exposes all user records with no authentication gate and no pagination

**File:** `backend/src/modules/users/users.controller.ts:158–161`

```ts
@Get()
getAllUsers(): Promise<User[]> {
  return this.usersService.findAll();
}
```

This endpoint is decorated with `@UseGuards(JwtAuthGuard)` at the class level, so it requires a session — but it returns every user in the database in a single unbounded query. With 10,000 users this will OOM or time out. More importantly, it leaks all usernames, avatars, levels, and shell skins to any authenticated user.

**Fix:** Either remove this endpoint (it is only used internally for the all-time leaderboard, which can be done in SQL) or add pagination and restrict to admins.

---

### 3.2 High

---

#### H1 — No JWT revocation on logout

**File:** `backend/src/modules/auth/auth.controller.ts` — `DELETE /api/auth/session`

`clearAuthCookie` only deletes the cookie on the client. The JWT itself remains valid until its 24-hour expiry. Anyone who captured the token (e.g. from a shared device, XSS, or a network intercept) can continue using it after the user logs out.

**Fix:** Maintain a Redis-backed deny-list of revoked JTI values (add a `jti: uuid` claim at sign time and check it in `JwtStrategy.validate`). Entries expire at the same TTL as the token.

---

#### H2 — All game and matchmaking state is in-memory only

**Files:** `matchmaking.service.ts` (queues Map), `room.service.ts` (rooms Map), `game-session.service.ts`

A single backend restart silently drops every active match. Players reconnect, the room is gone, but the DB shows the match as `active` forever. There is also no horizontal scaling path.

The reconnect logic (`room.service.ts → reconnect`) correctly handles socket reconnection but cannot survive a process restart.

**Fix for evaluation:** Acceptable as-is for a single-node deployment, but must be called out in the README and the match `status` column must be cleaned up on boot (set stale `active` matches to `abandoned`). Without that, the DB accumulates zombie matches that block future ratings queries.

---

#### H3 — `User Management` major module is incomplete — no avatar upload, no profile edit endpoint

The subject (IV.3) requires:
- ✅ Add friends and view online status
- ❌ **Upload an avatar** — no multipart/file-upload endpoint exists anywhere in the codebase. Avatar is either inherited from OAuth provider or remains null.
- ❌ **Update profile information** — `users.controller.ts` has no `PATCH /me` or `PUT /me` route. There is no way for a user to change their username, turtle name, or bio via the API.

Without these two sub-requirements the module is likely rejected at evaluation, losing 2 points.

**Fix:** Add `PATCH /api/users/me` accepting `{ turtleName?, bio? }` and a `POST /api/users/me/avatar` accepting `multipart/form-data`, storing the image (locally or object storage) and writing the URL to `user.avatar`.

---

#### H4 — Naive flat-delta rated system will not pass the "Ranked" module claim

**File:** `backend/src/modules/matchmaking/game-session.service.ts:154`

```ts
rating.rating += won ? 25 : -25;
```

This is not ELO. The delta is the same regardless of rating difference, so a 2000-rated player beating a 400-rated player gains as much as losing to them. If ranked mode is presented as a feature in the README, evaluators may probe this.

**Fix:** Implement the standard ELO formula: `K × (score - expected)` where `expected = 1 / (1 + 10^((rB - rA) / 400))`.

---

#### H5 — `synchronize: true` runs in any non-`production` NODE_ENV

**File:** `backend/src/app.module.ts:31`

```ts
synchronize: config.get("NODE_ENV") !== "production",
```

TypeORM's `synchronize` mode auto-alters the database schema on every startup by diffing entities against live tables. If you run `make dev` or `make up` (both set `BACKEND_ENV=development`) against a populated database after renaming a column or adding a `NOT NULL` field, TypeORM will drop and recreate columns, silently deleting data.

The project already has proper migrations. `synchronize` should be `false` everywhere; rely only on migrations.

---

#### H6 — `refreshSnapshotPlayers` copy-pasted across all four game engines

**Files:** `shell-curl.engine.ts`, `bamboo-bash.engine.ts`, `kame-knock.engine.ts`, `bell-clash.engine.ts`

Each engine implements an identical private `refreshSnapshotPlayers` and `toSnapshotPlayer` pair. This is ~40 lines duplicated four times. A bug fix must be applied in four places.

**Fix:** Extract to a shared `BaseEngine` abstract class or a standalone utility function in `game-engine.ts`.

---

### 3.3 Medium

---

#### M1 — WebSocket CORS is the only auth for socket connections — no re-validation window

Once a socket connection is established, `socket.data.user` is set at connect-time and never re-checked. If a user's account is deleted mid-session (e.g. a guest TTL cleanup runs), the socket remains active and the user can still emit game inputs.

**Fix:** In `handleConnection`, after setting `socket.data.user`, also verify the JWT has not expired (it does, via `jwtService.verify`). For guest accounts specifically, add a periodic re-check or disconnect on `deleteOldGuests`.

---

#### M2 — CSP header allows `unsafe-inline` and `unsafe-eval`

**File:** `infra/reverse-proxy/conf/default.conf.template:25`

```nginx
script-src 'self' 'unsafe-inline' 'unsafe-eval';
```

These directives negate most XSS protection that a CSP provides. `unsafe-eval` is required by Phaser 3 for its shader pipeline; `unsafe-inline` is likely there for React. The correct approach is to use CSP nonces (NestJS Helmet supports this) or hash-based allowlisting. This is a WAF/ModSecurity module concern — evaluators may flag it.

---

#### M3 — Rate limiter is in-memory and single-process

**File:** `backend/src/modules/auth/rate-limiter.service.ts`

The `Map`-based limiter resets on every backend restart, and will not work correctly if the backend ever runs as more than one replica. For a single-node local deployment this is fine, but it should be documented. Also: `purgeExpired()` is only called from `GuestCleanupService` (hourly) — in the meantime the map grows unboundedly under a moderate DoS.

**Fix:** Call `purgeExpired()` on every `allow()` call after the check, or implement a simple TTL-based eviction. Add a comment documenting the single-process limitation.

---

#### M4 — `profile: any` in OAuth strategies

**Files:** `forty-two.strategy.ts:25`, `github.strategy.ts` (profile param)

The `validate` method in the 42 strategy types `profile` as `any`, bypassing TypeScript safety entirely. `passport-42` does export profile types.

---

#### M5 — All-time leaderboard loads entire users table into application memory

**File:** `backend/src/modules/users/users.controller.ts:175` — `queryAllTime()`

```ts
const users = await this.usersService.findAll(); // SELECT * FROM users
return users.filter(...).sort(...).slice(0, 50);
```

This fetches every user (including all eager-loaded profiles) into Node.js heap to return 50 rows. As user count grows this is a silent performance cliff. The period-filtered path correctly uses SQL; the all-time path should too.

**Fix:** Replace with a SQL query mirroring `queryPeriod` but using `p.totalWins` directly, eliminating the in-memory sort.

---

#### M6 — Monitoring port (Grafana) is exposed on the host network

**File:** `docker-compose.yml:221`

```yaml
ports:
  - "${MONITORING_PORT:-3001}:${MONITORING_PORT:-3001}"
```

Grafana is accessible directly on port 3001 without going through the Nginx proxy or WAF. The Grafana admin password is read from Vault, but if the host is internet-facing, Grafana is exposed. It should only use `expose:` (internal Docker network) and be accessed via an Nginx proxy route protected by the WAF.

---

#### M7 — `grantMatchRewards` is not transactional

**File:** `backend/src/modules/matchmaking/game-session.service.ts` — `grantMatchRewards()`

The method loops over players and calls `gameResultsService.submitResult` sequentially. If it fails on the second player after updating the first, one player receives XP/coins and the other does not. The match is marked `finished` regardless.

**Fix:** Wrap the entire `persistFinishedRoom` (or at minimum `grantMatchRewards`) in a `dataSource.transaction()`, rolling back all reward grants on any failure.

---

#### M8 — Debug easter egg left in production frontend

**File:** `frontend/src/app/App.tsx:8–16`

```ts
if (!event.ctrlKey || event.key.toLowerCase() !== "c") return;
void navigator.clipboard.writeText("Lucas haz algo");
```

`Ctrl+C` in the app silently overwrites the user's clipboard with the string "Lucas haz algo". This will confuse users and is embarrassing if discovered during evaluation.

**Fix:** Remove the entire `useEffect` block.

---

### 3.4 Low / Style

---

#### L1 — `console.log` / `console.warn` / `console.error` used instead of NestJS Logger

**Files:** `main.ts:45`, `metrics.service.ts:82`, `shells.service.ts:31`

NestJS Logger provides structured, level-filtered, context-tagged output. Raw `console.*` calls bypass it.

**Fix:** Replace with `this.logger.log(...)`, `this.logger.warn(...)`, `this.logger.error(...)`.

---

#### L2 — Missing `private readonly` on several constructor-injected dependencies

**Files:** `metrics.service.ts` (`config`), `auth strategies` (configService, authService), `guest-cleanup.service.ts` (usersService, rateLimiter)

NestJS dependencies injected into the constructor and never reassigned should be `private readonly`. This is enforced by the team's own stated coding standards.

---

#### L3 — `makeUniqueOAuthUsername` has no iteration cap

**File:** `backend/src/modules/auth/auth.service.ts:158`

The `while` loop that appends numeric suffixes to colliding OAuth usernames queries the DB on every iteration with no limit. Under high concurrency this could spin for a long time. Cap at, say, 100 iterations and fall back to `${base}_${randomHex(4)}`.

---

#### L4 — Stale `shellsmash/` directory at repo root

The `shellsmash/` directory contains an old copy of the project with `node_modules/`, `dist/`, and compiled artifacts — all gitignored but physically present. While `.gitignore` correctly excludes it, its presence is confusing and wastes disk space. It should be fully removed from disk.

---

#### L5 — Test coverage: 8 spec files for 15 services

Services with **zero test coverage**:
- `metrics.service.ts`
- `customization.service.ts`
- `achievements.service.ts`
- `shells.service.ts`
- `game-session.service.ts` ← core game logic
- `matchmaking.service.ts` ← core game logic
- `room.service.ts` ← core game logic
- `friends.service.ts` (spec exists but coverage is partial)

No frontend tests exist. No e2e tests for critical flows (login → queue → match → rewards).

---

## 4. Module Assessment & Score

> Points required to pass: **14**  
> Major = 2 pts | Minor = 1 pt

| # | Module | Category | Status | Pts |
|---|--------|----------|--------|-----|
| 1 | Framework (NestJS backend + React frontend) | Web — Major | ✅ Confirmed | 2 |
| 2 | Real-time features via WebSockets | Web — Major | ✅ Socket.IO gateway, reconnect logic, spectator stream | 2 |
| 3 | WAF/ModSecurity + HashiCorp Vault | Cybersecurity — Major | ✅ Full AppRole auth, ctmpl templates, ModSecurity rules | 2 |
| 4 | Complete web-based multiplayer game | Gaming — Major | ✅ Shell Curl (Temple Curling) — real-time, win/loss | 2 |
| 5 | Multiplayer with >2 players | Gaming — Major | ✅ Up to 5 players per match, side-indexed | 2 |
| 6 | Additional game with history & matchmaking | Gaming — Major | ✅ Bamboo Bash, Kame Knock, Bell Clash (3 extra games) | 2 |
| 7 | Monitoring with Prometheus + Grafana | DevOps — Major | ✅ MetricsService, Grafana dashboards, Prometheus scrape | 2 |
| 8 | Standard user management & authentication | User Mgmt — Major | ⚠️ **PARTIAL** — friends ✅, online status ✅, profile update ❌, avatar upload ❌ | 0–2 |
| 9 | ORM for database | Web — Minor | ✅ TypeORM with migrations | 1 |
| 10 | OAuth 2.0 remote authentication | User Mgmt — Minor | ✅ 42 intra + GitHub | 1 |
| 11 | Game statistics & match history | User Mgmt — Minor | ✅ UserGameStats entity, per-game breakdown, leaderboard | 1 |
| 12 | Gamification system | Gaming — Minor | ✅ XP, levels, coins, 35+ achievements, cosmetic unlocks | 1 |
| 13 | Spectator mode | Gaming — Minor | ✅ spectator:join/leave, live state stream | 1 |
| 14 | Game customization options | Gaming — Minor | ✅ Shell skins, hub backgrounds, alter arts | 1 |
| 15 | 2FA | User Mgmt — Minor | ❌ Not implemented | 0 |
| 16 | Tournament system | Gaming — Minor | ❌ Not implemented | 0 |

### Score Summary

| Scenario | Points |
|----------|--------|
| **Conservative** (user mgmt major rejected) | **16 pts** |
| **Optimistic** (evaluator accepts partial user mgmt) | **18 pts** |
| **Pass threshold** | 14 pts |

**The project passes** even in the conservative scenario, but the two missing sub-requirements of the User Management major (avatar upload + profile edit endpoint) are a real evaluation risk worth fixing in the next few days.

---

## 5. Per-Service Verdicts

### Auth (`auth.service.ts`, `auth.controller.ts`)
**Grade: A−**
Excellent fundamentals: scrypt with proper params (N=32768, r=8, p=1), timing-safe comparison, double-submit CSRF, constant-time dummy derivation on missing users. The dev-login endpoint is correctly double-gated. Missing: JWT revocation on logout (H1).

### Matchmaking Gateway (`matchmaking.gateway.ts`)
**Grade: B+**
Reconnect logic is thoughtful (45s window, timer cleanup). CORS wildcard is critical (C1). The `onGameInput` method is a large switch-like block that could be extracted to the engine layer.

### Game Engines (4 engines)
**Grade: B**
Each engine correctly implements the game rules as a pure state-machine. The `refreshSnapshotPlayers` duplication (H6) is the main structural issue. No unit tests for any engine.

### User Management (`users.controller.ts`, `users.service.ts`)
**Grade: B−**
Leaderboard SQL for period queries is solid. All-time path loads full table into memory (M5). No PATCH endpoint for profile updates (H3). `getAllUsers` is a data-leak and performance risk (C2).

### Friends System (`friends.service.ts`)
**Grade: A−**
Block/unblock, bidirectional lookup, live online status integration — all implemented correctly. Error handling is consistent. Well-tested.

### Achievements (`achievements.service.ts`)
**Grade: A−**
Startup validation of cosmetic reward references is a nice touch. `evaluateForUser` correctly handles duplicate-key races (23505). No tests.

### Customization (`customization.service.ts`)
**Grade: A−**
The `buy` transaction is correctly wrapped in `dataSource.transaction()`. Achievement-locked items are enforced server-side. No tests.

### Vault / Infra
**Grade: A**
AppRole with file-based bootstrap, per-service policies, ctmpl template rendering — this is a textbook Vault implementation. The parallel build race was a Makefile issue (already fixed), not a design flaw.

### Monitoring
**Grade: B+**
Prometheus counters, histograms, and Grafana dashboards provisioned at startup. Metrics endpoint is token-gated when `METRICS_TOKEN` is set. Grafana exposed directly on host network (M6).

### Frontend
**Grade: B**
Clean routing with lazy-loaded `GamePage`, protected routes, proper Suspense. The debug clipboard easter egg (M8) must be removed. No tests. `window` usage should be audited for SSR compatibility if SSR is ever added.

---

## 6. What Is Done Well

These are genuinely good engineering decisions worth keeping:

- **scrypt password hashing** with explicit `maxmem` override — most tutorials get this wrong.
- **Constant-time dummy derivation** when username doesn't exist — prevents timing-based user enumeration.
- **CSRF double-submit pattern** implemented correctly without a library.
- **`passwordHash` excluded from all SELECT queries** via TypeORM `select: false` + explicit defence-in-depth strip in the controller.
- **Vault AppRole pipeline** with per-service least-privilege policies — production-grade secrets management.
- **Guest account lifecycle**: creation, 2h cookie TTL, hourly cleanup job, rate limiting on the guest endpoint.
- **Reconnect window** with per-player timer and abandon-on-timeout — handles real network conditions.
- **Achievement system startup validation** — crashes the app at boot if a reward references a non-existent cosmetic, preventing silent runtime failures.
- **ModSecurity WAF** with OAuth callback exemptions — shows understanding of WAF false-positive management.
- **TypeORM migrations** alongside `synchronize` for dev — the intent is right even if `synchronize` should be disabled (H5).
- **Leaderboard SQL** for period queries uses parameterised queries with explicit `ANY($n)` binding — no SQL injection surface.
