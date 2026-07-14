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
Status: `In progress`

Requirement breakdown:
- Update profile.
- Upload avatar with default avatar.
- Friends and online status.
- Profile page.

Evidence:
- Local auth, guest, and OAuth in `backend/src/modules/auth/`
- Editable profile and avatar upload in `backend/src/modules/users/users.controller.ts`
- Friends and online status in `friends` and `presence`
- Profile viewable from `HomePage`

Missing for completion:
- Validate that the profile page and complete avatar flow work well in the UI.
- Confirm consistent default avatar in all cases.
- Still marked as `pending` in `docs/modules.md`, so should not be claimed as closed yet.

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

Missing for completion:
- Should review history coverage for all exposed games.

### Minor: Remote authentication with OAuth 2.0
Status: `Done`

Requirement breakdown:
- Remote OAuth with providers like Google, GitHub, or 42.

Evidence:
- 42 and GitHub flows implemented in `backend/src/modules/auth/`
- OAuth UI in `frontend/src/components/auth/OAuthButtons.tsx`

Missing for completion:
- Multiple frontend buttons do not imply functional backend; claiming this module requires real working providers, but avoid advertising unimplemented providers.

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

Missing for completion:
- Complete the manual two-client validation matrix for Kame Knock, Bell Clash,
  Bamboo Bash, and Shell Curl after the 2026-07-12 recovery from the partial
  server-authoritative experiment. It must cover launch input, full-screen
  resize, settlement, reconnect, spectator entry, and replay capture.

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

Missing for completion:
- Rest of Phase 6 (Shop SPEC-012, item content + effects SPEC-007/019), the Vertical Slice (snapshot-first networking + minimal UI, gated on arena netcode D9), and roadmap phases 4/5/7/8 (minigame/gambling/key-item progression, endgame, full frontend, quality/simulator). See `docs/tournament-implementation-roadmap.md`.

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
Status: `Done`

Requirement breakdown:
- Must be substantial, relevant to the project, and justifiable as a major.

Evidence:
- Replay and event persistence in migrations and entities.
- Replay API in `backend/src/modules/matchmaking/matches.controller.ts`
- Visualization in `frontend/src/pages/HomePage.tsx`

Missing for completion:
- Document final justification also in `README.md` for evaluation.

## Module Boundary Rule
This document, together with `AGENTS.md`, defines the functional boundaries of the project. The agent must not propose, implement, or extend functionality outside these chosen modules except upon explicit user request.
