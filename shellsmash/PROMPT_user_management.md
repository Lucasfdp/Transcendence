# Implementation Prompt: Standard User Management — Friends + Online Status + Leaderboards

## Context

You are working on **ShellSmash**, a multiplayer gaming hub (ft_transcendence project).
The stack is:
- **Backend:** NestJS + TypeORM + PostgreSQL + Redis, running on port 8000 behind Nginx
- **Frontend:** React + Phaser.js (TypeScript, Vite), all game UI is Phaser scenes
- **Auth:** httpOnly JWT cookie (`auth_token`), CSRF double-submit, 42 OAuth + local
- **WebSocket:** Socket.io gateway at `/ws/` — auth via the same JWT cookie

All source lives under `srcs/requirements/`.

---

## Goal

Implement the three remaining pieces of the **Standard User Management** module so it fully passes evaluation:

1. **Friends system** — add/remove, friends list, pending requests
2. **Online status** — expose per-user and per-friends-list online state
3. **Leaderboards** — all-time, monthly, weekly, and friends-only boards

These must work together: the friends leaderboard filters the main leaderboard to only show friends.

---

## What Already Exists (do not duplicate)

### Entities you will use
- `User` entity at `srcs/requirements/backend/src/src/users/entities/user.entity.ts`
  - Fields: `id`, `username`, `turtleName`, `shellSkin`, `level`, `xp`, `coins`, `avatar`, `isGuest`, `createdAt`
- `Profile` entity at `srcs/requirements/backend/src/src/profiles/entities/profile.entity.ts`
  - Fields: `totalWins`, `totalLosses`, `gamesPlayed`, `totalCoinsEarned`, `bio`
- `UserGameStats` entity at `srcs/requirements/backend/src/src/game-results/entities/user-game-stats.entity.ts`
  - Fields: `userId`, `gameId`, `gamesPlayed`, `totalWins`, `totalLosses`
- `UserRating` entity at `srcs/requirements/backend/src/src/matchmaking/entities/user-rating.entity.ts`
  - Fields: `userId`, `gameId`, `rating`, `wins`, `losses`, `draws`
- `Match` / `MatchPlayer` entities under `srcs/requirements/backend/src/src/matchmaking/entities/`
  - `Match.createdAt` is a real `timestamptz` — use it for weekly/monthly filtering

### Services you will call
- `UsersService` — `findById`, `findByUsername`, `findAll`, `save`
- `PresenceService` (in `MatchmakingModule`) — `isOnline(userId: number): boolean`
  - This service is in-process; inject it or expose it via a shared module

### Frontend API client
`srcs/requirements/frontend/src/hub/api.ts` — all backend calls go through `apiFetch`.
Add every new endpoint here following the same pattern (typed return, `credentials: 'include'`).

### Frontend profile UI
`srcs/requirements/frontend/src/hub/ProfilePanel.ts` — the existing profile panel is a
Phaser `Container`. It already renders wins/losses/played. Friends list and online dots
should be added as a new tab or section inside this panel, not a separate scene.

---

## What to Build

### 1. Backend — Friendship entity + module

Create `srcs/requirements/backend/src/src/friends/` with:

**`entities/friendship.entity.ts`**
```
@Entity('friendships')
@Index(['requesterId', 'addresseeId'], { unique: true })
Friendship {
  id: number (PK)
  requesterId: number (FK → users.id, CASCADE)
  addresseeId: number (FK → users.id, CASCADE)
  status: 'pending' | 'accepted' | 'blocked'  // use a varchar column, not enum
  createdAt: timestamptz (CreateDateColumn)
  updatedAt: timestamptz (UpdateDateColumn)
}
```

**`friends.service.ts`** — methods:
- `sendRequest(requesterId, addresseeId)` — insert pending; throw `ConflictException` if a row already exists in either direction; throw `BadRequestException` if self-friending
- `acceptRequest(addresseeId, requesterId)` — update status to 'accepted'; throw `NotFoundException` if no pending row
- `removeOrDecline(actorId, otherId)` — delete the row regardless of direction or status
- `block(blockerId, blockedId)` — upsert status to 'blocked' with blockerId as requester
- `listFriends(userId)` — return all accepted rows where user is requester or addressee; join User on the other side; return `FriendView[]`
- `listPending(userId)` — return rows where addresseeId = userId AND status = 'pending'
- `areFriends(userAId, userBId): Promise<boolean>`
- `getFriendIds(userId): Promise<number[]>` — used by the leaderboard

