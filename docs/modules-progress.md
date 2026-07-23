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
- Social modal redesign (2026-07-17): the modal is now a two-pane layout mirroring the replay page (`.hub-modal__social-grid`, cloned from `.hub-modal__replays`) — a left sidebar with a pinned friend-code/add-friend block and a `Friends | Chats | Requests` tab strip (Requests shows a pending-count badge), and a right pane holding the open chat thread (or an empty state) so switching sidebar tabs no longer unmounts an open thread. Friend rows show a mini `ShellPortrait` (`shell-portrait--mini`, 2.2rem) with the presence dot overlaid on the portrait corner; request rows are unchanged (avatars are friends-only per product decision). "New group" no longer requires closing the open thread first, and shows "Add some friends first — groups are friends-only." instead of a dead disabled button when the user has no friends yet.
- Hardening alongside the redesign: raw HTTP error text (e.g. a bare "Unauthorized" banner) is no longer shown for modal-level failures — a shared `describeModalError` helper routes any 401 to `/auth` with friendly copy and preserves user-worded 4xx messages otherwise. The live `friend:removed` handler now no-ops while the Social modal has never been opened and guards against a burst of removals firing concurrent refetches.
- Chat-list avatars and group photos (2026-07-19): conversation rows in the Chats tab now show a mini `ShellPortrait` — the other participant's avatar (falling back to their equipped shell via the new `shellSkin` field on `ConversationSummaryView`) for a dm, and the group photo for a group, defaulting to `public/assets/ui/icons/group_default.svg`. The owner can set a group photo through an owner-only `POST /chat/conversations/:id/avatar` multipart endpoint (same accepted types, 2 MB cap, and uploads volume as user avatars), backed by the new `conversations.avatar` column (migration `20260719000000-add-conversation-avatar.ts`); photo changes post a system message and patch open clients live via `chat:conversation-updated` (now also carrying `avatar`). Validated end-to-end with two headless Firefox sessions (dm avatar, default and uploaded group photo, owner-only visibility of the Photo control, member live sync, no console errors) plus `npm run build`, `npm run test:run`, and the backend chat Jest suites.

Validation:
- Backend: full Jest suite green (`cd backend && npm run test`, all 65 spec files) — chat/friends/reports/matchmaking-gateway suites cover every owner action (happy / non-owner 403 / non-group 404 / self-kick 400 / transfer selection / delete cleanup), the presence fan-out (happy / guest short-circuit / non-fatal error), the Part B fixes, and the new `gif.service.spec.ts` cases (all three trusted CDN hosts, lookalike-host rejection, malformed-URL rejection, `getBySlug` on a `static1` item, 503 on missing app key).
- `tsc --noEmit` clean for both `backend/` and `frontend/` on every touched file (remaining errors are pre-existing and unrelated — Phaser scene canvas typings, etc.).
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
- Complete OpenAPI documentation generated by NestJS and rendered with Scalar.
- Dedicated public API in `backend/src/modules/public-api/` protected by `X-API-Key`.
- Documented public endpoints: `GET /api/public/users`, `GET /api/public/users/:username`, `POST /api/public/users/query`, `PUT /api/public/users/:username`, `DELETE /api/public/users/:username/avatar`.
- `PUBLIC_API_KEY` documented in `.env.example` and registered as a dedicated
  OpenAPI security scheme for public mutations; safe reads are public.
- `/api/docs`, its local Scalar bundle, and the JSON/YAML contracts require a
  registered session and reject guest accounts.
- `make validate-openapi` rejects invalid contracts, empty component schemas,
  missing summaries or responses, duplicate operation identifiers, and route
  or operation regressions below 97 paths and 108 operations.
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
- `StoneButton` provides shared `back` and `base` artwork variants across the
  Hub mode and tournament-lobby return controls and the pre-game navigation,
  settings, player-count, matchmaking, and private-room actions.
- The pre-game mode selector uses the Tournament board's gold divider treatment
  across the titles and responsive vertical separators of its unboxed mode and
  power-up groups. It also shares the Hub's background contrast filter while
  fitting the full desktop flow without page scrolling.
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
- Profile exposes ShellSmash and 42 connected-account controls.
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
- 2026-07-22 replay fidelity pass: Bamboo Bash, Temple Curling, and Bell Clash
  replays now reuse their games' production renderers and equipped shell/trail
  cosmetics instead of simplified replay-only artwork. Bamboo obstacle sizing
  and anchoring now match live play; Curling renders textured shells rather than
  coloured placeholder circles; and Bell Clash uses the real score-zone
  gradients and bell asset. Replay trails retain their route across storage
  keyframes, reset only when a stopped projectile is genuinely repositioned,
  and interpolate a growing head instead of moving the whole polyline between
  samples. The replay canvas also renders at capped device-pixel density to
  prevent texture degradation in the modal and expanded viewer. Regression
  coverage now checks trail continuity across keyframes and correct reset after
  a stopped projectile is repositioned.
- 2026-07-22 replay fidelity follow-up: the shared replay scene now preserves
  the production layer order. The oval arena skin is explicitly visible in
  Bamboo Bash, Bell Clash, and Kame Knock; Temple Curling's background tint now
  sits beneath the ice instead of washing it grey; and Bell Clash's zones and
  bell retain their live-game depths. Kame Knock replay targets no longer use a
  minimum pixel radius or a visual pulse beyond their collision circle, so the
  displayed edge remains proportional to the recorded hit area. Playback no
  longer seeks backwards to React's last 100 ms progress update while running,
  and stops at the first terminal frame rather than waiting through trailing
  static capture time.
