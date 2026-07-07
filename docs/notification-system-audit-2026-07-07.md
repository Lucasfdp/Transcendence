# Notification System — Deep-Dive Audit (2026-07-07)

Scope: everything that produces, persists, delivers, renders, or resolves notifications.
Target module: **Minor — Complete notification system for create, update, and delete actions** (`docs/en.subject.md` L297, tracked in `docs/modules-progress.md`).

Files audited:

- `backend/src/modules/notifications/` (service, entity, module, spec)
- `backend/src/modules/friends/` (only producer of notifications)
- `backend/src/modules/matchmaking/matchmaking.gateway.ts` (WS delivery + read handlers)
- `backend/src/modules/presence/presence.service.ts`
- `backend/src/migrations/20260627000000-create-notifications.ts`, `20260707010000-add-notification-unread-unique.ts`
- `frontend/src/pages/HomePage.tsx` (bell, drawer, socket subscriptions)
- `frontend/src/services/network/gameSocket.ts`
- `frontend/src/features/social/notificationDedup.ts` (+ test)

---

## 1. How the system works today

**Producers.** `FriendsService` is the only producer. Two persistent types exist (`friend_request`, `friend_accepted`); game-lobby invites are ephemeral WS events (`lobby:invited`) and never persisted.

**Persistence.** `notifications` table; `readAt IS NULL` = unread. A partial unique index (`uq_notification_unread_triple`) enforces one unread row per `(type, fromUserId, toUserId)`; `create()` treats the 23505 loser of a race as a successful no-op. Dedup is solid.

**Delivery.** Entirely WebSocket-based, piggybacked on the matchmaking gateway (`path: /ws/`):

- On connect (non-guests): `pushInboxToSocket` emits `notification:inbox` (full unread list).
- On create: `notification:new` emitted to each of the recipient's live sockets.
- On decline/cancel/block: `removeWhere()` deletes matching rows and re-pushes `notification:inbox`.

**Client.** `HomePage.tsx` holds `notifications` in component state, subscribes to the two WS events, renders a bell + drawer. Reads are fired back over WS (`notification:read`, `notification:read-all`). Client-side dedup helpers resolve all duplicates from one sender at once.

There is **no REST surface** for notifications: no fetch, no read endpoint, no history.

---

## 2. Findings

Severity: **H** = will visibly break in front of users, **M** = broken edge case / correctness risk, **L** = polish or hardening.

### H1 — Bell inbox is wiped after any HomePage remount (hub → game → hub)

The unread inbox is only ever hydrated on **WS connect** (`matchmaking.gateway.ts` L175–185). The socket is a module-level singleton (`gameSocket.ts` L292–302) that stays connected across route changes, and `HomePage` initialises `notifications` to `[]` (L565) and never requests the inbox on mount — the effect at L781–839 only subscribes.

Consequences:

1. Navigate hub → `/play/:gameId` → back to hub: the bell shows **0** even though unread rows exist in the DB. It stays empty until the socket happens to reconnect or the page is reloaded.
2. Any `notification:new` pushed while the user is on GamePage is emitted to a socket with **no listener** and is lost from the UI (still persisted server-side, but invisible per point 1).

This is the most common navigation path in the app, so in practice the bell is unreliable for anyone who plays a match.

**Fix options** (any one): (a) add a `notification:sync` WS message the client emits on HomePage mount and the gateway answers with `notification:inbox`; (b) add `GET /api/notifications` and fetch on mount; (c) move the subscription + state into a top-level provider that outlives route changes. Option (b) is recommended — it also fixes M5 and feeds the module evidence in §3.

### H2 — Socket never disconnected on logout → presence leak and cross-user notification leak

`disconnectGameSocket()` (`gameSocket.ts` L304) is **dead code — never called anywhere**. `handleLogout` (`HomePage.tsx` L1057–1069) clears the cookie server-side and `navigate("/auth")`, leaving the authenticated socket connected.

Consequences:

1. The logged-out user remains "online" (and receives pushes) until the tab closes — friends see a ghost presence.
2. Password/2FA login navigates via SPA (`AuthPage.tsx` L61/L100/L141 use `navigate`, no reload). If user B logs in on the same tab after user A logs out, `getGameSocket()` returns **A's still-authenticated socket**: B's hub receives A's `notification:new` pushes, B's own notifications never arrive, and B's `notification:read` / `notification:read-all` emissions **mutate A's rows** (the server trusts the socket's connect-time identity). OAuth logins escape only because `window.location.assign` forces a full reload.

This is a cross-user data leak, not just a glitch.

**Fix:** call `disconnectGameSocket()` in `handleLogout` (and on `AuthError` redirects); optionally have the server disconnect a user's sockets when their session is invalidated.

### H3 — Accepting a friend request leaves a dead-end `friend_request` notification everywhere except the acting tab

Decline, cancel and block all clean up the pending `friend_request` notification server-side via `removeWhere()` + inbox re-push (`friends.service.ts` L244–250, L323–328 — the M9 fix). **`acceptRequest()` does not** (L172–201): it creates `friend_accepted` for the requester but never removes the `friend_request` row from the accepter's inbox. The social-tab accept handler (`HomePage.tsx` L1700–1734) also never calls `handleResolveFriendRequestNotifs` (only the drawer's own Accept button does, L2612).

Broken scenarios:

1. **Accept from the social tab** → the bell still shows "X sent you a friend request" with Accept/Decline. Accept now 404s ("No pending friend request found"), the drawer's `catch` swallows it silently (L2616–2618) — the button visibly does nothing, forever. (Decline happens to clear it only because `declineOrCancelRequest` is pending-scoped + calls `removeWhere`.)
2. **Mutual-request auto-accept** (`sendRequest` L93–99): A sends a request to B while B's request to A is pending → auto-accepted. A's bell keeps the stale "B sent you a friend request" with the same dead Accept button.
3. **Multi-device**: accept on your phone; the laptop bell keeps the stale entry until its socket reconnects.

**Fix:** in `acceptRequest()`, after saving, call `removeWhere("friend_request", requesterId, addresseeId)` (and the reverse direction for the auto-accept path) exactly as decline does. Defence in depth: the drawer's Accept `catch` should treat 404 as "already resolved" and clear the notification.

### M1 — `markRead` / `markAllRead` don't sync other tabs/devices

`removeWhere()` pushes a fresh inbox to all the user's sockets (`pushInboxToUser`, service L204–212), but `markRead`/`markAllRead` (L131–162) don't. Dismissing a notification in one tab leaves every other tab's bell stale until reconnect.

**Fix:** call `pushInboxToUser(userId)` after both mutations.

### M2 — `notification:read` payload is unvalidated; `{}` marks an arbitrary notification read

`onNotificationRead` (`gateway` L891–899) passes `data.notificationId` straight through. `markRead` then runs `findOne({ where: { id: notificationId, toUserId: userId } })`. TypeORM 0.3 silently **drops `undefined` where-values**, so a malformed `{}` payload matches the caller's first notification and stamps it read. A non-numeric string produces a DB error → wrapped 500 → silently swallowed by the gateway's `.catch()`. Scoped to the caller's own inbox, so no cross-user impact, but it's data corruption from a malformed message. (Worth a quick integration test to pin the TypeORM behaviour.)

**Fix:** guard with `Number.isInteger(data?.notificationId)` before calling the service (same pattern worth applying to all WS message bodies — none are validated).

### M3 — Drawer Accept/Decline failures are fully silent

Both buttons swallow every error (`HomePage.tsx` L2616–2618, L2633–2635) — no toast, no state change. Rate-limited (429), request already cancelled by the sender (404), network down: the button just does nothing. The social tab shows error toasts for the same operations, so the inconsistency reads as "the bell is broken".

**Fix:** `showToast` on failure; on 404/409 also resolve the stale notification (ties into H3).

### M4 — Guests are not excluded from the friend/notification flow

`sendRequest()` resolves the addressee by username with no `isGuest` filter (`friends.service.ts` L70–73), and `FriendsController` has no guest guard — only suggestions filter guests (L523). So:

- A friend request can target a guest (guest usernames are guessable). The notification row persists for an account that can never durably read it: the gateway skips the inbox push for guests (L175) and the read handlers no-op for guests (L897, L905) — yet `create()` still live-pushes `notification:new` to guest sockets, so a guest sees a bell item they can't dismiss persistently.
- Guests can also *send* requests and accept them via REST.

**Fix:** reject `isGuest` on either side in `sendRequest`/`acceptRequest` (404/400), and skip the live push to guest recipients.

### M5 — WS-only lifecycle has no fallback and a reconnect re-appearance race

Everything (hydrate, deliver, mark read) rides one WebSocket. If the transport is down, the bell silently shows nothing (compounds H1). Additionally, `notification:read` emitted while disconnected is buffered by socket.io and flushed after reconnect, but the server's connect-time `pushInboxToSocket` races that flush — the freshly pushed inbox can still contain the just-dismissed item, making a dismissed notification **reappear** until the next sync.

