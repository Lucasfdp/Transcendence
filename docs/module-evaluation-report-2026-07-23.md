# Transcendence Module Evaluation Report

Date: 23 July 2026. Author: automated codebase deep-dive.

## Purpose

This report inventories every ft_transcendence module the project implements,
explains how to demonstrate each one during the evaluation, and gives a personal
rating out of 10 for how well the implementation fits the subject description in
`docs/en.subject.md`. It cross-references the authoritative scope in
`docs/modules-progress.md` against the actual code on disk. Where a module's work
overlaps another module, the overlap is called out explicitly in a dedicated
section at the end.

Scoring reminder from the subject: a major module is worth 2 points, a minor
module is worth 1 point, and a passing project needs at least 14 points (roughly
seven majors). Only fully functional, demonstrable modules count; anything
partial counts as zero at evaluation. The advice is to aim above 14 as a buffer.

## Executive summary

The project is a custom multiplayer turtle-arena platform ("ShellSmash") built
with a React/Vite SPA frontend and a NestJS/TypeORM/PostgreSQL/Redis backend,
fronted by an Nginx reverse proxy with TLS and secured by HashiCorp Vault. It
replaces the canonical Pong game with four original real-time games (Kame Knock,
Bell Clash, Bamboo Bash, Temple Curling/Shell Curl) plus an ambitious board-game
tournament mode.

Fully complete and demonstrable modules already total roughly **21 points**,
comfortably clear of the 14-point pass line. On top of that sit a large band of
"in progress" modules (remote play, multiplayer 3+, tournament, replay, WAF,
spectator, game customisation, design system) that are substantially built and
mostly blocked on manual validation rather than missing code. If even half of
those close, the project lands in the high-20s to low-30s point range.

The single most important evaluation risk is that many of the heaviest majors are
gated on manual, in-browser, multi-client validation that the development
environment cannot run — the code exists and is unit-tested, but the subject
requires a live demonstration. Prioritise rehearsing those live before the defence.

## Module-by-module inventory

Statuses below mirror `docs/modules-progress.md`: `Done` (meets the spec
reasonably), `In progress` (real implementation, validation outstanding),
`Not done` (insufficient to claim).

### Web category

#### Minor — Frontend framework · Status: Done · Points: 1

React with Vite, confirmed in `frontend/package.json`. The whole SPA under
`frontend/src/` is the evidence.

How to demo: open the app, show the Vite dev server / built SPA, point to
`package.json` and the component tree in `frontend/src/`.

Rating: 9/10. It is unambiguously a modern frontend framework used throughout;
the only reason it is not a flat 10 is that the module is trivial by design.

#### Minor — Backend framework · Status: Done · Points: 1

NestJS, confirmed in `backend/package.json`, with 21 feature modules under
`backend/src/modules/`.

How to demo: show `backend/src/app.module.ts` wiring the modules; hit any REST
endpoint; open the generated OpenAPI docs at `/api/docs`.

Rating: 9/10. NestJS is used idiomatically and extensively.

#### Major — Real-time features using WebSockets · Status: Done · Points: 2

Socket.IO gateway in `backend/src/modules/matchmaking/matchmaking.gateway.ts`
and the client in `frontend/src/services/network/gameSocket.ts`. Handles game
events, queue, lobby, presence, chat, reconnection and shared state, with
connection/disconnection handling and broadcasting.

How to demo: open two browsers, join a queue, show a live match syncing in real
time; drop and reconnect one client to show reconnection; show presence flipping
online/in-game on a friend's list.

Rating: 9/10. This is the backbone of the whole platform and is genuinely
real-time and resilient. Docs flag remaining edge-case network-failure testing.

#### Major — Users can interact with other users · Status: Done · Points: 2

Profiles (`backend/src/modules/users/`), friends with add/remove/list plus
blocking/unblocking (`backend/src/modules/friends/`), live presence
(`backend/src/modules/presence/`), and DM + friends-only group chat with
persistent history and GIF sending via Klipy (`backend/src/modules/chat/`). The
Social modal in `frontend/src/pages/HomePage.tsx` is a two-pane layout with
Friends/Chats/Requests tabs, group ownership/member management, and mini shell
portraits with presence dots.

How to demo: with two accounts, send/accept a friend request, open a DM, send a
message and a GIF, create a group and add/kick/rename, block/unblock a user, and
show presence transitions live.

Rating: 8.5/10. Very complete — arguably over-delivers versus the minimal spec
(basic chat + profile + friends). The one caveat is that the 2026-07-17 social
redesign + GIF fix still needs a fresh manual pass on the user's machine.

