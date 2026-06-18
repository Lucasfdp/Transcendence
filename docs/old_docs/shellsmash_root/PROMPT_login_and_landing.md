# Shell Smash — Login & Landing Screen Implementation Prompt

## Context for the AI

You are implementing the login and landing experience for **Shell Smash**, a Phaser 3 Japanese-themed hub minigame system built as a 42 School `ft_transcendence` project. Read the following carefully before writing any code.

### Existing stack (do not change unless instructed)

| Layer | Tech |
|---|---|
| Frontend | Phaser 3, TypeScript, Vite, `Scale.RESIZE` |
| Backend | NestJS, TypeORM, PostgreSQL, Passport.js |
| Auth | 42 OAuth (`passport-42`), JWT (signed, stored in `localStorage`) |
| Infra | Docker Compose, Nginx reverse proxy (TLS termination), Redis |

### Existing auth files you must read before touching anything

- `src/hub/AuthCallbackScene.ts` — currently the first Phaser scene; reads `?token=` from the OAuth callback URL, stores it in `localStorage`, then transitions to `HubScene`.
- `src/hub/api.ts` — `apiFetch` helper reads JWT from `localStorage` and attaches it as `Authorization: Bearer`. Also exposes `api.devLogin()`.
- `srcs/requirements/backend/src/src/auth/auth.controller.ts` — `GET /api/auth/me` (JWT-guarded), `GET /api/auth/dev-login` (double-gated).
- `srcs/requirements/backend/src/src/auth/auth.service.ts` — `findOrCreateUser`, `issueJwt`, `devLogin`.
- `srcs/requirements/backend/src/src/users/entities/user.entity.ts` — `User` entity with `id, fortyTwoId, username, email, avatar, level, xp, turtleName, shellSkin`.
- `srcs/requirements/backend/src/src/profiles/entities/profile.entity.ts` — `Profile` with `totalWins, totalLosses, gamesPlayed, bio`.

### Visual theme (must be respected throughout)

```typescript
// src/shared/theme.ts
export const THEME = {
  background: 0x1a1410,   // very dark warm brown
  red:        0xa23b3b,   // muted temple red
  gold:       0xd4a843,   // warm gold — primary highlight
  green:      0x3a5a40,   // dark forest green
  text:       '#e6ddd0',  // warm off-white
  textGold:   '#d4a843',
  font:       'monospace',
};
```

All new UI must use `THEME` tokens. No hardcoded colours. Depth ordering: background = 0, gameplay = 3, HUD = 20, overlays = 30.

---

## What to build

### 1. New `LandingScene` (Phaser 3)

Create `src/hub/LandingScene.ts` and register it as **the first scene** in `src/main.ts`, replacing `AuthCallbackScene` as the scene at index 0.

`LandingScene` must:

1. **Detect an OAuth callback** first — if `window.location.search` contains `?token=`, store the JWT in `localStorage`, clean the URL with `history.replaceState`, and transition immediately to `HubScene`. This preserves the existing OAuth callback logic that was in `AuthCallbackScene`.

2. **Detect an existing valid session** — if a JWT is already in `localStorage`, call `GET /api/auth/me`. If the response is 200, transition to `HubScene` without showing the landing screen. If 401 (expired/invalid), clear the token and show the landing screen.

3. **Render the landing screen** when no valid session exists. The screen must contain:
   - The game logo / title ("Shell Smash" in large gold text) centred at approximately 35% of canvas height.
   - A brief Japanese-themed subtitle line ("Enter the Dojo") beneath it, in muted text.
   - Two large interactive buttons stacked vertically and centred at ~60% height:
     - **"Login / Create Account"** — primary button (gold border, dark background).
     - **"Quick Game"** — secondary button (red border, slightly smaller or lower contrast to establish visual hierarchy).
   - A small "Dev Login" link (text only, no button styling) visible **only** when both `NODE_ENV !== 'production'` AND `ENABLE_DEV_LOGIN === 'true'` are in the Vite env. Gate this client-side check using `import.meta.env.VITE_DEV_LOGIN_ENABLED === 'true'`. The link should appear at the very bottom of the screen in muted text.

4. **Handle `Scale.RESIZE`** — all elements must reposition correctly when the window is resized. Follow the same pattern used in `HubScene`: register a listener in `create()`, unregister in `shutdown()`, and rebuild layout elements in the handler.

