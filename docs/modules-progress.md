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
Status: `In progress`

Requirement breakdown:
- Basic chat.
- Profile system.
- Friends system with add/remove and list.

Evidence:
- Profiles and updates: `backend/src/modules/users/` (public hover-card view is a whitelist — no PII/balances leaked; see `getUser` in `users.controller.ts`).
- Friends, blocking, and unblocking: `backend/src/modules/friends/` — includes `GET /friends/blocked` + `POST /friends/unblock` and a "Blocked users" section in the Social modal; mutual blocks are representable.
- Online status via sockets: `backend/src/modules/presence/`
- DM and group chat (friends-only, with persistent history, GIF sending via Klipy): `backend/src/modules/chat/`. The chat WebSocket glue in `matchmaking.gateway.ts` (`chat:send` / `chat:send-gif` / `chat:read` handlers, per-conversation room joins on connect, unread-inbox push) was restored in the 2026-07-07 social audit — before that it was absent and chat was non-functional end-to-end. UI in the "Messages" section of the Social modal (`frontend/src/pages/HomePage.tsx`), now with older-message pagination.

Missing for completion:
- Basic chat is functional end-to-end. Group ownership transfer on owner-leave is still not implemented (owner is informational only; empty groups are now cleaned up on last-member-leave). See `docs/social-page-bug-audit-2026-07-07.md` for the full audit and remaining product calls.

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
Status: `In progress`

Requirement breakdown:
- Complete notification system for relevant create, update, and delete actions.

Evidence:
- `backend/src/modules/notifications/`
- Real-time inbox in `frontend/src/pages/HomePage.tsx`
- Persistent friendship notifications.

Missing for completion:
- Covers only part of the social domain.
- No clear coverage of create/update/delete across the system.
- Need to define complete catalog of events and their persistence.

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
Status: `Done`

Requirement breakdown:
- Two remote players.
- Latency, disconnection, and reconnection handling.

Evidence:
- `matchmaking.gateway.ts`, `room.service.ts`, `gameSocket.ts`
- Rejoin, away, abandon, and reconnect timeout implemented.

Missing for completion:
- Fine-tune real multi-team testing before evaluation.

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
- `backend/src/modules/cards/` (Shell Cards): collectible cosmetic binder, with multiple booster levels (`basic`/`deluxe`/`legendary`, each with its own price and probabilities — see `docs/SHELL_CARDS_SPEC.md` §11). Catalog expanded to 37 cards (4 new gold characters) and new "Prismatic" state — a rarer tier than foil, exclusive to gold cards, no changes to the economy (see `docs/SHELL_CARDS_SPEC.md` §12). Reinforces, does not replace, the pending separation between gameplay customization and cosmetic customization.

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
Status: `In progress`

Requirement breakdown:
- Metrics collection.
- Exporters and integrations.
- Custom dashboards.
- Alerts.
- Secure access.

Evidence:
- `monitoring` service in Docker.
- `backend/src/modules/metrics/`
- `backend/src/modules/health/`

Missing for completion:
- Missing evidence of final dashboards and alert rules.
- Monitoring is in place, but it is not yet demonstrated that the entire module is closed.

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