#### Major — Public API for database interaction · Status: Done · Points: 2

Dedicated module `backend/src/modules/public-api/` protected by `X-API-Key`,
with documented endpoints covering GET/POST/PUT/DELETE
(`GET /api/public/users`, `GET /api/public/users/:username`,
`POST /api/public/users/query`, `PUT /api/public/users/:username`,
`DELETE /api/public/users/:username/avatar`), Redis-backed shared rate limiting
(`auth/redis-rate-limiter.service.ts`), OpenAPI docs via Scalar, and consumption
examples in `docs/public-api.md`. `make validate-openapi` enforces the contract.

How to demo: run the curl examples from `docs/public-api.md` for each verb; show
a 401 without the key and a 429 when rate-limited; open `/api/docs`.

Rating: 8.5/10. Ticks every explicit requirement (key, rate limit, docs, 5+
endpoints, all four verbs). Minor blemish: legacy `auth`/`casino` buckets still
use an in-memory limiter rather than the shared Redis one.

#### Minor — ORM for the database · Status: Done · Points: 1

TypeORM configured in `backend/src/app.module.ts` with entities and migrations
distributed across modules (`backend/src/migrations/`).

How to demo: show entity classes, a migration file, and a live query path.

Rating: 9/10. Standard, correct, pervasive.

#### Minor — Notification system (create/update/delete) · Status: Done · Points: 1

`backend/src/modules/notifications/` with REST (`GET /api/notifications`,
read/read-all) plus live WebSocket push. Event catalogue in
`docs/notifications.md` covers create (`friend_request`), update
(`friend_accepted`), delete (`friend_removed`), plus lobby invites and a chat
unread digest.

How to demo: trigger a friend request (create), accept it (update), remove a
friend (delete); show the bell badge updating live and across tabs.

Rating: 7.5/10. Solid create/update/delete coverage. Two deliberate gaps:
`achievement_unlocked` is not wired to a notification producer, and there is no
standalone history view (inbox is unread-only by design).

#### Minor — Server-Side Rendering · Status: Not done · Points: 0

Pure Vite SPA; no Next/Nuxt/SvelteKit or SSR pipeline. Not claimed.

Rating: n/a (not attempted).

#### Minor — Progressive Web App · Status: Not done · Points: 0

No manifest, service worker or PWA plugin. Not claimed.

Rating: n/a.

#### Minor — Custom design system (10+ components) · Status: In progress · Points: 0 (1 if closed)

Reusable components in `frontend/src/components/` (e.g. `StoneButton`,
`NineSliceButton`, `GameConfirmModal`, `RouteLoading`, `WorkInProgressModal`),
theme primitives in `frontend/src/shared/theme.ts`, Tailwind config, and
feature-scoped style modules under `frontend/src/styles/modules/`.

How to demo: this is the weak spot — you must present a formal inventory of at
least 10 reusable components with palette, typography and iconography, and show
them reused across screens. That inventory does not yet exist.

Rating: 5/10 as it stands. The raw material is there and a genuine design system
is emerging, but the module is failable at evaluation until you produce and
demonstrate the explicit 10-component catalogue with systematic reuse. This is
low-effort, high-value work to close before the defence.

#### Minor — Support additional browsers · Status: Not done · Points: 0

No compatibility matrix or documented cross-browser testing. Not claimed.

Rating: n/a.

### User Management category

#### Major — Standard user management and authentication · Status: Done · Points: 2

Local auth, guest and OAuth in `backend/src/modules/auth/`; unique-email
registration, login by email or username; editable profile and avatar upload
(with default) in `backend/src/modules/users/users.controller.ts`, served via
`/api/uploads/`; a reusable Shell Portrait default; friends + online status;
protected public profile route `/profile/:username`. Full acceptance evidence in
`docs/user-management-acceptance.md` (368 frontend tests, 878 backend tests, two
production builds, two-account Firefox matrix, persistence across `make re`).

How to demo: register, log in with email then username, edit profile, upload and
remove an avatar (show default fallback), view your and another user's public
profile, show online status.

Rating: 9/10. Comprehensive and well-evidenced; one of the strongest modules.

#### Minor — Game statistics and match history · Status: Done · Points: 1

`backend/src/modules/game-results/`, `backend/src/modules/leaderboard/`,
`backend/src/modules/achievements/`, plus match history and replays via
`matchmaking/replay.service.ts`. Wins/losses/level/ranking, dated history with
opponents and results, 41-achievement catalogue, and multiple leaderboards
(per-game, total, tournaments) with Elo, bot/dev exclusion and tie-breaks.

How to demo: play a match, then show the updated stats, the dated history entry
with the opponent, an unlocked achievement, and your position on the Rankings
modal's several tabs.

