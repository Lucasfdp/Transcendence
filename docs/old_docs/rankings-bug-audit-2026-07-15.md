# Rankings Bug Audit — 2026-07-15

Handoff document for the agent that will fix the rankings/leaderboard feature.
Everything below was verified against the code at HEAD (`bb784d78` merge, plus
`b8012a28`) on 2026-07-15. File paths are repo-relative; line numbers are from
the current working tree.

## 1. Scope and architecture map

The rankings feature ("Rankings" modal in the hub) consists of:

| Layer | File | Role |
|---|---|---|
| Backend | `backend/src/modules/leaderboard/leaderboard.service.ts` | Two queries: per-game ELO board (from `user_ratings`) and overall total-wins board (from `user_game_stats`) |
| Backend | `backend/src/modules/leaderboard/leaderboard.controller.ts` | `GET /leaderboard?gameId=&scope=` and `GET /leaderboard/overall?scope=` (JWT-guarded) |
| Backend | `backend/src/modules/leaderboard/leaderboard.module.ts` | Wires `UserRating`, `UserGameStats`, `FriendsModule` |
| Backend (data writers) | `backend/src/modules/matchmaking/game-session.service.ts` | Writes `user_ratings` via `applyEloRatings()` (ranked online matches only) and `user_game_stats` via `GameResultsService.submitResult()` (all non-abandoned online matches) |
| Backend (data writers) | `backend/src/modules/game-results/game-results.service.ts` + `game-results.controller.ts` | `POST /game-results` — client-reported results from local play; writes `user_game_stats` + XP/level (level is displayed on both boards) |
| Entities | `backend/src/modules/matchmaking/entities/user-rating.entity.ts`, `backend/src/modules/game-results/entities/user-game-stats.entity.ts` | Rating and stats rows |
| Frontend | `frontend/src/features/hub/api.ts` (lines ~243–266, 415–423, 797–821) | Types, `RANKED_GAMES` list, `getGameLeaderboard` / `getOverallLeaderboard` |
| Frontend | `frontend/src/pages/HomePage.tsx` (lines ~593–600, 803–826, 3173–3253) | State, fetch effect, Rankings modal UI |
| Tests | `backend/src/modules/leaderboard/leaderboard.service.spec.ts` | Service-level tests with fully mocked repos. No controller spec, no e2e |

Data flow:

- **Per-game ELO board**: only ranked online matches write ratings.
  `persistFinishedRoom()` → `applyEloRatings()` when `room.mode === "ranked"
  && winnerSide !== null` (game-session.service.ts:199–201). Guests are
  blocked from ranked queue (matchmaking.service.ts:50), private lobbies are
  always `casual` (private-lobbies.service.ts:306).
- **Overall board**: `SUM(user_game_stats.totalWins)` per user. Rows are
  written by (a) the server for online matches (game-session.service.ts:187)
  and (b) the client via `POST /game-results` for local play
  (each game scene calls `api.submitGameResult(gameId, "completed"|...)`).

## 2. Drift since the leaderboard was written (context for the fixes)

The leaderboard module was created in one commit, `22c1f8a8` (2026-06-27,
"Adding notifications, leaderboards and social stuff") and **never touched
since**. 107 commits have landed on top of it. Relevant drift, all verified:

- **Server-authoritative rewrite** (`c426caad`, `dca41739`, etc.): online
  match results and Elo are now written server-side in a transaction in
  `game-session.service.ts`. The old client-trusted `POST /game-results`
  path still exists in parallel for local play — see finding H2.
- **Replay v2** (`a49a58c3`, `bb784d78`): `persistFinishedRoom()` now
  persists a replay *after* the rewards transaction and only then sets
  `room.rewardsGranted` — see finding M4.
- **22 new migrations** were added since 2026-06-14 (chat, cards, wagers,
  replays, reports, google oauth…) but **none for `user_ratings`** — see
  finding H1.
- **Game IDs are stable**: engine IDs (`temple-curling`, `bamboo-bash`,
  `kame-knock`, `bell-clash` in `engines/*.engine.ts`) exactly match the
  frontend `RANKED_GAMES` list in `hub/api.ts:416–421`. No orphaned-rating
  rename risk. (`"shell-curl"` survives only in a stale controller doc
  comment and in the service spec — see L3.)
