# Social Tab Improvement — Engineering Handoff

> Status as of 2026-07-01. Picking up from a partially-completed multi-batch effort
> to upgrade the game's **Social tab**. Batches 0–2 are **done and green**.
> Batches 3–5 remain. This document is written so a fresh agent can continue
> without re-deriving context.

---

## 1. What this project is

`ft_transcendence` — a turtle-sumo mini-game hub ("Shell Smash").

- **Backend:** NestJS + TypeORM + PostgreSQL, WebSockets via Socket.IO. Tests: **Jest** (`*.spec.ts`).
- **Frontend:** React 18 + TypeScript + Vite, Phaser for games. Tests: **Vitest + React Testing Library** (`*.test.ts[x]`) — *this harness was added in Batch 0; it did not exist before.*
- Auth is cookie-based (httpOnly `auth_token`); non-GET requests send `X-CSRF-Token`. The frontend API client lives in `frontend/src/features/hub/api.ts`.

The Social tab is a modal rendered inside the giant `frontend/src/pages/HomePage.tsx`
(~2800 lines, multiple components). The social modal JSX is gated by
`activeModal === "social"`.

---

## 2. ⚠️ Environment constraints (READ FIRST — these shape the whole workflow)

This work was done in a sandboxed Linux environment with the user's repo mounted.
Key limitations the next agent will hit:

1. **The sandbox npm registry is blocked (HTTP 403 on every package).** You cannot
   `npm install` anything new from the sandbox. New dependencies must be installed
   by the user on their machine.
2. **`node_modules` is the user's macOS build.** Native binaries (rollup, esbuild)
   don't load on Linux, so **you cannot run `vitest` (frontend tests) in-sandbox** —
   it crashes with a rollup `MODULE_NOT_FOUND`.
3. **Backend Jest DOES run in-sandbox** (its deps are pure JS enough). So **backend
   batches are fully live-TDD'd by you**; **frontend tests must be run by the user**
   on their Mac (`cd frontend && npm run test:run`).
4. **`tsc --noEmit` runs in-sandbox** for both frontend and backend — use it to
   type-check your work. (Pure JS, no native deps.)

### The agreed frontend TDD loop (because you can't run vitest)
- Write the failing test(s) → ask the user to run `npm run test:run` → they paste **RED**.
- Write the implementation → user runs again → they paste **GREEN**.
- For trivial pure modules you may write test+impl together and ask for a single GREEN run.
- Always `tsc --noEmit` your own files before handing off a run, and filter the output
  to your files (the project has pre-existing tsc errors — see §9).

---

## 3. Path mapping (sandbox ↔ user machine)

| Purpose | User machine (file tools) | Sandbox bash |
|---|---|---|
| Repo root | `/Users/lucas/Documents/Transcendence` | `/sessions/<id>/mnt/Transcendence` |
| Frontend | `…/Transcendence/frontend` | `…/mnt/Transcendence/frontend` |
| Backend | `…/Transcendence/backend` | `…/mnt/Transcendence/backend` |

Use the file tools (Read/Write/Edit) with the user-machine paths; use bash with the
sandbox paths. Never expose `/sessions/...` paths to the user.

---

## 4. Locked product decisions (already agreed with the user — do not re-litigate)

- **Friend code = reuse `@username`.** No schema change; the "copyable friend code" is
  literally the player's `@username` with a Copy button. (Username is already unique.)
- **Reporting = report + auto-block.** Reporting a user also blocks them immediately
  (reuse the existing block path).
- **Decline stays immediate (no undo).** Only friend *removal* gets the undo toast;
  declines and blocks are immediate. The user explicitly confirmed "no symmetry" here.
- **No muting** (the game has no chat).
- **Scope:** all 5 batches are in scope.

---

## 5. Coding standards to enforce (the user is strict about these)

Security: no hardcoded secrets (env vars); gate dev/debug endpoints behind
`NODE_ENV !== 'production'` **and** an explicit feature-flag env var; commit lock files;
flag `eval`/`dangerouslySetInnerHTML`/unvalidated input to syscalls/missing auth guards.

Reliability: every `async` wrapped in `try/catch` with meaningful errors; never mutate
shared arrays in place (`.toSorted()` or spread before `.sort()`); no unhandled promise
rejections (await / `.catch()` / `return`/`void`); no magic numbers — extract named constants.

Maintainability: NestJS constructor deps that are never reassigned must be
`private readonly`; no commented-out code; every `TODO`/`FIXME` has context + ideally an
issue ref; merge consecutive `.push()`; prefer `globalThis` over `window`; merge
consecutive Docker `RUN`s; no `0.0` where `0` is correct; no `{ ...{} }` no-ops.