5. **Show a loading/transition state** between button click and scene change — a brief animated fade (300 ms alpha tween from 1 → 0 on all scene content) before `this.scene.start(...)` so there is no hard cut.

#### Button behaviour

| Button | Action |
|---|---|
| Login / Create Account | Call `window.location.href = api.loginUrl()` to begin the 42 OAuth flow. The backend issues a JWT and redirects back to the frontend with `?token=`. On return, `LandingScene` picks this up (step 1 above) and routes to `HubScene`. |
| Quick Game | Call `POST /api/auth/guest` (new endpoint — see backend section). Store the returned short-lived JWT in `localStorage` under the key `jwt_guest_token` (distinct from `jwt_token`). Transition to `HubScene`. |
| Dev Login (dev only) | Call `api.devLogin('KameMaster')`. On success, transition to `HubScene`. On error, show an inline error message beneath the link. |

#### UX details

- Buttons must have hover states: on `pointerover`, raise the fill alpha and scale the button to 1.05× using a 100 ms tween. On `pointerout`, reverse. Use `useHandCursor: true`.
- Buttons must be disabled (non-interactive, reduced alpha) while any async request is in flight. Re-enable on error.
- Errors (network failure, invalid token) must display as a non-blocking text message beneath the buttons — never `alert()`. Auto-dismiss after 4 seconds or on next button press.
- All text objects must use `THEME.font` and the appropriate `THEME.text*` colour.
- The background must use the HubScene procedural Japanese night sky drawing logic. Extract the background drawing code from `HubScene` into a shared helper `src/shared/drawBackground(gfx, width, height)` so both scenes can call it without duplicating code.

---

### 2. Guest session — backend (`POST /api/auth/guest`)

Add a new endpoint to `auth.controller.ts`:

```
POST /api/auth/guest
Body: none
Returns: { access_token: string, expiresIn: number }
```

Implementation requirements:

- Create a temporary `User` record with a generated username (`guest_<uuid-v4-short>`), no email, no `fortyTwoId`. Set a boolean column `isGuest: boolean` on the `User` entity (default `false`).
- Issue a JWT with a **short TTL** — `expiresIn: '2h'` — distinct from the standard session TTL. Include `{ sub, username, isGuest: true }` in the payload.
- The `JwtStrategy` must read `isGuest` from the payload and attach it to `req.user`. Any route that requires a real account (e.g. leaderboard write, profile update) must reject guest tokens with `403 Forbidden` and a message: `"Guest accounts cannot perform this action. Please log in."`.
- **Rate-limit** this endpoint to 10 requests per IP per minute using NestJS Throttler (`@nestjs/throttler`). This prevents guest account spam. If not already in the project, add `ThrottlerModule` to `app.module.ts`.
- **Guest cleanup**: add a scheduled NestJS Cron job (`@nestjs/schedule`) that runs hourly and hard-deletes `User` rows where `isGuest = true` AND `updatedAt < NOW() - INTERVAL '3 hours'`. This prevents guest records from accumulating in the database.
- Do **not** apply the guest rate limit to the 42 OAuth or dev-login routes.

---

### 3. Dev account with max stats

Extend `auth.service.ts` `devLogin()` to seed the dev user with maximum stats on creation:

```typescript
// When creating the dev user for the first time, set:
user.level   = 99;
user.xp      = 999999;
// And on their Profile:
profile.totalWins   = 999;
profile.totalLosses = 0;
profile.gamesPlayed = 999;
profile.bio         = 'The legendary KameMaster. Undefeated.';
```

These values must only be set at account creation time, not on every `devLogin` call. Use the existing `findOrCreate` pattern: check if the user already exists, and only apply seed stats when creating a new record.

The dev user must also receive a special `isDevAccount: boolean` column (default `false`) on `User`. Set it to `true` for any user created through `devLogin`. This flag can be used by the frontend to render a gold crown or "DEV" badge on the profile panel.

---

### 4. Security requirements — non-negotiable

These must all be implemented. Do not skip any.

#### 4.1 JWT storage migration

`localStorage` is XSS-vulnerable. Migrate JWT storage from `localStorage` to **httpOnly, SameSite=Strict, Secure cookies** set by the backend.

