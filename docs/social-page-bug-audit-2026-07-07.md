# Social Page Bug Audit — 2026-07-07

Scope: everything reachable from the Social modal — friends (add/accept/decline/remove), blocking, reporting, DM/group chat, notifications, presence, profile hover cards, and their backend modules (`friends`, `chat`, `reports`, `notifications`, `presence`) plus the WS glue in `matchmaking.gateway.ts`.

This document is a work order for an implementing agent. Each finding has: severity, exact locations, why it's a bug, and a suggested fix. Findings are ordered so that fixing them top-to-bottom is a sensible plan. Per `CLAUDE.md`, when work here completes, update `docs/modules-progress.md` (its "Basic chat" section currently claims "Nothing pending" and "socket wiring in matchmaking.gateway.ts", both of which are wrong today).

Verification commands used: `cd backend && npx jest matchmaking.gateway.spec -t "onChatSend"` (fails to compile — see C1). Re-run `cd backend && npm run test` after each backend fix.

---

## CRITICAL

### C1. Chat WebSocket layer is entirely unwired — sending a chat message does nothing

**Locations:**
- `backend/src/modules/matchmaking/matchmaking.gateway.ts:85-87` — `afterInit` only calls `notificationsService.setServer(server)`. `ChatService.setServer()` is never called anywhere in production code (only in specs). `ChatService` is not even injected into the gateway (constructor, lines 71-82).
- The gateway has **no** `@SubscribeMessage` handlers for `chat:send`, `chat:send-gif`, or `chat:read`. `grep -i chat matchmaking.gateway.ts` returns nothing.
- `backend/src/modules/matchmaking/matchmaking.gateway.spec.ts:364-495` — tests reference `gateway.onChatSend`, `gateway.onChatSendGif`, `gateway.onChatRead`. **The backend test suite fails to compile** (`TS2339: Property 'onChatSend' does not exist on type 'MatchmakingGateway'`). Verified by running jest.
- `frontend/src/pages/HomePage.tsx:1313` (`chat:send`), `:1363` (`chat:send-gif`), `:1270` (`chat:read`) — the UI uses **only** these socket events. The REST fallbacks `sendChatMessageRest`, `sendGifMessageRest`, `markConversationReadRest` exist in `frontend/src/features/hub/api.ts` but are never called.
- `docs/modules-progress.md:65` claims "socket wiring in matchmaking.gateway.ts" exists.

**User-visible impact:**
- Typing a message and hitting Send clears the draft and emits `chat:send` into the void. The message is never persisted, never delivered, and no error is shown. Chat is 100% non-functional despite a complete service layer and passing service-level tests.
- GIF sends: same.
- `chat:read` never reaches the server → `ConversationParticipant.lastReadAt` never updates.
- On connect the gateway never calls `chatService.pushUnreadInboxToSocket(...)` and never joins sockets into `chat:<id>` rooms → `chat:unread-inbox`, `chat:unread`, `chat:read-sync`, and `chat:message` listeners in `HomePage.tsx:830-879` never fire. The whole unread-badge system is dead.

This looks like a lost merge/revert: the spec, the frontend, the service (`setServer`, `joinLiveParticipants`, `pushUnreadTransitions`) and the progress doc all assume "Batch 2 gateway glue" that is absent.

