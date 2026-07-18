# Social Features — Leaderboards, Notifications & Friend Invites

**Merged:** 2026-06-27  
**Sprints:** 3  

This document covers everything added in the social features sprint: per-game leaderboards, a persistent notification inbox, and friend-to-friend private lobbies. Read this before touching any of those systems.

---

## What was shipped

### Sprint 1 — Leaderboards

**Goal:** Replace the single static leaderboard with per-game ELO rankings + a cross-game total-wins board, both filterable by global or friends-only scope.

#### New backend files

| File | Purpose |
|---|---|
| `backend/src/modules/leaderboard/leaderboard.service.ts` | Two query methods (see below) |
| `backend/src/modules/leaderboard/leaderboard.controller.ts` | REST endpoints |
| `backend/src/modules/leaderboard/leaderboard.module.ts` | Module wiring |
| `backend/src/modules/leaderboard/leaderboard.service.spec.ts` | 9 unit tests |

**`LeaderboardService` methods:**
- `getGameLeaderboard(callerId, gameId, scope)` — queries `user_ratings` for a specific game. When `scope = "friends"`, intersects results with `FriendsService.getFriendIds()`. Returns up to 100 rows ranked by ELO descending.
- `getOverallLeaderboard(callerId, scope)` — aggregates `SUM(total_wins)` across all `user_game_stats` rows per user. Private/casual wins count here; ELO (`user_ratings`) is unaffected by casual matches.

**Endpoints:**
```
GET /api/leaderboard?gameId=<id>&scope=global|friends
GET /api/leaderboard/overall?scope=global|friends
```

**Modified:** `backend/src/app.module.ts` — added `LeaderboardModule`.

#### Frontend changes

- `frontend/src/features/hub/api.ts` — removed stale `getLeaderboard()` / `LeaderboardEntry`. Added `getGameLeaderboard`, `getOverallLeaderboard`, `RANKED_GAMES` constant, `GameLeaderboardEntry`, `OverallLeaderboardEntry`, `LeaderboardScope` types.
- `frontend/src/pages/HomePage.tsx` — leaderboard panel now has a game dropdown (including "Overall") and a global/friends scope toggle. Fetches re-fire on dropdown or scope change.
- `frontend/src/styles/modules/social-replays.css` — contains the leaderboard controls, selectors, scope controls, and ranking-list styles.

---

### Sprint 2 — Notification System

**Goal:** Persistent inbox for friend-related events (survives the user being offline), with live WebSocket push when they're online. Bell icon + drawer in the hub.

#### Design: why hybrid

| Notification type | Storage | Why |
|---|---|---|
| `friend_request` | DB + WS push | Must survive offline; needs Accept/Decline action in the inbox |
| `friend_accepted` | DB + WS push | Confirmation the user cares about later |
| Game invite (Sprint 3) | WS only | An old game invite is useless; no point persisting it |

#### New backend files

| File | Purpose |
|---|---|
| `backend/src/modules/notifications/entities/notification.entity.ts` | TypeORM entity |
| `backend/src/migrations/20260627000000-create-notifications.ts` | DB migration |
| `backend/src/modules/notifications/notifications.service.ts` | Core service |
| `backend/src/modules/notifications/notifications.module.ts` | Module wiring |
| `backend/src/modules/notifications/notifications.service.spec.ts` | 12 unit tests |

**Entity columns:** `id`, `type` (`friend_request | friend_accepted`), `fromUserId`, `toUserId`, `payload` (JSONB), `readAt` (null = unread), `createdAt`. Indexed on `(toUserId, readAt)` with a partial index `WHERE read_at IS NULL` for fast unread queries.

**`NotificationsService` API:**
- `setServer(server)` — called once from the gateway's `afterInit`; avoids circular DI (see architectural decisions below).
- `create(type, fromUserId, toUserId, payload)` — persists to DB, then pushes `notification:new` to all live sockets of the recipient via `PresenceService.getSocketIds()`.
- `listUnread(userId)` — newest first.
- `markRead(userId, notificationId)` — validates ownership before updating.
- `markAllRead(userId)` — bulk QueryBuilder update.
- `pushInboxToSocket(socketId, userId)` — emits `notification:inbox` on WebSocket connect so the badge is accurate immediately.

**Run the migration** before deploying:
```bash
cd backend
npx typeorm migration:run -d src/data-source.ts
```

#### Modified files

- `backend/src/modules/presence/presence.service.ts` — added `getSocketIds(userId): string[]`.
- `backend/src/modules/friends/friends.module.ts` — added `NotificationsModule` to imports.
- `backend/src/modules/friends/friends.service.ts` — `sendRequest()` and `acceptRequest()` both call `notifications.create(...)` with `.catch(() => undefined)` so a notification failure never breaks a friend request.
- `backend/src/modules/matchmaking/matchmaking.module.ts` — added `NotificationsModule`.
- `backend/src/modules/matchmaking/matchmaking.gateway.ts` — now implements `OnGatewayInit`; `afterInit` calls `notificationsService.setServer(server)`. `handleConnection` calls `pushInboxToSocket` for authenticated users. Added `notification:read` and `notification:read-all` WS handlers.
- `backend/src/app.module.ts` — added `NotificationsModule`.
- `frontend/src/features/hub/api.ts` — added `NotificationType`, `NotificationView` types.
- `frontend/src/pages/HomePage.tsx` — bell button in hub header with unread badge; notification drawer listing unread items; Accept/Decline actions for `friend_request` type.
- `frontend/src/styles/modules/social-replays.css` — contains `.hub-notif-bell`, `.hub-notif-bell__badge`, `.hub-notif-drawer` and all child BEM elements.

---

### Sprint 3 — Friend Invites + Private Lobbies