- 2026-07-20 achievement showcase picker fix (superseding a same-day full-catalog-on-profile change that was reverted as the wrong interpretation): the hub's profile editor (`HomePage.tsx`'s "Achievement showcase" picker) only ever offered *unlocked* achievements as choices for the 3 showcase slots, even though the backend never enforced that — `UpdateProfileDto.showcasedAchievements` (`backend/src/modules/users/dto/update-profile.dto.ts`) validates each entry against the full achievement-ID catalog with no unlock check. The picker now lists every achievement (`pickableAchievements = achievements ?? []`, dropping the `.filter(a => a.unlocked)`), marking locked ones with a 🔒 prefix; `PlayerProfilePreview` mirrors the same lock marker when rendering a showcased-but-locked achievement on the profile card, and the stale "Choose an unlocked achievement" empty-slot copy was corrected. Verified live (Firefox headless): the picker lists all 41 catalog achievements, saving a locked one round-trips through the backend and renders correctly on the public profile.
- 2026-07-15 rankings hardening pass (see `docs/old_docs/rankings-bug-audit-2026-07-15.md`): added the missing `user_ratings` migration and its unique constraint, closed the client-forgeable overall-leaderboard endpoint, fixed ranked draws never updating ratings, made match-finish reward persistence idempotent at the DB level, added stable tie-break ordering and dev-account exclusion to both leaderboard queries, and reworked the Rankings modal to show fetch errors, refetch on open, and the caller's own rank.
- 2026-07-20 rankings/tournament integration pass (see `docs/rankings-bug-audit-2026-07-20.md`): reclassified the reported "DB crash on Rankings" as a backend-process death/lockout (a rankings SELECT cannot take Postgres down) and hardened the actual cause — `main.ts` now logs `unhandledRejection`/`uncaughtException` instead of dying silently, and `BotPlayerService.tick()`'s whole body is wrapped so a bad tick is retried instead of killing the process. New `users.isBot` column (migration + entity + set on CPU-account minting in `tournament-lobby.service.ts`) and a `mergedIntoUserId IS NULL` filter close two ranking-integrity holes: tournament CPU bots and merged-away account duplicates could otherwise occupy public leaderboard rows; both are now excluded from all three leaderboard queries, alongside `isDevAccount` (which the demo account seed now also sets, closing a third — a level-99 KameMaster winning every overall tie-break). New `GET /leaderboard/tournaments` endpoint + `LeaderboardService.getTournamentLeaderboard` + a "Tournaments" tab in the Rankings modal surface a dedicated tournament-wins board off `tournaments.winnerUserId`; tournament minigame wins already flowed into the Total board by construction (same casual-match rail as any other game), confirmed by a new regression test in `game-session.service.spec.ts`. Fixed a leaderboard-fetch race (N5): the modal's cancellation flag used to be created only after the first `await`, so a stale request could resolve after a newer one and overwrite its rows — the flag is now a ref created synchronously before the fetch starts. The prior audit's claimed migration gap for the `tournaments` tables (N2) was verified stale — `20260713000000-create-tournaments.ts` already exists, ordered correctly. Open product decision (not actioned, flagged for the user): whether tournament-minigame XP/coin grants should also exclude CPU bot stand-ins in `GameSessionService.persistFinishedRoom` — currently unchanged, bots still accrue XP/coins/levels even though they're now excluded from every ranking display.
- 2026-07-20 follow-up (N7, post-fix live play-testing): the per-game Rankings tabs stayed permanently empty in production because nothing in the UI could ever send `mode: "ranked"`. First attempt fixed `ShellPickerScene.ts`'s `queue:join` emitter — wrong file: that scene is dead code, never started anywhere in the current routing (no `scene.start("ShellPickerScene"` call exists in the app). Reported still broken from live testing; root-caused to the actual "Normal Mode" flow, `GamePage.tsx`'s `PowerupMatchmakingPanel` (reached via the hub game cards → `/play/:gameId`), whose own separate `findOnlineMatch()` also hardcoded `mode: "casual"`. Fixed there instead: a `renderModePicker` Casual/Ranked selector (mirrors the existing player-count picker's styling) in the Multiplayer Online section, hidden for guests, disabled mid-search/mid-match, wired into the real `queue:join` payload. No backend change was needed — the ranked pipeline (Elo, guest gating, per-game boards) was already correct, just unreachable. `ShellPickerScene.ts`'s dead-code status is flagged, not yet cleaned up. (N8 from the same play-test — KameMaster invisible on every board — is the N4 fix working as designed, not a bug; no change made.)

Missing for completion:
- Should review history coverage for all exposed games.

### Minor: Remote authentication with OAuth 2.0
Status: `Done`

Requirement breakdown:
- Remote OAuth with a provider such as 42.

Evidence:
- The 42 flow is implemented in `backend/src/modules/auth/`; Google OAuth was
  removed on 23 July 2026 so 42 is the only exposed remote provider.
- 42 uses expiring, single-use OAuth state in Redis and can be linked or
  unlinked from Profile without relying on email-address matches.
- Provider callbacks are sourced from the configured callback URLs rather than
  request forwarding headers, preventing proxy or `Host` variations from
  causing redirect URI mismatches.
- OAuth UI in `frontend/src/components/auth/OAuthButtons.tsx`

Missing for completion:
- End-to-end validation still requires real 42 credentials.

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
- 2026-07-20 technical audit of this module's bugs and optimisation gaps (seat
  hijack on a second connection, room retention, 30 Hz forced replay
  keyframes, missing game-input rate limiting, and fix options for each):
  `docs/remote-multiplayer-modules-audit-2026-07-20.md`.
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
- Kame Knock's indestructible targets now use the same shared gold bumper rendering
  and impact flash as Temple Curling instead of tinted destructible-target artwork;
  local play, authoritative online impacts, responsive relayout, and replays use the
  same visual primitive.
- Player rings in all four games and replay rendering now match the tournament-map
  tokens: a coloured inner edge, dark separation, and a soft colour halo. Temple
  Curling's active ring also follows the current player's colour while retaining
  its turn pulse. The ring is present in single-player modes and its coloured edge
  now marks the exact circular physics radius. Settled Temple Curling shells retain
  their coloured hitbox edge without the active shell's dark separator. Frontend
  validation passed with 72 files / 395 tests and a production build.
- Idle turtle rendering now consistently restores the head and legs after movement
  while retaining the shell's final rolled angle instead of straightening it.
  Temple Curling uses the complete turtle renderer rather than its previous
  shell-only variant, and newly created turtles face 90 degrees clockwise to align
  with the map. Its stone-frame texture is aligned to the authored physics sheet
  in live play and replay, with the vector sheet retained as a load-failure
  fallback. Replay rendering now passes interpolated velocity to the complete
  turtle renderer, resets accumulated roll state after timeline jumps, and keeps
  Bell Clash's cached zone layer visible between frames. Focused tests cover the
  initial orientation, retraction, final-angle retention, replay velocity and
  timeline reset. After integration with the frontend performance refactor, the
  full frontend suite passed with 90 files / 490 tests, the Node.js 24 production
  build passed and emitted the arena texture, and Firefox validation covered
  launch, settlement, 1440×900 without page scrolling, and 1000×700 responsive
  rendering without console errors.