- **Friends rework** (`815fe568` etc., +408 lines): `getFriendIds()` still
  exists with the same contract (friends.service.ts:630–646). Leaderboard's
  friends scope is unaffected.
- `User` entity still has every column the leaderboard selects (`username`,
  `avatar`, `level`, `turtleName`, `isGuest`). It gained `isDevAccount` —
  see L4.

## 3. Findings

Severity: **H** = will visibly break/corrupt rankings in front of users,
**M** = broken edge case or wrong data users can hit, **L** = hardening/polish.

### H1 — `user_ratings` has no migration and no unique constraint

- `backend/src/modules/matchmaking/entities/user-rating.entity.ts` is the
  only place `user_ratings` is mentioned; `grep -rn "user_ratings"
  backend/src/migrations/` returns nothing.
- `app.module.ts:50` runs `synchronize: true` only when
  `NODE_ENV !== "production"`. A production database built from migrations
  alone has **no `user_ratings` table**, so `GET /leaderboard` (and every
  ranked match finish, which writes ratings) throws → all four per-game
  tabs 500 in prod (surfaced to the user as a permanent "No rankings yet.",
  see M2).
- The entity also lacks `@Unique(["userId", "gameId"])`. `user_game_stats`
  got exactly this constraint in its migration
  (`20260615000000-add-game-stats-achievement-progress.ts`,
  `UNIQUE ("userId","gameId")`), but ratings did not. `applyEloRatings()`
  does find-or-create (game-session.service.ts:229–237) with no lock, so a
  double-persist race (see M4) can insert duplicate rating rows → the same
  user appears twice on the board, and the frontend renders duplicate React
  keys (`key={entry.userId}`, HomePage.tsx:3236).

**Fix**: add a migration that creates `user_ratings` (idempotent,
`CREATE TABLE IF NOT EXISTS`, quoted camelCase columns — follow the pattern
and the schema-drift warnings documented in
`20260618000000-create-friendships.ts`), including
`UNIQUE ("userId","gameId")`, plus a de-dup step before adding the constraint
(keep the row with the most games: `wins+losses+draws`). Add
`@Unique(["userId","gameId"])` to the entity so `synchronize` matches.

### H2 — Overall leaderboard is trivially forgeable by any logged-in user

- `POST /game-results` (game-results.controller.ts:36–60) accepts any
  `{ gameId: string, outcome: "win"|"loss"|"draw"|"completed" }` from the
  client — `gameId` is only `@IsString()` (submit-result.dto.ts:7–8), never
  checked against the known game list, and nothing verifies a match actually
  happened.
- `updateGameStats()` increments `totalWins` on `outcome === "win"`
  (game-results.service.ts:211), and the overall board ranks by
  `SUM(ugs.totalWins)` (leaderboard.service.ts:132). One authenticated user
  with a loop of `fetch("/api/game-results", …{gameId:"kame-knock",
  outcome:"win"})` tops the global board, and also farms XP → the `level`
  column shown on both boards.
- Note the legit local-play flow only ever submits `"completed"` now (all
  four scenes, e.g. KameKnockScene.ts:920), which does **not** increment
  `totalWins`. So the *only* legitimate writers of wins are server-side
  online matches — the endpoint's win/loss/draw outcomes are pure attack
  surface today.

**Fix options (pick with the user)**:
1. Restrict the DTO: validate `gameId` against the engine registry IDs +
   local scene IDs, and only accept `outcome: "completed"` from clients
   (server writes win/loss/draw itself). Rate-limit per user.
2. Or make the overall board rank from server-written data only (e.g. a
   ranked/online-only wins column), leaving local play out of rankings.

Either way, keep the current server path in
`game-session.service.ts:182–196` untouched — it already bypasses HTTP and
calls `gameResultsService.submitResult()` directly.

### M1 — `GET /leaderboard` without `gameId` → 500 instead of 400

`gameId` has no validation (leaderboard.controller.ts:35). With `gameId`
undefined, the query builder binds an undefined parameter
(leaderboard.service.ts:70) → TypeORM throws → the blanket catch rethrows
as 500 "Failed to fetch game leaderboard". Should be a 400. Arbitrary
unknown `gameId` strings silently return `[]` (acceptable, but validating
against the known ranked IDs would be cleaner and would future-proof the
frontend/backend list drift).