- Backend: after issuing a JWT (OAuth callback, dev login), set a cookie:
  ```
  Set-Cookie: auth_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400
  ```
  Return `{ ok: true }` as the JSON body — the token itself must not appear in the response body.
- Frontend `apiFetch`: replace the `Authorization: Bearer` header with `credentials: 'include'` on all fetch calls. Remove all `localStorage.getItem('jwt_token')` and `localStorage.setItem` calls.
- Guest tokens follow the same pattern with `Max-Age=7200` (2 h).
- `api.devLogin` must also use cookie auth — the `/auth/dev-login` response sets a cookie, not a JSON token body.
- Update `AuthCallbackScene` (or `LandingScene` step 1): since the token is now in a cookie, the `?token=` URL parameter approach is eliminated. The OAuth callback endpoint on the backend must set the cookie and redirect to the frontend with no token in the URL: `res.redirect('/')`.
- Remove the `getToken()` function from `api.ts` entirely.

#### 4.2 CSRF protection

Because auth is now cookie-based, add CSRF protection to all state-mutating endpoints.

- Backend: add the `csurf` package (or NestJS equivalent) as middleware. Issue a CSRF token via `GET /api/auth/csrf-token` (unguarded). Return it in a response header and also in a non-httpOnly cookie `csrf_token`.
- Frontend: read `csrf_token` from cookies and attach it as `X-CSRF-Token` header on every non-GET `apiFetch` call.
- The `GET /api/auth/guest` endpoint is a POST — it must be CSRF-protected once the user has loaded the page.

#### 4.3 Dev login endpoint

The existing double-gate is correct and must be preserved:
```typescript
if (process.env.NODE_ENV === 'production') throw new ForbiddenException(...)
if (process.env.ENABLE_DEV_LOGIN !== 'true') throw new ForbiddenException(...)
```
Do not loosen either condition. The Vite client-side guard (`import.meta.env.VITE_DEV_LOGIN_ENABLED`) hides the UI but is not a security boundary — the backend gate is the enforcer.

#### 4.4 Input validation

- The `username` query param on `GET /api/auth/dev-login` must be validated: max 20 characters, alphanumeric + underscore only. Use NestJS `ValidationPipe` + `class-validator`. Reject with `400 Bad Request` if invalid.
- The guest username generator must use a UUID-based suffix — never echo any user-supplied input into the generated username.

#### 4.5 Rate limiting summary

| Endpoint | Limit |
|---|---|
| `POST /api/auth/guest` | 10 req / IP / min |
| `GET /api/auth/dev-login` | 5 req / IP / min |
| `GET /api/auth/me` | 60 req / IP / min |
| All other `/api/auth/*` | 20 req / IP / min |

Use `@nestjs/throttler` with per-route overrides via the `@Throttle()` decorator.

---

### 5. `api.ts` changes

Rewrite `api.ts` to:

- Remove `getToken()` and all `localStorage` references.
- Add `credentials: 'include'` to all `fetch` calls.
- Add `X-CSRF-Token` header injection on non-GET requests.
- Add a `logout()` method: `DELETE /api/auth/session` which clears the server-side session (future-proof for refresh token revocation) and instructs the browser to delete the auth cookie.
- Add `guestLogin()`: `POST /api/auth/guest` — used by the Quick Game button.
- Add `getCsrfToken()`: `GET /api/auth/csrf-token` — called once on `LandingScene` creation and cached for the session.
- All methods must have explicit TypeScript return types — no `any`.
- Wrap every `apiFetch` call in a try/catch and throw typed error objects (`AuthError`, `NetworkError`) instead of generic `Error` so the frontend can distinguish network failures from auth rejections.

---

### 6. `HubScene` changes

- The `promptLayer` that currently shows a login title + "Login with 42" button is now owned by `LandingScene`. Remove it from `HubScene` entirely.
- `HubScene.create()` must call `api.getMe()` on entry. If it returns 401, transition back to `LandingScene` (the session expired). This guards against token expiry during a long session.
- If `req.user.isGuest` is true, show a persistent non-intrusive banner at the bottom of the HUD: **"Playing as Guest — Log in to save your progress"**. Clicking it transitions to `LandingScene`. The banner must not block gameplay hotspots.
- If `req.user.isDevAccount` is true, render a small gold "DEV" badge next to the username in the HUD.