- 2026-07-20 audit remediation. The stability and robustness findings from
  `docs/remote-multiplayer-modules-audit-2026-07-20.md` were implemented with
  regression tests: a second connection from the same user no longer hijacks a
  live seat or triggers a false forfeit (R1, vacancy-guarded reconnect with a
  liveness check); finished rooms are evicted on rematch resolution and by a
  ten-minute TTL sweep, and disconnect/spectator lookups now use O(1) socket
  indexes instead of scanning every room (R2); the 30 Hz physics broadcast no
  longer forces a full replay keyframe, and the live replay buffer is bounded by
  whole-round trimming (R3); `game:input` and `game:physics-request` are now
  rate-limited per user with the previously unused `rate-limited` ack (R4); a
  socket that dies between matchmaking and room creation now arms its
  reconnect/forfeit window immediately, backed by a pending-room TTL (R5); the
  Curling lifecycle snapshot no longer ships legacy per-ball trails (R8); and the
  arena loop now broadcasts at 20 Hz while simulating at 30 Hz, cutting
  steady-state bandwidth by a third within the client's interpolation buffer
  (R9). Matchmaking observability was added to the Prometheus stack (tick-duration
  histogram, active-rooms and buffered-replay-frame gauges, dropped catch-up
  counter). The simulated-clock re-anchoring (R7) is instrumented via the dropped
  catch-up counter and deferred as a metrics-gated follow-up. The client-side
  cosmetic launch echo (R6) and the hub reconnect toast (R11) are designed but
  deferred pending the interactive Firefox visual validation this repository
  requires for visually significant changes. Backend suites for the touched
  services and both production builds pass.

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
- Automated 3–5 player end-to-end proof (2026-07-20). A dedicated integration
  spec (`backend/src/modules/matchmaking/nplayer-integration.spec.ts`) drives a
  full five-seat match through the real engines and the real `RoomService` for
  every game to a settled winner, asserting per-side scoring, turn rotation, a
  mid-match disconnect and rejoin of a middle seat, and a live spectator join.
  This is the repeatable, CI-friendly evidence the module previously lacked.
- N-player fairness gaps from `docs/remote-multiplayer-modules-audit-2026-07-20.md`
  are fixed with tests: Temple Curling now rotates the lead each end so the last
  seat no longer always holds the hammer (P2); Bell Clash, Kame Knock and Bamboo
  Bash enforce shell-selection ownership on powers, so a modified client can no
  longer fire a power it did not select (P3); ranked Elo is now a proper pairwise
  multiplayer construction scored by relative placement, so a clear last place
  records a loss and cannot gain rating from a tie for first (P4); and abandon
  resolution no longer excludes a temporarily disconnected leader, with 3+ player
  matches continuing via a CPU stand-in rather than ending when one player leaves
  (P5).

Missing for completion:
- The automated proof above closes the primary evidence gap; the remaining item
  is the manual two-client Firefox matrix for the visual/UX half (turn banner
  order, HUD score columns, spectator entry mid-match, responsive relayout across
  3–5 seats), which requires the interactive stack this environment cannot run.
- Rating-banded matchmaking for 3–5-seat ranked lobbies remains a documented
  out-of-scope limitation (FIFO per game/mode/player-count is retained).

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
- Implementation roadmap in `docs/tournament-implementation-roadmap.md`; platform seams audit in `docs/tournament-platform-seams-audit.md`; player-facing game rules and dormant-mechanics inventory in `docs/tournament-mechanics.md`.
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

- THE PARROT'S SHELL MAP BOARD (2026-07-19): the provisional eight-box ring has been replaced by the real transparent `public/assets/tournament/tournamentMap.png` presentation and a 28-step server-owned ring (`parrots-shell-path-28`). Players spawn in five evenly spaced visual bays across the lower dirt platform, with the first accessible tile directly above them, and advance clockwise through normalised visual anchors following the map path; four distributed bonus steps retain Action-Engine point awards. `TournamentBoardView` now layers the current viewer's equipped Hub background, the transparent map, a subtle route, step markers and top-down turtle pieces. Pieces move through the existing snapshot-driven 170 ms step queue, transition between independent map anchors, separate when sharing a tile, identify seats by colour and mark CPU seats. The HUD and phase status float over the transparent upper band on landscape layouts and reflow below the 16:9 board on narrow or portrait layouts. The layout is isolated in `tournament-board-layout.ts`, covered by coordinate/identity tests, and styled through the registered `tournament-board.css` module. Its visual anchors were subsequently aligned with the illustrated dirt paths, bridges and shoreline from the annotated map review, without changing server tile order or movement rules. Frontend 392 tests and backend 1410 tests green; the production frontend build is green with an alternate output directory because the local generated `frontend/dist/assets` directory is root-owned.

- FIVE-PLAYER TOURNAMENTS (2026-07-19): the tournament size moved from 4 to 5 players. The single source of truth is `playersPerTournament` in the SPEC-024 settings catalogue (`config/settings.catalog.ts`), from which `TOURNAMENT_PLAYERS` and every lobby capacity/start check derive; the four minigame engines already declared `maxPlayers = 5`, so no arena changes were needed. Frontend: lobby capacity mirror bumped to 5, a fifth seat colour (purple) and a fifth shared-tile token offset added to the board view. Backend 1410 and frontend 380 tests green (lobby specs reworked for five seats).