Testing: every function gets at least a conceptual test; cover happy + edge + error paths;
descriptive test names (`it('should … when …')`); ≥80% coverage on business logic; emit
LCOV for SonarCloud.

Communication: show before/after for changes; call out issues you spot even if not asked;
flag tech-debt/security risk before proceeding.

**Workflow:** the user runs the "superpowers" methodology — **Brainstorm → TDD
(red-green-refactor) → execute in reviewable batches**. Each batch is TDD'd and reviewed
before the next. Don't skip red. Present a review checkpoint after each batch.

---

## 6. ✅ DONE — Batches 0–2 (all green)

### Batch 0 — Frontend test harness
- Added Vitest + RTL + jsdom + v8 coverage. Files:
  - `frontend/vitest.config.ts` (jsdom, setup file, lcov → `frontend/coverage/`)
  - `frontend/src/test/setup.ts` (jest-dom matchers + auto-cleanup)
  - `frontend/src/test/smoke.test.tsx`
  - `frontend/package.json` — scripts `test`, `test:run`, `coverage`; pinned dev deps
    (`vitest@^1.6.1`, `@vitest/coverage-v8`, `@testing-library/{react,dom,jest-dom,user-event}`, `jsdom`).
  - `.sonarcloud.properties` — registered frontend `*.test.ts[x]` as tests; added
    `frontend/coverage/lcov.info` to `sonar.javascript.lcov.reportPaths`.
  - `.gitignore` — added `coverage/`.
- **Note:** the frontend previously had **no lock file**; `npm install` generated
  `frontend/package-lock.json` — make sure it's committed.

### Batch 1 — Social foundations (frontend only)
New, fully unit-tested pure/presentational modules under `frontend/src/features/social/`:
- `friendsOps.ts` (+`.test.ts`) — pure `removeById`, `upsertById`, `friendCounts` (non-mutating).
- `toast/ToastContext.tsx` (+`.test.tsx`) — `ToastProvider` + `useToast`; auto-dismiss,
  `MAX_TOASTS` cap, action button (Undo), `DEFAULT_TOAST_DURATION_MS`.
- `toast/ToastList.tsx` (+`.test.tsx`) — presentational stack.
- `toast/Toaster.tsx` — connected container (mounted in `frontend/src/app/App.tsx` inside
  a new `<ToastProvider>`).
- CSS: `.toast*` and `.hub-modal__social-count` in `frontend/src/styles/global.css`.

`HomePage.tsx` wiring:
- `useToast()` consumed; magic number `FRIEND_REMOVAL_UNDO_MS = 5000`.
- Optimistic add/accept/remove with rollback via `refreshSocial()`.
- **Undo-on-remove**: friend removal is optimistic + deferred-commit (`commitRemoveFriend`)
  with an Undo toast; a `removalTimers` ref holds pending deletions.
- `handleDeclineRequest` split out from removal (immediate, no undo).
- Friend count (`friendStats`) in the Friends heading; toasts replace the old inline
  `modalError` for action feedback (modalError still used for load failures).

### Batch 2 — Presence depth (backend live-TDD + frontend)
**Backend (all green in-sandbox):**
- `presence/presence.service.ts` (+ new `.spec.ts`, 6 tests) — added `PresenceStatus`
  (`offline|online|in-game`), `setInGame`/`clearInGame`/`getStatus`/`getGameId`; `disconnect`
  clears in-game when the last socket drops.
- `users/entities/user.entity.ts` — new nullable `lastSeenAt: Date | null` column.
- `users/users.service.ts` — `markSeen(userId, when?)` (+ focused `users.service.markSeen.spec.ts`, 2 tests).
- `migrations/20260701000000-add-user-last-seen.ts` — adds `users."lastSeenAt"` (camelCase to
  match the users table; `IF NOT EXISTS`, reversible).
- `friends/friends.service.ts` — `FriendView` gained `status`, `gameId`, `lastSeenAt`
  (kept `isOnline` = `status !== "offline"` for back-compat). `listFriends` maps them.
  Spec updated (now 13 tests; presence mock gained `getStatus`/`getGameId`).
- `matchmaking/matchmaking.gateway.ts` — `syncRoomPresence(room)` sets/clears in-game at the
  `emitState` chokepoint + explicit clears on match-end/abandon/lobby-match; `handleDisconnect`
  calls `usersService.markSeen` when a non-guest goes fully offline (`void …catch()`).
  **⚠️ This gateway glue is NOT unit-tested** (no gateway spec harness; 10 injected deps). It
  calls already-tested methods and type-checks clean. Adding a focused gateway spec is a
  candidate for Batch 5.