**Fix**: a small DTO/`@IsIn([...])` or a manual check that returns
`BadRequestException` when `gameId` is missing; optionally validate against
a shared ranked-games constant (single source of truth the frontend list can
mirror — today the list is duplicated in `hub/api.ts:416`).

### M2 — Frontend swallows errors: failure renders as "No rankings yet."

HomePage.tsx:817–818 catches fetch errors with `console.warn` only. On first
load failure the list state stays `[]`, so the modal shows the empty-state
copy "No rankings yet." — indistinguishable from a healthy empty board (this
is exactly what prod users would see under H1). On a later failure (e.g.
switching scope), the *previous* game/scope's rows remain on screen labelled
as the new selection.

**Fix**: add a `leaderboardError` state; show a retry-able error message
distinct from the empty state; clear the stale list when the selected
game/scope changes before fetching.

### M3 — Ranked draws are dropped entirely; `draws` is dead data

`persistFinishedRoom()` only calls `applyEloRatings()` when
`winnerSide !== null` (game-session.service.ts:199), and `applyEloRatings`
itself only ever increments `wins`/`losses` (lines 266–267). `grep` confirms
nothing in the backend ever writes `draws`. So for a ranked draw: no rating
adjustment (defensible) **and** no `draws` increment (data loss) — the
`draws` column, the API field, and the `GameLeaderboardEntry.draws` type are
permanently 0.

**Fix**: either handle draws in ranked persistence (increment `draws` for
all players; optionally apply Elo with score 0.5, which the existing
formula at line 252 supports naturally), or delete the column/field from
entity + service + frontend types so it doesn't mislead the next reader.

### M4 — Reward/Elo idempotency is fragile: in-memory flag set after external side effects

`persistFinishedRoom()` (game-session.service.ts:134–220):
- The guard is `if (room.rewardsGranted) return;` — an **in-memory** flag,
  checked non-atomically and set at line 204 only *after* the DB transaction
  **and** `replayService.persistReplayForRoom()` both succeed.
- `roomService.finish()` (room.service.ts:222–239) is not idempotent — it
  never checks the room's current status — and the finish path in
  game-session.service.ts:99–103 has a `?? room` fallback that re-runs
  persistence with the same room object.
- Consequence: if replay persistence throws after the rewards transaction
  committed, `rewardsGranted` stays false and any re-entry into the finish/
  abandon path (double disconnect, gateway retry) re-runs the whole
  transaction: Elo delta applied twice, XP/coins granted twice,
  `gamesPlayed`/`totalWins` double-counted — directly corrupting both
  boards. The window is narrow (callers at matchmaking.gateway.ts:663 and
  1149 check `room.status` first) but real, and it's exactly the ordering
  the replay-v2 work introduced after the leaderboard was written.