**`FriendView` interface:**
```typescript
interface FriendView {
  userId: number;
  username: string;
  turtleName: string | null;
  shellSkin: string;
  avatar: string | null;
  level: number;
  isOnline: boolean;  // from PresenceService.isOnline()
}
```

**`friends.controller.ts`** — all routes under `/friends`, all behind `JwtAuthGuard`:
- `GET /friends` → `listFriends(req.user.id)` — returns `FriendView[]` with live `isOnline`
- `GET /friends/pending` → `listPending(req.user.id)`
- `POST /friends/request` — body `{ username: string }` — look up by username, then `sendRequest`
- `POST /friends/accept` — body `{ userId: number }` — `acceptRequest`
- `DELETE /friends/:userId` — `removeOrDecline`
- `POST /friends/block` — body `{ userId: number }` — `block`

**`friends.module.ts`** — import `TypeOrmModule.forFeature([Friendship])`, import `UsersModule`, import `MatchmakingModule` (for `PresenceService`), export `FriendsService`.

Register `FriendsModule` in `app.module.ts`.

Add a migration: `srcs/requirements/backend/src/src/migrations/<timestamp>-create-friendships.ts` using the TypeORM migration pattern already used in the project.

---

### 2. Backend — Online status on user endpoints

Inject `PresenceService` into `UsersController` (which is inside `UsersModule`). Because `PresenceService` lives in `MatchmakingModule`, either:
- Export `PresenceService` from `MatchmakingModule` and import `MatchmakingModule` into `UsersModule`, OR
- Move `PresenceService` to a new `PresenceModule` that both import

Pick whichever avoids a circular dependency. Use `forwardRef` only as a last resort.

Add `isOnline: boolean` to the response of:
- `GET /users/:username` — single user public profile
- `GET /users/leaderboard` — each entry in the leaderboard array

The `isOnline` field is read-only and derived at request time from `PresenceService.isOnline()`. Never persist it to the database.

---

### 3. Backend — Leaderboard endpoint

Extend `UsersController` with:

```
GET /users/leaderboard?period=all|monthly|weekly&scope=global|friends
```

Query params:
- `period`: `'all'` (default) | `'monthly'` | `'weekly'`
- `scope`: `'global'` (default) | `'friends'`

When `scope=friends`, call `FriendsService.getFriendIds(req.user.id)` and filter results to only those user IDs plus the requesting user themselves (so you always appear on your own friends leaderboard).

When `period` is not `'all'`, join `MatchPlayer` on `userId` and filter `Match.createdAt` to the relevant window (last 7 days for weekly, current calendar month for monthly) and aggregate `wins` from that subset. Do this via a TypeORM QueryBuilder subquery — do NOT pull all matches into memory.

Leaderboard entry shape:
```typescript
interface LeaderboardEntry {
  rank:        number;      // 1-indexed position in the sorted result
  userId:      number;
  username:    string;
  turtleName:  string | null;
  shellSkin:   string;
  avatar:      string | null;
  level:       number;
  wins:        number;      // period-filtered wins OR profile.totalWins for 'all'
  gamesPlayed: number;      // period-filtered OR profile.gamesPlayed for 'all'
  isOnline:    boolean;
}
```

Sorting: `wins DESC`, tiebreak `level DESC`, tiebreak `username ASC`. Limit to 50 entries.

For `period=all` you can use the existing `profile.totalWins` — no join needed, fast path.

Guard this endpoint with `JwtAuthGuard`. Guests can call it; `scope=friends` returns only themselves.

---

### 4. Frontend — api.ts additions

Add to the `api` object in `srcs/requirements/frontend/src/hub/api.ts`:

```typescript
// Types
export interface FriendView {
  userId:     number;
  username:   string;
  turtleName: string | null;
  shellSkin:  string;
  avatar:     string | null;
  level:      number;
  isOnline:   boolean;
}

export interface LeaderboardEntry {
  rank:        number;
  userId:      number;
  username:    string;
  turtleName:  string | null;
  shellSkin:   string;
  avatar:      string | null;
  level:       number;
  wins:        number;
  gamesPlayed: number;
  isOnline:    boolean;
}

// API methods
getFriends: (): Promise<FriendView[]>
  => apiFetch<FriendView[]>('/friends'),

getPendingRequests: (): Promise<FriendView[]>
  => apiFetch<FriendView[]>('/friends/pending'),

sendFriendRequest: (username: string): Promise<void>
  => apiFetch<void>('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),

acceptFriendRequest: (userId: number): Promise<void>
  => apiFetch<void>('/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) }),

removeFriend: (userId: number): Promise<void>
  => apiFetch<void>(`/friends/${userId}`, { method: 'DELETE' }),

getLeaderboard: (
  period: 'all' | 'monthly' | 'weekly' = 'all',
  scope:  'global' | 'friends' = 'global',
): Promise<LeaderboardEntry[]>
  => apiFetch<LeaderboardEntry[]>(`/users/leaderboard?period=${period}&scope=${scope}`),
```