Rating: 8.5/10. Rich and battle-tested (several 2026-07 rankings audits). Docs
note history coverage across all exposed games should be reviewed once more.

#### Minor — Remote authentication with OAuth 2.0 · Status: Done · Points: 1

Google and 42 flows in `backend/src/modules/auth/` with single-use expiring
state in Redis, link/unlink from Profile independent of email matching, UI in
`frontend/src/components/auth/OAuthButtons.tsx`.

How to demo: sign in with Google and with 42; link and unlink each from the
Profile account-links panel.

Rating: 8/10. Two providers, correctly stateful. The only caveat is that a
clean end-to-end demo needs real provider credentials configured on the day.

### Cybersecurity category

#### Major — Hardened WAF/ModSecurity + HashiCorp Vault · Status: In progress · Points: 0 (2 if closed)

Vault plus per-service Vault agents are fully wired in `docker-compose.yml`
(`backend_vault_agent`, `database_vault_agent`, `redis_vault_agent`,
`monitoring_vault_agent`) with bootstrap in the `Makefile` and `scripts/`.
Crucially — and more than the doc's "in progress" status implies — ModSecurity
**is** actually installed: `infra/reverse-proxy/Dockerfile` pulls in
`libnginx-mod-http-modsecurity` and `modsecurity-crs` (the OWASP Core Rule Set),
and `infra/reverse-proxy/tools/entrypoint.sh` includes `modsecurity.conf`,
`crs-setup.conf` and `crs/rules/*.conf`.

How to demo: `make vault-status` and show a rendered secret; then send an obvious
attack request (e.g. an SQL-injection or XSS pattern in a query string) through
the proxy and show ModSecurity blocking it with a 403 in the logs.

Rating: 6.5/10. Both halves exist in the codebase, which is better than the
scope doc suggests. The gap is demonstrability and hardening: you need to prove
the WAF is in blocking (not just detection) mode with tuned CRS rules, and show
Vault as the live secret source end-to-end. This is a claimable major with a
short amount of finishing and rehearsal — treat it as a priority.

### Gaming and User Experience category

#### Major — Web-based game where users play each other · Status: Done · Points: 2

Four original games with engines in
`backend/src/modules/matchmaking/engines/` (kame-knock, bell-clash, bamboo-bash,
shell-curl) and clients under `frontend/src/games/`. Live matches, clear rules,
win/loss conditions, results persisted via `game-results`.

How to demo: pick a game from the hub, play a full live match against another
account, show the win/loss result and rewards.

Rating: 9/10. A complete, playable, original game platform — the mandatory core
is firmly met and then some.

#### Major — Remote players · Status: In progress · Points: 0 (2 if closed)

Server-authoritative netcode in `matchmaking.gateway.ts`, `room.service.ts`,
`gameSocket.ts`: fixed-step source-space simulation, 20–30 Hz physics
projection, backend collisions/scoring, snapshot interpolation, reconnect and
spectator projection, rejoin/away/abandon handling, per-user input rate limiting.
The 2026-07-20 audit (`docs/remote-multiplayer-modules-audit-2026-07-20.md`) was
remediated with regression tests (seat-hijack guard, room eviction, bounded
replay buffer, rate limiting).

How to demo: two remote clients in one match; introduce latency; disconnect and
reconnect one; show the match continuing correctly with authoritative state.

Rating: 7.5/10 on engineering, but scored 0 until the manual two-client Firefox
matrix (including live re-entry across all four games, especially the remaining
Temple Curling follow-up items) is completed. The code is strong; the blocker is
live validation.

#### Major — Multiplayer with more than two players · Status: In progress · Points: 0 (2 if closed)

3–5 simultaneous players supported; a dedicated integration spec
(`matchmaking/nplayer-integration.spec.ts`) drives a full five-seat match through
the real engines and `RoomService` to a settled winner with per-side scoring,
turn rotation, mid-match disconnect/rejoin, and a live spectator join. Fairness
gaps (hammer rotation, power ownership, pairwise Elo, abandon handling) were
fixed with tests.

How to demo: start a 3–5 player lobby, play to completion, show fair scoring and
correct synchronisation; disconnect a middle seat and show a CPU stand-in
continuing.

Rating: 7.5/10 engineering; 0 until the manual multi-seat Firefox UX matrix
(turn banner order, HUD score columns, spectator entry, responsive relayout) is
run. Rating-banded matchmaking for ranked 3–5 lobbies is a documented
out-of-scope limitation.

#### Major — Add another game with history and matchmaking · Status: Done · Points: 2

