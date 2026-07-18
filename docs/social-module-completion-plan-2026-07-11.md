# Social Module Completion Plan — 2026-07-11

Goal: take the **"Allow users to interact with other users"** major module (basic chat, profile system, friends system) from `In progress` to `Completed`. This is a work order for an implementing agent: every item has severity, exact locations, why it matters, a suggested fix, and test expectations.

Scope audited: `backend/src/modules/{users,friends,presence,chat,notifications,reports}`, the chat/notification WS glue in `backend/src/modules/matchmaking/matchmaking.gateway.ts`, the migrations touching these tables, and the Social modal + chat UI in `frontend/src/pages/HomePage.tsx` with its feature helpers (`frontend/src/features/{social,chat,hub}`).

Baseline verification (2026-07-11): `cd backend && npx jest --testPathPattern "(friends|chat|users|presence|notifications|reports|matchmaking.gateway|gif)"` → **11 suites, 242 tests, all passing.** Re-run the full backend suite after every backend change. Frontend has no runner wired for `HomePage.tsx`; document manual validation per `CLAUDE.md` ("Testing Y Validacion") — pure helpers under `frontend/src/features/` DO have vitest suites and any new helper logic must be added there, not inline in `HomePage.tsx`.

## Part A — Verified state (no action needed)

Everything in `docs/social-page-bug-audit-2026-07-07.md` is **fixed and verified in code**:

- C1: gateway chat glue restored (`onChatSend`/`onChatSendGif`/`onChatRead`, room joins + unread-inbox push on connect, `setServer` wiring at `matchmaking.gateway.ts:118-121`).
- H1: friendships/notifications migrations rewritten to quoted camelCase.
- H2: `GET /api/users/:username` returns a whitelisted `PublicUserView`, 404s on missing users (`users.controller.ts:74-90, 269-295`).
- H3/M1: blocked list + unblock endpoint + UI section exist; mutual blocks representable; unblock only deletes the caller's own row.
- M2: partial unique pair index (`20260707000000-add-friendship-pair-unique.ts`) + auto-accept of reverse pending requests.
- M3–M9, L1–L7: all verified fixed (404s on missing targets, friend-code `@` parsing, suggestion cleanup on block/report, page-size clamp, rate limits on friend requests/reports/chat sends both paths, silent-success on blocked-sender requests, notification cleanup on decline/block/accept, history pagination UI, gif search sequencing, IME guards, notification dedup index).

Also verified correct: DM `dmKey` race handling, frozen-DM re-check on send, gif slug server-side re-resolution with allowlist + client re-validation, XSS-safe message rendering, non-mutating sorts, guest exclusion from friend graph and suggestions, undo-window flush on Social open, notification-drawer 404-as-resolved handling.

## Part B — Bugs to fix

Ordered: fixing top-to-bottom is a sensible plan. B1–B6 are user-visible.

### B1 (MEDIUM): Chat unread badge is lost after navigating hub → game → hub

