# Shell Smash — Fix Account Registration

> **Context for the implementer:** NestJS 10 + TypeORM + PostgreSQL backend,
> Phaser 3 + Vite frontend (TypeScript). Auth is cookie-based JWT with a
> double-submit CSRF pattern. The frontend is served through an nginx proxy.
> No localStorage — all state is server-side.

---

## Confirmed Bug — `apiFetch` maps 409 / 429 to `NetworkError`, breaking all conflict and rate-limit feedback

### Root cause

`apiFetch` in `hub/api.ts` only promotes HTTP 401 and 403 to `AuthError`.
Every other non-2xx status — including **409 Conflict** (duplicate username)
and **429 Too Many Requests** (rate limit hit) — falls into the `!res.ok`
branch and becomes a generic `NetworkError`:

```typescript
// hub/api.ts — current (broken)
if (res.status === 401 || res.status === 403) {
	throw new AuthError(res.status, `${res.status} on ${path}`);
}
if (!res.ok) {
	throw new NetworkError(`API error ${res.status} on ${path}`); // swallows 409, 429
}
```

Meanwhile, `LandingScene.friendlyError()` checks `err instanceof AuthError`
before inspecting the status, so neither branch ever fires:

```typescript
// LandingScene.ts — friendlyError() — 409 / 429 checks are dead code
if (err instanceof AuthError) {
	if (err.status === 429) return "Too many attempts…"; // never reached
	if (err.status === 409) return "That username is already taken."; // never reached
}
```

**Symptom:** A duplicate-username registration attempt shows
"Network error — please check your connection." instead of
"That username is already taken."
A rate-limited attempt shows the same generic message.

### Fix — `hub/api.ts` `apiFetch`

Extend the `AuthError` branch to include every status code that the backend
sends with a structured JSON error body that the frontend needs to act on:

```typescript
// hub/api.ts — fixed
const AUTH_ERROR_STATUSES = new Set([401, 403, 409, 422, 429]);

if (AUTH_ERROR_STATUSES.has(res.status)) {
	throw new AuthError(res.status, `${res.status} on ${path}`);
}
if (!res.ok) {
	throw new NetworkError(`API error ${res.status} on ${path}`);
}
```

No changes needed to `LandingScene.friendlyError()` — it already handles
409 and 429 correctly, it just never got to execute them.

---

## Likely Bug — `POST /api/auth/register` returns HTTP 201, `apiFetch` does not handle it

### Root cause

`AuthController.localRegister` is decorated with `@HttpCode(201)`.
A 201 response is `res.ok === true`, so it passes the error guards — but
then `apiFetch` checks:

```typescript
if (res.status === 204) return {} as T;
return res.json() as Promise<T>;
```

A 201 body of `{ ok: true }` is valid JSON, so `res.json()` succeeds and the
function returns normally. **This is not a bug by itself**, but it is a source
of confusion if you are curl-testing the endpoint expecting 200.

**Recommendation:** Change `@HttpCode(201)` to `@HttpCode(200)` on
`localRegister` for consistency with `localLogin`. The `201 Created` status is
semantically correct but adds nothing here — login already returns 200, and the
frontend just checks `{ ok: true }` regardless.

```typescript
// auth/auth.controller.ts
@Post('register')
@HttpCode(200)   // was 201
async localRegister(...)
```

---

## Potential Bug — CSRF token not present in browser when register is called

### What should happen

1. `LandingScene.create()` → `api.getMe()` returns 401 → overlay mounts.
2. User clicks "Create Account" → `handleSubmit()` calls `await api.getCsrfToken()`.
3. `getCsrfToken()` hits `GET /api/auth/csrf-token` which sets the
   `csrf_token` cookie (`httpOnly: false`, so JS can read it) and returns
   `{ csrfToken }`. The value is cached in `cachedCsrfToken`.
4. `api.register()` calls `apiFetch` which reads `cachedCsrfToken` and adds
   `X-CSRF-Token` header.
5. Backend `validateCsrf()` compares header ↔ cookie — they match — proceeds.

### How it can break