Beyond the base game there are three further distinct games (bell-clash,
bamboo-bash, shell-curl), each with history/statistics and multi-game
matchmaking via `matchmaking/engines/` and the shared queue.

How to demo: from the hub, matchmake into a second distinct game, play it, and
show its separate history and stats.

Rating: 9/10. The requirement is one extra game; the project ships three, all
integrated into the same matchmaking and stats rails.

#### Minor — Tournament system · Status: In progress · Points: 0 (1 if closed)

By far the largest single body of work: a full board-game tournament mode ("The
Parrot's Shell") specified across 41 frozen SPEC documents (`SPEC/`) and
implemented in `backend/src/modules/tournaments/` with entities
(tournaments/participants/matches), a 15-phase state machine, per-tournament
deterministic engines (economy, rules, leaderboard, actions, inventory, rewards),
board/dice/turn systems, random events, steal, shop, key-item progression,
minigame integration (reusing the four arena games), a provably-fair gambling
phase, boss and final-challenge endgame, CPU players (stand-ins and lobby
participants), a real 28-step map board, five-player support, and a dedicated
`/tournament/:id` page. Registration, participant management and visible matchup
order all exist at the lobby level.

How to demo: create a lobby, invite/join by PIN, fill empty seats with CPUs,
start; play a round of board turns → minigame → gambling → key items → boss →
final sudden-death → champion, showing the bracket/turn order throughout.

Rating: 8/10 on ambition and depth — this vastly exceeds what a "minor" tournament
module requires (brackets, matchup order, registration). Scored 0 until the manual
5-player in-browser validation of the full loop is run. Two framing points worth
raising at the defence: (1) it is categorised internally as a minor but is by far
the project's largest feature; (2) some F7 presentation polish (inventory UI, boss
FX, final-ranking screen, reconnection overlays) remains.

#### Minor — Game customisation options · Status: In progress · Points: 0 (1 if closed)

Powers/mechanics in `frontend/src/shared/mechanics/`, cosmetics in
`backend/src/modules/customization/`, and a Shell Cards collectible system
(`backend/src/modules/cards/`, 41-card catalogue, three booster tiers, Prismatic
state) with an animated day/night hub background. Default options exist.

How to demo: show power selection in a game, equip a shell skin/trail, open a
card booster, switch a hub background theme.

Rating: 6/10. Plenty of customisation content ships. The blockers are conceptual,
not missing code: the module needs a clear separation of gameplay customisation
from cosmetic customisation, and a stable, per-module-evaluable playable config.
Some cut-out mask art (sunrise/login cycle themes) is also still `TODO`.

#### Minor — Gamification system · Status: Done · Points: 1

Achievements, leaderboards, and XP/levels with persistence and visual feedback
(hub player-card XP bar, detailed profile progress, achievement popups) — three+
of the required mechanics, well over the "at least 3" bar.

How to demo: earn XP from a match and show the bar move, unlock an achievement
with its popup, and show leaderboard movement.

Rating: 8/10. Comfortably meets the requirement; overlaps heavily with match
history (see overlaps section).

#### Minor — Spectator mode · Status: In progress · Points: 0 (1 if closed)

Spectator entities and projection paths in `matchmaking`/`room.service.ts` and
the frontend scenes; spectators are used in the tournament and multiplayer specs.

How to demo: with a match live, join it as a spectator from the UI and show
real-time updates without being able to affect play.

Rating: 6/10. The plumbing exists and is exercised by automated N-player tests,
but the UI entry flow and observer-mode stability need a validated end-to-end
demonstration before it can be claimed.

### DevOps category

#### Major — Monitoring with Prometheus and Grafana · Status: Done · Points: 2

`backend/src/modules/metrics/` (prom-client + default Node metrics) scraped by
Prometheus; `postgres_exporter` and `redis_exporter` services; three baked-in
Grafana dashboards; nine file-provisioned alert rules; secure access only via
`https://localhost:42424/monitoring/` with Vault-sourced admin credentials and
anonymous access disabled. Defects D1–D11 fixed; 24 metrics/health tests.

How to demo: open the Grafana subpath, show the three dashboards with live data,
show the alert rules, and show that direct/anonymous access is refused.

Rating: 8.5/10. Hits every requirement (collection, exporters, dashboards,
alerts, secure access). Alert thresholds should be tuned against real traffic
before the demo.

### Modules of Choice

#### Major — Replay mode · Status: In progress · Points: 0 (2 if closed)