- SHOP TILE + SHOP INTERACTION WINDOW (2026-07-19): the Shop System (SPEC-012, engine-complete since F6) is now playable. (a) **Board**: `tile-18` of the 28-step ring (`SHOP_TILE_INDEX`, directly in front of the pagoda at the map's top-right corner) carries the `openShop` tile Action and wire kind `"shop"`; the board view renders it as a highlighted 🛒 marker ("Pagoda shop", styled in `tournament-board.css`). (b) **Interaction window (SPEC-005 binding)**: landing on the tile opens the shop session during tile resolution; the runtime now HOLDS the turn baton while a session is open (`onInteractiveTurnFinished` defers, an always-on `ShopClosed` subscription resumes the normal 2.6 s handoff on purchase/cancel/timeout/empty — the 30 s `shopInteractionSeconds` timeout is the backstop), the disconnect grace also cancels the leaver's open session, and `convertPlayerToBot` takes over a quitter's live session. (c) **Intents**: `BuyOfferIntent {offerId}` and `EndTurnIntent` are live (both contract mirrors; gateway validates the payload shape and routes to new `handleBuyOffer`/`handleEndTurn` runtime entry points; a rejected purchase keeps the session open per SPEC-012). (d) **Wire**: snapshot gained `shop: {playerId, deadlineAt, offers} | null` (`TournamentShopSummary`/`TournamentShopOfferSummary`), filled by the sync service from a new engine read `TournamentShop.getCatalogView(playerId, round)` — per-offer rule-modified price (the exact amount `buy` charges) and availability (minRound + stock). (e) **UI** (`TournamentBoardView`): the shopper gets the offer list (icon/name/description, price buttons disabled when unavailable, dimmed when unaffordable, red notice on local/acked rejection) plus "Done shopping" and the session countdown; everyone else sees "X is browsing the pagoda shop… Ns". (f) **CPU policy**: a bot shopper buys the first available+affordable offer after a 2 s clock delay, else closes — through the same intent entry points. Also fixed en route: a fresh page load of `/tournament/:id` (direct URL/F5) could race the socket's async auth stamping and reject the join with `not_participant` — the board now retries transient join rejections briefly before surfacing the error. Backend 1427 green (17 new: shop catalog view, runtime shop-window hold/buy/reject/timeout/disconnect/CPU, gateway routing, sync fill + tile kind), frontend build + 393 vitest green, contracts drift green, backend tsc clean; live headless-Firefox validation confirms the 🛒 tile renders top-right (x≈0.80, y≈0.36 of the map) on a running 5-seat board with no console errors.

- RANKINGS INTEGRATION (2026-07-20, see `docs/rankings-bug-audit-2026-07-20.md`): a durable `users.isBot` marker now excludes CPU tournament accounts from every public leaderboard (they were previously ordinary `users` rows whose match/tournament results could rank publicly), a new `GET /leaderboard/tournaments` board ranks players by finished tournament wins (`tournaments.winnerUserId`), and tournament minigame wins were confirmed (by a new regression test) to already flow into the Total leaderboard through the normal casual-match reward pipeline. `main.ts` gained `unhandledRejection`/`uncaughtException` logging and `BotPlayerService.tick()` is now fully guarded, closing the most likely cause of a reported backend outage traced to this module's CPU-bot load testing.

- BOT ROUND-COUNTDOWN HOLD (2026-07-21): `BOT_START_COUNTDOWN_HOLD_MS` only covered a room's FIRST "3, 2, 1, GO!" — the engines advance `roundNumber` (kame-knock, bell-clash, bamboo-bash) / `currentEnd` (temple-curling) the instant a round ends with no server-side delay, so a bot's next scheduled action could fire mid-countdown at every later round boundary, letting a CPU shoot before the client's round-transition countdown finished. `BotPlayerService.tick()` now tracks each room's current round/end number (`roundKeyFor`) and, on a change, calls `armRoundHold` to re-arm the hold for `BOT_ROUND_COUNTDOWN_HOLD_MS` (3.2 s, the countdown itself) plus a new `BOT_SKILL.roundStartDelayMs` (1–3 s random) human-ish pause before the round's first move — the match-start hold is untouched. Follow-up same day: the pause was first wired as one shared room-level draw, so every bot seat resumed on the exact same tick once it cleared (visibly simultaneous in Bell Clash/Bamboo Bash, which have no turn gating) — `armRoundHold` now rolls `roundStartDelayMs` independently per bot seat straight onto that seat's own `SeatPlan.nextActionAt`, so seats in the same room no longer share a draw. Second follow-up (user-requested, same day): kame-knock is strictly turn-based — only the seat whose turn it is can ever act, so the "every bot fires at once" risk this hold exists for never applied there, and it only added an unwanted extra wait on top of the bot's own per-seat pacing. `roundKeyFor` no longer has a `kame-knock` case (falls through to `null`), so its round boundaries never re-arm the hold; the match-start hold (which prevents a kame-knock bot moving before the very first "GO") is untouched. Backend 1482 green (the shared round-boundary-hold spec now runs against Bell Clash instead, plus a new spec asserting kame-knock resumes on its own per-seat pacing with no extra round-boundary wait).

- LIVE TOP-BAR SCORES (kame-knock, bell-clash, bamboo-bash; temple-curling untouched by request) (2026-07-21): the top `ScoreHud` only refreshed on lifecycle `game:state` snapshots (turn/round boundaries), so a player's total visibly sat still while points were actually landing mid-round. Root causes differed per game: (a) **kame-knock** — `KameKnockOnline.snapshotScore` read only the lifecycle snapshot's `score`, ignoring that `kame-knock-physics.ts` already increments `score` live per target break and broadcasts it on every 30 Hz physics tick; now prefers `latestPhysicsState.score`. (b) **bamboo-bash** — same lifecycle-only read; `score` only absorbs a round's points at `completeRound` (bamboo-bash.engine.ts), with the in-progress round tracked separately in `liveRoundScores` (already mutated live onto the snapshot in `applyPhysicsState`, just never added in); `snapshotScore` now returns `score + liveRoundScores` per seat. (c) **bell-clash** — worse: `publicPhysicsState` never put `liveRoundScores` on the physics wire for this game at all (kame-knock and bamboo-bash both had their per-game branch; bell-clash had none), so the frontend had no live figure to read even after a getter fix. Added a `bell-clash` branch to `matchmaking.gateway.ts`'s `publicPhysicsState`, added `liveRoundScores` to the frontend's `BellClashPhysicsState` type, and wired `BellClashOnline.applyPhysicsState` to store it and call the (now-public) `BellClashScene.updateScoreHud()`; `snapshotScore` combines `score + liveRoundScores` the same way as bamboo-bash. A second bug surfaced only in live-browser verification (Selenium/Firefox, two-account private Bell Clash match): `BellClashScene.currentScoresForRules()` read `this.online.snapshot.score` directly instead of the `snapshotScore` getter, so the getter fix alone had no visible effect until this call site was corrected too — the other two games' equivalent methods already called the getter. Verified live: top score moved 0 → 200 mid-round (shell 2/3, round not yet locked), matching the side panel's running round score. Backend 1481 green (new Bell Clash physics-projection test), frontend build + 413 vitest green.

- DISCONNECT → CPU TAKEOVER (2026-07-21): a plain disconnect (dropped connection/tab close, NOT the "Leave match" quit) never actually handed the seat to a CPU — `convertPlayerToBot` was wired only into the quit flow, so a genuinely absent player just sat there getting every future turn/gambling/shop decision dumbly auto-resolved on the full per-decision timeout (30s turn/30s shop/30s gambling) instead of properly played, unlike minigames (already covered by the existing socket-less CPU v1 stand-in). Per SPEC-023 a lone disconnect must stay reconnectable indefinitely (unlike the permanent "Abandono"/quit) and its architecture explicitly leaves room for a future "IA sustituta" policy — so `TournamentRuntime.handlePlayerDisconnect` now arms a second, longer timer (`DISCONNECT_BOT_TIMEOUT_MS`, 45s, alongside the existing 3s turn/gambling/shop auto-resolve grace): still no reconnect by then converts the player to a CPU through the SAME `convertPlayerToBot` the quit flow uses, so every later turn/gambling/shop decision is actually played at bot pace. Reversible: `handlePlayerConnected` hands control straight back on reconnect (new `lobbyBotPlayerIds` distinguishes real lobby-seeded CPUs, never reverted, from a disconnect-timeout conversion, which is) — a plain disconnect can never turn into a permanent loss of the seat the way quitting does. New runtime specs cover the timeout conversion (proving the bot's next turn resolves via a real roll intent, `autoResolved: false`, not another auto-resolve) and the revert-on-reconnect path. Backend suite 1484 green (2 new), tsc clean, no contract changes. Known related gap (pre-existing, NOT touched here): the SPEC-023 "all players disconnected → cancel after `allDisconnectedMinutes` (10min, catalog value)" watchdog is still unwired — today only an explicit last-quit tears the tournament down; a table where everyone silently vanishes just keeps running all-CPU.

- DISCONNECT-TIMEOUT FALSE POSITIVE DURING A MINIGAME (2026-07-21, same-day follow-up): the DISCONNECT → CPU TAKEOVER fix above regressed gambling — user report "sometimes the after-minigame gamble happens automatically and the player is not prompted". Root cause: launching the round's minigame navigates EVERY board client away to the arena, firing `handlePlayerDisconnect` for all of them as a normal side effect — but real minigames routinely run past the 45s `DISCONNECT_BOT_TIMEOUT_MS` (a played match can easily take 50+ seconds), so by the time it concluded the winner was often already wrongly flagged as a CPU, and `GamblingOpened` silently auto-decided for them instead of showing the prompt. Fix: `handlePlayerDisconnect` now never arms that timer while `currentPhase` is `MINIGAME` or `FINAL_CHALLENGE` (new `isArenaPhase()`) — both route every client through the arena, so a disconnect firing there is never abandonment. A disconnect that started earlier, during `PLAYER_TURNS`/`GAMBLING_PHASE`, is unaffected (its timer was already armed and keeps counting through the minigame, correctly, since that one really was gone before the round even reached the arena). New runtime spec closes a full round through real roll intents, disconnects a player at the exact instant `currentPhase` flips to `MINIGAME`, then advances the clock 90s past the timeout to prove no CPU flag is ever set. Backend suite 1485 green (1 new; verified to fail without the fix).

- MINIGAMES NOW WAIT FOR EVERY PLAYER TO ENTER THE ARENA (2026-07-21, same-day): user reports "CPUs still move during the 3,2,1,GO! countdown" and "minigames have to wait for all the players to enter to start" turned out to be the same root cause. Investigation (background research agent) confirmed: `MatchmakingGateway.startServerInitiatedMatch` (used by tournament minigames, private lobby matches and rematches) force-marks every seat `ready` and flips the room `active` the INSTANT the match is created — no client has navigated to `/play/:gameId` or mounted its Phaser scene yet, and the server previously had zero visibility into when (or whether) that happens; `BOT_START_COUNTDOWN_HOLD_MS` was a flat 5s guess from match-creation time, but its own comment's worst case (3.2s countdown + up to 3s navigation lag = 6.2s) already exceeded it, and the real chain (socket join → `match:status` round trip → `match:rejoin` → Phaser boot) can run longer still. Fix: a genuine per-client arrival signal. Frontend `GamePage.tsx` now emits a new `game:arena-ready {matchId}` right after `createShellSmashGame` mounts (the single choke point for every online match, any of the 4 games, any launch path) — the one place that previously had zero server-side visibility. Backend: `MatchRoom.enteredUserIds` (new `RoomService.markArenaEntered`) tracks it; `MatchmakingGateway` gained the `game:arena-ready` handler. `BotPlayerService.tick()` now only starts the countdown-hold clock (`BOT_START_COUNTDOWN_HOLD_MS`, still 5s) once every REAL (non-bot) seat has entered — bounded by a new `ARENA_ENTRY_TIMEOUT_MS` (20s, matching the platform's other arrival gates) so a client that never loads in can never block the match forever. Private lobby/rematch matches never seat bots at start, so this is a no-op for them; only tournament minigames (the only place bots appear at match start) are affected. New bot-player specs: holds through a real `markArenaEntered` call (proving the countdown floor is measured from actual entry, not match creation) and the 20s backstop (proving a stuck client never blocks the match) — both verified to fail without the fix. Backend suite 1487 green (2 new), frontend 414 vitest green, both tsc clean, prod build green.

- ARENA DIRECT LAUNCH FOR TOURNAMENT MINIGAMES (2026-07-21, same-day follow-up): the fix above closed the "no arrival signal" gap but not the round trip that fed it — user report "sometimes I land on the selecting-queue page and only get into the minigame later, already mid-way, and it doesn't end properly" persisted. Root cause: `TournamentBoardView`'s `tournament:minigame-start` handler already receives the FULL match payload (matchId/side/gameId/tournamentId/snapshot/physicsState — the exact same shape `lobby:matched` carries for a private lobby) but discarded everything except `gameId`, navigating with only `{ autoJoinMatch: true }`. `GamePage` then had to rediscover the match through an indirect round trip (`match:status` → `match:rejoin` → `game:physics-request`) before it could mount the Phaser scene and emit `game:arena-ready` — visible to the player as the online-matchmaking panel (the "selecting queue" page) briefly showing. Any slowness in that chain ate directly into (or, in a bad case, could exceed) the arena's 20s `ARENA_ENTRY_TIMEOUT_MS` backstop, so the CPUs' bot-hold clock could start — and the match visibly progress — before the real player's client had even mounted; a match that a late-joining client only ever saw already finished also explains the "doesn't end properly" report (no live start/end transition to render). Fix: `TournamentBoardView` now carries the full payload through `navigate(...)`'s state (new `tournamentMinigame` field, exported `TournamentMinigameStartPayload` type); `GamePage` launches straight from it the instant it mounts — mirroring the existing `lobby:matched` handling — with the old round trip kept only as a fallback for lost navigation state (e.g. a hard refresh mid-navigation) or a stale payload for a different game. New tests (`TournamentBoardView.test.tsx`, `GamePage.test.tsx`) cover the payload handoff and the direct-launch path, both verified to fail against the pre-fix code (queue page staying visible, payload discarded, `match:rejoin` round trip firing). Frontend build + 417 vitest green, tsc clean on touched files.

- TURN-LESS ONLINE GAMES NOW HIGHLIGHT THE LOCAL PLAYER, NOT A HARDCODED SEAT (2026-07-21, same-day follow-up): user report "the throw counter seems to follow the player's shots for everyone" in a CPU-filled match, then clarified as a general rule — "in games with no turns, the highlighted player should always be the user". Bamboo Bash and Bell Clash are both turn-less online (their engines have no `currentTurn`/turn-gating at all — any seat can act whenever, unlike Kame Knock or Temple Curling, which ARE strictly turn-based and correctly read the real turn off the snapshot), so the HUD's active-player highlight (the underline plus, for Bamboo Bash, each seat's ACTIVE/READY status chip that the user read as a "throw counter") has no real "whose turn" value to show and is supposed to always track the LOCAL viewer's own seat instead. Bell Clash's `currentPlayerIndex()` already did this (`Math.max(0, this.online.side)`); Bamboo Bash's equivalent `getCurrentPlayer()` hardcoded seat `0` for every online match instead — so any viewer not actually seated at 0 (routine in a CPU-filled tournament match) saw the highlight glued to the wrong player forever, regardless of who actually shot, which is exactly what "follows the player's shots for everyone" describes when the human WAS seated at 0. Fix: extracted the correct Bell Clash behaviour into a shared, tested helper (`turnlessOnlineHighlight` in `shared/mechanics/game-rule-hooks.ts`) and pointed Bamboo Bash's `getCurrentPlayer()` at it too, so the two games can't diverge on this again; Bell Clash now calls the same helper (behaviour unchanged, `Math.max(0, side)` → `turnlessOnlineHighlight(side)`). New tests in `game-rule-hooks.test.ts` (both the local-seat-tracking contract and the spectator/-1 clamp). Neither Scene class has (or gained) a unit test — consistent with the rest of the codebase, which never instantiates the four game Scene classes directly and tests only their extracted pure logic instead. Frontend build + 419 vitest green, tsc clean on touched files.

