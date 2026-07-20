# Rankings Bug Audit — 2026-07-20 (follow-up)

## Resolution log (added 2026-07-20, same day as the audit)

Implemented in full against `HEAD` (`95c8a7e3`), verified by the backend and
frontend test suites plus `tsc`/build checks. Status per finding:

- **N2** (tournament create-migrations): reclassified, not actioned. The
  claim was stale — `backend/src/migrations/20260713000000-create-tournaments.ts`
  already creates `tournaments`/`tournament_participants`/`tournament_matches`
  with `IF NOT EXISTS`, correctly ordered before
  `20260718000000-add-tournament-participant-has-left.ts`.
- **N1** (CPU bot accounts ranking publicly): fixed. New `users.isBot`
  column (migration `20260720000000-add-users-is-bot.ts`, backfilled by the
  reserved bot email domain), set at CPU-account minting in
  `tournament-lobby.service.ts`, excluded from all three leaderboard queries.
- **N3** (merged-away accounts ranking): fixed. `u."mergedIntoUserId" IS NULL`
  added to all three leaderboard queries.
- **N4** (demo account ranking as a normal player): fixed. `seedDemoAccount`
  now sets `isDevAccount: true` on creation and backfills it on every boot
  for accounts seeded before this fix.
- **N5** (leaderboard fetch cancellation race): fixed. The cancellation flag
  is now a ref created synchronously in the effect, before the fetch starts.
- **§3.3** (undiagnosable backend outage): mitigated. `main.ts` now logs
  `unhandledRejection`/`uncaughtException` instead of the process dying
  silently; `BotPlayerService.tick()`'s whole body is now wrapped in a
  try/catch so a bad tick is retried rather than killing the process. The
  auth rate-limit lockout message and the "backend unreachable" vs "wrong
  credentials" UI distinction were **not** actioned this pass.
- **§5.1** (tournament-wins board): shipped — `GET /leaderboard/tournaments`,
  `LeaderboardService.getTournamentLeaderboard`, and a "Tournaments" tab in
  the Rankings modal.
- **§5.2** (tournament minigame wins → overall ranking): confirmed already
  correct by construction; added a regression test
  (`game-session.service.spec.ts`) that pins the behaviour.
- **§5.3** (per-player tournament wins on the profile page): not built —
  the audit itself recommended deferring this until profiling shows a need.

**Open product decision, not actioned:** whether tournament-minigame
XP/coin/level grants in `GameSessionService.persistFinishedRoom` should also
exclude CPU bot stand-ins. Bots are now excluded from every ranking display,
but `submitResult` still credits them XP/coins/levels exactly as before —
this only affects bot accounts' own (invisible) stats, not any real player,
but it is still worth a decision.

Test coverage added: `leaderboard.service.spec.ts` (tournament-board happy
path, bot/dev/guest/merged exclusions on all three boards, tie-break order,
friends scope, repository-failure logging), `leaderboard.controller.spec.ts`
(new route scope coercion), `game-session.service.spec.ts` (tournament-launched
room still grants a win), `auth.service.spec.ts` (demo account
`isDevAccount` on creation and backfill).

Not performed this pass (no running dev stack or Postgres instance available
in this environment): the live `make dev` walkthrough of §6/§7's manual
validation steps (fresh-DB migration run, in-browser Tournaments tab check,
playing a tournament with CPUs end-to-end). Recommended as an immediate
follow-up before considering this audit fully closed.

---

Handoff document for the agent that will work on the rankings/leaderboard
feature. Supersedes `docs/old_docs/rankings-bug-audit-2026-07-15.md` (all of
whose findings are now resolved — see §2). Covers three things:

1. Current state: which previous findings are fixed, plus new/unfixed bugs.
2. The reported "DB crash when opening the Rankings tab" — investigated live.
3. A specification for integrating tournament mode into rankings: a separate
   tournament-wins board, and tournament minigame wins counting toward the
   overall (total) ranking.

