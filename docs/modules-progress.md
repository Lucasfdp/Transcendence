# Modules Progress And Scope

## Purpose
This document translates `docs/modules.md` to the level of detail in the specification `docs/en.subject.md` and defines the actual project scope. Only selected, completed, or in-progress modules are considered here.

Status indicators used:
- `Done`: meets the requirements of the specification reasonably well.
- `In progress`: real implementation exists, but validation requirements remain.
- `Not done`: insufficient implementation to claim the module.

## Web

### Minor: Frontend framework
Status: `Done`

Requirement breakdown:
- Use of a frontend framework.

Evidence:
- `frontend/package.json` uses React + Vite.

Missing for completion:
- Nothing specific to this module. Overall quality depends on the rest of the project.

### Minor: Backend framework
Status: `Done`

Requirement breakdown:
- Use of a backend framework.

Evidence:
- `backend/package.json` uses NestJS.

Missing for completion:
- Nothing specific to this module.

### Major: Real-time features using WebSockets
Status: `Done`

Requirement breakdown:
- Real-time updates.
- Connection and disconnection handling.
- Efficient broadcasting.

Evidence:
- `backend/src/modules/matchmaking/matchmaking.gateway.ts`
- `frontend/src/services/network/gameSocket.ts`
- Game events, queue, lobby, reconnection, and shared state.

Missing for completion:
- Strengthen testing of network failures and reconnection in edge-case scenarios.

### Major: Allow users to interact with other users
Status: `Completed`

Requirement breakdown:
- Basic chat.
- Profile system.
- Friends system with add/remove and list.

Evidence:
- Profiles and updates: `backend/src/modules/users/` (public hover-card view is a whitelist — no PII/balances leaked; see `getUser` in `users.controller.ts`).
- Friends, blocking, and unblocking: `backend/src/modules/friends/` — includes `GET /friends/blocked` + `POST /friends/unblock` and a "Blocked users" section in the Social modal; mutual blocks are representable. Blocking pushes a live `friend:removed` resync to the blocked side (Bug B3), `sendRequest` resolves mutual blocks deterministically (Bug B7), and block/unblock/report are guest-guarded (Decision 4).
- Online status via sockets: `backend/src/modules/presence/`. Coarse presence transitions (offline↔online, online↔in-game) are pushed live to a user's online friends via `presence:changed` from `matchmaking.gateway.ts` (`broadcastPresence`), and the Social modal patches the friend list in place (`frontend/src/features/social/presence.ts::patchFriendPresence`) — Decision 3.
- DM and group chat (friends-only, with persistent history, GIF sending via Klipy): `backend/src/modules/chat/`. The chat WebSocket glue in `matchmaking.gateway.ts` (`chat:send` / `chat:send-gif` / `chat:read` handlers, per-conversation room joins on connect, unread-inbox push) was restored in the 2026-07-07 social audit. UI in the "Messages" section of the Social modal (`frontend/src/pages/HomePage.tsx`), with id-cursor older-message pagination (Bug B6), REST unread hydration across hub→game→hub (Bug B1), scroll anchoring (Bug B2), and a draft-restore on rejected sends (Bug B8).
- Group ownership & member management (Decision 1/2): the owner can kick (`DELETE /chat/conversations/:id/members/:userId`), rename (`PATCH /chat/conversations/:id`), and delete (`DELETE /chat/conversations/:id`) a group; ownership transfers to the most senior remaining member when the owner leaves; a `GET /chat/conversations/:id/members` endpoint backs the member-list + add-member UI. Kicked/deleted members are notified live via `chat:removed`; renames patch open clients via `chat:conversation-updated`.
- GIF search/send (2026-07-17 fix): `GifService` (`backend/src/modules/chat/gif.service.ts`) now trusts all three of Klipy's documented CDN hosts (`static`/`static1`/`static2.klipy.com`) instead of just one — the single-host allowlist was silently dropping most search results and causing "GIF provider returned an unexpected format" on send. A missing `KLIPY_APP_KEY` now throws `ServiceUnavailableException` (503) instead of a generic 500, and the frontend (`HomePage.tsx`) tracks a distinct `gifSearchError` state so a real failure reads "GIF search is unavailable right now." instead of the misleading "No gifs found." The reverse-proxy CSP `img-src` (`infra/reverse-proxy/conf/default.conf.template`) now allows all three hosts. A "Powered by KLIPY" attribution line was added to the picker per Klipy's API usage guidelines.
- Social modal redesign (2026-07-17): the modal is now a two-pane layout mirroring the replay page (`.hub-modal__social-grid`, cloned from `.hub-modal__replays`) — a left sidebar with a pinned friend-code/add-friend block and a `Friends | Chats | Requests` tab strip (Requests shows a pending-count badge), and a right pane holding the open chat thread (or an empty state) so switching sidebar tabs no longer unmounts an open thread. Friend rows show a mini `ShellPortrait` (`shell-portrait--mini`, 2.2rem) with the presence dot overlaid on the portrait corner; conversation/request rows are unchanged (avatars are friends-only per product decision). "New group" no longer requires closing the open thread first, and shows "Add some friends first — groups are friends-only." instead of a dead disabled button when the user has no friends yet.
- Hardening alongside the redesign: raw HTTP error text (e.g. a bare "Unauthorized" banner) is no longer shown for modal-level failures — a shared `describeModalError` helper routes any 401 to `/auth` with friendly copy and preserves user-worded 4xx messages otherwise. The live `friend:removed` handler now no-ops while the Social modal has never been opened and guards against a burst of removals firing concurrent refetches.

Validation:
- Backend: full Jest suite green (`cd backend && npm run test`, all 65 spec files) — chat/friends/reports/matchmaking-gateway suites cover every owner action (happy / non-owner 403 / non-group 404 / self-kick 400 / transfer selection / delete cleanup), the presence fan-out (happy / guest short-circuit / non-fatal error), the Part B fixes, and the new `gif.service.spec.ts` cases (all three trusted CDN hosts, lookalike-host rejection, malformed-URL rejection, `getBySlug` on a `static1` item, 503 on missing app key).
- `tsc --noEmit` clean for both `backend/` and `frontend/` on every touched file (remaining errors are pre-existing and unrelated — Phaser scene canvas typings, an untyped `passport-google-oauth20` module, etc.).
- Frontend: pure helpers under `frontend/src/features/{chat,social}` have vitest coverage (`isNearBottom`, `patchFriendPresence`, conversation ops); `ShellPortrait.test.tsx` now also covers the `mini` size. The `HomePage.tsx` UI has no runner and was previously validated manually per `CLAUDE.md` (two accounts across friend request/accept, DM + gif + unread badges across hub→game→hub, group create/add/kick/rename/leave/delete, block/unblock, presence transitions) — **the 2026-07-17 redesign + GIF fix still needs a fresh manual pass** (GIF search/send/render both directions with a real `KLIPY_APP_KEY`, tab switching with a thread open, requests badge, mini avatars incl. fallbacks, mobile ≤1100px single-column + back button, block/report/invite from the new Friends tab) plus a `cd frontend && npm run test:run` run on the user's Mac — the sandbox can't run either. See `docs/social-tab-redesign-and-gif-fix-plan-2026-07-17.md` §6 for the checklist; that document stays in `docs/` (not moved to `docs/old_docs/`) until this manual pass is done.

See `docs/social-module-completion-plan-2026-07-11.md` for the completion work order and `docs/social-page-bug-audit-2026-07-07.md` for the prior audit.

### Major: Public API for database interaction
Status: `Done`

Requirement breakdown:
- Secure API key.
- Rate limiting.
- Documentation.
- At least 5 endpoints.
- Examples for `GET`, `POST`, `PUT`, `DELETE`.

Evidence:
- Multiple REST endpoints in `auth`, `users`, `friends`, `matches`, `leaderboard`.
- Partial rate limiting on authentication and mini-games.
- Swagger documentation in backend.
- Dedicated public API in `backend/src/modules/public-api/` protected by `X-API-Key`.
- Documented public endpoints: `GET /api/public/users`, `GET /api/public/users/:username`, `POST /api/public/users/query`, `PUT /api/public/users/:username`, `DELETE /api/public/users/:username/avatar`.
- `PUBLIC_API_KEY` documented in `.env.example` and registered in Swagger.
- Shared rate limiting in Redis for the public API via `backend/src/modules/auth/redis-rate-limiter.service.ts`.
- Consumption examples in `docs/public-api.md`.

Missing for completion:
- Legacy buckets (`auth`, `casino`) still use in-memory limiter; only the public API uses the shared Redis limiter.

### Minor: ORM for database
Status: `Done`

Requirement breakdown:
- Use of an ORM.

Evidence:
- TypeORM in `backend/src/app.module.ts` with entities distributed across modules.

Missing for completion:
- Nothing specific to this module.

### Minor: Complete notification system for create, update, and delete actions
Status: `Done`

Requirement breakdown:
- Complete notification system for relevant create, update, and delete actions.

