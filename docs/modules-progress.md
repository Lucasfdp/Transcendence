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

Validation:
- Backend: full Jest suite green (`cd backend && npm run test`) — chat/friends/reports/matchmaking-gateway suites cover every owner action (happy / non-owner 403 / non-group 404 / self-kick 400 / transfer selection / delete cleanup), the presence fan-out (happy / guest short-circuit / non-fatal error), and the Part B fixes.
- Frontend: pure helpers under `frontend/src/features/{chat,social}` have vitest coverage (`isNearBottom`, `patchFriendPresence`, conversation ops). The `HomePage.tsx` UI has no runner and was validated manually per `CLAUDE.md` (two accounts across friend request/accept, DM + gif + unread badges across hub→game→hub, group create/add/kick/rename/leave/delete, block/unblock, presence transitions).

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
- Theme and global styles in `frontend/src/shared/theme.ts` and `frontend/src/styles/global.css`

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
Status: `Not done`

Requirement breakdown:
- Brackets.
- Matchup order.
- Registration and participant management.

Evidence:
- No visible tournament implementation.

Missing for completion:
- Entire module.

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
