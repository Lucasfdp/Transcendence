# Shell Smash — Project Overview

Shell Smash (ft_transcendence) is a sumo-turtle multiplayer gaming hub served entirely from Docker. Players log in, visit a Japanese-dojo hub world, and launch into mini-games. Everything runs behind a single Nginx HTTPS entry point.

---

## Table of Contents

1. [Infrastructure & Docker](#1-infrastructure--docker)
2. [Reverse Proxy (Nginx)](#2-reverse-proxy-nginx)
3. [Backend (NestJS)](#3-backend-nestjs)
4. [Database (PostgreSQL)](#4-database-postgresql)
5. [Redis](#5-redis)
6. [Frontend (Phaser 3 + Vite)](#6-frontend-phaser-3--vite)
7. [Hub Scene](#7-hub-scene)
8. [Profiles](#8-profiles)
9. [Authentication Flow](#9-authentication-flow)
10. [Data Models](#10-data-models)
11. [Mini-Games Registry](#11-mini-games-registry)
12. [Code Quality & CI](#12-code-quality--ci)
13. [Makefile Commands](#13-makefile-commands)
14. [Environment Variables](#14-environment-variables)

---

## 1. Infrastructure & Docker

The project is a multi-container Docker Compose stack. Every service runs in its own container; the only ports exposed to the host are Nginx (80/443) and Portainer (9443).

```
Browser
  │
  └─▶ Nginx :443 (HTTPS)
        ├─▶ /          → frontend:3000  (Phaser SPA)
        ├─▶ /api/      → backend:8000   (NestJS REST)
        └─▶ /ws/       → backend:8000   (WebSocket, future)
```

**Key files**

| File                          | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `docker-compose.yml`          | Production service definitions                                                        |
| `docker-compose.override.yml` | Dev overrides — hot-reload for frontend (Vite HMR) and backend (`nest start --watch`) |
| `.env`                        | All secrets and tunable values (never commit real values)                             |
| `.env.example`                | Safe-to-commit template                                                               |
| `Makefile`                    | Developer shortcuts (`make up`, `make dev`, `make logs`, etc.)                        |

**Two Docker networks** enforce a security perimeter:

- `frontend_network` — Nginx, frontend, backend, monitoring, Portainer. Only traffic that touches the browser lives here.
- `backend_network` — backend, database, Redis, monitoring. The database is invisible to Nginx and the browser.

---

## 2. Reverse Proxy (Nginx)

**Path:** `infra/reverse-proxy/`

Nginx is the single entry point for all external traffic. It terminates TLS and proxies to the appropriate upstream.

**What it does:**

- Replaces plain HTTP requests sent to the published TLS port with a branded
  `426 Upgrade Required` page that links back to the secure entrance.
- Serves HTTPS with TLS 1.2/1.3 only and a strong cipher suite.
- Adds security headers: `Strict-Transport-Security`, `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Content-Security-Policy`.
- Routes `/api/` to the NestJS backend (120 s read timeout, 10 MB body limit).
- Routes `/ws/` to the backend with WebSocket upgrade headers (3600 s timeout for long-lived game connections).
- Routes `/` to the Vite-served SPA.

**TLS:** Self-signed certificate in development (generated at container build time). Swap for Let's Encrypt paths in production by changing `ssl_certificate` / `ssl_certificate_key` in `default.conf`.

---

## 3. Backend (NestJS)

**Path:** `backend/`

A NestJS API server backed by TypeORM. It handles authentication, user data, and the mini-game registry.

### Modules

**AppModule** (`backend/src/app.module.ts`)  
Root module. Wires up ConfigModule (global), TypeORM (async factory using ConfigService), and all feature modules. TypeORM `synchronize` is enabled in development so schema changes apply automatically — disabled in production.

**AuthModule** (`backend/src/modules/auth/`)  
Handles local, guest, and 42 authentication with JWTs stored in an HTTP-only
cookie.

- `AuthController` — local registration/login, guest sessions, session logout,
  current-user lookup, connected-account operations, and the 42 OAuth routes
  and callback.
- `AuthService` — local credential validation and auth-cookie issuance.
- `AccountLinksService` — authentication identities, persistent conflicts,
  previews, unlinking, and transactional account consolidation.
- `OAuthStateService` — expiring, single-use OAuth state stored in Redis.
- `JwtStrategy` — validates the auth cookie and loads the current user.
- `FortyTwoStrategy` — the only supported remote OAuth provider; it returns a
  verified provider identity and never creates users.

**UsersModule** (`backend/src/modules/users/`)  
CRUD over the `users` table.

- `UsersController` — JWT-guarded routes for the strict public user view,
  current-user profile updates, avatar upload/removal and leaderboards. Public
  profile data is served by `GET /api/users/:username` without returning the
  `User` entity or private account fields.
- `UsersService` — `findById`, `findByFortyTwoId`, `findByUsername`, `create`
  (also creates a linked Profile row), and `findAll`.
- `UserAccountActivityService` — process-local queue markers used to prevent an
  account consolidation while a player is waiting for a match.

**ProfilesModule** (`backend/src/modules/profiles/`)  
Manages the `profiles` table. Profiles are created automatically when a user is created — no separate endpoint yet.

**MiniGamesModule** (`backend/src/modules/minigames/`)  
Serves the static list of mini-games that the hub reads.

- `GET /api/minigames` — returns all game definitions with their current status (`available` | `coming_soon`).

**AppController** (`backend/src/app.controller.ts`)  
Provides `GET /api/health` — used by Docker health checks and the Makefile `make health` target.

### OpenAPI and Scalar

The complete REST contract is generated by `@nestjs/swagger` and rendered by
Scalar at `/api/docs` in development and production. The reference, its local
JavaScript bundle, and `/api/docs-json` and `/api/docs-yaml` are protected by
Nginx: a valid registered-account session is required and guest sessions are
rejected. The interactive client sends session cookies, obtains a fresh CSRF
token before authenticated mutations, and accepts a public API key only as
manual input. WebSocket events are intentionally outside the REST contract.

---

## 4. Database (PostgreSQL)

**Path:** `infra/database/`

Standard PostgreSQL container. Accessible only inside `backend_network` — the frontend and Nginx cannot reach it.

- Data is stored in the `db_data` named volume (survives container restarts).
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` are injected from `.env`.
- Initialisation scripts can be dropped in `tools/` and will run on first boot.

To access the database directly during development:

```
docker compose exec database psql -U $POSTGRES_USER $POSTGRES_DB
```

---

## 5. Redis

**Path:** `infra/redis/`

Redis is running and connected to the backend. It currently stores OAuth state,
JWT revocations, and distributed rate-limit counters. Further planned uses are:

- WebSocket pub/sub for real-time game state
- Matchmaking queues and lobby state

Config lives in `tools/redis.conf`. Password auth is required (`REDIS_PASSWORD`). Memory is capped at `REDIS_MAX_MEMORY` with the `allkeys-lru` eviction policy by default.

---

## 6. Frontend (Phaser 3 + Vite)

**Path:** `frontend/`

A single-page application built with React, Phaser 3.60, and Vite. React handles routing and page-level composition while Phaser renders the game and hub scenes.

**Entry points:** `frontend/src/main.tsx` mounts the React app and routes. `frontend/src/lib/createShellSmashGame.ts` creates the Phaser `Game` instance and registers the hub and mini-game scenes.

**Styling:** Tailwind CSS provides shared utilities, design tokens, and reusable
layout primitives. Complex visual effects remain grouped by feature under
`frontend/src/styles/modules/`, with a single ordered manifest preserving the
application's cascade.

**Vite config:** The dev server proxies `/api` to `http://backend:8000`, so the frontend never needs to know the backend's address in development.

### Scenes

**LandingScene** (`frontend/src/features/hub/LandingScene.ts`)  
Handles entry into the Phaser experience and transitions authenticated users into the hub.

**HubScene** (`frontend/src/features/hub/HubScene.ts`)  
The main hub world. See [§7 Hub Scene](#7-hub-scene).

### Supporting files

| File                               | Purpose                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontend/src/features/hub/api.ts` | Typed wrappers around the shared cookie/CSRF-aware API transport, including private current-user and strict `PublicUserView` contracts. |
| `frontend/src/shared/theme.ts`     | Central colour palette (warm Japanese-temple: deep charcoal background, gold accents, muted red). All Phaser graphics calls reference `THEME.*` constants so colours are changed in one place.               |
| `public/assets/hub-background.png` | Optional background image. If missing or failed to load, the procedural night-sky scene renders as a full fallback.                                                                                          |

---

## 7. Hub Scene

**File:** `frontend/src/features/hub/HubScene.ts`

The hub is a top-down view of a Japanese dojo courtyard. It is always fully playable — the procedural background renders as a fallback if no image is provided.

### Procedural Background

Drawn entirely with Phaser `Graphics` primitives in `drawBackground()`:

- Three-band sky gradient (midnight navy → deep indigo → dark earthen ground).
- Randomised stars (density based on canvas area).
- Moon with layered glow halos at 74% width, 18% height.
- Ground mist band.
- Stone path (centre lane with joint lines).
- Two cherry blossom trees (`drawBlossamTree()`) with randomised branch clusters and blossom dots.
- 28 ambient static petal shapes scattered across the scene.

### Hotspot Zones

Seven interactive shrine zones are defined in `HOTSPOTS[]`. Each entry stores the zone centre and size as fractions of the source image dimensions (1080×1080). A letterbox transform (`bgScale`, `bgOffX`, `bgOffY`) maps those fractions to actual canvas pixels so the zones scale correctly at any resolution.

On hover: a gold glow rectangle lights up the zone and a continuous cherry blossom petal shower falls through it.  
On click: if the game is `available` and its scene is registered, the scene starts. Otherwise a "Coming Soon" modal appears.

**Current zone map:**

| Zone         | Status      |
| ------------ | ----------- |
| Kame Knock   | available   |
| Bell Clash   | coming soon |
| River Rush   | coming soon |
| Bamboo Bash  | coming soon |
| Oni Dodge    | coming soon |
| Sakura Sweep | coming soon |
| Shell Cards  | coming soon |

### Cherry Blossom Petal Effect

`startPetals(cx, cy, zoneW, zoneH)` — spawns a Phaser 3.60 `ParticleEmitter` (continuous, `frequency: 55 ms`, angle 75–105° for a gentle downward drift, randomised pink/white tints).

`stopPetals()` — calls `emitter.stop()` to halt new particles, then destroys the emitter after 1800 ms so in-flight petals complete their fall naturally.

### HUD Bar

Rendered by the React hub page when a user is logged in. The player area at the
top of the screen shows:

- The uploaded avatar or equipped shell portrait, with a level badge.
- The player name, dojo tag, equipped shell and coin balance.
- A compact XP progress bar with a numeric label; narrow layouts retain the bar
  while hiding the numbers.
- The most-played game summary when available. Selected achievements remain in
  the profile rather than duplicating them in this compact player area.

The player card opens the profile editor. A separate accessible link opens the
current player's public `/profile/:username` page, so the existing editor action
is unchanged. The private profile preview repeats the detailed XP bar, while the
public profile deliberately omits XP with the rest of the private progression
data.

### Login Prompt

Rendered by `drawLoginPrompt()` when no user is authenticated. Shows the Shell Smash title, a subtitle, and the "Enter the Dojo" Torii-gate button. The button calls `api.devLogin('KameMaster')` then restarts the scene. The Torii button is styled as a red gate with inverted-gold pillars and a crossbeam.

---

## 8. Profiles

The React profile editor lives in `frontend/src/pages/HomePage.tsx`. It updates
the turtle name, an unlocked dojo tag, three showcased achievements and the
custom avatar while rendering a live `PlayerProfilePreview`. Connected account
controls remain in the same fixed desktop modal.

`frontend/src/pages/ProfilePage.tsx` implements the protected
`/profile/:username` route. It loads the strict public endpoint independently of
Hub state and displays the player's identity, `ShellPortrait`, level, online
state, dojo tag, showcased achievements, match record and most-played game.
Loading, missing, network, malformed-response and empty-data states are explicit.

Social friend rows include a separate `View profile` link. Compact Social hover
cards continue to provide a quick summary without exposing private account data.

---

## 9. Authentication Flow

```
ShellSmash sign-in:
  Browser → CSRF bootstrap → POST /api/auth/login
          → AuthIdentity scrypt verification
          → canonical User resolution
          → HTTP-only auth cookie

JWT-protected request:
  Browser → GET /api/users/me
          → auth_token cookie
          → JwtStrategy.validate() → UsersService.findCanonicalById()
          → returns a private-field-safe user view

OAuth sign-in or linking:
  Browser → application start endpoint
          → single-use Redis state
          → provider authorisation and callback
          → verified provider identity
          → direct link, new user, or persistent account conflict
```

42 OAuth is wired through its Passport strategy and guard, controller callback,
single-use Redis state, and HTTP-only auth cookies. Real client credentials are
supplied through Vault; see `docs/oauth-setup.md`. Tokens are never stored in
browser storage.

---

## 10. Data Models

### User

| Column           | Type              | Notes                                      |
| ---------------- | ----------------- | ------------------------------------------ |
| id               | int (PK)          | auto-increment                             |
| username         | string (unique)   | progress-account display handle            |
| avatar           | string (nullable) | URL to avatar image                        |
| level            | int               | default 1                                  |
| xp               | int               | default 0                                  |
| coins            | int               | player balance                             |
| turtleName       | string (nullable) | display name; falls back to username       |
| shellSkin        | string            | default `"base"`                           |
| mergedIntoUserId | int (nullable)    | canonical account after consolidation      |
| createdAt        | timestamp         |                                            |
| updatedAt        | timestamp         |                                            |
| profile          | Profile           | one-to-one, eager-loaded                   |

Legacy authentication columns remain temporarily for rolling-deployment
compatibility. New authentication decisions use `AuthIdentity`.

### AuthIdentity

| Column          | Type            | Notes                                        |
| --------------- | --------------- | -------------------------------------------- |
| id              | UUID (PK)       |                                              |
| userId          | int (FK)        | progress account                             |
| method          | string          | active: `shellsmash` or `forty_two`; legacy Google rows may remain |
| providerSubject | string nullable | stable 42 subject, or a retained legacy subject |
| shellUsername   | string nullable | ShellSmash sign-in name                      |
| shellEmail      | string nullable | normalised ShellSmash sign-in email          |
| passwordHash    | string nullable | private salted scrypt hash                   |

The database enforces one identity per user and method, and global uniqueness
for provider subjects, ShellSmash usernames, and ShellSmash emails.

### AccountLinkConflict

Pending conflicts retain the initiating and linked user IDs, the method that
created the conflict, and the eventual resolution. A partial unique index and
transactional advisory locks prevent concurrent conflicts for the same
account. Completed rows retain the final user ID for idempotent retries and
auditability.

### Profile

| Column      | Type              | Notes           |
| ----------- | ----------------- | --------------- |
| id          | int (PK)          |                 |
| user        | User              | one-to-one FK   |
| totalWins   | int               | default 0       |
| totalLosses | int               | default 0       |
| gamesPlayed | int               | default 0       |
| bio         | string (nullable) | player bio text |

---

## 11. Mini-Games Registry

Defined as a static array in `MiniGamesController`. Each entry has an `id` (matches the hotspot `id` in `HOTSPOTS[]`), `name`, `status`, and `description`.

To add a new game:

1. Add a row to the `MINIGAMES` array in `minigames.controller.ts`.
2. Add a matching entry in `HOTSPOTS[]` in `HubScene.ts` with correct `cx/cy/hw/hh` fractions.
3. Create a new Phaser `Scene` class and register it in `main.ts`.
4. Change the game's `status` to `"available"` and update the `pointerup` handler in `buildHotspots()` to start the scene.

---

## 12. Code Quality & CI

### SonarCloud

`.sonarcloud.properties` at the repo root configures the analysis:

- Excludes `node_modules`, `dist`, `*.spec.ts`, and `coverage` from the source scan.
- Points to `backend/coverage/lcov.info` for test coverage reporting.

### Jest

**Config:** `backend/jest.config.ts`  
**Scripts:** `npm test` / `npm run test:cov`

Coverage is output in LCOV format (for SonarCloud) and a text summary. Three spec files are included:

| File                                   | Covers                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `auth/auth.service.spec.ts`            | `findOrCreateUser`, `issueJwt`, `devLogin` — happy path, missing user, error propagation |
| `users/users.service.spec.ts`          | All five service methods, including `NotFoundException` re-throw vs wrapping             |
| `auth/strategies/jwt.strategy.spec.ts` | `validate()` with valid payload and missing user                                         |

### ESLint

**Config:** `backend/.eslintrc.js`

Key rules enforced:

- `@typescript-eslint/prefer-readonly: error` — all constructor-injected dependencies must be `readonly`.
- `@typescript-eslint/no-unused-vars: error` — unused variables are a build error (underscore prefix `_name` exempted).
- `no-warning-comments: warn` — `TODO`, `FIXME`, and `HACK` comments produce warnings so they stay visible in CI output.

### Husky + lint-staged

A pre-commit hook runs `lint-staged` on every `git commit`. Any staged `.ts` file is linted and its related tests are run before the commit is allowed through. The `prepare` script in `package.json` installs the hooks automatically on `npm install`.

---

## 13. Makefile Commands

Run from the repo root (where `.env` lives).

| Command                     | What it does                                          |
| --------------------------- | ----------------------------------------------------- |
| `make up`                   | Build and start all services in production mode       |
| `make dev`                  | Start with `docker-compose.override.yml` (hot-reload) |
| `make down`                 | Stop and remove containers                            |
| `make re`                   | Full rebuild and recreation via `down` then `up`; persistent volumes are preserved |
| `make fclean`               | Remove containers, volumes, and images                |
| `make logs SERVICE=backend` | Tail logs for a specific service                      |
| `make ps`                   | Show running container status                         |
| `make db`                   | Open a psql shell in the database container           |
| `make test`                 | Run backend Jest tests                                |
| `make health`               | Curl the `/api/health` endpoint                       |
| `make push`                 | Tag and push images to a registry                     |

---

## 14. Environment Variables

All variables live in `.env` at the repo root. Key ones to know during development:

| Variable                    | Default                 | Purpose                                                         |
| --------------------------- | ----------------------- | --------------------------------------------------------------- |
| `BACKEND_ENV`               | `development`           | Sets `NODE_ENV` inside the backend container                    |
| `ENABLE_DEV_LOGIN`          | `true` (in dev)         | Enables `GET /api/auth/dev-login`. **Never set in production.** |
| `JWT_SECRET`                | `changeme_jwt_secret`   | Signs all JWTs — use a strong random string in production       |
| `POSTGRES_*`                | see `.env`              | Database credentials                                            |
| `VITE_API_URL`              | `https://localhost/api` | API base URL injected into the Vite build                       |
| `FORTYTWO_CLIENT_ID/SECRET` | Vault                   | 42 OAuth credentials                                             |
| `DOMAIN_NAME`               | `localhost`             | Used by Nginx server_name in production                         |

> **Never commit real secrets.** `.env` is listed in `.gitignore`. Use `.env.example` as the committed template.