---

### 5. Frontend — HubScene leaderboard panel

The leaderboard is currently rendered in `HubScene.ts` in a method called `buildLeaderboardPanel` (look for `lbLayer`). It calls `api.getAllUsers()` and sorts client-side. Replace this with the new endpoint.

Changes to `HubScene.ts`:
- Replace the `getAllUsers()` call with `api.getLeaderboard('all', 'global')`
- Add three tab buttons above the leaderboard: **All Time**, **Monthly**, **Weekly** — clicking each re-fetches with the matching `period` param and redraws the list
- Add a **Friends** toggle button — when active, passes `scope: 'friends'` to the current period fetch
- Each row should display a small coloured dot (green = online, grey = offline) using the `isOnline` field — use `THEME` colours already defined in `srcs/requirements/frontend/src/shared/theme.ts`
- Keep generation-guard pattern already in place (check the existing `buildLeaderboardPanel` for the `_lbGen` guard to prevent stale async redraws)

---

### 6. Frontend — ProfilePanel friends tab

`ProfilePanel.ts` currently has sections for stats and shell inventory. Add a **Friends** section below the stats panel:

- A scrollable list of `FriendView[]` — each row: online dot, `turtleName ?? username`, level badge
- An **Add Friend** input: a text input (use a DOM `<input>` overlaid on the Phaser canvas, same pattern used elsewhere if one exists, otherwise use a Phaser `Graphics` + keyboard capture) that POSTs to `sendFriendRequest`
- A **Pending** count badge on the panel toggle button if `getPendingRequests()` returns any entries
- Pending requests shown as a sub-list with Accept / Decline buttons per row

Keep the panel self-contained — it owns its own async fetches. Fetch friends on `toggle()` open, not on construction.

---

## Coding Standards

Apply these unconditionally — do not leave them for review:

- All injected dependencies that are never reassigned: `private readonly`
- Every `async` method that touches DB or network: `try/catch` with a meaningful NestJS exception (never let TypeORM errors bubble raw)
- No raw `.sort()` on shared arrays — use `[...arr].sort(...)` or `.toSorted()`
- No magic numbers — extract `LEADERBOARD_LIMIT = 50`, `WEEKLY_DAYS = 7` etc. as named constants at module top
- No commented-out code; no bare `// TODO` without a description
- TypeORM `QueryBuilder` for the period-filtered leaderboard query — do not pull all rows and filter in JS
- The `Friendship` entity must have a `CHECK` constraint preventing `requesterId = addresseeId` — add it with `@Check('"requesterId" <> "addresseeId"')` on the entity class
- `sendRequest` must be idempotent-safe: if a row already exists in either direction with status `'pending'` or `'accepted'`, throw `ConflictException('Friend request already exists or users are already friends')`
- All new controller methods must have `@ApiTags` and `@ApiBearerAuth` decorators to match the existing Swagger setup

---

## What NOT to change

- `PresenceService` internals — it is already correct; only consume `isOnline()`
- The WebSocket gateway or matchmaking flow
- The auth system, JWT strategy, or CSRF logic
- Any existing entity columns — only add new entities or new columns via migration

---

## Acceptance Criteria

- `GET /friends` returns friends with correct `isOnline` state reflecting the live WebSocket presence
- `POST /friends/request` → `POST /friends/accept` flow works end-to-end
- `GET /users/leaderboard?period=weekly&scope=friends` returns only the requesting user's friends (+ themselves) sorted by wins in the last 7 days
- `GET /users/leaderboard?period=monthly` counts wins from `Match.createdAt` within the current calendar month, not JS-computed
- The HubScene leaderboard panel shows All Time / Monthly / Weekly tabs and a Friends toggle, all fetching from the new endpoint
- The ProfilePanel shows a friends list with online indicators and a working Add Friend input
- No existing tests break; new service methods have at minimum one spec file with happy-path and error-path cases
- `docker compose up --build` starts cleanly with no TypeScript compile errors
