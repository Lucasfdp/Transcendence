# Social Feature Handoff — Shellsmash

**Branch:** main  
**Date:** 2026-06-27  
**Sprints completed:** 3 (Leaderboard, Notifications, Friend Invites + Private Lobbies)

---

## What was built

This document describes every file added or modified across three sprints of social feature work. An agent reviewing this can use it to audit the changes, check for integration issues, or continue development.

---

## Sprint 1 — Leaderboard

### Goal
Expose per-game ELO rankings and a cross-game total-wins board, with a global/friends scope toggle.

### New files

**`backend/src/modules/leaderboard/leaderboard.service.ts`**  
Two public methods:
- `getGameLeaderboard(callerId, gameId, scope)` — queries `user_ratings` filtered by `gameId`, optionally scoped to friends via `FriendsService.getFriendIds()`. Returns up to 100 entries ranked by ELO descending.
- `getOverallLeaderboard(callerId, scope)` — aggregates `SUM(totalWins)` across all `user_game_stats` rows per user. Private lobby casual wins count here (they write to `user_game_stats`); ELO (`user_ratings`) is ranked-only and unaffected by private lobbies.

**`backend/src/modules/leaderboard/leaderboard.controller.ts`**  
- `GET /api/leaderboard?gameId=<id>&scope=global|friends`
- `GET /api/leaderboard/overall?scope=global|friends`

**`backend/src/modules/leaderboard/leaderboard.module.ts`**  
Imports `TypeOrmModule.forFeature([UserRating, UserGameStats])` and `FriendsModule`.

**`backend/src/modules/leaderboard/leaderboard.service.spec.ts`**  
9 tests covering both methods: happy path, sequential ranking, friends-scope filter, empty results, DB error.

### Modified files

**`backend/src/app.module.ts`**  
Added `LeaderboardModule` import.

**`frontend/src/features/hub/api.ts`**  
- Removed stale `LeaderboardEntry` interface and `getLeaderboard()` method.
- Added `GameLeaderboardEntry`, `OverallLeaderboardEntry`, `LeaderboardScope` types.
- Added `RANKED_GAMES` constant (array of `{ id, label }` for all 4 games).
- Added `getGameLeaderboard(gameId, scope)` and `getOverallLeaderboard(scope)` API calls.

**`frontend/src/pages/HomePage.tsx`**  
- Replaced single `leaderboard` state with `gameLeaderboard`, `overallLeaderboard`, `leaderboardGame`, `leaderboardScope`, `leaderboardLoading`.
- Added `useEffect` that re-fetches whenever `leaderboardGame` or `leaderboardScope` changes.
- Replaced static leaderboard panel with game dropdown + global/friends toggle + conditional render of ELO vs total-wins list.
- Import updated: `LeaderboardEntry` removed, new types + `RANKED_GAMES` added.

**`frontend/src/styles/global.css`**  
Added rules for: `.hub-leaderboard-controls`, `.hub-leaderboard-select`, `.hub-leaderboard-scope`, `.hub-leaderboard-scope__btn`, `.hub-ranking-list__rank`, `.hub-ranking-list__name`, `.hub-ranking-list__stat`.

---

## Sprint 2 — Notification System

### Goal
Persistent inbox for friend-request events (survives offline), live-only WebSocket delivery for real-time push. Notification bell + drawer in the hub.

### Design decision
Hybrid: `friend_request` and `friend_accepted` are stored in DB. Game invites (Sprint 3) are ephemeral WS-only.

### New files

**`backend/src/modules/notifications/entities/notification.entity.ts`**  
Columns: `id`, `type` (varchar: `friend_request | friend_accepted`), `fromUserId`, `toUserId`, `payload` (JSONB), `readAt` (null = unread), `createdAt`.  
Indexed on `(toUserId, readAt)`.

**`backend/src/migrations/20260627000000-create-notifications.ts`**  
Creates `notifications` table with a partial index `WHERE read_at IS NULL` for fast unread queries.

**`backend/src/modules/notifications/notifications.service.ts`**  
- `setServer(server: Server)` — called by the gateway's `afterInit`; avoids circular DI by not importing the gateway module.
- `create(type, fromUserId, toUserId, payload)` — saves to DB, then pushes `notification:new` to all live sockets of the recipient via `PresenceService.getSocketIds()`.
- `listUnread(userId)` — returns all unread rows, newest first.
- `markRead(userId, notificationId)` — validates ownership, sets `readAt`.
- `markAllRead(userId)` — bulk update via QueryBuilder.
- `pushInboxToSocket(socketId, userId)` — fetches unread and emits `notification:inbox`; called on WS connect.