Verified against HEAD (`95c8a7e3`) on 2026-07-20, including a **live session**
against the running dev stack (`make dev`, https://localhost:42424) via the
browser: guest login and the KameMaster account, every Rankings tab
(Total + 4 games) and both scopes exercised — all requests returned 200.

## 1. Architecture recap (what changed since 15 July)

The 2026-07-15 audit was executed in commit `c75ef553` ("Ranking bugs").
Since then the relevant drift is:

- **Tournament mode** (`backend/src/modules/tournaments/`, merged via
  `tournament/f2-engines`): a board-game session whose minigames are launched
  through the platform's normal matchmaking rail
  (`tournament-minigame.adapter.ts` → `MatchFactoryService.createMatch` with
  `mode: "casual"`). Match finishes therefore flow through
  `GameSessionService.persistFinishedRoom` → `GameResultsService.submitResult`
  → `user_game_stats` — i.e. **tournament minigame wins already feed the
  overall leaderboard** (verified by code path; see §4.2 for the caveats).
- **CPU bot accounts**: `tournament-lobby.service.ts` mints real `users` rows
  for CPU participants (`username: "CPU"`, `isGuest: false`, no other flag),
  and commit `7ef543b5` gave them Profile rows precisely so their match
  results persist. See finding N1.
- **Account linking/merging** (`317a80fa`): `users.mergedIntoUserId` marks
  merged-away accounts. See finding N4.
- **Champion persistence**: `tournaments.winnerUserId` is written durably on
  finish (`tournament-runtime.service.ts:299–306`), with a 500-coin champion
  reward and a `tournament-champion` achievement. This is the foundation §4
  builds the tournament-wins board on.

## 2. Status of the 2026-07-15 findings

All thirteen were fixed in `c75ef553` and verified in code (and live where
applicable) today:

| Finding | Status | Where fixed |
|---|---|---|
| H1 user_ratings migration + unique | **Fixed** | `20260715000000-create-user-ratings.ts` (incl. de-dup + `uq_user_ratings_user_game`), `@Unique` on entity |
| H2 forgeable overall board | **Fixed** | `SubmitLocalResultDto` (only `outcome: "completed"` accepted from clients) + per-user rate limit (20/min) in `game-results.controller.ts` |
| M1 gameId 500/validation | **Fixed** | `KNOWN_GAME_IDS` check → 400 (`leaderboard.controller.ts:48–55`) |
| M2 error state vs empty state | **Fixed** | `leaderboardError` + Retry button (HomePage.tsx:3492–3504) — but see N5 for a residual race |
| M3 ranked draws dropped | **Fixed** | draws scored 0.5, `draws` incremented (`game-session.service.ts`) |
| M4 double-reward idempotency | **Fixed** | `UPDATE matches … WHERE status='active'` guard inside the transaction; flag set before replay persistence |
| M5 tie-breakers | **Fixed** | wins/username (game), level/username (overall) secondary ordering |
| M6 own rank invisible | **Fixed** | full 100 rendered scrollable + pinned "Your rank" bar |
| L1 fetch on modal open | **Fixed** | effect gated on `activeModal === "rankings"` |
| L2 error logging | **Fixed** | `Logger.error` with stack in both service methods |
| L3 stale shell-curl refs | **Fixed** | controller doc + specs updated; controller spec added |
| L4 dev accounts on boards | **Fixed** | `u.isDevAccount = false` in both queries |
| L5/L6 NaN guard, row lock | **Fixed** | `opponentRatings.length === 0` guard; `pessimistic_write` lock |

## 3. The reported "DB crash when opening the Rankings tab"

### 3.1 What was investigated

- **Live reproduction (2026-07-20)**: with the stack running, Rankings was
  opened as a fresh guest and as KameMaster; every tab (Total, Temple
  Curling, Bamboo Bash, Kame Knock, Bell Clash) and both scopes
  (global/friends) were exercised. **All requests returned HTTP 200, no
  console errors, no crash.** All boards were empty ("No rankings yet.") —
  consistent with the database having been reset since the incident (Lucas
  confirmed a reset happened).
- **Query-level fuzzing**: both leaderboard queries were replayed verbatim
  against an in-memory Postgres (pg-mem harness) with adversarial data —
  CPU bot users, guests, dev accounts, merged-away accounts, null
  turtleName/avatar, `totalWins` at INT_MAX (SUM overflows into bigint
  cleanly). **Neither query can error on data**; they are plain filtered
  aggregates. Nothing in the rankings read path can plausibly crash
  PostgreSQL.

### 3.2 Reclassification of the symptom

The observed incident was: *everyone got logged out of the hub, login then
failed ("authentication issue") until `make re`*. That is **not a Postgres
crash** — a rankings SELECT cannot take Postgres down, and a Postgres outage
would not be healed by `make re` alone in this way. The symptom profile
matches a **backend (NestJS) process death or lockout**, with the rankings
click being when it was noticed, not necessarily what caused it:

1. **Backend process crash via unhandled promise rejection** (most likely).
   `backend/src/main.ts` registers **no** `process.on("unhandledRejection")`
   / `uncaughtException` handlers, and Node ≥16 kills the process on any
   floating rejection. Nest catches HTTP-path errors, but background timers
   and event listeners are exposed. The riskiest live pattern is
   `bot-player.service.ts:151`:
   `setInterval(() => void this.tick(), BOT_TICK_MS)` — `stepSeat` guards its
   own work, but any synchronous throw in `tick()`'s room iteration outside
   that guard rejects an un-awaited promise → process death. Tournament
   testing runs bots constantly, matching when the incident occurred. While
   the backend restarts, nginx serves 502/503 for every API call — the hub
   redirects to /auth and login "fails" until the container is healthy
   (a 503 for `https://localhost:42424/` was in fact captured in the browser
   network log during today's session, from stack boot).
2. **Auth lockout compounding it**: `POST /auth/login` is rate-limited to
   10/min per IP with an **in-memory** limiter — two people retrying on the
   same machine can lock login, and a restart (`make re`) clears it. This
   alone can explain "couldn't log in again until make re" even without a
   crash.
3. **JWT expiry as the trigger for the logout**: dev `JWT_EXPIRY` is 3600 s;
   after an hour of testing, the next API call 401s and the hub kicks to
   /auth. Opening Rankings issues exactly such a call.

### 3.3 Actions for the fixing agent

- Add process-level handlers in `main.ts`: log and keep the process alive on
  `unhandledRejection` (or at minimum log the reason before exit), plus
  `uncaughtException` logging. Without this, the next such incident is again
  undiagnosable.
- Wrap `BotPlayerService.tick()`'s body in a top-level try/catch (the
  interval callback must never produce a floating rejection).
- Make the incident diagnosable: after any recurrence, capture
  `make logs SERVICE=backend` and `docker inspect --format '{{.RestartCount}}'`
  for the backend container **before** running `make re` / `make fclean` —
  the reset destroyed the evidence this time.
- Consider distinguishing "backend unreachable" from "wrong credentials" on
  the auth page (nginx 502/503 currently reads as an "authentication issue").
- Optional: soften the login rate-limit lockout message to include the
  retry window.

## 4. New findings (2026-07-20)

### N1 — HIGH: CPU tournament bot accounts will appear on public rankings

CPU participants are minted as ordinary users
(`tournament-lobby.service.ts:369–380`: `isGuest: false`, username `CPU`,
`CPU 2`, …) and, since `7ef543b5`, their match results persist. Tournament
minigames finish through `persistFinishedRoom`, which calls `submitResult`
for **every non-guest room player** (`game-session.service.ts:182–196`) —
bots included. Their wins land in `user_game_stats`, and the overall
leaderboard filters only `isGuest`/`isDevAccount`, so **bots rank on the
public Total board** (confirmed in the pg-mem simulation: "CPU"/"CPU 2" rows
appear). A CPU can also *win a tournament*, which would corrupt the
tournament-wins board of §5. Bots additionally accrue XP/levels and coins.

**Fix (also a prerequisite for §5)**: add a durable marker for bot accounts —
recommended: `users.isBot boolean NOT NULL DEFAULT false` (migration +
entity), set it in `ensureCpuUser`/minting and backfill existing bots (they
are identifiable by `email LIKE 'cpu-%@<TOURNAMENT_BOT_EMAIL_DOMAIN>'`).
Then add `AND u.isBot = false` to both existing leaderboard queries and the
new tournament board. Decide separately (with the user) whether bots should
also be excluded from XP/coin grants in `submitResult`.

### N2 — HIGH (production): tournament tables have no create migrations, and an ALTER depends on them

`tournaments`, `tournament_participants` and `tournament_matches` exist only
via dev `synchronize`. Migration
`20260718000000-add-tournament-participant-has-left.ts` runs
`ALTER TABLE tournament_participants …` unguarded — on a migrations-built
production database the table does not exist, so **the whole migration chain
hard-fails**. This repeats the resolved H1 pattern but is worse: it blocks
`npm run migration:run` outright. (`matches`/`match_players` still lack
create migrations too — the pre-existing gap documented in `app.module.ts`'s
`TODO(#initial-migration)`.) The §5 feature reads `tournaments` in
production, so this is a blocker for it.

**Fix**: add `create-tournaments` migration(s) (quoted camelCase, `IF NOT
EXISTS`, following `20260715000000-create-user-ratings.ts`), ordered before
`20260718000000`; ideally also fold in the `matches`/`match_players` creation
or finally generate the initial migration the TODO calls for.

### N3 — MEDIUM: merged-away accounts still rank

`users.mergedIntoUserId` (account-link conflict resolution, `317a80fa`) is
not filtered in either leaderboard query, so a merged-away duplicate of a
person can occupy a second board position with its pre-merge stats
(confirmed in the pg-mem simulation). Add
`AND u."mergedIntoUserId" IS NULL` to both queries (and to the §5 board),
and decide whether merge should also fold `user_game_stats`/`user_ratings`
rows into the canonical account (recommended, else those wins are lost).

### N4 — MEDIUM: demo account ranks as a normal player

`seedDemoAccount` creates KameMaster with level 99 and seeded profile totals
but does **not** set `isDevAccount`, so the L4 filter misses it. Once it
plays a single game it ranks — with level 99 winning every overall-board
tie-break. Set `isDevAccount: true` at seeding (and backfill by username in
a small migration or startup check).

### N5 — LOW: leaderboard fetch cancellation never actually cancels

`loadLeaderboard` (HomePage.tsx:855–885) returns its cancel function only
after the awaited fetch resolves; the effect cleanup (`return () =>
cancel?.()`) therefore runs while `cancel` is still `undefined` for any
in-flight request. Rapid tab/scope switching can let a slow previous
request resolve after the next one and overwrite its rows (mislabelled
data — the exact situation M2's row-clearing was meant to prevent).
**Fix**: hoist the `cancelled` flag/AbortController out of the promise —
e.g. create it synchronously in the effect and pass it into
`loadLeaderboard`, or switch to an `AbortController` whose `abort()` is the
cleanup.

### N6 — LOW: rankings verification gap after DB resets

All boards are currently empty post-reset. After the next play session,
verify rows appear (overall + per-game ranked). If boards stay empty after
real matches finish, `persistFinishedRoom` is failing server-side — check
backend logs for `Failed to persist match`.

## 5. Tournament rankings integration — specification

Three requirements from the user, in order:

### 5.1 Separate tournament-wins leaderboard

Data source already exists: `tournaments.winnerUserId` + `status =
'finished'` (runtime writes it durably; DEFEAT leaves it null — correctly
excluded by the `IS NOT NULL` filter below).

**Backend** (`leaderboard` module):

- New method `getTournamentLeaderboard(callerId, scope)` in
  `LeaderboardService`, mirroring the existing two:

  ```sql
  SELECT u.id AS "userId", u.username, u."turtleName", u.avatar, u.level,
         COUNT(*)::int AS "tournamentWins"
  FROM tournaments t
  INNER JOIN users u ON u.id = t."winnerUserId"
  WHERE t.status = 'finished' AND t."winnerUserId" IS NOT NULL
    AND u."isGuest" = false AND u."isDevAccount" = false
    AND u."isBot" = false            -- N1
    AND u."mergedIntoUserId" IS NULL -- N3
  GROUP BY u.id, u.username, u."turtleName", u.avatar, u.level
  ORDER BY "tournamentWins" DESC, u.level DESC, u.username ASC
  LIMIT 100
  ```

  Friends scope: same `allowedIds` pattern as the existing methods.
- New route `GET /leaderboard/tournaments?scope=` in
  `LeaderboardController` (same guard/validation conventions; register the
  `Tournament` entity in `LeaderboardModule`'s `forFeature`).
- Blocked by N2 (tournaments table must exist via migration in prod) and N1
  (bot flag) — fix those first.

**Frontend**:

- `hub/api.ts`: `TournamentLeaderboardEntry` type +
  `getTournamentLeaderboard(scope)`.
- HomePage Rankings modal: add a "Tournaments" tab after "Total"
  (`leaderboardGame === "tournaments"` branch alongside the existing
  overall/game branches), rendering `{entry.tournamentWins} tournaments won`
  and the same pinned own-rank bar. Reuse existing list styles.

### 5.2 Tournament minigame wins → total (overall) ranking

**Already implemented by construction** — tournament minigames are casual
matches on the normal rail, so their win/loss results are written
server-side into `user_game_stats` and are summed by the overall board.
CPU stand-ins for offline players credit the real player (intentional,
per `tournament-minigame.adapter.ts`). What the fixing agent must add:

- A regression test in `game-session.service.spec.ts` (or an adapter spec)
  asserting a tournament-launched room's finish increments the winner's
  `user_game_stats.totalWins`.
- The N1 bot exclusion, so only the *human* results feed the board.
- One product decision to confirm: whether tournament minigame wins should
  ALSO count Elo. Current behaviour: they do not (mode is `casual`; only
  ranked queue matches touch `user_ratings`). Recommendation: keep it that
  way — tournament rosters are not rating-balanced and include CPU seats.

### 5.3 Separate tournament wins visible per player

The champion is also recognisable via the existing `tournament-champion`
achievement. If a per-profile "tournaments won" stat is wanted on the
profile page, compute it from the same `tournaments` query scoped to one
user — do not add a denormalised counter unless profiling shows a need.

## 6. Suggested execution order

1. **N2** — tournament create-migrations (unblocks everything prod-facing).
2. **N1** — `isBot` column + backfill + filters in both existing queries.
3. **N3 / N4** — merged-account filter + demo-account flag (small, same
   query sites).
4. **§5.1** — tournament-wins endpoint + service + module wiring + tests.
5. **§5.2** — regression test for minigame → overall counting.
6. **Frontend** — Tournaments tab + N5 cancellation fix in the same file.
7. **§3.3** — process-level rejection handlers + bot tick hardening.

## 7. Test plan

- `leaderboard.service.spec.ts`: tournament board happy path, bot/guest/dev/
  merged exclusions, tie-break order, friends scope includes caller, repo
  failure → 500 with logging.
- `leaderboard.controller.spec.ts`: new route scope coercion; existing
  gameId validation unaffected.
- `tournament` side: spec that a finished tournament with a CPU winner does
  NOT appear on the board; a human winner does.
- Migration check: fresh DB, `synchronize` off, `npm run migration:run`
  passes end-to-end (currently fails at `20260718000000` — N2).
- Frontend manual validation (no HomePage harness): Tournaments tab loads,
  empty state, error + Retry state, own-rank bar, rapid tab switching shows
  no cross-tab row bleed (N5), `cd frontend && npm run build` and
  `npm run test:run` pass.
- Live validation via `make dev`: play one tournament with CPUs; confirm
  the human's minigame wins appear in Total, the champion appears in
  Tournaments, and no `CPU*` user appears on any board.

## 8. Explicitly verified as healthy today

- All five leaderboard endpoints return 200 for guest and real sessions,
  every tab and both scopes (live browser session, 2026-07-20).
- The two ranking queries are robust to nulls, unicode names, guests, huge
  win counts (bigint SUM) — pg-mem fuzz harness.
- `KNOWN_GAME_IDS`, engine registry ids and frontend `RANKED_GAMES` are
  identical (temple-curling, bamboo-bash, kame-knock, bell-clash).
- All thirteen findings from the 2026-07-15 audit are fixed (§2).