**Fix plan:**
1. Inject `ChatService` into `MatchmakingGateway`; call `this.chatService.setServer(server)` in `afterInit`.
2. Implement `onChatSend` / `onChatSendGif` / `onChatRead` to match the spec's contract exactly (`matchmaking.gateway.spec.ts:362-495`): guard on `socket.data.user`, call the service, broadcast the returned `MessageView` to `chatRoomName(conversationId)`, and emit `chat:error { message }` to the sender on rejection.
3. On connect (`handleConnection`), join the socket into the rooms of every conversation the user belongs to (add e.g. `ChatService.getConversationIdsFor(userId)`), then call `pushUnreadInboxToSocket(socket.id, user.id)` for non-guests.
4. Decide where `chat:message` is broadcast: today only `leaveGroup` broadcasts from inside the service (`chat.service.ts:390`), while the spec expects the gateway to broadcast after `sendMessage`. Note that **REST sends** (`chat.controller.ts:108-116, 145-153`) currently broadcast nothing — moving the broadcast into `ChatService.sendMessage` (mirroring `leaveGroup`) fixes both paths at once and makes the gateway handler trivial; if you do that, update the gateway spec's expectations accordingly.
5. `addGroupMember` gives the new member no system message and existing members no signal; consider a system message like `leaveGroup` posts (optional, product call).

**Tests:** the existing gateway spec is the contract; make it compile and pass. Add a test asserting REST-sent messages are broadcast too, and one asserting rooms are joined on connect.

---

## HIGH

### H1. Production schema drift: friendships/notifications migrations create snake_case columns, entities expect camelCase

**Locations:**
- `backend/src/migrations/20260618000000-create-friendships.ts:20-26` — creates `requester_id`, `addressee_id`, `created_at`, `updated_at`.
- `backend/src/migrations/20260627000000-create-notifications.ts:24-34` — creates `from_user_id`, `to_user_id`, `read_at`.
- Entities use TypeORM's default naming (camelCase): `friendship.entity.ts:39-46` (`requesterId`, `addresseeId`), `notification.entity.ts` (`toUserId`, `readAt`).
- Newer migrations are camelCase-quoted and consistent: `20260701010000-create-reports.ts`, `20260704000000-create-chat.ts`.
- `backend/src/app.module.ts:47` — `synchronize: NODE_ENV !== "production"` masks this in dev (synchronize builds camelCase schema; `CREATE TABLE IF NOT EXISTS` in the migration then no-ops).

**Impact:** on a production deployment (synchronize off, migrations run per the comment at `app.module.ts:41-46`), `friendships` and `notifications` get snake_case columns and **every friends/notifications query fails** (`column "requesterId" does not exist`). The entire social page breaks in prod while working in dev. Alternatively, if migrations run against a dev DB, order-of-operations can leave duplicate column sets.

**Fix plan:** rewrite the two old migrations to quoted camelCase (they are documented as "additive on top of the synchronize base", so on existing dev DBs they no-op either way), or add a corrective rename migration; ideally also do the `TODO(#initial-migration)` at `app.module.ts:45` and set `synchronize: false` everywhere. Verify with a fresh Postgres + `npm run migration:run` + smoke test of `/api/friends`.

### H2. Profile hover card endpoint leaks PII to any authenticated user

**Locations:**
- `backend/src/modules/users/users.controller.ts:241-257` — `GET /api/users/:username` strips only `passwordHash` and returns the full `User` entity: **`email`, `fortyTwoId`, `googleId`**, `coins`, `xp`, `lastSeenAt`, `isGuest`, timestamps, and the full `profile` relation.
- Consumed by the social page's hover card: `HomePage.tsx:1774-1791` (`loadHoveredProfile` → `api.getUser`), which only needs `level`, `profile.totalWins/totalLosses/tag`, `mostPlayedGame` (`ProfileCard.tsx:7-18`).

**Impact:** any logged-in user (including guests) can harvest email addresses and OAuth identifiers for every registered user by username. Blocking does not restrict it.

**Fix plan:** return a whitelisted public view (id, username, turtleName, shellSkin, avatar, level, isOnline, profile stats, mostPlayedGame). Nothing in the frontend uses the sensitive fields. Also consider 404 instead of `200 null` for missing users (frontend `loadHoveredProfile` handles both, but the current contract is odd).

### H3. Blocking is irreversible: no unblock endpoint, no blocked-users list, no UI