---

### 7. Backend — new endpoint summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/guest` | None | Create guest user, return httpOnly cookie. |
| `DELETE` | `/api/auth/session` | Cookie | Clear auth cookie (logout). |
| `GET` | `/api/auth/csrf-token` | None | Return CSRF token for subsequent requests. |
| `GET` | `/api/auth/42` | None | Redirect to 42 OAuth (existing, restore from TODO#1). |
| `GET` | `/api/auth/42/callback` | 42 OAuth | Handle callback, set cookie, redirect to `/`. |

---

### 8. DevOps / environment variables

Add the following to `.env.example` and Docker Compose environment blocks:

```env
# Auth
JWT_SECRET=<strong-random-secret-min-64-chars>
JWT_EXPIRES_IN=24h
JWT_GUEST_EXPIRES_IN=2h

# 42 OAuth
FORTYTWO_CLIENT_ID=<from-42-intra-app-settings>
FORTYTWO_CLIENT_SECRET=<from-42-intra-app-settings>
FORTYTWO_CALLBACK_URL=https://localhost/api/auth/42/callback

# Dev login (never set to true in production)
ENABLE_DEV_LOGIN=false
NODE_ENV=development

# Vite (frontend only — these are PUBLIC, do not put secrets here)
VITE_API_URL=/api
VITE_DEV_LOGIN_ENABLED=false
```

- `JWT_SECRET` must be loaded from a Docker secret (`secrets:` block in `docker-compose.yml`), not a plain environment variable, in any deployment beyond local dev.
- `FORTYTWO_CLIENT_SECRET` must also use Docker secrets.
- `ENABLE_DEV_LOGIN` must default to `false` (absent from env = disabled). Add an explicit comment in `.env.example` warning that setting this to `true` in a public deployment is a critical security vulnerability.
- The Nginx config must not expose `/api/auth/dev-login` to the public internet in any environment. Add a location block that returns `403` for that path when `NODE_ENV=production`. This is a second network-layer defence in addition to the application-layer guard.

---

### 9. Testing requirements

Write or update tests for every new backend endpoint. Minimum coverage:

- `POST /api/auth/guest`:
  - Returns 200 and sets `Set-Cookie` on success.
  - Returns 429 after exceeding rate limit.
  - Guest username is unique per call.
- `GET /api/auth/dev-login`:
  - Returns 403 when `NODE_ENV === 'production'`.
  - Returns 403 when `ENABLE_DEV_LOGIN !== 'true'`.
  - Returns 200 and sets cookie when both gates pass.
  - Returns 400 when username contains invalid characters.
  - Returns 400 when username exceeds 20 characters.
- `DELETE /api/auth/session`:
  - Clears the cookie (`Set-Cookie: auth_token=; Max-Age=0`).
  - Returns 401 when called without a valid cookie.
- Guest cleanup cron:
  - Deletes guest records older than 3 hours.
  - Does not delete non-guest records or recent guest records.

Test framework: Jest (already configured). Use `supertest` for HTTP integration tests. Mock `UsersService` and `JwtService` in unit tests.

---

### 10. Checklist before opening a PR

- [ ] `npx tsc --noEmit` passes with zero errors on both frontend and backend.
- [ ] `npm run test` passes with zero failures.
- [ ] No `localStorage` references remain in `api.ts` or any scene file.
- [ ] `ENABLE_DEV_LOGIN` is `false` in all committed `.env` files.
- [ ] `JWT_SECRET` and `FORTYTWO_CLIENT_SECRET` are not committed — Docker secrets only.
- [ ] The "Dev Login" UI element is invisible when `VITE_DEV_LOGIN_ENABLED !== 'true'`.
- [ ] `GET /api/auth/dev-login` returns 403 when called in a `NODE_ENV=production` container.
- [ ] Resize the browser window from 400px to 1920px — landing screen layout stays correct.
- [ ] Guest banner appears in HubScene when logged in as guest.
- [ ] DEV badge appears in HUD when logged in as dev account.
- [ ] All buttons have hover states and disabled states during async operations.
- [ ] No hardcoded colours — all UI uses `THEME` tokens.
- [ ] Guest cleanup cron is registered and visible in NestJS startup logs.