**Goal:** Let a player create a private casual lobby, invite one online friend, and drop both into a match when the invite is accepted. Invites expire after 2 minutes. Casual wins count towards the total-wins leaderboard but do **not** affect ELO.

#### New backend files

| File | Purpose |
|---|---|
| `backend/src/modules/matchmaking/private-lobbies.service.ts` | In-memory lobby store |
| `backend/src/modules/matchmaking/private-lobbies.service.spec.ts` | 14 unit tests |

**`PrivateLobbiesService`** keeps lobbies in a `Map<lobbyId, PrivateLobby>`. There is no DB entity — lobbies are transient (2-min TTL). The `PrivateLobby` shape:

```typescript
interface PrivateLobby {
  lobbyId: string;           // uuid
  hostSocketId: string;
  host: SocketUser;
  gameId: string;
  shellSelection: string[];
  createdAt: number;
  pendingInviteeId: number | null;
  expiryTimer: ReturnType<typeof setTimeout>;
}
```

**Key behaviour:**
- `createLobby` guards against the host already being in a match or having an open lobby.
- `joinLobby` calls `cancelLobby` first (clears the timer), then creates a real `Match` row with `mode: "casual"`, calls `RoomService.createRoom`, and saves `MatchPlayer` rows. Returns `{ matchId, room }`.
- `cancelLobby` always calls `clearTimeout` before deleting — no timer leaks.
- `removeLobbyForUser` is called on disconnect to clean up any open lobby.

#### WebSocket events (all lobby-related)

| Client → Server | Server → Client | What happens |
|---|---|---|
| `lobby:create { gameId, shellSelection? }` | `lobby:created { lobbyId, gameId, expiresAt }` → host | Creates lobby |
| `lobby:invite { lobbyId, inviteeUserId }` | `lobby:invited { lobbyId, hostUsername, gameId, expiresAt }` → invitee sockets | Validates: host owns lobby → invitee online → invitee not in match → friendship check |
| `lobby:join { lobbyId, shellSelection? }` | `lobby:matched { matchId, side, gameId }` + `game:state` → both | Invitee accepts; match created |
| `lobby:decline { lobbyId }` | `lobby:declined` → host | Invitee declines |
| `lobby:cancel { lobbyId }` | `lobby:cancelled` → invitee + host | Host cancels |
| *(disconnect)* | `lobby:cancelled` → pending invitee | Auto-cleanup on disconnect |
| *(2-min timer fires)* | `lobby:expired` → host, `lobby:cancelled` → invitee | Auto-expiry |

**Modified:**
- `backend/src/modules/matchmaking/matchmaking.module.ts` — added `PrivateLobbiesService` to providers, `FriendsModule` to imports.
- `backend/src/modules/matchmaking/matchmaking.gateway.ts` — injected `PrivateLobbiesService`, `FriendsService`; added all lobby event handlers above.
- `frontend/src/pages/HomePage.tsx` — `LobbyCountdown` component, host waiting overlay, invitee invite popup, "Invite" button per online friend in the social modal, game picker inline.
- `frontend/src/styles/modules/social-replays.css` — contains `.hub-modal__social-invite-btn`, `.hub-lobby-picker` and children, `.hub-lobby-countdown`, `.hub-lobby-waiting` and children, `.hub-invite-popup` and children.

---

## Architectural decisions

**Why `NotificationsService.setServer()` instead of injecting the gateway?**  
The gateway already imports `NotificationsModule`. If `NotificationsModule` imported `MatchmakingModule` back, you'd have a circular dependency. Instead, the gateway calls `notificationsService.setServer(server)` in `afterInit` — one-time injection of the Socket.io `Server` instance, no circular import needed.

**Why are notification failures non-fatal in `FriendsService`?**  
A notification write failure (DB down, etc.) must never prevent a friend request from going through. Both `sendRequest` and `acceptRequest` call `.catch(() => undefined)` on the notification call.

**Why are private lobbies in-memory and not a DB table?**  
They live for at most 2 minutes and serve no purpose after the match starts or is cancelled. Persisting them would require a migration, a cleanup job, and added complexity for zero benefit. This is consistent with how the matchmaking queue already works.

**Why are game invites WS-only (not stored)?**  
An invite to a game that expired 10 minutes ago is meaningless. Storing it would clutter the inbox with stale actions.

**Why `mode: "casual"` for private lobbies?**  
Prevents ELO sandbagging. Two friends could otherwise exploit private ranked matches to farm rating. Casual wins still count towards the total-wins leaderboard.

---

## Running the tests

```bash
cd backend
node node_modules/.bin/jest \
  --testPathPattern="leaderboard.service.spec|notifications.service.spec|private-lobbies.service.spec" \
  --no-coverage
```

Expected: **35 tests passing** (9 + 12 + 14).

---

## Things to verify before merging further work on top of this

1. **Run the migration** — `notifications` table must exist before the backend starts. See the command in Sprint 2 above.

2. **`lobby:matched` → game launch** — the frontend emits `match:status` on `lobby:matched` to sync hub state, which should trigger the same Phaser launch flow as the ranked queue. Smoke-test this end-to-end.

3. **Shell selection in lobbies** — currently passes `shellSelection: []`. If shell picker matters for private matches, wire up the existing `ShellPickerScene` flow before emitting `lobby:create`.

4. **Casual wins → leaderboard** — private lobby wins count towards the overall leaderboard only if `GameResultsService.submitResult()` runs after the match ends. This should work automatically since `joinLobby` creates a real `Match` row, but confirm the `game:end` → `submitResult` path executes for casual matches.

5. **npm audit** — there are 51 pre-existing vulnerabilities in backend deps (unrelated to this sprint). Worth a separate triage.
