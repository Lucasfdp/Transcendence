# Notification System

Architecture, event catalog, and fix history for the notification module
(`docs/modules-progress.md` — Minor: "Complete notification system for
create, update, and delete actions"). Seeded from the 2026-07-07 deep-dive
audit; updated 2026-07-08 once the fixes below shipped.

## Architecture

**Producers.** `FriendsService` (`backend/src/modules/friends/friends.service.ts`)
is the only producer of persisted notifications. `MatchmakingGateway` produces
one live-only event (`lobby:invited`) that is never persisted.

**Persistence.** `notifications` table (`backend/src/modules/notifications/`).
`readAt IS NULL` means unread. A partial unique index
(`uq_notification_unread_triple`) enforces at most one unread row per
`(type, fromUserId, toUserId)`; `NotificationsService.create()` treats the
23505 loser of a create race as a successful no-op, so retried/duplicated
requests never produce duplicate bell entries. `listUnread()` caps at 50 rows
(`MAX_UNREAD_NOTIFICATIONS`) — there is no retention sweep for read rows yet,
so old, dismissed notifications remain in the table indefinitely (fine for
now: they're excluded from every query by the `readAt IS NULL` filter, they
just aren't purged).

**Delivery — REST + WebSocket.**
- `GET /api/notifications` — the full unread inbox. This is the *source of
  truth*: the frontend fetches it on every `HomePage` mount.
- `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` —
  REST fallbacks mirroring the WS mark-read path.
- WebSocket (`path: /ws/`, `backend/src/modules/matchmaking/matchmaking.gateway.ts`)
  is the live accelerator layered on top: `notification:inbox` (full unread
  list, pushed on connect and after any server-side mutation),
  `notification:new` (a single new notification), `notification:read` /
  `notification:read-all` (client → server mark-read).

Before 2026-07-08, delivery was WebSocket-only. The game socket
(`frontend/src/services/network/gameSocket.ts`) is a module-level singleton
that survives route changes, so its one-time "hydrate inbox on connect" never
re-fired on a `HomePage` remount (hub → game → hub) — the bell went stale or
empty on the single most common navigation path in the app. REST closes that
gap: `HomePage` now fetches on every mount regardless of socket state, and WS
remains additive for the live in-session push.

**Client.** `HomePage.tsx` holds `notifications` in component state, fetches
the REST inbox on mount, and subscribes to the WS events for live updates. It
renders a bell (badge caps display at "99+" past 50 — see
`NOTIF_BADGE_CAP`) and a drawer with per-item relative timestamps, Accept /
Decline (for `friend_request`), and per-item dismiss.

## Event catalog

| Event | Verb | Persisted? | Delivery | Read semantics |
|---|---|---|---|---|
| `friend_request` | create | Yes | REST inbox + WS push | Dismissed individually, or resolved automatically when the request is accepted/declined/cancelled/blocked (either direction) |
| `friend_accepted` | update | Yes | REST inbox + WS push | Dismissed individually |
| `friend_removed` | delete | **No — live-only** | WS event `friend:removed`, no inbox entry | N/A — see rationale below |
| `lobby:invited` (game invite) | create | No — ephemeral | WS push only, expires with the lobby | Resolved by accept/decline/expiry |
| Chat unread digest | create | Yes, separate cursor-based system (`ChatService`) | REST + WS (`chat:unread-inbox` / `chat:unread`) | Per-conversation read cursor, not a notification row |

### Why `friend_removed` has no bell entry

A standing "so-and-so removed you as a friend" notification is an awkward,
arguably hostile UX choice for a social feature — most platforms deliberately
don't tell you when someone unfriends you, to avoid an obvious retaliation
prompt. `FriendsService.removeFriend()` instead calls
`NotificationsService.pushLiveEvent("friend:removed", otherId, { userId })`:
a fire-and-forget WS push, silently a no-op if the removed user is offline,
that just lets their friends list resync instantly if they're online. It
fills the catalog's "delete" verb without adding a persisted artifact whose
product implications weren't asked for. Revisit if product wants a real
"removed" notification later — the persisted-type extension point is
`NotificationType` in `backend/src/modules/notifications/entities/notification.entity.ts`.

### Deliberately out of scope

- `achievement_unlocked` — achievements already exist server-side
  (`backend/src/modules/achievements/`) but have no notification producer.
  Not added here: it's a genuine scope extension (a new producer into a
  different domain module) rather than a bug fix, and `CLAUDE.md` bounds this
  agent's scope to `docs/modules-progress.md` unless explicitly requested.
  Flagged here so a future task can pick it up deliberately.

## Guest exclusion

Guest accounts are ephemeral (2-hour sessions) and can't durably read a
persistent inbox. As of 2026-07-08:
- `FriendsService.sendRequest()` rejects a guest **addressee** with the same
  404 as a nonexistent user (no info leak that a username belongs to a live
  guest session).
- `POST /friends/request` and `POST /friends/accept` are gated by the
  existing (previously unused) `GuestGuard`, rejecting a guest **caller**
  with 403.
- Together these mean neither `friend_request` nor `friend_accepted` can ever
  target a guest recipient, so `NotificationsService.create()` doesn't need
  its own guest check — there's no remaining path that would call it with a
  guest `toUserId`.
- The WS gateway's inbox push, read, and read-all handlers already no-op for
  guests (unchanged, was previously correct).

## Fix log — 2026-07-08

Applied against the 2026-07-07 audit findings (severities as scored there):

- **H1 / M5** — bell went stale after any `HomePage` remount; no REST
  fallback existed. Fixed via `GET /api/notifications` +
  `POST /api/notifications/:id/read` + `POST /api/notifications/read-all`
  (`notifications.controller.ts`), fetched on every `HomePage` mount.
- **H2** — the game socket was never disconnected on logout or session
  invalidation, leaking presence and letting a second SPA login on the same
  tab inherit the first user's authenticated socket. Fixed:
  `disconnectGameSocket()` now runs in `HomePage.handleLogout` and in
  `useSessionGate`'s unauthenticated branch.
- **H3** — accepting a friend request never cleared the matching
  `friend_request` notification, so Accept from the social tab (or the
  mutual-request auto-accept path) left a dead-end bell entry that 404s
  forever. Fixed: `FriendsService.acceptRequest()` now calls
  `removeWhere("friend_request", …)` in both directions, mirroring
  decline/cancel/block. The drawer's Accept/Decline also now treat a 404 as
  "already resolved" instead of swallowing it.
- **M1** — `markRead`/`markAllRead` didn't sync other tabs/devices. Fixed:
  both now call the same `pushInboxToUser` used by `removeWhere`.
- **M2** — `notification:read`'s `notificationId` was unvalidated. Fixed:
  gateway now requires `Number.isInteger(data?.notificationId)` before
  calling the service.
- **M3** — the drawer's Accept/Decline swallowed every failure silently.
  Fixed: both now `showToast` on unexpected errors (network/rate-limit/etc.)
  and resolve the notification locally on a 404.
- **M4** — guests could be targeted by or send friend requests. Fixed — see
  "Guest exclusion" above.
- **L1** — `toView()` fell back to a blank sender name if the post-save
  relation reload failed; now falls back to the `payload.username` snapshot.
- **L3** — `listUnread()` had no cap; now bounded to 50 rows
  (`MAX_UNREAD_NOTIFICATIONS`).
- **L4** — a duplicated `notification:new` push (reconnect races) could
  render twice with duplicate React keys; the client now id-dedups.
- **L5** — `markRead` was a findOne+save round trip; now a single atomic
  `UPDATE … WHERE id AND toUserId AND readAt IS NULL`.
- **L6** — the drawer now shows a relative timestamp per notification, and
  the bell badge caps its display at "99+".
- **L2, L7** — left as documented product decisions, not code changes:
  `removeWhere` still deletes read rows too (no history view exists to lose
  data from yet); there is still no toast/sound for an incoming request
  while the drawer is closed (badge-only is the current product choice).