Evidence:
- `backend/src/modules/notifications/` — REST (`GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`) plus WebSocket live push/read; REST is now the source of truth, WS is the accelerator.
- Full event catalog with create/update/delete coverage documented in `docs/notifications.md`: `friend_request` (create), `friend_accepted` (update), `friend_removed` (delete, live-only by deliberate product choice), `lobby:invited` (create, ephemeral), chat unread digest (create, separate cursor-based system).
- Persistent friendship notifications in `backend/src/modules/friends/friends.service.ts`, with guest exclusion (guests can neither send/receive nor be targeted by persisted notifications).
- 2026-07-07 audit (`docs/notifications.md` fix log) closed the bell-goes-stale-on-remount bug (H1), the cross-user socket leak on logout (H2), the dead-end accept notification (H3), and four medium-severity gaps (cross-tab read sync, WS payload validation, silent drawer failures, guest exclusion).

Missing for completion:
- `achievement_unlocked` is not wired to a notification producer (achievements exist server-side but don't emit one) — deliberately deferred as a separate scope extension; see `docs/notifications.md`'s "Deliberately out of scope" note.
- No standalone history view (the inbox is unread-only by design, documented in `docs/notifications.md`).

### Minor: Server-Side Rendering (SSR)
Status: `Not done`

Requirement breakdown:
- Real SSR for performance and SEO.

Evidence:
- Frontend is a Vite SPA; no Next.js, Nuxt, SvelteKit, or SSR pipeline.

Missing for completion:
- Complete implementation of server-side rendering.

### Minor: Progressive Web App (PWA)
Status: `Not done`

Requirement breakdown:
- Offline support.
- Installability.

Evidence:
- No `manifest`, service worker, or PWA plugin.

Missing for completion:
- Entire module.

### Minor: Custom design system with at least 10 reusable components
Status: `In progress`

Requirement breakdown:
- Custom design system.
- At least 10 reusable components.
- Palette, typography, and iconography.

Evidence:
- Reusable components in `frontend/src/components/`
- Theme primitives in `frontend/src/shared/theme.ts`, Tailwind CSS configuration
  in `frontend/tailwind.config.cjs`, and feature-scoped style modules in
  `frontend/src/styles/modules/`.

Missing for completion:
- Formal inventory of the design system is lacking.
- Need to explicitly demonstrate the 10 pieces and their systematic reuse.

### Minor: Support additional browsers
Status: `Not done`

Requirement breakdown:
- Full compatibility with at least 2 additional browsers.
- Documented tests and fixes.
- Specific limitations documented.

Evidence:
- No documentation or compatibility matrix.

Missing for completion:
- Entire module.

## User Management

### Major: Standard user management and authentication
Status: `Done`

Requirement breakdown:
- Update profile.
- Upload avatar with default avatar.
- Friends and online status.
- Profile page.

Evidence:
- Local auth, guest, and OAuth in `backend/src/modules/auth/`
- Local registration validates and stores a unique email address, while local
  login accepts either email or username.
- Profile exposes ShellSmash, Google, and 42 connected-account controls.
  Authentication identities are separate from progress, legacy credentials
  are migrated, and a persistent two-preview conflict flow retains exactly one
  account's progress while preserving moderation and antifraud records.
- Editable profile and avatar upload in `backend/src/modules/users/users.controller.ts`
- Avatar uploads are persisted in a dedicated Docker volume and served through
  `/api/uploads/`. The profile editor supports upload, replacement, and removal;
  a reusable Shell Portrait uses the equipped shell as the visible default in
  the hub header, profile editor, and social profile cards. Broken custom-image
  URLs also fall back to the equipped shell.
- Firefox headless validation on 17 July 2026 covered the shell fallback,
  real image upload and delivery, removal back to the equipped shell, desktop
  layout, compact landscape layout, and the existing portrait-orientation guard.
- Friends and online status in `friends` and `presence`
- Profile editor in `HomePage`, with a separate protected public profile route at
  `/profile/:username` for the current player and other authenticated users.
- Public profile navigation is available from the Hub header and each friend row
  in Social without changing the existing player-card editor action.
- Full acceptance evidence is recorded in
  `docs/user-management-acceptance.md` (65 frontend files / 368 tests, 65 backend
  suites / 878 tests, both production builds, two-account Firefox matrix,
  persistence across a volume-preserving `make re`, and healthy Docker services).

Missing for completion:
- Nothing essential to claim the module. Portraits in every compact chat and
  ranking row are deliberately outside the closure criteria.

### Minor: Game statistics and match history
Status: `Done`

Requirement breakdown:
- Wins, losses, ranking, level, and similar.
- History with dates, results, and opponents.
- Achievements and progression.
- Leaderboards.

Evidence:
- `backend/src/modules/game-results/`
- `backend/src/modules/leaderboard/`
- `backend/src/modules/achievements/`
- Replays and match history in `backend/src/modules/matchmaking/replay.service.ts`
- 2026-07-15 rankings hardening pass (see `docs/old_docs/rankings-bug-audit-2026-07-15.md`): added the missing `user_ratings` migration and its unique constraint, closed the client-forgeable overall-leaderboard endpoint, fixed ranked draws never updating ratings, made match-finish reward persistence idempotent at the DB level, added stable tie-break ordering and dev-account exclusion to both leaderboard queries, and reworked the Rankings modal to show fetch errors, refetch on open, and the caller's own rank.

Missing for completion:
- Should review history coverage for all exposed games.

### Minor: Remote authentication with OAuth 2.0
Status: `Done`

Requirement breakdown:
- Remote OAuth with providers such as Google or 42.

Evidence:
- 42 and Google flows implemented in `backend/src/modules/auth/`
- Both providers use expiring, single-use OAuth state in Redis and can be linked
  or unlinked from Profile without relying on email-address matches.
- OAuth UI in `frontend/src/components/auth/OAuthButtons.tsx`

Missing for completion:
- End-to-end validation still requires real credentials for both providers.

## Cybersecurity

### Major: Hardened WAF/ModSecurity plus HashiCorp Vault
Status: `In progress`

Requirement breakdown:
- Strict WAF/ModSecurity.
- Vault for secrets, keys, and credentials.

Evidence:
- Vault and agents in `docker-compose.yml`
- Scripts and bootstrap in `Makefile` and `scripts/`

Missing for completion:
- Hardened ModSecurity/WAF is not clearly visible and demonstrable in the current state.
- Without that part, the complete major cannot be claimed as done.

## Gaming and User Experience

### Major: Complete web-based game where users can play each other
Status: `Done`

Requirement breakdown:
- Playable web game.
- Live matches.
- Clear rules and win/loss conditions.

Evidence:
- `frontend/src/games/kame-knock/`
- States and results in `matchmaking` and `game-results`

Missing for completion:
- Nothing critical to claim this base module.

### Major: Remote players
Status: `In progress`

Requirement breakdown:
- Two remote players.
- Latency, disconnection, and reconnection handling.

Evidence:
- `matchmaking.gateway.ts`, `room.service.ts`, `gameSocket.ts`
- Rejoin, away, abandon, and reconnect timeout implemented.
- Bell Clash online matches now use a dedicated server-authoritative physics
  stream: fixed-step source-space simulation, immediate launch plus 30 Hz
  physics projections, backend collisions/powers/scoring, velocity-aware
  snapshot interpolation, explicit reconnect/spectator projection, and
  authoritative replay frames. Two-player plus spectator Firefox headless
  validation covered simultaneous shots, second-shot rearming, round transition,
  rejoin, and responsive relayout on 2026-07-13.
- Bamboo Bash now uses the same separated authoritative projection channel:
  fixed-step source-space projectile movement, bamboo growth/spawning, pickup
   collection, collisions, scoring, and timed round completion are server-owned.
   Browser inputs are limited to bounded launches; transform, bamboo-hit, pickup,
   and round-score reports are rejected. Client rendering uses buffered physics
   projections rather than locally stepping the match. An accepted launch now
   emits the authoritative physics projection immediately rather than the legacy
   client throw event. Score and pickup pop-ups are driven by server-confirmed
   events, with the initial projection used as a deduplication baseline after a
   reconnect; two-client manual validation confirmed both feedback paths on
   2026-07-14. Lobby re-entry now waits for a newly emitted snapshot and physics
   projection before recreating the game scene, avoiding stale lobby state during
   a live trajectory. A re-entry with moving entities resumes immediately, and
   physics projections continue rendering during any remaining UI countdown;
   it also requests projections briefly until a newer physics sequence confirms
   stream continuity. Phaser scene teardown now removes the projection listener
   on both shutdown and game destruction, preventing a stale re-entry scene from
   throwing before its replacement receives the stream. Two-client manual tests
   confirmed leave/re-entry during live play and subsequent launches in Bamboo
   Bash and Bell Clash on 2026-07-14. Automated backend (59 suites / 827 tests),
   frontend (48 files / 289 tests), and build validation passed; initial two-client
   and power-up checks are positive, while the full validation matrix remains pending.
- Multiplayer cosmetic parity was completed on 2026-07-19. Public matchmaking,
  PIN/private matches, spectators, re-entry, rematches, and tournament minigames
  now derive each player's equipped shell skin and trail effect from the
  authoritative snapshot by side. All four arena clients reconstruct trails from
  interpolated authoritative positions without restoring client-side physics.
  Classic, comet, spark, ghost, and ripple trails render through cached procedural
  stamps on dynamic textures rather than per-frame vector retessellation. Temple
  Curling now preserves Phantom alpha online, and server-owned monotonic impact
  events drive Curling bumper flashes and Kame Knock solid-target bounce feedback
  without replaying historical effects after re-entry. Automated validation passed
  with 70 frontend files / 389 tests, 100 backend suites / 1,414 tests, and both
  production builds. A two-guest Firefox run confirmed synchronised classic trails
  on both multiplayer clients at 1440×900 and responsive relayout at 1000×700.

Missing for completion:
- Bell Clash and Bamboo Bash manual multiplayer validation, including live
  re-entry, has completed successfully. Replay-specific checks are maintained
  separately while replay work proceeds on another branch.
- The initial Kame Knock visual pass, including the idle opponent shell, turn
  cleanup, and server-projected pickups, was manually validated successfully on
  2026-07-14. The power-up, scoring, live re-entry, full-match, results,
  history, and reward paths were also manually validated successfully. Kame
  Knock relies exclusively on the server for projectile movement, collisions,
  pickups, scoring, and turn settlement; its dedicated physics and engine tests
   cover those authority boundaries.
- Temple Curling now uses the separated server-authoritative projection channel:
  fixed-step source-space balls, walls, bumpers, shell collisions, the eight
  active selected powers, settlement, turns, ends, and house scoring are owned
  by the backend. The browser sends only bounded launch intent and renders
  interpolated `game:physics-state` projections; client `settled` reports are
  rejected. Rejoin uses a fresh physics request, while the projection frames
  remain compatible with replay capture. Curling now uses the same ball
  vocabulary as the other games across turn state, HUD state, physics, powers,
  replay, and online projection code. Its moving physics ticks no longer emit
  lifecycle snapshots, and the public projection now excludes internal physics
  fields and historical trails. All authoritative game clients share an
  adaptive, bounded interpolation timeline and Curling removes every visual and
  trail resource when the authoritative world removes an entity. Focused
  backend physics/engine/gateway tests, the full frontend and backend suites,
  and both production builds passed on 2026-07-15.
- Temple Curling also keeps the local aiming proxy separate from authoritative
  entities, prevents aiming while a release is pending, and restores the
  selected power when a launch is rejected. A follow-up on 2026-07-15 fixed the
  late empty-projection race that removed the initial aiming shell, aligned its
  empty-selection power handling with the active eight-power roster, and made
  exactly tied closest shells produce a blank end in both online and local
  scoring. Power-enabled ends now also expose three server-owned pickups whose
  collection and effect are resolved by authoritative physics and projected to
  every client. The shared rematch UI now replaces duplicate lifecycle
  listeners and carries the initial authoritative physics state into every
  game's rematch. Kame Knock avoids rebuilding unchanged targets, pickups, HUD
  panels, and slingshot state for every projection frame.
- Complete Kame Knock spectator entry during live play and responsive relayout
  validation before claiming its rollout complete.
- Complete the manual two-client Temple Curling matrix, including the eight
  powers, full matches, re-entry, spectators, responsive relayout, and 3–5
  player matches, before claiming its rollout complete.
- Complete a two-account visual matrix with non-default equipped shell skins and
  each advanced trail effect across public/private entry, spectator, re-entry,
  rematch, and tournament-minigame paths. The shared snapshot and renderer paths
  are covered automatically, while this final asset-level matrix remains manual.
- Follow-up remote validation under the original network conditions found Bell
  Clash and Kame Knock responsive with powers enabled. Temple Curling retained
  additional gameplay issues after the ghost-ball cleanup; those are deferred
  to a dedicated follow-up before its multiplayer rollout can be completed.

### Major: Multiplayer game with more than two players
Status: `In progress`

Requirement breakdown:
- Minimum 3 simultaneous players.
- Fair gameplay.
- Correct synchronization.

Evidence:
- Engines for multiple games and sufficiently general matchmaking structure.
- `shell-curl` points to modes with more than two participants.

Missing for completion:
- Lacking clear, demonstrable proof of a functional 3+ match validated end-to-end.

### Major: Add another game with user history and matchmaking
Status: `Done`

Requirement breakdown:
- Second distinct game.
- History and statistics.
- Matchmaking.

Evidence:
- Additional games in `bell-clash`, `bamboo-bash`, `shell-curl`
- Multi-game matchmaking in `backend/src/modules/matchmaking/engines/`

Missing for completion:
- Nothing essential to claim the module.

### Minor: Tournament system
Status: `In progress`

Requirement breakdown:
- Brackets.
- Matchup order.
- Registration and participant management.

Evidence:
- Full architecture specified and frozen in `SPEC/` (SPEC-000 → SPEC-040); board mode ("The Parrot's Shell") adopted as the tournament interpretation with participant registration and visible play order (D6, SPEC-040/SPEC-038).
- Implementation roadmap in `docs/tournament-implementation-roadmap.md`; platform seams audit in `docs/tournament-platform-seams-audit.md`.
- Phase 0 (Grounding) COMPLETE: backend module `backend/src/modules/tournaments/` with entities (`tournaments`, `tournament_participants`, `tournament_matches`), manual migration, boot reconciliation; frozen WS/REST contracts (`tournaments.contracts.ts` + frontend mirror + `scripts/check-tournament-contracts.sh`); full SPEC-038 entry/lobby REST flow (create/invite/join/join-pin/leave/start) with DB-backed lobby, PIN join, friend invitations (`tournament_invite` notification type), deterministic seed-derived turn order (`turn-order.util.ts`) — registration, participant management and visible matchup order are implemented at lobby level.
- Phase 1 (Core) COMPLETE: determinism + orchestration foundation — per-tournament typed Event Bus (SPEC-004), 15-phase declarative State Machine (SPEC-003), generic `Registry<T>` (SPEC-025), validated settings catalog (SPEC-024), injectable clock (SPEC-028, no `Date.now`/`setTimeout` outside `SystemClock`), and the empty-gameplay `TournamentRuntime` (SPEC-001) driven by `TournamentRuntimeService` into the Match Lifecycle (SPEC-023): snapshot-per-transition persistence into `tournaments.state.runtime`, phase→status mapping, lobby `start()` handoff, and pessimistic-lock concurrency hardening on lobby join/start. Runtime touches no TypeORM.
- Phase 2 (Engines) COMPLETE: the six per-tournament engines, each built as a standalone deterministic unit (injected bus + clock, `serialize()`-able, no TypeORM/`Date.now`/`Math.random`) and reviewed against its SPEC — Economy (SPEC-011), Rule Engine (SPEC-009, 5 fixed query points), Leaderboard (SPEC-018, ranking off `WalletUpdated`), Action Engine (SPEC-008, single engine + `ActionRegistry`/`ActionFactory` + base actions), Inventory + Item Framework (SPEC-014/007, consume via `ItemEffectRunner`), Reward Resolver (SPEC-013, `Reward` → `ActionConfig[]` via `RewardActionRunner`). Composition root `runtime/tournament-engines.ts` wires the deferred seams (Rule→Economy `RewardRuleApplier`; `ActionServices` bundle; one Action-Engine-backed runner satisfying both effect/reward runner ports; `GrantItemAction` narrowing `InventoryPort`); the `TournamentRuntime` holds the bundle and serializes it. Checkpoint: a composite Reward (points+item) credits the wallet AND fills the inventory end-to-end through the one Action Engine.
- Phase 3 (Gameplay Base) COMPLETE: the board-turn loop, each unit deterministic and standalone-testable (injected ports with inert defaults, seeded RNG from `infra/seeded-rng.ts`, no TypeORM/`Date.now`/`Math.random`) — Board System (SPEC-002, `board/`: pure-data Tile model, v1 single-successor ring board, `movePlayer`/`teleportPlayer` commands, forced-relocation anti-loop limit, shared tiles, tile resolution delegated to the Action Engine via a `TileActionRunner` port), Dice System (SPEC-010, `dice/`: a die is a list of numbers, seeded reproducible rolls with a monotonic `rollCount`, `DiceValueModifier`/`ActiveDieResolver` seams, v1 catalog normal/chiquito/grande/op), Tile Actions (SPEC-006, `nothing`/`teleport`/`movePlayer` narrowing `BoardPort`), and Turn System (SPEC-005, `turn/`: one active turn, PlayerTurnStarted→DiceRollRequested→roll→move→resolve→PlayerTurnFinished, roll timeout auto-roll via the injectable clock, disconnection auto-resolution). All wired into `tournament-engines.ts` (Board+Dice+TurnSystem constructed per-tournament, `services.board` live, Dice value-modifier bound to `queryDiceModifier`, seed threaded from the Runtime) and serialized in the Runtime snapshot. Checkpoint green: a full round of board turns (4 players roll, move and resolve their tile) simulated end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1136 green; `tsc` clean; contracts drift check green.

- Phase 6 (Secondary content) IN PROGRESS:
  - Random Events System (SPEC-019) COMPLETE: `random-events/` `TournamentRandomEvents` selects a weighted event deterministically from the tournament seed (`infra/seeded-rng.ts`, monotonic `selectionCount`), runs its Actions through the shared Action-Engine runner, and emits RandomEventRequested→Selected→Started→Finished (Cancelled on an empty catalog); driven by a `randomEvent` tile Action via a new `services.randomEvents` capability; wired into `tournament-engines.ts` and serialized; placeholder catalog (windfall/misfortune/gust).
  - Steal (SPEC-006 AttemptStealAction) COMPLETE: the `attemptSteal` tile Action picks a seeded victim (roster ∩ players with points > 0), checks the StealPrevention Rule, and moves points thief-ward through `economy.transfer`, emitting StealStarted→StealSucceeded (or StealFailed). Backed by a new `services.steal` capability and a serializable seeded stream `infra/tournament-rng.ts` (`TournamentRng`), both wired into the composition and snapshot. `ActionContext` gained an optional `clock` so Actions can emit their own facts deterministically. Full backend suite 1158 green.
  - Shop System (SPEC-012) COMPLETE: `shop/` `TournamentShop` runs one purchase session at a time — `open` emits ShopRequested→ShopOpened (empty catalog closes immediately with `empty`), `buy` validates existence/`minRound`/stock/funds, charges through `economy.remove`, delivers via the Reward Resolver (`ShopRewardGranter`), and emits PurchaseRequested→ItemPurchased→ShopClosed (rejections keep the session open via PurchaseRejected). Stock is infinite/perPlayer/perGame; a `ShopPriceModifier` seam binds to the Rule Engine's `queryPriceModifier`; session timeout auto-closes via the injectable clock (no `Date.now`). Driven by an `openShop` tile Action via a new `services.shop` capability; a placeholder offer catalog (`pointsPack`/`luckyDiceOffer`/`badgeOffer`) is built through `createShopRegistry`; wired into `tournament-engines.ts` and serialized. Checkpoint green: a shop purchase charges Economy and both a points offer credits the wallet and an item offer lands in the buyer's inventory end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1177 green; build clean; contracts drift check green.
  - Item content + effects, first functional items (SPEC-007/009/010) COMPLETE: player-scoped rule consultation + two real items. (a) Rule Engine refinement — the five consultation points (`queryDiceModifier`/`isStealPrevented`/…) now honour a rule's `targetPlayerId`: a targeted rule applies ONLY when it matches `ctx.playerId`, an untargeted rule stays global (backward-compatible; the field was previously used only for Turns-duration ticking). New `TournamentRuleEngine.applyForPlayer(config, playerId)` (exposed on the `RuleCommands` port) builds a per-player, per-player-id'd rule instance. (b) New base Action `activatePlayerRule` (registered in `registerBaseActions`) drives that seam from an inline rule definition, defaulting to the acting player. (c) Two functional items in the item registry (real effects, not placeholder action strings): **Shell Shield** (consumable → personal StealPrevention that protects only its holder from `attemptSteal`) and **Loaded Die** (consumable → personal exclusive dice `set`→6 override for the holder's next turn; a value-override, NOT a die-swap). Checkpoint green: consuming the shield protects only its holder while others stay stealable, and consuming the loaded die forces only the holder's roll to 6 (`runtime/tournament-engines.spec.ts`). Full backend suite 1186 green; build clean; contracts drift check green.

- Phase 4 (Main Progression) COMPLETE at the engine/coordinator level (D9 gate opened by the user 2026-07-15 under the assumption the arena netcode is reliable):
  - Key Item Progression (SPEC-017) COMPLETE: `key-items/` `TournamentKeyItems` tracks the GLOBAL match progress — an ordered set of Key Items (v1 placeholder catalog of 4 "Shell Fragments" via `createKeyItemRegistry`), each Locked/Unlocked (never reverting). It is the SOLE emitter of KeyItemUnlocked/KeyItemProgressUpdated/AllKeyItemsUnlocked/FinalChallengeUnlocked (SPEC-004 canonical owner). `unlock(unlockedBy)` always unlocks the NEXT locked item by `order` (duplicates structurally impossible), emits progress, and fires AllKeyItemsUnlocked + FinalChallengeUnlocked at `keyItemsRequired` (SPEC-024, v1=4); an unlock past completion is a logged rejection, never a throw. Driven ONLY through the Reward Resolver's `unlockKeyItem` Action (the previously-reserved forward seam, now real: `UnlockKeyItemAction` via a new `services.keyItems` capability), so a Key Item can only be a KeyItemReward outcome (gambling win / shop purchase). Wired into `tournament-engines.ts` and serialized. Checkpoint green: a `keyItem` Reward resolved through the one Action Engine unlocks the next item, and four unlock the Final Challenge end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1198 green; build clean; contracts drift check green.

  - Minigame Integration (SPEC-015) COMPLETE (coordinator): `minigame/` `TournamentMinigame` orchestrates one round's minigame as a pure CONSUMER of the existing platform through narrow injected ports (`MinigameLauncherPort`/`MinigameLifecyclePort`/`MinigameReconcilerPort`/`MinigameCatalogPort`) — it never imports the matchmaking module. Pipeline (SPEC-015): skip when <2 active; seeded selection from the catalog filtered by active-player count (`createMinigameCatalog`, no duplicated id list — the adapter supplies ids from the real `GameEngineRegistry`); launch a casual match; a blocking logical wait on lifecycle events (no polling) backed by a reconciliation watchdog (SPEC-024 `minigameWatchdogMinutes`, one `matches`-table reconcile on expiry via the injected clock); award winner/participant outcome points to active players through the ONE Reward Resolver (source Minigame); return the single winner (null on a tie ⇒ Gambling skipped) to feed Gambling. Emits MinigameSelectionStarted/Selected/Loading/Started/Finished/Cancelled. Ports are inert by default (a standalone tournament cleanly cancels its minigame) and injected with real adapters by the NestJS Runtime layer; wired into `tournament-engines.ts` (`rewardGranter`=Reward Resolver, context bound to the services bundle) and serialized. Checkpoint green: a completed match awards outcome points through the real Economy end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1211 green; build clean; contracts drift check green. Deferred (outer integration): the socket-bound launch/lifecycle/reconcile adapter over MatchFactoryService/MatchLifecycleEvents/`matches`, which needs tournament players live in the arena (same gate as the Vertical Slice's intent/room layer).

  - Gambling Integration (SPEC-016) COMPLETE: `gambling/` `TournamentGambling` runs the phase as an interactive session like the Shop but at PHASE scale (Open→wait→Bet/Abandon/Timeout→Close). `open(winnerId, winChance)` opens only while Key Items remain locked (else skips) — even when the winner can't afford the stake (they may only abandon) — and starts the 30s decision timeout (SPEC-024, via the injected clock; timeout = abandon, never an auto-bet). `bet` charges the stake against the Tournament Economy in POINTS (`source: "gambling"`, never `users.coins`/`wagers`/CasinoEngine), resolves provably-fair through a `GamblingFairness` port whose default (`gambling-fairness.ts`) imports the existing casino's `casino.fair` primitives (server seed committed + revealed, per-bet nonce — architect-approved reuse, no duplication; seeds are per-bet and NOT the tournament seed, so the outcome is outside the determinism layer), and on a win requests a Key Item unlock through the ONE Reward Resolver (`keyItem` Reward → Key Item Progression emits KeyItemUnlocked). The win probability with pity is computed by the Runtime and passed in — never hardcoded. Emits GamblingOpened/Started/Won/Lost/Cancelled and GamblingFinished (ALWAYS, the State-Machine event). Wired into `tournament-engines.ts` and serialized. Checkpoint green: a winning bet charges tournament points and unlocks a real Key Item end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1226 green; build clean; contracts drift check green.

- Phase 5 (endgame) COMPLETE at the engine/coordinator level:
  - Boss System (SPEC-020) COMPLETE: `boss/` `TournamentBoss` is a pure ORCHESTRATOR — it spawns ONLY when every Key Item is unlocked (`BossKeyItemGate` over `TournamentKeyItems.isComplete`), single-spawn guarded, plays its intro through the ONE Action runner (an intro error is logged and the pipeline continues), alters the game EXCLUSIVELY by activating Rules through a `BossRuleController` seam over the real Rule Engine (`registerAndActivate`/`remove`), and emits BossSpawnRequested→BossSpawned→BossRulesActivated→BossIntroCompleted (the State-Machine event carrying `finalChallengeId`); `finish()` removes its Rules (BossRulesRemoved→BossFinished, idempotent). A Boss DEFINITION is pure content in `createBossRegistry` (v1 placeholder "The Parrot King": empty intro, seed Rules No-Steal + Double-Dice, pointing at the v1 sudden death); it never rewards, decides winners, or touches Economy/Inventory/Board. Wired into `tournament-engines.ts` and serialized. Checkpoint green: spawning activates real Rules (steals blocked globally, dice doubled) and finishing removes them end-to-end (`runtime/tournament-engines.spec.ts`). Full backend suite 1240 green.
  - Final Challenge System (SPEC-021) + Shell (SPEC-013 ShellReward) COMPLETE: `final-challenge/` `TournamentFinalChallenge` runs the LAST phase, fully decoupled from the Boss (the Boss only triggers it; the Runtime will call `start()` on BossIntroCompleted). v1 victory condition (config-driven via `createFinalChallengeRegistry`, definition = rules + actions + victoryConditions): MINIGAME SUDDEN DEATH through EXACTLY the SPEC-015 pipeline port — one minigame with every active player, tie/no-winner relaunches, a minigame that cannot run stalls the challenge (logged, stays ACTIVE, `resume()` re-enters — SPEC-021 error policy). On a unique winner: VictoryConditionReached → the Shell Reward through the ONE Reward Resolver (`shell` Reward → `grantShell` Action, the last forward seam now real via a new `services.shell` capability → `TournamentShell`, the single-grant match-state holder and SOLE emitter of ShellGranted) → frozen final ranking via `Leaderboard.generateFinal(winnerId)` (1º Shell holder) → FinalChallengeFinished (the State-Machine event towards VICTORY; TournamentFinished stays Runtime-owned). Boss Rules remain active throughout; challenge-specific Rules activate/remove through the same Rule-controller seam. Wired into `tournament-engines.ts` (challenge id taken from the Boss definition) and serialized (`shell` + `finalChallenge` snapshots). Checkpoint green: endgame end-to-end — 4 Key Items → Boss spawns → sudden death resolves → ShellGranted through the real Resolver → leaderboard frozen with the winner first (`runtime/tournament-engines.spec.ts`). Full backend suite 1255 green; build clean; contracts drift check green.

- Vertical Slice (SPEC-022 + SPEC-039 minimum) COMPLETE: the mode is playable in the browser. (a) **Interactive Runtime turn loop** — `TournamentRuntime` gains `interactiveTurns` (production default via `TournamentRuntimeService`): PLAYER_TURNS drives REAL board turns through the Turn System (one turn per player in TurnOrder; `handleRollDice` validates RollDiceIntent per SPEC-022; the roll timeout/disconnect auto-resolution keeps unattended games progressing to the D3 anti-stall DEFEAT), then MINIGAME(Phase-1 skip)→CHECK_KEY_ITEMS→next round automatically; the deterministic simulation API (`advancePhase`/`runToCompletion`) stays intact and the two modes are mutually exclusive (Turn System now clears the turn BEFORE emitting PlayerTurnFinished so the sequencer can chain synchronously). (b) **Contracts V1** — `TournamentSnapshotV1` (phase/round/maxRound/turnOrder/activePlayerId/turnDeadlineAt, board tile ring, players with points+tile+connected, key-item progress), client→server messages `tournament:join`/`tournament:leave`/`tournament:intent`, `RollDiceIntent` + accepted/rejected acks — mirrored consciously in `frontend/src/features/tournaments/contracts.ts`, drift check green. (c) **TournamentGateway + TournamentSyncService** — gateway in the tournaments module shares the platform `/ws/` Socket.IO server (auth stays in the matchmaking connection handler; SPEC-037: never touches matchmaking.gateway.ts): join validates participant + acks the current snapshot envelope (the SPEC-022 reconnection path), intents are validated and forwarded to the Runtime (ack never carries state), leave/disconnect auto-resolves the leaver's turn; the sync service broadcasts the COMPLETE visible snapshot with a monotonic `seq` to room `tournament:<id>`, coalescing each synchronous event burst into ONE emit, and detaches after the terminal snapshot. The lobby attaches the sync on `start()`. (d) **Provisional board UI** — `TournamentBoardView.tsx` (React, self-contained; the Phaser scene is F7): schematic 8-tile ring + seat-colored tokens, HUD (points, round/maxRound, turn order with active highlight, key items, connection dimming), Roll button only on your turn with the server-deadline countdown; snapshot-first client (discards `seq <=` current, never derives state); rendered by the lobby modal when the lobby goes active. Backend suite 1274 green; build clean; contracts drift check green; gateway verified live (`tournament:join/intent/leave` subscribed on `/ws/`). Manual in-browser 4-player validation via `make dev` pending user run-through.

- FULL GAME LOOP (P1: F4/F5 outer integration) COMPLETE — the whole game plays end-to-end: (a) **Socket-bound minigame adapter** (`tournament-minigame.adapter.ts`) satisfies the four SPEC-015 ports over the real platform: catalog from `GameEngineRegistry.list()` (engines gained explicit `minPlayers`/`maxPlayers`; never a duplicated id list), launcher via `MatchFactoryService.createMatch` (casual) + the platform's single launch rail `MatchmakingGateway.startServerInitiatedMatch` (made public — its own doc anticipated "any future orchestrator" — with a `tournament:minigame-start` client notification; matchmaking exports widened accordingly), lifecycle mapping `MatchLifecycleEvents` rooms → tournament results (`winnerSide`→userId), reconciler off the durable `matches`/`match_players` rows. A player with no live socket aborts the launch (never half-seated). (b) **The interactive Runtime now drives the WHOLE round pipeline**: after the last turn, MINIGAME awaits the real SPEC-015 coordinator; the winner gets GAMBLING_PHASE with pity-adjusted win chance (base + increment×(round−1), computed by the Runtime per SPEC-016) resolved by `StartGamblingIntent`/`LeaveGamblingIntent`/30s timeout/disconnect (all → GamblingFinished → CHECK_KEY_ITEMS); key-item completion enters BOSS_EVENT → boss spawns + Boss Rules live → FINAL_CHALLENGE (sudden death through the SAME minigame pipeline; a stalled challenge retries via clock backoff per SPEC-021) → VICTORY → REWARDS → FINISHED with `TournamentFinished{winnerUserId}`. (c) **Persistent champion rewards (SPEC-037/D10)**: `tournaments.winnerUserId` persisted from the snapshot; 500 coins granted once (idempotency marker in `state.championReward`) under `lockUserForUpdate`; new `tournament-champion` achievement ("The Parrot's Shell") in the achievements catalog, unlocked lazily off the persisted winner (context gained `tournamentsWon`). (d) **Contracts V1 + UI**: snapshot carries `gambling` session (spectator-visible per SPEC-039), `minigameMatchId`, `winnerUserId`; board view launches into minigames via the existing auto-join rail on `tournament:minigame-start`, renders the gambling decision (Gamble/Pass for the winner, live spectator line for the rest), phase labels for the endgame and the champion/defeat banner. End-to-end test plays a COMPLETE game (rounds → minigames → gambling → 4 Key Items → Boss → sudden death → champion persisted). Backend suite 1284 green; build clean; contracts drift green; gateway live.

- CPU PLAYERS v1 (user-approved scope: bots only in tournament-launched minigames) COMPLETE: (a) **CPU stand-ins** — when the tournament launches a round minigame and a participant has no live socket, the adapter seats a `bot:<userId>` stand-in carrying the REAL user's identity (outcomes/points credit them), so one offline player never blocks/aborts a round's minigame; bot seats exist ONLY on tournament-launched matches. (b) **`BotPlayerService`** (matchmaking module): server-side driver ticking active rooms with bot seats and playing all four games through the SAME rail as human clients (`MatchmakingGateway.handleUserInput`, extracted public from the game:input handler — one input pipeline, full engine validation, broadcasts, replays, settlement). Per-game playbooks grounded in real client behaviour (all scoring is client-reported by design): temple-curling aims/settles stones around the button with gaussian skill noise (engine scores the end), kame-knock picks the highest-value breakable target (hit chance 0.55), bell-clash shoots and reports real zone values 50–200 (hit chance 0.7) then locks the round, bamboo-bash fells the ripest bamboo until the round clock elapses. Skill knobs centralized in `BOT_SKILL` for the D2/F8 balance pass. Human reconnect mid-match reclaims the seat automatically (the `bot:` socket marker is replaced by `RoomService.reconnect`). Proven by an integration spec where two bots play EVERY game to a finished, engine-scored match through the real engines. Backend suite 1290 green. Next wave (approved, pending): CPU tournament PARTICIPANTS (lobby "Add CPU" seat, bot users, board-turn/gambling policy driver).

- CPU PLAYERS v2 (lobby CPU participants) COMPLETE: the creator fills empty seats with CPUs and a tournament can run with 1 human (or, technically, none). (a) **Bot accounts** — pooled user rows on the reserved email domain `@bots.tournament.local` (unreachable via registration/OAuth, so a real account can never be picked), display names "CPU Kame/Shellby/Snapper/Bowser" with unique-collision retry; a free bot = not seated in any pending/active tournament; minted on demand. (b) **`POST /tournaments/:id/add-cpu`** (creator-only, CSRF-guarded, same pessimistic-lock critical section as join so a CPU can never overfill the lobby); `record.botUserIds` marks them per-tournament (backward-compatible optional field); lobby state exposes `isBot` (always ready). (c) **Runtime bot policy** (interactive mode, from `botPlayerIds`): board turns roll after a 1.5s clock delay (deterministic under ManualClock — an all-CPU table plays itself, proven in tests), gambling decision after 2.5s (bet when the stake is affordable, else pass) — all through the SAME intent entry points as humans. (d) Minigames need nothing: bots are never online, so the CPU v1 stand-in seating covers them automatically. (e) UI: "+ Add CPU" on the first empty lobby seat, 🤖 badges in the lobby and board HUD; snapshot `TournamentPlayerStateSummary.isBot` (CPUs always render connected). Backend suite 1292 green; contracts drift green. SPEC-038 scope note: this is the user-approved D-extension "CPU players" (2026-07-15/16) — entry flow otherwise unchanged (4 seats, PIN/invites). v1 limitation: CPUs cannot be removed from a lobby (create a fresh lobby instead).

- LEAVE-FOR-GOOD vs DISCONNECT (polish) COMPLETE: the board's "Leave match" button now emits a distinct `tournament:quit` message (contracts V1 + frontend mirror) that removes the player from the tournament PERMANENTLY — they can never rejoin (`tournament:join`/`tournament:intent` reject them with reason `"left"`, backed by an in-memory `left` set in `TournamentSyncService`) and are immediately freed to create/join a new tournament (persisted `tournament_participants.hasLeft`, migration `20260718000000-add-tournament-participant-has-left.ts`, auto-synced in dev; the one-tournament-per-user gate `assertNotInAnotherTournament` and `getMyLobby` now filter `hasLeft: false`). Reconnection stays reserved for players who merely disconnected/navigated away (`tournament:leave` + socket disconnect, unchanged). The quitter's seat is handed to a CPU (`TournamentRuntime.convertPlayerToBot`): the departed player keeps their seat/points/turn-order slot but the Runtime now plays their board turns and gambling decisions like a lobby CPU (CPU v2) through the same validated intent entry points — and takes over any decision they own at the moment of leaving (their active turn, or the open gambling session), so the round never stalls. Bot subscriptions are now always wired in interactive mode (they check membership at event time), so a table that started all-human is driven the moment the first quitter converts; the snapshot renders the seat as 🤖 (isBot, always connected). Gateway/runtime specs cover quit (permanent removal, persisted leave, barred rejoin, CPU takeover incl. an all-human table converting mid-game). Backend tournament suite green; contracts drift green.

- NO-ZOMBIE CLEANUP + LEAVE=LOSS COMPLETE: (a) **No real players left → tear the tournament down.** `TournamentRuntime.humanPlayerCount` = seats not played by a CPU (incl. converted quitters); when the last human quits, the gateway calls `TournamentRuntimeService.cancelTournament(id, "all players left the match")` → CANCELLED, persisted, sync detached — no all-CPU game runs on in limbo. (b) **No zombie minigames.** `cancelTournament` captures the in-flight `minigame.serialize().pendingMatchId` before cancelling and aborts that arena match via a new seam `TournamentMinigameAdapter.abortMatch` → `MatchmakingGateway.abortMatch` → new `GameSessionService.abort(room)` (finish winnerless as `abandoned`, persist, emit the `abandoned` lifecycle event so the coordinator's wait settles instead of hanging to the 10-min watchdog). In practice the last human only quits between minigames (no in-flight match), so this is a defensive guarantee. (c) **Leaving a match counts as a loss (user-approved 2026-07-18).** Tournament quit: `markParticipantLeft` now also sets `tournament_participants.outcome = "forfeit"` and, once per quit (guarded on the row actually flipping), increments the player's `profiles.totalLosses` + `gamesPlayed` — a bare stat bump, NO consolation XP/coins. Minigame abandon (arena "Abandon Match" / disconnect-timeout forfeit): `GameSessionService.abandon` now records the same bare loss for the abandoning player only (skips guests + CPU stand-ins, inside the M4-guarded transition so it never double-counts). Both leave dialogs warn "this counts as a LOSS" before confirming. Note: `BOT_SOCKET_PREFIX`/`isBotSeat` moved to the dependency-free `matchmaking.types` (re-exported from `bot-player.service`) to break a `game-session → bot-player → matchmaking.gateway → game-session` cycle. Full backend suite 1390 green; tsc clean; contracts drift green.

- TOURNAMENT PAGE + MINIGAME CONTINUE FLOW COMPLETE (2026-07-18): (a) **The tournament match has its own endpoint** — new route `/tournament/:tournamentId` (`frontend/src/routes/TournamentPage.tsx`, lazy + protected) hosting `TournamentBoardView`; `TournamentLobbyModal` now only covers the creation lobby and redirects to the page when the lobby goes active (fresh `start` AND reopening the Tournament button mid-match via the getMine hydrate). (b) **Tournament-launched minigames end with one CONTINUE button + 15s auto-return.** The room now carries its owning `tournamentId` (`MatchRoom.tournamentId`, set by `MatchFactoryService.createMatch` ← `TournamentMinigameAdapter.launch`) and both client payloads expose it (`match:status`, `startServerInitiatedMatch` events) so the flag survives refresh/reconnect. The end-of-match modal (`online-rematch.ts`) branches on `registry.onlineMatch.tournamentId`: no rematch listeners, single CONTINUE action with a live per-second countdown ("BACK TO THE BOARD IN Ns"), auto-continue at 0; continuing emits `match:leave-finished` and starts HubScene, whose return event GamePage redirects to `/tournament/:id` instead of the hub. Backend suite 1390 green, frontend vitest 371 green (incl. 2 new tournament-continue tests), dev stack HMR clean.

- IN-ARENA "LEAVE GAME" (tournament quit from a minigame) COMPLETE (2026-07-18): the shared HUD's "RETURN TO HUB" button becomes **LEAVE GAME** when the match carries a `tournamentId` — there is no casual hub-return mid-tournament; leaving quits the WHOLE tournament for good, after an "Are you sure you want to quit the game? This counts as a LOSS…" confirmation. Client: `buildReturnButton` (shared/mechanics/hud.ts) branches on the registry's online-match context and fires `TOURNAMENT_QUIT_EVENT`; GamePage emits `tournament:quit { tournamentId }` and navigates to the hub (not the tournament page). Server: `tournament:quit` now accepts an explicit `tournamentId` body (`TournamentQuitRequest`, both contract mirrors — the arena socket already LEFT the tournament room; body ids are validated against the runtime's participants) and, on quit, ALSO hands the quitter's live minigame seat to a CPU stand-in (`RoomService.convertSeatToBot` → `bot:` socket keeping the user identity, disconnect timer cleared, user unmapped from the room → `match:status` clean, no reconnect takeover, free to queue; surfaced via `MatchmakingGateway.convertSeatToBot` → adapter → `TournamentRuntimeService.convertMinigameSeatToBot`), so the arena match plays on for the remaining seats and NO disconnect-forfeit double-loss fires — the tournament layer's forfeit is the single recorded loss. Backend 1398 green (new room.service.spec + gateway/tournament-gateway cases), frontend vitest 374 green (new hud.test.ts), contracts drift green.

- ROUND-1 ARRIVAL GATE + DISCONNECT GRACE (2026-07-18): fixed "first turn always goes to the lobby owner / players skipped on turn 1". Root cause was a race, not the ordering (deriveTurnOrder is uniform; the runtime always starts at turnOrder[0]): `start()` opened turn 1 the instant the owner clicked Start, while other clients were still in the lobby (2.5s poll + navigation) — and every arriving board fires JOIN→LEAVE→JOIN (React StrictMode), where the LEAVE **instantly** auto-resolved that player's active turn. The skips cascaded down the order until reaching the owner (the only client already connected). Fix (server-authoritative): (a) **first-turns gate** — interactive runtimes accept `firstTurnsGraceMs` (service passes 10s): round 1 holds in ROUND_START until every human has connected (`handlePlayerConnected`, fed by the gateway on JOIN; quitters converting to CPU also release the gate) or the grace expires, then turn 1 opens for the real `turnOrder[0]`; board shows "Waiting for players…". (b) **disconnect grace** — `handlePlayerDisconnect` now schedules the auto-resolve 3s out and skips it if the player reconnected (protects both the active TURN and the open GAMBLING decision, which the same LEAVE race could silently abandon so the minigame winner never saw the Key-Item gamble). The 30s roll timeout stays the backstop. Backend 1401 green (new runtime gate/grace specs; service + gateway specs updated), frontend 374 green.

- DICE-ROLL REVEAL + TOKEN WALK + GAMBLING FEEDBACK (2026-07-18): rolls are no longer an instant teleport. Backend: the runtime records every resolved roll off the existing `PlayerTurnFinished` event (`diceValue`/`autoResolved` were already in the payload) and the wire snapshot gained `lastRoll: TournamentLastRollSummary | null` (`{playerId, round, value, autoResolved}`, identified by (round, playerId) — one turn per player per round; both contract mirrors, drift green). Client (`TournamentBoardView`, presentation-only per SPEC-022): a new roll queues an animation — board-center banner "🎲 X rolls …" (450 ms suspense) → value reveal (750 ms hold, "(auto-rolled)" tag for server-resolved turns) → the token WALKS the ring tile-by-tile (170 ms/hop, reusing the existing tile render via a `displayedTiles` overlay that lags only the animating player) and settles on the authoritative tile. Reveals queue in order; a backlog > 2 (CPU bursts) fast-forwards silently; the first snapshot after (re)join never replays a stale roll. Gambling UX: the winner's box now shows "You have N points (— you need C to bet)", dims Gamble when short, and surfaces a red notice on an unaffordable/rejected bet (local check + server ack `insufficient_points`), cleared per session. Backend 1401 green (+ sync spec asserts `lastRoll` on the wire), frontend 374 green, tournament files tsc-clean (checked with a patched tsconfig — repo-wide strict tsc has many pre-existing errors in other files).

- MINIGAME TIE-BREAK ROULETTE (2026-07-18): no tie ever stands. When a round's minigame ends winnerless, the coordinator (`tournament-minigame.ts`) now opens a **tie-break roulette**: candidates = the players tied for the TOP score (`MinigameFinalResult.tiedPlayerIds`, computed by the adapter from the match's per-side `state.score` — every engine keeps one; fallback = all seated players, and reconciled draws fall back to all drawn players), winner = seeded pick (`createSeededRng(seed:tiebreak:round:matchId)` — deterministic, decided the moment the tie-break opens), and the round HOLDS for `TIE_BREAK_SPIN_MS` (6.5 s, awaited on the injected clock) so every client plays the spin before Gambling opens. The roulette winner takes the round: winner's minigame reward + the Gambling decision; then turns resume through the normal pipeline. New bus event `MinigameTieBreakStarted`; coordinator snapshot + wire snapshot gained `tieBreak: {playerIds, winnerId, resolveAt} | null` (`TournamentTieBreakSummary`, both mirrors) and players gained `avatar` (resolved by the sync service with usernames). Because the FINAL_CHALLENGE runs through the same coordinator, drawn sudden-death matches are settled by the roulette too instead of retry-looping. Client: new `TieBreakRoulette.tsx` overlay on the board — reuses the Fortune Wheel's spin maths (`nextRotation`/`spinToAngle` from `features/gambling/wheel`), SVG slices per tied player with their seat color, username and circular-clipped profile avatar, top pointer, ~4 s CSS spin that lands on the server-chosen winner on every client, then "X wins the tie-break!" until the server resumes. Backend 1404 green (coordinator tie-break/subset/determinism tests, adapter top-scorer test), frontend 374 green, drift green, tournament files tsc-clean.

- MINIGAME TIME! GATE + TURN-HANDOFF PACING (2026-07-18): the round no longer jumps from the last dice roll straight into the arena. (a) **Turn handoff**: after every resolved roll the runtime holds the baton `TURN_HANDOFF_MS` (2.6 s — the boards are presenting the roll: value reveal + token walk) before opening the next turn or closing the round, so a player's turn visibly ends only after their piece lands. (b) **MINIGAME TIME! gate** (SPEC-015 v2): after the minigame is selected, the coordinator opens a confirmation gate (`launchGate` option — absent in unit tests keeps launch-immediately; runtime passes min-hold 1.5 s + 20 s deadline + `isAutoReady` = CPU seats/disconnected humans): every human must send the new `ConfirmMinigameIntent` ("Let's go!") before the match launches; the deadline guarantees an absent player never blocks. New bus events `MinigameLaunchGateOpened`/`MinigameLaunchConfirmed`; wire snapshot gained `minigameGate: {minigameId, playerIds, readyPlayerIds, deadlineAt} | null` (`TournamentMinigameGateSummary`) and the intent unions gained `ConfirmMinigameIntent` (both mirrors, drift green). Client: full-board popup — "🎮 MINIGAME TIME!", the chosen minigame's title, per-player ready chips (✅/⌛), "auto-starts in Ns", and a "Let's go!" button that flips to "Waiting for players…" once clicked; when the last human confirms the match launches and everyone auto-joins the arena (the platform launch rail force-starts all seats together, so the wait happens on the popup by design). Backend 1406 green (gate confirm/deadline coordinator tests; turn-pacing updates across runtime/sync specs), frontend 374 green, tournament files tsc-clean.

- GAMBLING OUTCOME REVEAL (2026-07-18): a resolved Key-Item bet is no longer silent. The runtime records every `GamblingWon`/`GamblingLost` as `lastGamble: {playerId, round, won, cost}` on the wire (`TournamentGambleOutcomeSummary`, both mirrors), and a RESOLVED bet now **holds the round 4 s** (`GAMBLE_RESULT_HOLD_MS`, scheduled continuation of `GamblingFinished` — pass/timeout still resume immediately, nothing to reveal) so every board presents the outcome: board-center banner (🔑 "X unlocked a KEY ITEM!" / 💸 "X lost the bet (−N pts)") plus a green/red HUD box, personalized for the bettor ("You won the bet…"). The client shows it exactly while `phase === GAMBLING_PHASE` with no open session — the server's hold window — so no client timers. Backend 1407 green (new hold-and-reveal runtime test; whole-game loop pacing bumped), frontend 374 green, drift green.

- SHARED "3,2,1,GO!" COUNTDOWN + TIE-BREAK AUDIENCE SYNC (2026-07-18): (a) **Countdown**: root cause of "the 3,2,1,GO is missing" — Bell Clash and Temple Curling NEVER had one (verified across git history) and Kame Knock only had it online; the tournament picks minigames at random so most rounds landed in countdown-less games. Extracted Bamboo's countdown into `shared/mechanics/start-countdown.ts` (`runStartCountdown`, identical visuals, scene-clock timers, safe on shutdown) and wired it with real input gating into: Bell Clash (all modes — `running=false` until GO gates update()+onLaunch, which also zeroes a swallowed release), Kame Knock local (`running` gate — the slingshot arm was already `running`-gated; online keeps its own countdown), Temple Curling (all modes — `startCountdownHold` flag guards onLaunch; local defers `beginTurn()`+replay capture to GO). Bamboo unchanged (already had both). Mid-game rejoins skip it (bell: score/round heuristic; curl: turnNumber>0). (b) **Tie-break roulette sync**: the spin used to start the instant the tied match resolved — while everyone was still on the arena's 15 s CONTINUE screen — so the 6.5 s spin+reveal was over before anyone returned. The coordinator now has a `tieBreakGate` audience gate (runtime passes `isPresent` = CPU or connected, 20 s arrival timeout; `notifyPresenceChanged()` poked from `handlePlayerConnected`/`convertPlayerToBot`): the roulette WAITS until every player's board is back, then spins in sync for everyone; `TIE_BREAK_SPIN_MS` bumped 6.5 s → 8 s so the landed result stays readable (~3.5 s) before the round resumes. Backend 1409 green (audience-gate wait/timeout tests), frontend 376 green (start-countdown tests), drift green, touched files tsc-clean. Follow-up (same day): the countdown lock was client-only, so server-driven CPU stand-ins still moved during it — `BotPlayerService` now holds every room's bots for `BOT_START_COUNTDOWN_HOLD_MS` (5 s, sized for the 3.2 s countdown + tournament navigation lag) after the room ticks active, so nothing moves before GO on any board (backend 1410 green, new hold spec).

- THE PARROT'S SHELL MAP BOARD (2026-07-19): the provisional eight-box ring has been replaced by the real transparent `public/assets/tournament/tournamentMap.png` presentation and a 28-step server-owned ring (`parrots-shell-path-28`). Players spawn on the lower dirt clearing and advance clockwise through normalised visual anchors following the map path; four distributed bonus steps retain Action-Engine point awards. `TournamentBoardView` now layers the current viewer's equipped Hub background, the transparent map, a subtle route, step markers and top-down turtle pieces. Pieces move through the existing snapshot-driven 170 ms step queue, transition between independent map anchors, separate when sharing a tile, identify seats by colour and mark CPU seats. The HUD and phase status float over the transparent upper band on landscape layouts and reflow below the 16:9 board on narrow or portrait layouts. The layout is isolated in `tournament-board-layout.ts`, covered by coordinate/identity tests, and styled through the registered `tournament-board.css` module. Frontend 380 tests and backend 1410 tests green; the production frontend build is green with an alternate output directory because the local generated `frontend/dist/assets` directory is root-owned.

- FIVE-PLAYER TOURNAMENTS (2026-07-19): the tournament size moved from 4 to 5 players. The single source of truth is `playersPerTournament` in the SPEC-024 settings catalogue (`config/settings.catalog.ts`), from which `TOURNAMENT_PLAYERS` and every lobby capacity/start check derive; the four minigame engines already declared `maxPlayers = 5`, so no arena changes were needed. Frontend: lobby capacity mirror bumped to 5, a fifth seat colour (purple) and a fifth shared-tile token offset added to the board view. Backend 1410 and frontend 380 tests green (lobby specs reworked for five seats).

Missing for completion:
- Manual 5-player in-browser validation of the full loop (the minigame → CONTINUE → board handoff is now automatic; validate it live).
- F7 presentation remainder (SPEC-039 Phase 7): shop/inventory UI, boss FX, final ranking screen and reconnection overlays. The map board presentation is no longer provisional.
- F6 remainder: die-SWAP items (needs ADR), shop interaction window binding, and D11 content for real items/events/shop/boss behaviour; the production map and board route are now in place.
- F8 quality: simulator (D2 balance), analytics (SPEC-026), performance (SPEC-029).
- Rest of Phase 6 item content (die-SWAP items — changing WHICH die is rolled via the Dice `ActiveDieResolver` seam — still need an ADR since that seam is not one of the Rule Engine's 5 fixed query points; value-override die items are done), the Vertical Slice (snapshot-first networking + minimal UI, gated on arena netcode D9), and roadmap phases 4/5/7/8 (minigame/gambling/key-item progression, endgame, full frontend, quality/simulator). See `docs/tournament-implementation-roadmap.md`.

### Minor: Game customisation options
Status: `In progress`

Requirement breakdown:
- Power-ups, abilities, maps, or adjustments.
- Default options.

Evidence:
- Powers and mechanics in `frontend/src/shared/mechanics/`
- `shell-curl` and other games already use powers and selection.
- `backend/src/modules/customization/` covers user cosmetics.
- `backend/src/modules/cards/` (Shell Cards): collectible cosmetic binder, with multiple booster levels (`basic`/`deluxe`/`legendary`, each with its own price and probabilities — see `docs/SHELL_CARDS_SPEC.md` §11). Catalog is 40 cards total (21 power_shell + 5 shrine + 3 shell_skin + 11 character, the latter including `char-pirate` and `char-samurai`, which had shipped in code but were missing from the spec's own card list) and includes a "Prismatic" state — a rarer tier than foil, exclusive to gold cards, no changes to the economy (see `docs/SHELL_CARDS_SPEC.md` §12). Reinforces, does not replace, the pending separation between gameplay customization and cosmetic customization. A bug audit (`docs/handoff-shell-cards-bug-audit-and-fix-plan.md`) closed a concurrent-double-spend hole in pack opening (pessimistic row lock), added the missing `user_cards` create-table migration, made per-card increments atomic, surfaced match-completion card drops in all four game scenes (previously granted but never shown), and fixed several medium/low-severity gaps (pack-open error handling, binder-load retry, reveal-overlay focus trap, in-modal coin balance).

Missing for completion:
- Clearly separate gameplay customization from cosmetic customization.
- Demonstrate stable, playable configuration evaluable by module.

### Minor: Gamification system
Status: `Done`

Requirement breakdown:
- At least 3 of: achievements, badges, leaderboard, XP/levels, quests, rewards.
- Persistence.
- Visual feedback.

Evidence:
- Achievements
- Leaderboards
- XP/level and progression
- Compact XP progress in the hub player card and detailed progress in the private profile preview.
- Visual achievement popups

Missing for completion:
- Nothing essential to claim it.

### Minor: Spectator mode
Status: `In progress`

Requirement breakdown:
- Watch ongoing matches.
- Real-time updates.
- Optional chat.

Evidence:
- Spectator entities and structures in `matchmaking`
- `room.service.ts` and frontend scenes contemplate `spectator`

Missing for completion:
- Validate complete flow and accessibility from UI.
- Confirm real entry into active matches and observer mode stability.

## Devops

### Major: Monitoring with Prometheus and Grafana
Status: `Done`

Requirement breakdown:
- Metrics collection.
- Exporters and integrations.
- Custom dashboards.
- Alerts.
- Secure access.

Evidence:
- Metrics collection: `backend/src/modules/metrics/` (prom-client counters/histograms/gauges + default Node.js metrics), scraped by Prometheus via `job: backend` in `infra/monitoring/conf/prometheus.yml.tpl`.
- Exporters (Option A): `postgres_exporter` and `redis_exporter` services in `docker-compose.yml` (`infra/monitoring/exporters/`), scraped as `job: postgres` / `job: redis`. Postgres auth uses a dedicated read-only `monitoring` role (`pg_monitor`) created by `infra/database/tools/init/01-monitoring-role.sh`, never the superuser credential.
- Custom dashboards (3, baked into the image, uids stable): `shellsmash-overview.json`, `shellsmash-infra.json`, `shellsmash-datastores.json` in `infra/monitoring/conf/grafana/provisioning/dashboards/`.
- Alerting: 9 Grafana-managed, file-provisioned rules in `infra/monitoring/conf/grafana/provisioning/alerting/alerts.yml` (folder "Shell Smash Alerts") — BackendDown, High5xxRate, HighP95Latency, EventLoopLagP99, HeapNearLimit, PrometheusTargetMissing, PostgresDown, RedisDown, PGConnectionsHigh.
- Secure access: Grafana is reachable only via `https://localhost:42424/monitoring/` (Nginx `location /monitoring/` in `infra/reverse-proxy/conf/default.conf.template`), never on a published host port. Admin credentials come from Vault (`GF_ADMIN_PASSWORD` — entrypoint now fails hard instead of defaulting to `changeme`), sign-up and anonymous access are disabled.
- Defects D1–D11 from `docs/monitoring-module-completion-plan.md` fixed (Grafana subpath exposure, error-status recording, uptime panel, unbound-var crash-loop, credential fallback, dual healthcheck, constant-time token compare, label-cardinality fallback, gauge naming, Redis health AUTH→PING, `--web.enable-lifecycle` removed). D12 covered by `backend/src/modules/{metrics,health}/*.spec.ts` (24 tests, 92.75% statement / 86.2% branch coverage on those modules).
- Build-time `promtool check config` validation added to `infra/monitoring/Dockerfile`.

Missing for completion:
- Nothing essential to claim the module. Alert thresholds (Phase 3 in the completion plan) are a starting point and should be tuned against real dev traffic before the evaluation demo.

## Modules of Choice

### Major: Replay mode
Status: `In progress`

Requirement breakdown:
- Must be substantial, relevant to the project, and justifiable as a major.

Evidence:
- Replay and event persistence in migrations and entities.
- Replay API in `backend/src/modules/matchmaking/matches.controller.ts`
- Shared contract, encoder, capture runtime, controller, and viewer in
  `frontend/src/games/common/replay/`.
- Shared Phaser visualisation in `frontend/src/games/common/ReplayScene.ts`.
- Replay contract v2 migration in
  `backend/src/migrations/20260714000000-unify-replay-contract-v2.ts`.
- Power-up matches are excluded at local capture, online capture, import,
  persistence, and listing boundaries.
- Automated replay tests cover accumulator remainder, keyframes, deltas,
  reconstruction, temporal seeking, stable final state, pre-roll, and the
  power-up import/capture restrictions.

Validation completed on 14 July 2026:
- Frontend production build passed.
- Frontend Vitest suite passed: 47 files and 290 tests.
- Backend production build passed.
- Backend replay, matchmaking gateway, game-session, and private-lobby suites
  passed: 68 tests.
- The complete backend suite passed 787 tests in the sandbox; its five
  loopback Redis health tests were rerun outside the restricted sandbox and
  passed, giving 792 passing tests overall.
- `make re` completed, the replay v2 database columns were verified, and all
  services reported healthy through `make health`.
- The continuous replay trail repair passed 38 targeted trail, replay, and
  visual tests across 11 files, followed by a successful frontend production
  build. The shared renderer now covers Shell Curl, Bamboo Bash, Kame Knock,
  and Bell Clash with runtime-matched width, colour, and alpha progression.
- The manual gameplay and frame-budget matrix remains outstanding, so Replay
  Mode and Multiplayer 3+ remain `In progress`.

Missing for completion:
- Complete and execute the replay v2 acceptance matrix in
  `docs/replay-system-unification-plan.md`.
- Complete the manual one-to-five-player and rendering-budget matrix before
  changing this status to `Done`.

## Module Boundary Rule
This document, together with `AGENTS.md`, defines the functional boundaries of the project. The agent must not propose, implement, or extend functionality outside these chosen modules except upon explicit user request.