**Locations:**
- `backend/src/modules/friends/friends.controller.ts` — endpoints exist for request/accept/decline/remove/block only. Nothing lists blocked users; nothing removes a `blocked` row (`removeFriend` is scoped to `accepted`, `declineOrCancelRequest` to `pending`).
- Frontend has no blocked-list section in the Social modal (verified across `HomePage.tsx` social render, lines 2893-3436).

**Impact:** one click on Confirm-block (or submitting a report, which auto-blocks — `reports.service.ts:24-48`) permanently prevents the pair from ever re-friending: `sendRequest`'s existing-row check (`friends.service.ts:82-92`) returns 409 forever, for **both** sides. There is no recovery path short of manual DB surgery.

**Fix plan:** add `GET /friends/blocked` (rows where `requesterId = me AND status = 'blocked'`) and `POST /friends/unblock` (delete that row only — must NOT delete a `blocked` row where the caller is the addressee), plus a "Blocked users" section with an Unblock button in the Social modal. Update `docs/modules-progress.md` if the module scope description changes.

---

## MEDIUM

### M1. Blocking someone who already blocked you silently destroys their block

`friends.service.ts:232-267` — `block()` deletes **both directions** (including an existing `blocked` row where the other user is the requester) before inserting the caller's block. If A blocked B, then B blocks A, A's block row is gone; only B→A remains. Once unblock exists (H3), B unblocking A would fully reconnect the pair against A's expressed intent, and mutual blocks are unrepresentable.

**Fix:** in the delete step, only remove rows with status `pending`/`accepted` plus the caller's own previous `blocked` row; allow `A→B blocked` and `B→A blocked` to coexist (the unique index is per direction, so this works). Update `sendRequest`/suggestion exclusion logic accordingly (they already check both directions).

### M2. Race: simultaneous opposite-direction friend requests create duplicate rows

`friends.service.ts:82-104` — the existing-row check queries both directions, but the DB unique index (`uq_friendship`) is per direction. Two concurrent `sendRequest` calls A→B and B→A both pass the check and both insert (different key tuples; the 23505 handler at line 127 never triggers). Result: two pending rows. Each user sees the other in both "Pending" and "Outgoing"; accepting one leaves a stale reverse `pending` row (visible forever); accepting **both** yields two `accepted` rows → `listFriends` returns the same friend twice → duplicate React keys in the friends list (`HomePage.tsx:1833`).

**Fix options (either):** (a) add a DB uniqueness guarantee on the unordered pair, e.g. unique index on `(LEAST(requesterId,addresseeId), GREATEST(requesterId,addresseeId))`; or (b) in `acceptRequest`, also delete any reverse-direction pending row in the same transaction, and have `sendRequest` treat a reverse pending row as an auto-accept. (a) is the real fix; (b) is a nice UX addition on top.

### M3. Blocking or reporting a nonexistent user returns 500 instead of 404

- `friends.service.ts:232-267` — `block()` never checks the target exists; the FK violation on insert is swallowed into `InternalServerErrorException`.
- `reports.service.ts:24-59` — same for `create()` (both the report insert and the nested block).

**Fix:** look up the target user first, throw `NotFoundException("User not found")`. Add spec cases (`friends.service.spec.ts`, `reports.service.spec.ts`).

### M4. Copied friend code can't be pasted into "Add friend"

- `frontend/src/features/social/friendCode.ts:6-9` — the code is formatted as `@username` and copied that way (`handleCopyFriendCode`, `HomePage.tsx:1512-1527`).
- `HomePage.tsx:1529-1535` — `handleSendFriendRequest` sends the input verbatim (only `.trim()`), and `friends.service.ts:70-72` looks up the exact username. Pasting your friend's code `@alice` → "User not found".

**Fix:** strip a single leading `@` in `handleSendFriendRequest` (and/or normalize in `FriendsService.sendRequest`). Unit-test in `friendCode.test.ts` / service spec.

### M5. Blocked/reported users linger in "People you may know" with a broken Add button