- BELL CLASH "BALLS LEFT" DOTS NOW PER-SEAT (2026-07-21, same-day follow-up #2): the fix above was real but incomplete — user follow-up pinned the actual complaint to "the throw counter/balls left on the scoreboard on top … it still follows the balls left for the user for all CPU scores". That scoreboard is `ScoreHud`'s per-seat dot row (`ballsLeft`/`getRemainingTurns`), which is a DIFFERENT code path from the ACTIVE/READY highlight fixed above and only Bell Clash, Kame Knock and Temple Curling render (Bamboo Bash shows text status chips instead, no dots, so it was never in scope for this one). Root cause, isolated to Bell Clash: `buildTurnDots`'s online branch computed a single `shellIndex` from `this.online.localShot` — the LOCAL viewer's own shots-taken count, read from the per-seat wire array `snapshot.shotCounts[this.side]` — and then repeated that ONE number for every seat's dot count, instead of reading each seat's own entry out of `shotCounts`. So every CPU's remaining-shots dots silently mirrored the human's own remaining shots, exactly as reported; with several CPU seats it looked like all of them were burning shots in lockstep with the human. (Temple Curling's equivalent, `throwsUsedBySide`, was checked and is already correctly per-seat — it derives each seat's count from the shared round-robin rotation math, not from the local viewer; Kame Knock's `buildTurnDots` also already reads the real `online.currentTurn`, not the local seat.) Fix: new shared, tested helper `perSeatShotsRemaining(shotCounts, playerCount, shotsPerRound)` in `shared/mechanics/game-rule-hooks.ts` maps every seat to its own `shotCounts[seat]` entry; Bell Clash's `buildTurnDots` now calls it instead of repeating `shellIndex`. New tests in `game-rule-hooks.test.ts` (mixed per-seat counts resolve independently; missing entries/negative clamps handled). Frontend build + 421 vitest green, tsc clean on touched files.

- ONLINE STATUS TEXT NO LONGER OVERLAPS THE SCOREBOARD (2026-07-21, same-day follow-up #3, all 4 minigames — not tournament-specific, logged here for continuity with the same-day thread above): user report "the text that says which turn it is, the one on top of the screen, is overlapping with the scores". Each online controller creates its own "whose turn"/status text (`createStatusText`) independently of `ScoreHud`, which occupies a fixed-height band at the top of the screen (`BAR_HEIGHT + BALLS_ROW_H + 4` = 74px: main bar + balls-remaining row). Three of the four games (Bell Clash, Temple Curling, Bamboo Bash) hardcoded that text's y at `48` — well inside the 74px band, sitting on top of the score labels/dots — while Kame Knock alone had at some earlier point already been nudged to `78` (clear of the band), with no shared constant tying the two together, so the fix never propagated to the other three. Fix: exported the real HUD height as `SCORE_HUD_HEIGHT` from `shared/mechanics/score-hud.ts`, and pointed all four online controllers' status text at `SCORE_HUD_HEIGHT + 4` (=78, matching Kame Knock's already-correct value) instead of a hand-picked number — so the four games can't drift apart on this again. Pure layout change, no logic/behaviour difference; validated via build + full vitest suite (no dedicated test — Phaser text-object positioning isn't unit-testable in this codebase's existing patterns). Frontend build + 421 vitest green, tsc clean on touched files.

- GAMBLING NO LONGER AUTO-RESOLVES ON A REAL WINNER (2026-07-21, same-day follow-up #4): user report "the gambling for the key item is being automatically done sometimes" — clarified: "for the CPUs that's fine [decideBotGambling already decides instantly for a bot winner, by design], but users should never be taken away options". Root cause: `runMinigamePhase` opened GAMBLING_PHASE (`enterGambling`, starting the 30 s decision timeout, `SPEC-024 gambling.decisionTimeoutMs`) the INSTANT the arena match's lifecycle reported "finished" server-side — with no account for the arena's own 15 s CONTINUE auto-return screen plus the navigation/rejoin back to the tournament board, all of which a real winner has to get through before they can even SEE the Gamble/Pass prompt. If that took long enough (routine — a player reading the end screen, or a slower rejoin), the 30 s window could expire before the prompt ever rendered, silently resolving as a timed-out "abandon" — exactly "the gambling is done automatically" for someone who was never actually shown it. (Distinct from the earlier same-day DISCONNECT-TIMEOUT FALSE POSITIVE fix, which stopped the winner being wrongly FLAGGED as a CPU during this same window — this bug remained even with that fix in place, since GAMBLING_PHASE opened regardless of the flag.) Fix mirrors the existing tie-break audience gate (`TournamentMinigame.awaitTieBreakAudience`, itself covering the identical CONTINUE-screen risk for the roulette): a new `awaitPlayerPresence(winnerId)` in `TournamentRuntime` — resolves immediately for a CPU winner (`botPlayerIds`, unaffected — "for the CPUs that's fine") or an already-connected human, otherwise waits for `handlePlayerConnected` (the board reconnecting) up to a 20 s arrival backstop (`GAMBLING_ARRIVAL_TIMEOUT_MS`, same bound as the tie-break gate, so a winner who never comes back still can't stall the round forever) — called from `runMinigamePhase` before `enterGambling`, so the 30 s decision clock now only starts once the winner is actually back and can see the prompt. New tests: the winner reconnecting opens gambling immediately with no backstop needed (the core fix), a CPU winner opens with no wait at all, and the four existing minigame→gambling tests updated to resolve the new wait explicitly (`advanceGamblingArrival`, riding the backstop — this harness has no live boards to reconnect). Backend suite 1489 green (2 new), tsc clean.

- RANDOM PER-MATCH TURN ORDER + PLAY-ORDER SCOREBOARD, COLOURS UNTOUCHED (2026-07-21, same-day follow-up #5): user request — turn order in turn-based minigames (Temple Curling, Kame Knock) should be random every time a new minigame launches; the top-bar scoreboard should list players in that same play order; but each player's colour must stay their stable tournament colour, "the first player will not always be the blue one" — plus an explicit steer toward the cleanest, least-special-cased implementation that couldn't risk the minigames themselves. Root cause of "the turn system is a bit weird": both engines' turn rotation is a plain `turnNumber % playerCount`/`currentEnd % playerCount`, always starting at seat 0 for a fresh match — since a tournament seat's `side` is fixed for the WHOLE tournament (its colour, everywhere: HUD, trails, replays), the same seat led every single minigame, forever. Design choice (rejected the alternative): reshuffling `side` itself per match would make turn order genuinely random too, but `side` is the ONE identity every colour lookup in the codebase keys off directly — trails, ball/projectile tints, replay rendering, the scoreboard — reassigning it per match would either require re-plumbing a stable colour through every one of those call sites (large, risky, exactly what "least special cases" and "don't break the minigames" ruled out) or ship visibly inconsistent colours (HUD label one colour, the player's own ball flying in another). Instead: `side` is never touched — colours stay 100% consistent automatically, zero new fields needed anywhere in that direction — and only the ROTATION'S STARTING SEAT is randomised. New `BaseEngine.randomStartingTurn(playerCount)` (shared by both engines, matchmaking-layer `Math.random()` — not part of the Tournament's deterministic SPEC-000/028 seed, same convention as `BotPlayerService`) picks it once at `createInitialState`, stored as a new immutable snapshot field `startingTurn`; both engines' rotation formulas offset by it (`(startingTurn + turnNumber) % n` for Kame Knock, `(startingTurn + currentEnd) % n` for Curling's per-end lead) instead of assuming 0 — so a match's play order is a random ROTATION of the seats (e.g. 2,3,0,1) every time, applied uniformly to every match of either game (no tournament-only branching anywhere in the engines). Scoreboard: new optional `TurnState.firstPlayer` (defaults to 0 — a complete no-op for Bell Clash/Bamboo Bash, which have no turn order, and for local play) threaded through the existing shared `GameRuleHooks`/`buildTurnStateFromGameRuleHooks` pipeline every game already uses; `ScoreHud` now renders display slot `i` as seat `firstPlayer + i` (new pure, tested `seatAtDisplaySlot` helper in `turn-manager.ts`) for the underline, score/label/status text, and balls-remaining dots alike — each seat's own colour/score/label travel with it to its new position, never reassigned. New tests: two engine specs pin `Math.random` (a fixed starting seat keeps every OTHER existing assertion in both files unchanged) plus one dedicated test each proving the offset rotation from a non-zero random seat; `seatAtDisplaySlot` unit tests (identity default, and the 2,3,0,1 wrap-around); a `game-rule-hooks` test for the new hook. Backend suite 1491 green (4 new), frontend 424 vitest green (3 new), both tsc clean, prod build green.

Missing for completion:
- Manual 5-player in-browser validation of the full loop (the minigame → CONTINUE → board handoff is now automatic; validate it live).
- Manual in-browser pass of the shop window (land on tile-18, buy/close/timeout, spectator line) — server flow is spec-covered; the panel UI needs a human eyeball.
- F7 presentation remainder (SPEC-039 Phase 7): inventory UI, boss FX, final ranking screen and reconnection overlays. The map board presentation is no longer provisional; the shop window UI shipped 2026-07-19.
- F6 remainder: die-SWAP items (needs ADR) and D11 content for real items/events/shop/boss behaviour; the production map, board route and shop interaction window are now in place.
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
- `backend/src/modules/cards/` (Shell Cards): collectible cosmetic binder, with multiple booster levels (`basic`/`deluxe`/`legendary`, each with its own price and probabilities — see `docs/SHELL_CARDS_SPEC.md` §11). Catalog is 41 cards total (21 power_shell + 5 shrine + 3 shell_skin + 12 character, the character set including `char-pirate` and `char-samurai`, which had shipped in code but were missing from the spec's own card list, and `char-presenter` — Shelly, El Conchudo, the tournament-mode presenter turtle, art at `public/assets/character/presenter-turtle.png`) and includes a "Prismatic" state — a rarer tier than foil, exclusive to gold cards, no changes to the economy (see `docs/SHELL_CARDS_SPEC.md` §12). Reinforces, does not replace, the pending separation between gameplay customization and cosmetic customization. A bug audit (`docs/handoff-shell-cards-bug-audit-and-fix-plan.md`) closed a concurrent-double-spend hole in pack opening (pessimistic row lock), added the missing `user_cards` create-table migration, made per-card increments atomic, surfaced match-completion card drops in all four game scenes (previously granted but never shown), and fixed several medium/low-severity gaps (pack-open error handling, binder-load retry, reveal-overlay focus trap, in-modal coin balance).
- Animated day/night "cycle" hub background alter art extended from night-only to all four alters (`night_cycle_bg`, `sunset_cycle_bg`, `sunrise_cycle_bg`, `login_cycle_bg`), per `docs/day-night-cycle-backgrounds-report.md`. The theme-agnostic time engine (`getDayProgress`/`applyCycleVisuals`, sun/moon arc, sky palette, stars, debug clock slider) is unchanged and now parameterised by `CycleTheme` (`frontend/src/shared/backgrounds.ts`, `frontend/src/pages/HomePage.tsx`). Shipped via the interim route (§7 step 8b): the three new themes reuse the existing static `sunset_bg.png`/`sunrise_bg.png`/`login_bg.png` as a masked foreground (vertical gradient mask hides the baked sky so the animated sky shows through) with a new `--cycle-fg-brightness` variable dimming the baked lighting at night; clouds/moon sprites and in-game/profile/shop previews stay on the theme-neutral night art or parent static PNGs since no per-theme cut-out art exists yet. `cd frontend && npx tsc --noEmit` on the touched files and `npm run test:run` (relevant suites) and `npm run build` all pass; the full project-wide `tsc --noEmit` has unrelated pre-existing baseline failures (`tsconfig.json`'s `ignoreDeprecations` value is rejected by the locally installed TypeScript 5.9.3, plus several unrelated type errors in `ShellPickerScene.ts`, `power-pickups.ts`, etc.) — not introduced by this change.
- Sun/moon occlusion fix (`docs/cycle-sun-moon-occlusion-fix-report.md`): the interim masked-PNG route above initially let the sun/moon render inside scenery (clock tower, torii, pagoda, mountains) because one arc box, tuned for the night art, was reused for every theme, and the mask's wide fade zone left scenery translucent exactly where the arc travels. Fixed with per-theme celestial arc geometry (`CYCLE_ARCS` in `frontend/src/pages/HomePage.tsx`, hand-tuned against the static PNGs at a 16:9 desktop breakpoint; `night` reproduces the pre-existing constants exactly — regression guard), narrower per-theme sun/moon body sizing for `sunrise`/`login`, hard ~3pt mask edges replacing the old wide fade (`frontend/src/styles/modules/hub.css`), and `mix-blend-mode: screen` on the moon for `sunrise`/`login` as a residual-overlap fallback. Also added `scripts/generate-cycle-masks.py` (adaptive-tolerance flood-fill mask generator, Pillow/NumPy/SciPy — see `scripts/requirements-cycle-masks.txt`) to produce real per-pixel cut-out masks instead of the horizontal-band approximation; after inspection this was **accepted for `sunset`** (`public/assets/backgrounds/sunset_cycle_mask.png`) and **rejected for `sunrise`** (eats 2 lanterns near the top-right after 2 tuning passes) and **`login`** (leaks into the grey/green cliff rock at the left edge after 4 tuning passes) — both keep the hard-gradient mask, with `TODO(cycle-masks)` comments in `hub.css` recording why and how to retry. `npm run build`, the relevant `npm run test:run` suites, and a scoped `tsc --noEmit` (project-wide baseline failures noted above are unrelated and unchanged) all pass.

Missing for completion:
- Clearly separate gameplay customization from cosmetic customization.
- Demonstrate stable, playable configuration evaluable by module.
- `TODO(cycle-masks)`: real cut-out masks for the `sunrise` and `login` cycle themes (the scripted flood-fill generator needs different tuning or a hand-authored mask; see `frontend/src/styles/modules/hub.css` and `scripts/generate-cycle-masks.py`).
- Real cut-out `sunset_cycle_part{1,2,3}.png` / `sunrise_cycle_part{1,2,3}.png` / `login_cycle_part{1,2,3}.png` art to replace the masked-static-PNG interim route for the day/night cycle alters (tracked inline as `TODO(day-night-cycle art)` in `frontend/src/styles/modules/hub.css`).

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
- Long local replays now use the API's full 3,000-frame import allowance and,
  when compaction is still required, sample snapshots uniformly across the
  complete match. This removes the early-keyframe bias that left the latter
  half of deliberately long Temple Curling replays without recorded motion.
  Captures exceeding that allowance are marked in their persisted metadata;
  the replay list and viewer display `Replay too long to play`, and the viewer
  does not initialise playback for an incomplete recording.
- The manual gameplay and frame-budget matrix remains outstanding, so Replay
  Mode and Multiplayer 3+ remain `In progress`.
- The frontend performance programme completed its authoritative Phase 1
  baseline on the destination machine on 23 July 2026. Matched development and
  production matrices ran at 1440 x 900 and device pixel ratio 1 in Firefox
  152.0.6 with the recorded software-rendered X11 configuration. The lifecycle,
  React, and Firefox evidence reproduces the principal replay defect: inline
  playback owns one complete replay runtime, expansion owns two, and teardown
  returns every live resource to zero. This completes the performance
  programme's baseline phase but does not change Replay Mode's module status;
  the replay v2 acceptance and manual rendering-budget matrices remain
  outstanding.
- The 23 July destination rendering-budget follow-up added a software-renderer
  Canvas fallback shared by all four live games while hardware-capable browsers
  retain Phaser's automatic WebGL selection. Complete 60-second Firefox profiles
  at 1440 x 900 reduced minor collections by 78.4–89.7% and reduced the combined
  measured application/Renderer/CanvasRenderer occupancy for every game.
  Bamboo Bash reached the aspirational five-collections-per-second target;
  Kame Knock, Temple Curling, and Bell Clash remain above it. A production
  lifecycle matrix preserved one active canvas, zero after every return, input,
  responsive layout, and static visual parity. This advances the outstanding
  rendering-budget matrix but does not complete Replay Mode or browser
  compatibility: replay, persistent-SPA, reduced-motion, Chrome, and TypeScript
  acceptance checks remain open.

Missing for completion:
- Complete and execute the replay v2 acceptance matrix in
  `docs/replay-system-unification-plan.md`.
- Complete the manual one-to-five-player and rendering-budget matrix before
  changing this status to `Done`.

## Maintenance

- 2026-07-22 — Dead-code cleanup (Phases 0–4 of `docs/dead-code-cleanup-plan.md`)
  executed. Removed all five committed `graphify-out/` analyser directories (250
  files, ~8 MB) and added `graphify-out/` to `.gitignore`; deleted four orphaned
  source files (F1–F4, incl. the unused `tournaments/actions/index.ts` barrel),
  three test-only helper + test pairs (T1–T3), nine dead exports plus their
  cascade-orphaned private helpers/constants across `replay-state.helpers.ts`,
  `arena.ts` and `physics.ts` (E1–E3), and 20 confirmed-duplicate/misc image
  assets. No behavioural change; no functional module altered. Character
  portraits and `concept-art/*` were kept (potential roadmap content). Phase 5
  (`hidpi.ts`) is deferred pending a runtime HiDPI sharpness check. Deletions are
  staged, not committed; the owner should run `cd frontend && npm run build &&
  npm run test:run` and `cd backend && npm run test` before committing. See the
  plan's §11 implementation log for the full detail and the two pre-existing
  baseline issues in untouched tournament files.

## Module Boundary Rule
This document, together with `AGENTS.md`, defines the functional boundaries of the project. The agent must not propose, implement, or extend functionality outside these chosen modules except upon explicit user request.