**Fix**: make idempotency durable and early — inside the transaction, guard
on the match row's status (`UPDATE matches … WHERE status = 'active'
RETURNING`, skip rewards if 0 rows), and/or set `rewardsGranted = true`
immediately after the transaction commits, before replay persistence (a
lost replay must not risk double rewards).

### M5 — No tie-breaker in either ranking query

`ORDER BY ur.rating DESC` / `ORDER BY "totalWins" DESC` only
(leaderboard.service.ts:72, 140). Tied players get nondeterministic relative
order that can flip between refreshes, and the `LIMIT 100` cutoff among a
tie at position 100 is arbitrary.

**Fix**: add stable secondary ordering, e.g. `.addOrderBy("ur.wins", "DESC")
.addOrderBy("u.username", "ASC")` (and `u.level DESC, u.username ASC` for
overall).

### M6 — Players outside the top 10 can never see their own rank

The API returns up to 100 rows; the frontend keeps 10
(HomePage.tsx:812, 815) and renders only those. There is no "my rank"
affordance anywhere and the backend has no way to ask for it.

**Fix (product-level, confirm with user)**: either render the full 100 in a
scrollable list with the caller's row pinned/highlighted (data is already
fetched — today 90% of the payload is thrown away), or add a lightweight
"your rank" computation to the service (`COUNT(*) WHERE rating > mine + 1`).

### L1 — Rankings data is fetched at HomePage mount, not when the modal opens

The effect at HomePage.tsx:804–826 runs on mount and on tab/scope change
only. Opening the Rankings modal never refetches, so a user who keeps the
hub open sees standings from mount time. Also the mount fetch is wasted work
for users who never open the modal.

**Fix**: gate the effect on `activeModal === "rankings"` (add it to the
dependency list) so opening the modal always fetches fresh data.

### L2 — Blanket `catch` in `LeaderboardService` hides root causes and never logs

Both methods wrap everything in try/catch and rethrow a generic
`InternalServerErrorException` (leaderboard.service.ts:106–111, 167–172)
without logging the original error. Under H1, prod logs would show only
"Failed to fetch game leaderboard" with no hint the table is missing.

**Fix**: add a `Logger` and log `err` before rethrowing (pattern already
used in game-session.service.ts:213).

### L3 — Stale `shell-curl` references in docs/tests

- leaderboard.controller.ts:25 doc comment: `gameId=shell-curl` — not a real
  game ID (engines use `temple-curling`).
- leaderboard.service.spec.ts uses `"shell-curl"` throughout — harmless
  because repos are mocked, which itself shows the spec never exercises
  gameId validation (there is none — see M1). When fixing M1, add spec cases
  for missing/unknown gameId (expect 400 / `[]`), and a controller spec.

### L4 — Dev accounts are not excluded from public boards

Queries filter `u.isGuest = false` only (leaderboard.service.ts:71, 134).
`users.isDevAccount` exists (user.entity.ts:95); dev/test accounts with
inflated stats will appear on the global board. Decide with the user whether
`AND u.isDevAccount = false` should be added.

### L5 — `applyEloRatings` divides by zero for a 1-player room

game-session.service.ts:255–258: `opponentRatings.length === 0` → NaN
propagates into `rating.rating` and is saved. Unreachable today
(`MIN_PLAYERS = 2` in matchmaking.service.ts) but a one-line guard
(`if (opponentRatings.length === 0) continue;`) makes it safe against
future solo/practice modes.

### L6 — Elo read-modify-write has no row lock

`applyEloRatings` does `findOne` → mutate → `save` inside the transaction
but without `pessimistic_write`. A user can only be in one active room at a
time (matchmaking.service.ts:52–57), so cross-match races are prevented at
the app layer today; the lock matters only if that invariant ever loosens
and as belt-and-braces alongside H1's unique constraint (which converts a
duplicate insert race into a constraint error instead of silent dup rows).

## 4. Suggested execution order for the fixing agent

1. **H1** — migration + unique constraint + entity decorator (unblocks prod).
2. **M1 + L2 + L3** — controller validation, logging, spec updates (small,
   same module).
3. **H2** — agree approach with the user first (product decision), then DTO
   restriction/rate limit.
4. **M4** — durable idempotency guard in `persistFinishedRoom`.
5. **M3, M5, L4, L5, L6** — backend data-quality fixes.
6. **M2, M6, L1** — frontend modal fixes (error state, own rank, fetch on
   open). M6 needs a product decision.

## 5. Test plan

- Backend: extend `leaderboard.service.spec.ts` (missing/unknown gameId,
  tie-break ordering, dev-account exclusion if adopted); new
  `leaderboard.controller.spec.ts` (400 on missing gameId, scope coercion);
  `game-session.service.spec.ts` cases for draw persistence, double-persist
  idempotency, 1-player Elo guard; `game-results.service.spec.ts` cases for
  rejected gameIds/outcomes. Run `cd backend && npm run test:cov`.
- Migration: verify on a fresh DB with `synchronize` off that
  `npm run migration:run` creates `user_ratings` and both leaderboard
  endpoints return 200 with `[]`.
- Frontend has no test harness for HomePage — document manual validation:
  open Rankings modal with backend stopped (expect error state, not "No
  rankings yet."), tie two players' ratings and refresh (stable order),
  finish a ranked draw (draws increments, ratings unchanged or ±0.5-based
  per chosen fix).

## 6. Out of scope / explicitly not bugs

- Friends scope always includes the caller (`allowedIds` never empty) —
  correct as designed.
- Guests: blocked from ranked queue, filtered from boards, skipped by both
  game-result writers — consistent.
- Game ID drift between frontend `RANKED_GAMES` and backend engines —
  checked, currently identical; M1's shared constant removes the future risk.
- Abandoned ranked matches applying Elo (forfeit = loss) — appears
  intentional; do not change without user sign-off.