`HomePage.tsx:1660-1687` (`handleBlockUser`) and `:1694-1729` (`handleSubmitReport`) optimistically remove the user from friends/pending/outgoing but **not** from `suggestions`, and neither path calls `refreshSocial()` on success. Clicking Add on the stale suggestion → 409 "Friend request already exists…" toast (the block row matches the existing-row check).

**Fix:** add `setSuggestions((prev) => prev ? removeById(prev, userId) : prev)` to both handlers (and consider a background `refreshSocial()` after report).

### M6. Chat history `limit` is uncapped — trivial DoS

`backend/src/modules/chat/chat.controller.ts:208-215` — `parseOptionalPositiveInt` accepts any positive integer; `chat.service.ts:724` passes it straight to `take`. `GET /chat/conversations/:id/messages?limit=100000000` loads an unbounded page with sender relations.

**Fix:** clamp to a `MESSAGE_PAGE_MAX_LIMIT` (e.g. 100) in the controller. Same review for `before` (harmless). Add controller/service spec.

### M7. No rate limiting or dedup on friend requests, reports, or chat sends

Only gif search is rate-limited (`chat.controller.ts:123-139`). A user can: spam friend requests to arbitrary usernames (each creates a persisted notification + WS push — `friends.service.ts:107-111`; the notification dedup only collapses *concurrent unread* ones); file unlimited duplicate reports against the same target (`reports` has no unique constraint or cooldown); flood messages once C1 restores chat (2000 chars each, no per-user cap).

**Fix:** reuse `RateLimiterService` for `POST /friends/request`, `POST /reports`, and message sends (both REST and the restored socket path). Consider a partial unique index on `reports (reporterId, reportedId)` or a cooldown window.

### M8. Sending a request to someone who blocked you leaks the block

`friends.service.ts:88-92` — the 409 ("Friend request already exists or users are already friends") fires for `blocked` rows in either direction, telling the sender something exists between the pair. Standard practice is to make requests toward a user who blocked you behave like success (silent drop) or a generic failure indistinguishable from "already pending".

**Fix:** when the only existing row is `blocked` with the *other* user as requester, return `{ ok: true }` without creating anything (silent). Keep 409 when the caller themselves blocked the target (actionable: "unblock first" once H3 lands). Product call — document the decision.

### M9. Stale friend_request notifications survive decline/block and then dead-end

Declining/cancelling a request (`friends.service.ts:204-215`) and blocking (`:232-267`) delete the friendship row but never touch the recipient's persisted `friend_request` notification (`notifications` table). The recipient later clicks Accept from the bell → `acceptRequest` finds no pending row → 404 toast "No pending friend request found", and the notification has to be dismissed manually.

**Fix:** add `NotificationsService.removeWhere(type, fromUserId, toUserId)` and call it from `declineOrCancelRequest` and `block` (both directions for block). Push an inbox refresh to the recipient's sockets.

### M10. Group lifecycle gaps: ownerless and empty groups persist forever

`chat.service.ts:341-402` — `leaveGroup` doesn't transfer ownership when the owner leaves (`ownerId` also `SET NULL` if the user is deleted — `conversation.entity.ts:37`), and when the **last** member leaves, the conversation, its messages, and the farewell system message persist unreachably forever (no participant can ever list or rejoin it; `addGroupMember` requires an existing participant). There's also no owner-side delete/kick (kick is a documented product decision; cleanup is not).

**Fix:** in `leaveGroup`, after deleting the membership, count remaining participants; if zero, delete the conversation (cascades to participants/messages). Ownership transfer is optional (owner is currently only informational).

---

## LOW

### L1. Open-thread race can drop or duplicate live messages
`HomePage.tsx:1259-1281` + `:833-848` — `setActiveConversationId` is set before the REST fetch resolves; a live `chat:message` arriving mid-fetch is appended, then overwritten by `setChatMessages([...messages].reverse())` (lost), or duplicated if it's in both. Fix: after fetch, merge by `message.id`; in `onChatMessage`, skip append if `id` already present. (Only observable once C1 is fixed.)