**Fix:** REST endpoints (`GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`) as source of truth + WS as accelerator. This also supplies the H1 mount-fetch.

### Low-severity / polish

- **L1** — If the post-save relation reload fails, the pushed view falls back to `fromUsername: ""` (service L95) → drawer renders "*␣* sent you a friend request." The `payload.username` snapshot exists precisely for this but the client never uses it. Fall back to `payload.username`.
- **L2** — `removeWhere()` deletes **read** rows too (no `readAt` filter). Fine today, but it erases history a future "all notifications" view would want.
- **L3** — No retention or pagination: `listUnread` is unbounded; unread `friend_accepted` rows accumulate forever and are re-pushed on every connect; read rows are never purged. Cap the inbox (e.g. newest 50) and add a retention sweep.
- **L4** — `onNew` prepends without id-dedup (`HomePage.tsx` L786–787); a duplicated push (reconnect races) would render twice and produce duplicate React keys. One-line guard like the chat handler already has (L858–860).
- **L5** — `markRead` is a findOne + save (two round trips, benign lost-update race). A single `UPDATE … WHERE id AND "toUserId" AND "readAt" IS NULL` is atomic and cheaper.
- **L6** — Drawer shows no timestamps (`createdAt` is in the view but unused), and the badge has no `99+` cap. Cosmetic.
- **L7** — No toast/sound for an incoming request while the drawer is closed — only the badge increments. Product choice; note for the defence.

### What is genuinely solid

Worth saying: the dedup story (partial unique index + 23505-as-noop + client-side `notificationDedup` for pre-existing duplicates), the decline/cancel/block cleanup path, ownership checks on `markRead`, guest gating on the read handlers, and the migration hygiene (quoted camelCase, partial index) are all careful, documented work. `notifications.service.spec.ts` covers happy path, edge, and failure paths for every service method.

---

## 3. Module completion assessment

Requirement: *"Complete notification system for relevant create, update, and delete actions."*

Today's coverage is **two event types in one domain**, both "create"-ish. An evaluator reading the requirement literally will look for notification coverage of create, **update**, and **delete** actions across the app's relevant domains. Gaps:

**No event catalog.** `docs/modules-progress.md` already flags this. Proposed minimal catalog that credibly covers all three verbs without inventing scope:

| Event | Verb | Persist? | Exists today |
|---|---|---|---|
| `friend_request` (request created) | create | yes | ✅ |
| `friend_accepted` (relationship updated) | update | yes | ✅ |
| `friend_removed` or `request_cancelled` | delete | yes (or live-only, documented) | ❌ |
| `game_invite` (lobby invite created) | create | live-only (documented as ephemeral) | ✅ ephemeral |
| `achievement_unlocked` | create/update | yes | ❌ (achievements already exist server-side) |
| `chat unread` digest | create | separate cursor-based system | ✅ (document it as part of the story) |

The catalog document should state, per event: trigger, verb, persistence, delivery (push/inbox), and read semantics. That document plus one or two new event types (`friend_removed` is the cheapest — the producer hook already exists in `removeFriend()`) is what moves the module from "partial" to defensible.

**Missing pieces beyond the catalog:**

1. REST API for notifications (fixes H1/M5; also strengthens the Public API module's GET/POST/PUT/DELETE evidence).
2. Fix H1–H3 — a module can't count as complete if the bell is stale after every match and accept dead-ends.
3. Notification history view (or an explicit documented decision that the inbox is unread-only).
4. Frontend tests: `notificationDedup` is tested, but nothing covers inbox hydration, the drawer actions, or the remount bug (H1 would have been caught by one test).
5. A `docs/notifications.md` describing the architecture (this audit can seed it).

---

## 4. Prioritised action list

1. **H2** — call `disconnectGameSocket()` on logout / auth redirect (cross-user leak; smallest fix).
2. **H3** — `acceptRequest()` calls `removeWhere("friend_request", …)` both directions; drawer treats 404 as resolved.
3. **H1 + M5** — add `GET /api/notifications` (+ read endpoints), fetch on HomePage mount; keep WS as live push.
4. **M1** — `pushInboxToUser` after `markRead`/`markAllRead`.
5. **M2** — validate `notificationId` in the gateway handler.
6. **M3** — error toasts in the drawer.
7. **M4** — guest exclusion in the friends flow.
8. Event catalog doc + `friend_removed` event → update `docs/modules-progress.md` to `Done` once shipped.
9. L1–L7 as time allows.