**Locations:** `frontend/src/pages/HomePage.tsx:665` (`unreadConversationIds` state, initialised empty), `:929-931` (only hydration source: the socket's connect-time `chat:unread-inbox` push), `frontend/src/features/hub/api.ts:507` (comment: "pushed live over the socket, never fetched via REST"; line shifted after the Phase 1 transport extraction — see `docs/frontend-cards-and-gambling-migration-phases.md`), `backend/src/modules/chat/chat.controller.ts` (no unread endpoint exists).

**Why:** the game socket is a module-level singleton that stays connected across route changes, so `chat:unread-inbox` fires once per *connect*, not per HomePage mount. After hub → game → hub, the freshly-mounted component's unread set is empty until a new message arrives. This is the exact bug class already fixed for the notification bell — see the comment block at `HomePage.tsx:803-810` and the REST hydration effect at `:811-822`. Chat unread was never given the same treatment because no REST endpoint exists.

**Fix:**
1. Backend: add `GET /api/chat/unread` to `ChatController`, returning `chatService.listUnreadConversations(req.user.id)` (the service method already exists, `chat.service.ts:691`).
2. Frontend: add `api.getUnreadConversations()` and mirror the notification hydration effect — on mount, fetch and `setUnreadConversationIds(unreadIdsFromInbox(entries))`. WS events remain the live accelerator.

**Tests:** controller spec for the new route (membership scoping is already inside the service); extend `chatOps` vitest if any new helper is added.

### B2 (MEDIUM): Chat thread has no scroll anchoring

**Locations:** `frontend/src/pages/HomePage.tsx` (message list) and
`frontend/src/styles/modules/social-replays.css`
(`.hub-modal__chat-message-list`: `flex-direction: column; max-height: 260px;
overflow-y: auto`).

**Why:** messages render oldest-first and the scroll container starts at the top, so opening a conversation shows the *oldest* page while the newest messages — the reason the user opened the thread — are below the fold. Live messages append below the fold invisibly. "Load older" prepends items, which shifts content and jumps the viewport.

**Fix:** add a ref to the list container and: (a) scroll to bottom after the initial fetch resolves and after sending; (b) on live message append, scroll to bottom only if the user was already at/near the bottom (threshold constant, no magic number); (c) on "Load older" prepend, capture `scrollHeight` before and restore `scrollTop += (newScrollHeight - oldScrollHeight)` after. Alternative acceptable approach: `flex-direction: column-reverse` with a reversed render order, which gives (a)/(b) for free — but still needs (c).

**Tests:** manual validation (document steps); any extracted scroll-position helper must be a pure function with a vitest suite.

### B3 (MEDIUM): Blocking gives the blocked side no live resync

**Location:** `backend/src/modules/friends/friends.service.ts:306-370` (`block()`), contrast with `removeFriend` (`:233-255`) which pushes `friend:removed`.

**Why:** blocking deletes an accepted friendship, but the blocked user's open client keeps showing the blocker as a friend — online dot, working-looking Message button — until their next Social open. Message attempts then fail with a confusing "You can no longer message this user". `removeFriend` already solved this with the live-only `friend:removed` event; `block()` just never got the same call.

**Fix:** in `block()`, after the transaction commits, if the delete removed a `pending` or `accepted` row, push `this.notifications.pushLiveEvent("friend:removed", blockedId, { userId: blockerId })`. The frontend handler (`HomePage.tsx:839`) already calls `refreshSocial()` on that event — no frontend change needed. Deliberately reuse `friend:removed` rather than a new `friend:blocked` event: the blocked side must not be told it was a *block* (same silent-block principle as Bug Audit M8). To know whether a live row was removed, capture the delete result inside `doBlock` (TypeORM `delete` returns `affected`) — but note the delete also matches the caller's own previous block row, so either scope the "did we remove a live relationship" check to a separate pending/accepted delete, or query for the pending/accepted rows first inside the transaction.

**Tests:** `friends.service.spec.ts` — pushes `friend:removed` when a friendship/pending row existed; does NOT push when the only pre-existing row was the caller's own re-block (idempotent re-block must stay silent).

### B4 (MEDIUM): New conversations never appear while the Social modal is open

**Locations:** `frontend/src/pages/HomePage.tsx:916-926` (`onChatMessage`), `frontend/src/features/chat/chatOps.ts:38-47` (`upsertConversationPreview` — its own doc says "the caller should trigger a refetch in that case", but no caller does), `backend/src/modules/chat/chat.service.ts:446-507` (`addGroupMember` — posts no system message, updates no denormalised preview).

**Why:** two flows go dark while the modal is open: (1) a friend starts a first-ever DM and sends a message — the receiver's socket is in the room (`joinLiveParticipants`) so `chat:message` arrives, but the conversation list doesn't contain the id, so the upsert no-ops and nothing renders; (2) being added to a group produces **no event at all** until someone happens to message.

**Fix:**
1. Frontend: in `onChatMessage`, when `conversations !== null` and the id is unknown, call `void refreshConversations()` (debounce/in-flight-guard so a burst of messages doesn't stampede the endpoint).
2. Backend: make `addGroupMember` post a `system` message — `"<actor> added <newMember>"` — through the same persist+denormalise+broadcast path `leaveGroup` uses (`chat.service.ts:400-426`). This simultaneously: notifies existing members, gives the new member a `chat:message`/`chat:unread` signal, and (with fix 1) makes the conversation appear in their list. Covered product call: this was flagged optional in the 2026-07-07 audit; it is now **required** (see Part C, decision 2).

**Tests:** `chat.service.spec.ts` — addGroupMember persists a system message, updates `lastMessageAt`/`lastMessagePreview`, broadcasts to the room; `chatOps` vitest for any new helper.

### B5 (MEDIUM): Rapid conversation switching can render the wrong thread

**Location:** `frontend/src/pages/HomePage.tsx:1383-1418` (`handleOpenConversation`).

**Why:** no guard ties the fetch to the currently-open conversation. Open conversation A, quickly open B: A's slower `getChatMessages` resolves last and overwrites `chatMessages` (and `chatHasMoreOlder`, and emits `chat:read` for A — that part is harmless) while the header shows B.

**Fix:** after `await api.getChatMessages(conversationId)`, bail out if `activeConversationIdRef.current !== conversationId` (the ref already exists at `:897-900`). Apply the same guard to the `catch`/`finally` state writes so a stale failure doesn't null out the newer thread's loading state. Same pattern as the gif-search sequence guard (`:1495-1518`).

**Tests:** manual validation; if the merge logic is extracted to a pure helper, vitest it.

### B6 (MEDIUM-LOW): Message pagination can silently skip messages sharing a millisecond

**Locations:** `backend/src/modules/chat/chat.service.ts:751-761` (`listMessages`: `createdAt: LessThan(before)`, `order: { createdAt: "DESC" }` — no id tiebreaker), `frontend/src/pages/HomePage.tsx:1425-1431` (cursor = `oldest.createdAt`, an ISO string with ms precision).

**Why:** Postgres `timestamptz` stores microseconds; the wire cursor (JS `Date` → `toISOString()`) is millisecond-truncated. A message stored at `.123456` is not `< .123000`, so if two messages share a millisecond across a page boundary, the later-µs one is excluded from every subsequent page — silently lost history. Ties in `createdAt` also make the sort order itself nondeterministic between fetches.

**Fix:** switch to an id cursor. `Message.id` is a serial PK, monotonic per insert order: add optional `beforeId` to `ListMessagesOptions` + controller query param; `where.id = LessThan(beforeId)`, `order: { id: "DESC" }`. Keep `before` accepted for back-compat during the transition or remove it in the same change (frontend is the only consumer — update `handleLoadOlderMessages` to pass `oldest.id`). Frontend already dedups by id, so the transition is safe.

**Tests:** `chat.service.spec.ts` — page 2 with `beforeId` returns strictly-older ids, no overlap/gap; controller spec for param validation.

### B7 (LOW): Mutual-block edge in `sendRequest` is nondeterministic

**Location:** `backend/src/modules/friends/friends.service.ts:86-128`.

**Why:** the existing-row check is `findOne` over both directions. When *both* `A→B blocked` and `B→A blocked` exist, which row comes back is unspecified, so the caller (who has their own block) can get the "silent success" branch instead of the intended actionable 409 "You have blocked this user. Unblock them before sending a request."

**Fix:** use `find()` (both rows), then evaluate in priority order: caller's own `blocked` row → 409 unblock-first; other's `blocked` row → silent success; `pending` from other → auto-accept; anything else → generic 409.

**Tests:** `friends.service.spec.ts` — mutual-block case returns the 409, both orderings.

### B8 (LOW): Rejected chat send loses the user's text

**Location:** `frontend/src/pages/HomePage.tsx:1481-1489` (`handleSendChatMessage` clears the draft immediately), `:941-943` (`onChatError` only toasts).

**Why:** send is fire-and-forget over the socket. If the server rejects (rate limit "You're sending messages too fast.", frozen DM, group left in another tab), the toast appears but the typed message is gone — the user must retype, and with the rate limit that is exactly the moment retyping hurts.

**Fix (pick one, document the choice):** (a) simplest: keep the last-sent body in a ref; on `chat:error`, if the draft is still empty, restore it; (b) fuller: optimistic append with a pending state and reconcile on own-broadcast/error. (a) is proportionate for this app.

**Tests:** manual validation; extract restore logic if it grows.

### B9 (LOW): Concurrent sends can regress the conversation preview

**Location:** `backend/src/modules/chat/chat.service.ts:577-594`.

**Why:** two simultaneous `sendMessage` calls both load the conversation, both `save()` it — last writer wins, so `lastMessageAt`/`lastMessagePreview` can end up pointing at the *older* of the two messages. Also skews the `pushUnreadTransitions` was-caught-up comparison (duplicate or missed bell ping). Cosmetic-level impact, real race.

**Fix:** replace the entity save with a targeted conditional update: `UPDATE conversations SET "lastMessageAt" = $1, "lastMessagePreview" = $2 WHERE id = $3 AND ("lastMessageAt" IS NULL OR "lastMessageAt" <= $1)`.

**Tests:** `chat.service.spec.ts` — an update with an older timestamp does not overwrite a newer one.

### B10 (LOW): Housekeeping

- `docs/SOCIAL_TAB_HANDOFF.md` is referenced from `reports.service.ts:23` as the locked-decision source for report-auto-block; decision 1 below **changes** a locked decision from that doc (no-kick). Update both docs when implementing.
- `frontend/src/pages/HomePage.tsx` is 4,517 lines. Do NOT refactor wholesale in this task, but any *new* UI (member list, presence patching) should go into extracted components/helpers, not inline additions.

## Part C — Product decisions (locked by Lucas, 2026-07-11) and feature work

### Decision 1: Groups get FULL owner powers

`Conversation.ownerId` is currently written once and never read (verified: zero non-spec references outside `createGroup`). Implement:

1. **Kick** — owner-only. `DELETE /api/chat/conversations/:id/members/:userId`. Service: verify caller is owner, target is a participant, target ≠ owner; delete membership; post system message `"<owner> removed <member>"`; `leaveLiveParticipant` for the kicked user's sockets; push the kicked user a live event so their conversation list refetches (reuse the B4 frontend refetch trigger — a dedicated `chat:removed { conversationId }` live event via `NotificationsService.pushLiveEvent` is cleanest; frontend removes the conversation, closes the thread if it was open, and clears its unread flag). **This overrides the 2026-07-07 "no kick by design" decision — update the doc comments in `chat.service.ts:351-354` and `chat.controller.ts:211-215` and `docs/SOCIAL_TAB_HANDOFF.md`.**
2. **Rename** — owner-only. `PATCH /api/chat/conversations/:id` with `{ name }` (same DTO rules as `CreateGroupDto.name`: 1–60 chars trimmed). Post system message `"<owner> renamed the group to <name>"`; broadcast; frontend updates the list + open-thread title.
3. **Delete group** — owner-only. `DELETE /api/chat/conversations/:id`. Delete messages + conversation (mirror the empty-group cleanup at `chat.service.ts:390-398`); push `chat:removed` to all participants; sockets leave the room.
4. **Ownership transfer on owner-leave** — in `leaveGroup`, when the leaver is the owner and members remain, set `ownerId` to the longest-standing remaining participant (`ORDER BY joinedAt ASC, id ASC` — `joinedAt` already exists on `ConversationParticipant:37-38`). Post system message `"<new owner> is now the group owner"`. Note `conversation.entity.ts` has `ownerId` `SET NULL` on user delete — a null-owner group should be treated as "first member to act on an owner action gets a 403 but nothing crashes"; optionally run the same transfer logic lazily when a null owner is detected.
5. **Expose owner in views** — add `ownerId` to `ConversationSummaryView` (and the members endpoint below) so the UI can gate owner-only controls.

DTO/authz notes: all owner checks live in the service (controller stays thin, mirroring current style). Non-owner calls → `ForbiddenException`. All four actions need `chat.service.spec.ts` coverage: happy path, non-owner 403, non-group 400, non-participant target 404, owner-kicks-self 400, transfer picks correct member, delete cleans up rows.

### Decision 2: Group member list + add-member UI + system messages

1. **Backend:** `GET /api/chat/conversations/:id/members` — participant-only; returns `PendingView`-shaped entries (`userId`, `username`, `turtleName`, `shellSkin`, `avatar`, `level`, `isOnline`) plus `joinedAt` and an `isOwner` flag.
2. **Frontend:** in the open group thread header, a "Members (n)" toggle revealing the list; each row shows presence dot and, for the owner viewing, a Kick button (decision 1). Below the list, an "Add friend" affordance listing friends not already members (client-side diff of `friends` vs member ids), calling the existing-but-unused `api.addGroupMember` (`frontend/src/features/hub/api.ts:1127`), then refreshing the member list.
3. **System message on add** — covered by B4 fix 2.

### Decision 3: Live presence push to friends

1. **Backend:** emit a light `presence:changed { userId, status, gameId }` to each *online friend* of a user when their coarse status actually transitions: first socket connect (offline→online), last socket disconnect (→offline, `matchmaking.gateway.ts:221-232` already detects this exact condition for `markSeen`), and `setInGame`/`clearInGame` transitions (find the gateway call sites of `presence.setInGame`/`clearInGame`). Implementation shape: a small `PresenceBroadcastService` (or a method on the gateway) that calls `friendsService.getFriendIds(userId)` and fans out via `presence.getSocketIds` — one DB query per *transition*, not per socket event. Guests never trigger or receive these (they have no friends by construction).
2. **Frontend:** subscribe in the existing chat/notifications socket effect; patch `friends` state in place (`status`, `isOnline`, `gameId`, and set `lastSeenAt` to now on the →offline transition). Pure patch helper in `frontend/src/features/social/presence.ts` with vitest coverage. No-op when `friends === null` (modal never opened).
3. **Ordering caveat:** a `presence:changed` may race the initial `getFriends()` fetch; applying a patch for a user not in the list must be a no-op.

### Decision 4: Guard guests out of block/unblock/report

Add `@UseGuards(GuestGuard)` to `POST /friends/block`, `POST /friends/unblock` (`friends.controller.ts:159-182`) and `POST /reports` (`reports.controller.ts`), matching the existing guards on request/accept (`:88-119`). Consequence (accepted): guests cannot report players they meet in matches. Tests: controller specs asserting 403 for guest principals.

## Part D — Execution order

1. **B1** (unread REST hydration) — small, isolated, restores a core signal.
2. **B4** (conversation refetch + add-member system message) — prerequisite plumbing for the group work.
3. **B2, B5** (scroll anchoring, open-race guard) — pure frontend, independent.
4. **Decision 1 + Decision 2** (owner powers + member UI) — the big block; B4's system-message path and `chat:removed` event are shared infrastructure. Update `chat.service` doc comments + `SOCIAL_TAB_HANDOFF.md` re: kick.
5. **B3, B7, B9** (friends-service fixes) — one PR-sized unit, all in `friends.service.ts`/`chat.service.ts` with spec coverage.
6. **B6** (id cursor) — coordinated backend+frontend change.
7. **Decision 3** (presence push).
8. **Decision 4** (guest guards) + **B8** (draft restore) + **B10** (doc updates) — closers.

After each backend step: `cd backend && npm run test`. Integrated validation: `make dev`, exercise two browsers (two accounts) through: friend request/accept both surfaces, DM + gif + unread badges across hub→game→hub, group create/add/kick/rename/leave/delete, block/unblock from every list, presence transitions.

## Part E — Definition of done

- All Part B fixes and Part C features implemented with the listed test coverage; full backend suite green.
- Manual validation of the two-browser script above documented in the delivery summary.
- `docs/modules-progress.md`: module status → `Completed`; evidence updated (owner powers, member management, presence push, unread REST hydration); the "Missing for completion" block replaced accordingly.
- `docs/SOCIAL_TAB_HANDOFF.md` §4-adjacent "no kick" decision annotated as superseded (2026-07-11); `AGENTS.md` untouched unless workflow conventions changed.
- No commented-out code, no bare TODOs; new TODOs carry a tracking reference per repo conventions.