- **SameSite / Secure mismatch:** In development the backend sets
  `sameSite: 'lax'` and `secure: false` for the CSRF cookie.
  If the frontend origin and the backend origin are on different ports but
  the same hostname (`localhost`), lax + same-site should work.
  If nginx is terminating TLS and the backend thinks it is not production,
  `secure: false` means the cookie is also sent over HTTP — fine in dev.
  **If nginx is serving HTTPS but `NODE_ENV` is not `'production'`**, the
  cookie will have `secure: false` and may be rejected by the browser.
  Fix: ensure `NODE_ENV=production` in the docker-compose override whenever
  nginx is serving HTTPS.

- **Cookie path:** The CSRF cookie is set with `path: '/'` — correct.

- **`cachedCsrfToken` stale across page reloads:** The in-memory cache is
  module-level and survives HMR reloads in dev but not full page reloads.
  `readCsrfCookie()` reads the cookie from `document.cookie` as a fallback,
  so a stale cached value is not a problem — a missing cookie is.
  If `getCsrfToken()` succeeds but the cookie is somehow not visible to JS
  (e.g., httpOnly set incorrectly), `readCsrfCookie()` returns null and the
  header will be omitted, causing a 401 on the next POST.

### How to diagnose

Open DevTools → Network tab → find `GET /api/auth/csrf-token`.

1. Confirm the response sets `Set-Cookie: csrf_token=<hex>` with no
   `HttpOnly` flag.
2. Confirm `document.cookie` in the console includes `csrf_token=<same hex>`.
3. Find the `POST /api/auth/register` request and confirm the request headers
   include `X-CSRF-Token: <same hex>`.

---

## Potential Bug — DB `unique` constraint on `username` throws a raw error that bypasses `ConflictException`

### Root cause

`AuthService.localRegister` guards with an explicit lookup before inserting:

```typescript
const existing = await this.usersService.findByUsername(username);
if (existing) throw new ConflictException("Username is already taken");
```

There is a TOCTOU race: two concurrent requests for the same username can
both pass the `findByUsername` check and then race to `usersRepo.save()`.
The second save will throw a PostgreSQL `UniqueViolation` (error code `23505`),
which TypeORM wraps as a generic `Error`, not as a `ConflictException`. The
catch block in `usersService.create()` re-throws it as
`InternalServerErrorException` (HTTP 500), not 409.

**Symptom:** The user sees "Registration failed — username may already be
taken." (the fallback string) rather than the structured 409 message.

### Fix — `users/users.service.ts` `create()`

Inspect the error code and re-throw as `ConflictException`:

```typescript
import { ConflictException, InternalServerErrorException } from '@nestjs/common';

async create(data: { ... }): Promise<User> {
  try {
    const profile      = this.profilesRepo.create();
    const savedProfile = await this.profilesRepo.save(profile);
    const user         = this.usersRepo.create({ ...data, profile: savedProfile });
    return await this.usersRepo.save(user);
  } catch (err: unknown) {
    // PostgreSQL unique-violation error code
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '23505') {
      throw new ConflictException('Username is already taken');
    }
    throw new InternalServerErrorException('Failed to create user');
  }
}
```

This makes the DB-level constraint the authoritative guard and removes the
TOCTOU window entirely. The application-level `findByUsername` check in
`localRegister` can remain as a fast pre-flight, but it is no longer the
only guard.

---

## Potential Bug — `null` email unique constraint in PostgreSQL

`User.email` is `@Column({ unique: true, nullable: true })`. PostgreSQL treats
each `NULL` as distinct, so multiple rows with `email = null` are allowed —
this is correct behaviour. **No action needed**, but be aware that MySQL/MariaDB
treats `NULL` as equal in unique indexes, which would break local accounts.
If the project ever runs on MySQL, a partial index workaround is needed.

---

## Potential Bug — scrypt password hashing blocks the event loop in Node 18

`AuthService.hashPassword` uses the `crypto.scrypt` callback API wrapped in a
promise. With `N = 32768` this takes ~100 ms on a modern core. In Node.js the
scrypt computation runs on libuv's thread pool (not the main thread), so the
event loop is **not** blocked — this is fine. No action needed, but worth
knowing when debugging slow registration responses.