Replay/event persistence (migrations + `replay-contract-v2` migration), replay
API in `matchmaking/matches.controller.ts`, and a shared contract/encoder/capture
runtime/controller/viewer in `frontend/src/games/common/replay/` with a shared
`ReplayScene.ts` renderer used by all four games. Extensive automated coverage
(keyframes, deltas, reconstruction, seeking, trail continuity). Power-up matches
are excluded at every boundary.

How to demo: play a (non-power-up) match, open its replay from history, scrub the
timeline, and show it reproducing the real game with correct cosmetics.

Rating: 7.5/10 engineering; 0 until the replay v2 acceptance matrix and the
manual 1–5 player + rendering-budget matrix are executed. A well-justified major
(substantial, project-relevant) once validated.

## Point tally

Fully `Done` and demonstrable today:

- Web: frontend (1) + backend (1) + WebSockets (2) + user interaction (2) +
  public API (2) + ORM (1) + notifications (1) = 10
- User Management: user management/auth (2) + game stats (1) + OAuth (1) = 4
- Gaming: web game (2) + add another game (2) + gamification (1) = 5
- DevOps: monitoring (2) = 2

Subtotal `Done`: **21 points** — already past the 14-point pass line.

`In progress`, code substantially present, blocked mostly on manual validation
(potential additional points if closed): remote players (2), multiplayer 3+ (2),
replay mode (2), WAF + Vault (2), tournament (1), game customisation (1),
spectator (1), design system (1) = **up to 12 more points**.

Realistic ceiling if the in-progress band is validated: low-30s. Even a
conservative outcome (only WAF, remote players and replay closed) reaches ~27.

## Overlaps between modules

The subject explicitly allows gaming modules to build on the base game and lets
Advanced chat build on basic chat, so overlap is expected — but at evaluation you
must be able to point to distinct, independently demonstrable value for each
claimed module. The significant overlaps here:

Real-time WebSockets is the shared substrate for remote players, multiplayer 3+,
spectator mode, live chat, presence and live notifications. All of these ride the
same Socket.IO gateway (`matchmaking.gateway.ts`). When demoing, be ready to show
that each is a separate capability, not the same feature counted repeatedly — the
WebSocket module is the transport, the others are features built on it.

User interaction (Major) and Standard user management (Major) both include the
friends system and online status, and both touch profiles. The friends/presence
code (`friends/`, `presence/`) and the profile code (`users/`) are shared. Draw
the line clearly: user management = auth + profile + avatar + friends CRUD; user
interaction = chat (DM/group/GIF) + the social experience on top.

Game statistics/match history (Minor), Gamification (Minor) and Replay (Major)
all read from the same match-result substrate. Leaderboards and achievements
appear in both stats and gamification; replays are the recorded form of the same
matches counted in history. Present stats as the data/records, gamification as
the progression/reward layer, and replay as the playback system — three distinct
surfaces over one match-result core.

Tournament (Minor) is a composite that reuses Remote players, Multiplayer 3+,
Add another game and the matchmaking rail: its round minigames are literally the
four arena games launched through `MatchFactoryService`/the matchmaking gateway.
It also embeds a gambling phase reusing the casino's provably-fair primitives and
CPU players reusing the matchmaking bot driver. This is the biggest cross-module
dependency in the project — flag it as a strength (deep integration) but be ready
to demo the tournament's own board/turn/economy logic as distinct from the arena
games it launches.

Game customisation (Minor) overlaps Gamification and the card/cosmetic economy
(`cards/`, `customization/`, `shells/`): shell skins, trails and cards are both
customisation content and gamification rewards, sharing the coin economy. Keep
customisation = configurable gameplay/appearance options; gamification = the
earn/progress loop.

Public API (Major) overlaps User management by exposing user CRUD over
`X-API-Key`; the WAF + Vault module's Vault half underpins every service's
secrets (database, redis, backend, monitoring), so it implicitly touches
monitoring's secure access too. Monitoring instruments the matchmaking module
(tick-duration histogram, active-rooms and replay-buffer gauges), so its custom
metrics overlap the remote-play/tournament code they measure.

OAuth (Minor) is a sub-capability of the auth module that also powers Standard
user management — demo it as the remote-authentication path, separate from local
auth.

## Recommendations before the evaluation

The fastest points-per-effort wins are: (1) produce the formal 10-component
design-system inventory — the code exists, only the catalogue is missing; (2)
rehearse and document the WAF blocking demo and Vault secret flow, since both are
already installed; (3) run the manual multi-client Firefox matrices that gate
remote players, multiplayer 3+, replay and the tournament — these are the highest
point values and are blocked on demonstration, not development. Everything marked
`Done` above should be rehearsed end-to-end at least once on the real stack via
`make dev`/`make up`, because the subject counts only what is demonstrated live.