### L2. Friend-removal undo timers survive modal close/unmount
`HomePage.tsx:655-657, 1614-1653` — `removalTimers` are never cleared on unmount, and `openSocial`'s fresh `getFriends()` re-shows a friend whose removal is still pending commit; they vanish again ~5 s later with no feedback. Fix: on `openSocial`, flush (commit immediately) or cancel pending timers before fetching; add a `useEffect` cleanup.

### L3. GIF search results can arrive out of order
`HomePage.tsx:1321-1338` — no sequence guard; a slow earlier response can overwrite a newer one after the debounce. Fix: request-id ref check before `setGifResults`.

### L4. Enter-to-send fires during IME composition
`HomePage.tsx:3116-3118` (composer) and `:2916` (add friend) — guard with `e.nativeEvent.isComposing`.

### L5. Suggestions computation does O(friends × fof) array scans
`friends.service.ts:363-401` — `friendIds.includes(...)` inside loops; convert to `Set` lookups. Cosmetic at current scale.

### L6. No UI for chat history pagination
`api.getChatMessages` supports `before` but `HomePage.tsx:1267` never passes it — only the newest 50 messages are ever visible, with no "load older" affordance.

### L7. Notification dedup is check-then-insert
`notifications.service.ts:55-58` — racy without a partial unique index (`(type, fromUserId, toUserId) WHERE readAt IS NULL`); client-side dedup (`notificationDedup.ts`) mitigates. Fix with the index + 23505 handling if touching this file anyway.

### L8. Misc
- `reports.service.ts:23` references `SOCIAL_TAB_HANDOFF.md §4`; the file lives at repo root, not `docs/` (CLAUDE.md requires project docs in `docs/`). Move it and fix the reference.
- `chat.service.ts:829-837` — `chat:unread` DM title falls back to `""` if the sender reload failed; `toMessageView` similarly emits empty `senderUsername`. Consider falling back to a fetch-by-id or "Someone".
- `users.controller.ts:31` TODO(#leaderboard-refactor) mentions `getAllUsers`; unrelated to social but adjacent — leave.
- `matchmaking.module.ts` imports `ChatModule` although the gateway doesn't use it yet — becomes correct once C1 is fixed.

---

## Explicitly verified as correct (no action)

- DM creation race handled via `dmKey` unique index + 23505 re-read (`chat.service.ts:213-230`).
- Duplicate-friend-request race within the *same* direction correctly mapped to 409 (`friends.service.ts:120-131`).
- GIF metadata is server-resolved from an opaque slug with a media-host allowlist (`gif.service.ts:161-183`); client re-validates before rendering (`chatOps.ts:107-123`). No URL-injection path.
- Frozen-DM rule: blocked/unfriended pairs can read history but `sendMessage` re-checks friendship (`chat.service.ts:524-537`). Group messaging between blocked members is a documented product decision.
- `removeFriend`/`declineOrCancel` status-scoping prevents the accept-vs-decline cross-surface race (`friends.service.ts:183-215`).
- Message bodies rendered through React text nodes — no XSS; CSRF handled centrally with retry (`api.ts:119-190`).
- Non-mutating sorts throughout (`chatOps.ts`, `chat.service.ts:637`).

## Suggested execution order for the implementing agent

1. C1 (restores chat end-to-end; unblocks the failing test suite) — largest single win.
2. H1 (migrations) — required before any production deploy.
3. H2 (PII) — small, isolated, high value.
4. H3 + M1 (unblock feature; fix block semantics while in the file).
5. M2–M9 in any order (mostly small, independent).
6. M10 + LOWs opportunistically.

After each backend change: `cd backend && npm run test`. Frontend has no test runner wired for HomePage; document manual validation per `CLAUDE.md` ("Testing Y Validacion"). Update `docs/modules-progress.md` (chat status) and `AGENTS.md` if any workflow/conventions change.