---

## Diagnostic checklist — run these before writing any code

Work through these in order. Most bugs will be caught before step 5.

### Step 1 — Confirm the backend is actually receiving the request

```bash
# Inside the backend container or on the host
docker compose logs backend --follow
```

Submit the registration form and watch for:

- `POST /api/auth/register` log line
- Any unhandled exception stacktrace
- TypeORM SQL query logs (enabled when `NODE_ENV=development`)

### Step 2 — Inspect the raw HTTP exchange

DevTools → Network → find `POST /api/auth/register`:

- **Request headers:** `Content-Type: application/json`, `X-CSRF-Token: <hex>`,
  `Cookie: csrf_token=<hex>` (and possibly `auth_token=...` if a stale session
  exists).
- **Request body:** `{"username":"...","password":"..."}` — confirm no extra
  fields.
- **Response status:** expect `200` (or `201` if not yet changed). If you see
  `401` the CSRF check failed. If `400`, `ValidationPipe` rejected the body.
  If `500`, there is a DB error.
- **Response body:** for errors, NestJS returns
  `{ statusCode, message, error }` — log `await res.json()` in the catch to
  see the actual message.

### Step 3 — Confirm the CSRF handshake

```javascript
// Paste in browser console after the landing page loads
console.log("csrf cookie:", document.cookie.match(/csrf_token=([^;]+)/)?.[1]);
```

Then submit the form and check the `X-CSRF-Token` header on the POST matches.

### Step 4 — Check for a stale auth cookie blocking the overlay

If `GET /api/auth/me` returns 200 (not 401), `LandingScene` skips the overlay
and goes straight to `HubScene`. If `HubScene` then fails to load the user,
the session is corrupt. Fix: clear cookies in DevTools → Application → Cookies.

### Step 5 — Test the endpoint directly with curl

```bash
# 1. Get CSRF token
CSRF=$(curl -s -c /tmp/cookies.txt \
  https://localhost/api/auth/csrf-token | jq -r .csrfToken)

# 2. Register
curl -s -b /tmp/cookies.txt -c /tmp/cookies.txt \
  -X POST https://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"username":"testturtle","password":"password123"}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `{"ok":true}` with HTTP 200 (or 201).
If this succeeds but the browser flow fails, the problem is in CORS /
cookie propagation from nginx, not in the backend logic.

---

## Files to modify (summary)

| Action     | Path                                                        | Change                                                                                |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Modify** | `srcs/requirements/frontend/src/src/hub/api.ts`             | Extend `AUTH_ERROR_STATUSES` to include 409 and 429                                   |
| **Modify** | `srcs/requirements/backend/src/src/auth/auth.controller.ts` | Change `@HttpCode(201)` → `@HttpCode(200)` on `localRegister`                         |
| **Modify** | `srcs/requirements/backend/src/src/users/users.service.ts`  | Catch PostgreSQL error code `23505` in `create()` and re-throw as `ConflictException` |

---

## Tests to write

```typescript
// auth/auth.service.spec.ts (or auth.controller.spec.ts)

it("should return { ok: true } and set auth cookie on successful registration");
it("should return 409 when username is already taken");
it("should return 400 when password is shorter than 8 characters");
it("should return 400 when username contains invalid characters");
it("should return 429 after 5 failed attempts within 60 seconds");
it("should return 401 when CSRF token is missing");
it("should return 401 when CSRF header does not match cookie");

// users/users.service.spec.ts
it("should throw ConflictException when PostgreSQL returns error code 23505");
```

---

## Security notes

- **Username enumeration:** `localLogin` already performs a dummy scrypt
  derivation when the username does not exist, preventing timing-based
  enumeration. Good.
- **Password exposure in logs:** confirm NestJS request logging does not
  log request bodies. The default logger does not — but any custom logging
  middleware should explicitly exclude `password` fields.
- **Bcrypt vs scrypt:** scrypt with `N=32768` is a strong choice. Ensure the
  production Docker image has enough memory; scrypt `N=32768, r=8, p=1`
  uses approximately 32 MB of RAM per invocation at peak.