**Frontend:**
- `features/hub/api.ts` — `FriendView` mirrors the backend (`status`, `gameId`, `lastSeenAt`,
  `PresenceStatus` exported).
- `features/social/presence.ts` (+`.test.ts`, 7 tests) — pure `formatRelativeTime` (named
  ms constants) and `groupFriendsByPresence`.
- `HomePage.tsx` — friends list now renders **grouped** (In game / Online / Offline) via a
  shared `friendRow()` renderer; in-game shows the game label (from `RANKED_GAMES`), offline
  shows "Last online <relative>". Optimistic-accept builds a full `FriendView`.
- CSS: `.hub-modal__social-group*`, `.hub-modal__social-status*` in `global.css`.

**Frontend test count after Batch 2: 26 passing.**

---

## 7. 🔜 REMAINING — Batch 3: Requests & friend code

### 3a. Outgoing friend requests (backend + frontend)
The backend currently only lists **incoming** pending (`FriendsService.listPending`,
`GET /api/friends/pending`). Add the outgoing side.
- **Backend** `friends.service.ts`: add `listOutgoing(userId)` → friendships where
  `requesterId = userId AND status = 'pending'`, with `relations: ["addressee"]`, mapped to a
  view shaped like `PendingView` (use the addressee's fields). TDD in `friends.service.spec.ts`.
- **Controller** `friends.controller.ts`: `GET /api/friends/outgoing`.
- **Frontend** `api.ts`: `getOutgoingRequests()`. Add an "Outgoing requests" section to the
  social modal with a **Cancel** button → `api.removeFriend(userId)` (the existing DELETE
  deletes a pending row in either direction, so cancel works as-is). Optimistic + toast.

### 3b. Copyable friend code (frontend only)
- The friend code **is** the player's `@username` (locked decision). Add a small row at the top
  of the social modal: shows `@<username>` + a **Copy** button → `navigator.clipboard.writeText`,
  then a success toast. Optionally a pure helper `buildFriendCode(username) => "@"+username` with
  a trivial test. Guard `navigator.clipboard` (may be undefined in insecure contexts) — wrap in
  try/catch and toast an error fallback.

### 3c. Notification dedup / reconcile fix (backend + frontend)
**The bug the user described:** with two `friend_request` notifications from the same person,
accepting one (creates the friendship) then declining the duplicate (`removeFriend` deletes it)
nets to *added-then-removed*. See the notification drawer in `HomePage.tsx` (~line 2139): each
`friend_request` notif's Accept calls `acceptFriendRequest(notif.fromUserId)` and Decline calls
`removeFriend(notif.fromUserId)`, marking only that one notif read.
- **Frontend fix:** when acting on a `friend_request` from `fromUserId`, mark **all**
  notifications from that `fromUserId` of that type read (filter them out of the drawer), so a
  duplicate can't be acted on independently.
- **Backend hardening:** in `NotificationsService.create`, dedupe — don't persist a second
  **unread** `friend_request` for the same `(fromUserId → toUserId)` pair. (`FriendsService.sendRequest`
  already throws `ConflictException` on a duplicate friendship row, so the friendship side is safe;
  this is purely about duplicate notification rows.) TDD in `notifications.service.spec.ts`.

---

## 8. 🔜 REMAINING — Batch 4: Discovery & safety, and Batch 5: Polish

### Batch 4
- **Search/filter (frontend):** a text input above the friends list; pure
  `filterFriends(friends, query)` matching `username`/`turtleName` case-insensitively. TDD.
  Add an empty-state for "no matches".
- **Hover profile card (frontend):** on hover/focus of a friend's name, fetch `api.getUser(username)`
  (debounced via a named delay constant + in-memory cache) and show level, tag, most-played,
  W/L. Make it keyboard-accessible (focus also triggers it). Test the cache/debounce logic.
- **Block UI (frontend; backend already done):** `FriendsService.block` + `POST /api/friends/block`
  + `api.blockUser(userId)` already exist. Add a **Block** action (row menu or hover card) with a
  confirm step; optimistic remove + toast.
- **Reporting = report + auto-block (NEW backend module + frontend):**
  - New `reports` module: entity (`id`, `reporterId`, `reportedId`, `category`/`reason`,
    optional `message`, `createdAt`), migration (camelCase columns to match `users`), DTO with a
    category enum, `ReportsService.create(...)` that persists the report **and** calls
    `FriendsService.block(reporterId, reportedId)` (auto-block). Controller `POST /api/reports`.
    Guard against self-report. TDD the service (happy + invalid + that it triggers block).
  - Frontend: a Report action (reason dropdown) → `api.reportUser(...)`; success toast; the
    reported user disappears from the list (they're now blocked).
- **Friend suggestions (backend + frontend):** `FriendsService.getSuggestions(userId)` →
  friends-of-friends, **excluding** self, existing friends, any pending (either direction), and
  blocked users. A query-builder or raw SQL join over `friendships`. Controller
  `GET /api/friends/suggestions`. Frontend "People you may know" section with Add buttons
  (reuse the send-request + optimistic flow). TDD the service exclusion logic carefully.

### Batch 5 — Polish & coverage verification
- **List virtualization** only if row counts warrant (>~50). The social list is in a modal; a
  simple windowing or `react-window` (needs user `npm install`). If lists stay small, document
  why it was skipped rather than adding a dep.
- **A11y pass:** focus management on modal open/close, aria on group headings, keyboard access
  for the hover card and row menus. (Toasts already have `role`/`aria-live`.)
- **Coverage:** backend `npm run test:cov`; frontend `npm run coverage` (user runs). Confirm
  ≥80% on new business logic; LCOV emitted for SonarCloud.
- **Optional but recommended:** add the deferred `MatchmakingGateway` spec to cover
  `syncRoomPresence` + `markSeen`-on-disconnect (Batch 2's untested glue).

---

## 9. Pre-existing issues & gotchas (NOT caused by this work — leave unless asked)

- **3 backend specs fail on clean HEAD** (verified by stashing all edits and re-running):
  `auth.service.spec.ts`, `game-session.service.spec.ts`, `users.service.spec.ts` — 12 failing
  tests from constructor-arity / Request-vs-Response type drift in those specs. Your new backend
  specs all pass; the full-suite "3 failed" is entirely these pre-existing ones. Worth a separate
  cleanup pass; flag to the user, don't silently fix mid-batch.
- **~36 pre-existing `tsc` errors** in the frontend (mostly `games/*` Phaser scenes and the
  `ReplayStage` part of `HomePage.tsx`, e.g. `GameMap.bumpers`, `ReplayMarker`). The project ships
  via Vite/esbuild, which does **not** type-check, so these don't block builds or tests. When you
  `tsc --noEmit`, **filter to your own files** to see if you introduced anything new.
- **Column naming inconsistency:** the `friendships` table uses snake_case columns
  (`requester_id`), but the `users` table uses camelCase quoted columns (`"turtleName"`,
  `"lastSeenAt"`). Match the table you're altering — for `users` use camelCase.
- **Migrations** auto-load via glob (`app.module.ts`: `migrations: [__dirname + "/migrations/**/*{.ts,.js}"]`)
  and `synchronize` is on outside production, so entity changes apply automatically in dev/test.

---

## 10. Commands

```bash
# Backend (runs in-sandbox AND on the user's machine)
cd backend && npx jest <pattern>          # run a spec
cd backend && npm test                    # full suite (note 12 pre-existing failures)
cd backend && npm run test:cov            # coverage
cd backend && node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # type-check

# Frontend (TESTS RUN ON THE USER'S MACHINE ONLY — sandbox can't run vitest)
cd frontend && npm run test:run           # ask the user to run this for RED/GREEN
cd frontend && npm run coverage           # user runs
cd frontend && node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json  # type-check (you can run this)
```

---

## 11. Git / working state

All Batch 0–2 changes are **uncommitted** (the user said to leave them uncommitted for review).
Do not commit unless the user asks. There are two **pre-existing user stashes**
(`WIP on main: Social`, `WIP on main: fixed physics bug`) — **do not touch them.**

Changed/added files so far (relative to repo root):
```
.gitignore  .sonarcloud.properties
backend/src/modules/presence/presence.service.ts (+ presence.service.spec.ts)
backend/src/modules/users/entities/user.entity.ts
backend/src/modules/users/users.service.ts (+ users.service.markSeen.spec.ts)
backend/src/migrations/20260701000000-add-user-last-seen.ts
backend/src/modules/friends/friends.service.ts (+ friends.service.spec.ts)
backend/src/modules/matchmaking/matchmaking.gateway.ts
frontend/package.json  frontend/package-lock.json  frontend/vitest.config.ts
frontend/src/test/**  frontend/src/features/social/**
frontend/src/features/hub/api.ts
frontend/src/app/App.tsx
frontend/src/pages/HomePage.tsx
frontend/src/styles/global.css
```

### Suggested order for the next agent
Batch 3 (3a → 3b → 3c) → Batch 4 (search → hover → block → reporting → suggestions) → Batch 5.
TDD each: backend live in-sandbox; frontend tests-first with the user running RED then GREEN.
Present a review checkpoint after each batch before starting the next.