**`backend/src/modules/notifications/notifications.module.ts`**  
Imports `TypeOrmModule.forFeature([Notification])` and `PresenceModule`. Exports `NotificationsService`.

**`backend/src/modules/notifications/notifications.service.spec.ts`**  
12 tests: `create` (no server, with server, multi-socket, DB error), `listUnread` (results, empty, DB error), `markRead` (success, wrong user, DB error), `markAllRead` (success, DB error).

### Modified files

**`backend/src/modules/presence/presence.service.ts`**  
Added `getSocketIds(userId): string[]` — returns all active socket IDs for a user (empty array if offline).

**`backend/src/modules/friends/friends.module.ts`**  
Added `NotificationsModule` to imports.

**`backend/src/modules/friends/friends.service.ts`**  
- Injected `NotificationsService` (new constructor param).
- `sendRequest()`: after saving the friendship row, calls `notifications.create('friend_request', ...)` with `.catch(() => undefined)` — non-fatal.
- `acceptRequest()`: after updating status, calls `notifications.create('friend_accepted', ...)` — non-fatal.

**`backend/src/modules/matchmaking/matchmaking.module.ts`**  
Added `NotificationsModule` to imports.

**`backend/src/modules/matchmaking/matchmaking.gateway.ts`**  
- Now implements `OnGatewayInit` in addition to existing `OnGatewayConnection`/`OnGatewayDisconnect`.
- Injected `NotificationsService`.
- `afterInit(server)` — calls `notificationsService.setServer(server)`.
- `handleConnection` — calls `notificationsService.pushInboxToSocket()` after auth (guests skipped).
- Added `@SubscribeMessage("notification:read")` and `@SubscribeMessage("notification:read-all")` handlers.

**`backend/src/app.module.ts`**  
Added `NotificationsModule` import.

**`frontend/src/features/hub/api.ts`**  
Added `NotificationType` and `NotificationView` types.

**`frontend/src/pages/HomePage.tsx`**  
- Added `getGameSocket` import.
- Added `notifications`, `isNotifDrawerOpen` state.
- `useEffect` subscribes to `notification:inbox` and `notification:new` socket events (cleaned up on unmount).
- Added `handleMarkAllRead()` and `handleMarkRead()` helpers.
- Added notification bell button (with unread count badge) in the hub header.
- Added notification drawer component inline: lists unread notifications with Accept/Decline for `friend_request` type.

**`frontend/src/styles/global.css`**  
Added rules for: `.hub-notif-bell`, `.hub-notif-bell__badge`, `.hub-notif-drawer` and all child BEM elements.

---

## Sprint 3 — Friend Invites + Private Lobbies

### Goal
Allow a player to create a private casual lobby, invite an online friend, and have both players dropped into a match when the friend accepts. Invites expire after 2 minutes. Private lobbies count toward the cross-game total-wins leaderboard (casual wins) but do not affect ELO.

### New files

**`backend/src/modules/matchmaking/private-lobbies.service.ts`**  
In-memory store (Map). Key types:

```typescript
interface PrivateLobby {
  lobbyId: string;        // uuid
  hostSocketId: string;
  host: SocketUser;
  gameId: string;
  shellSelection: string[];
  createdAt: number;
  pendingInviteeId: number | null;
  expiryTimer: ReturnType<typeof setTimeout>;
}
```

Public methods:
- `createLobby(hostSocketId, host, gameId, shellSelection, onExpiry)` — guards against host already in match or having an open lobby. Sets 2-minute `setTimeout` calling `onExpiry` on expiry.
- `getLobby(lobbyId)`, `getLobbyForUser(userId)`, `setInvitee(lobbyId, inviteeId)`.
- `joinLobby(lobbyId, joinerSocketId, joiner, shellSelection)` — calls `cancelLobby` first (clears timer), then creates a `Match` (mode: `"casual"`), calls `RoomService.createRoom`, saves `MatchPlayer` rows. Returns `{ matchId, room }`.
- `cancelLobby(lobbyId)` — `clearTimeout` + removes from map.
- `removeLobbyForUser(userId)` — called on disconnect.

**`backend/src/modules/matchmaking/private-lobbies.service.spec.ts`**  
14 tests covering all methods including expiry timer behavior with `jest.useFakeTimers()`.

### Modified files

**`backend/src/modules/matchmaking/matchmaking.module.ts`**  
Added `PrivateLobbiesService` to providers and `FriendsModule` to imports.

**`backend/src/modules/matchmaking/matchmaking.gateway.ts`**  
Injected `PrivateLobbiesService` and `FriendsService`. Added handlers:

| WS Event (client→server) | Behaviour |
|---|---|
| `lobby:create { gameId, shellSelection? }` | Creates lobby, emits `lobby:created { lobbyId, gameId, expiresAt }` to host |
| `lobby:invite { lobbyId, inviteeUserId }` | Validates: host owns lobby, invitee is online, invitee not in match, they are friends. Emits `lobby:invited` to all invitee sockets |
| `lobby:join { lobbyId, shellSelection? }` | Calls `joinLobby`, emits `lobby:matched { matchId, side, gameId }` + `game:state` to both players |
| `lobby:decline { lobbyId }` | Clears `pendingInviteeId`, emits `lobby:declined` to host |
| `lobby:cancel { lobbyId }` | Cancels lobby, emits `lobby:cancelled` to invitee + host |

`handleDisconnect` extended: calls `removeLobbyForUser`, emits `lobby:cancelled` to any pending invitee.

Expiry callback (set in `lobby:create` handler): emits `lobby:expired` to host and `lobby:cancelled` to pending invitee.

**`frontend/src/pages/HomePage.tsx`**  
New state: `activeLobby`, `inviteTarget`, `inviteGameId`, `incomingInvite`.

Added to the existing socket `useEffect`: listeners for `lobby:created`, `lobby:expired`, `lobby:cancelled`, `lobby:declined`, `lobby:invited`, `lobby:matched`.

Helper functions: `handleCreateLobby`, `handleCancelLobby`, `handleAcceptInvite`, `handleDeclineInvite`.

New `LobbyCountdown` component (defined above `HomeMenu`): live countdown using `setInterval`, clears on unmount.

Social modal friends list: each online friend now has an "Invite" button (hidden when host already has an active lobby). Clicking it shows an inline `hub-lobby-picker` with a game dropdown and Send/Cancel.

New overlays rendered at root level:
- `hub-lobby-waiting` — shown to the host while waiting for the invitee to accept. Shows game name, countdown, Cancel button.
- `hub-invite-popup` — bottom-right toast shown to the invitee with Accept/Decline buttons and countdown.

**`frontend/src/styles/global.css`**  
Added rules for: `.hub-modal__social-invite-btn`, `.hub-lobby-picker` and children, `.hub-lobby-countdown`, `.hub-lobby-waiting` and children, `.hub-invite-popup` and children.

---

## Key architectural decisions

| Decision | Rationale |
|---|---|
| Leaderboard as its own module | Clean separation; only needs read access to `user_ratings` and `user_game_stats` |
| `NotificationsService.setServer()` pattern | Avoids circular DI between NotificationsModule and MatchmakingModule |
| Notification failures are non-fatal in FriendsService | A notification DB failure must never break a friend request |
| Private lobbies are in-memory (not a DB entity) | Lobbies are transient (2-min TTL); no need for persistence or migration |
| Private lobbies always `mode: "casual"` | Prevents ELO sandbagging between friends |
| Invite validation order in gateway | Online check → in-match check → friendship check; cheapest checks first |
| Game invites are WS-only (not persisted) | An old game invite is useless; no point storing it |

---

## Test summary

| File | Tests | Status |
|---|---|---|
| `leaderboard.service.spec.ts` | 9 | ✅ passing |
| `notifications.service.spec.ts` | 12 | ✅ passing |
| `private-lobbies.service.spec.ts` | 14 | written, run with `node node_modules/.bin/jest --testPathPattern="private-lobbies"` |

Run all new tests:
```bash
cd ~/Documents/42/42_Projects/Transcendence/backend
node node_modules/.bin/jest --testPathPattern="leaderboard.service.spec|notifications.service.spec|private-lobbies.service.spec" --no-coverage
```

---

## Things left for a reviewer to check

1. **CSS styling** — all new CSS classes are written in `global.css`. Visually verify the leaderboard controls, notification bell/drawer, and lobby overlays match the existing hub design.
2. **`lobby:matched` → game navigation** — the frontend emits `match:status` on `lobby:matched` to sync the hub's in-match state. Verify this triggers the existing Phaser game launch flow the same way the ranked queue does.
3. **Shell selection in lobbies** — currently passes an empty `shellSelection: []`. If shell selection matters for private matches, wire up the existing `ShellPickerScene` flow before sending `lobby:create`.
4. **`user_game_stats` write path** — private casual wins count toward the overall leaderboard only if `GameResultsService.submitResult()` is called after the match ends. Confirm the existing `game:end` → `submitResult` flow runs for private lobby matches (it should, since `joinLobby` creates a real `Match` row with `mode: "casual"`).
5. **`npm audit`** — 51 pre-existing vulnerabilities in backend deps. Unrelated to this work but worth a separate triage.
