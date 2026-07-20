# Remote Players & Multiplayer 3+ — Technical Audit (2026-07-20)

Deep-dive review of the two in-progress majors from `docs/modules-progress.md`:
**Major: Remote players** and **Major: Multiplayer game with more than two
players**. Written from a senior games/web perspective: every finding cites the
code, states the impact, and reasons through the available fix options rather
than prescribing a single answer.

Scope reviewed: `backend/src/modules/matchmaking/` (gateway, room, session,
matchmaking, arena simulation, bot driver, replay capture, all four engines and
physics modules) and the frontend network layer (`services/network/`,
`games/*/…Online.ts`, `games/common/runtime/authoritative-projection.ts`,
`routes/GamePage.tsx`).

Severity legend: **H** = correctness/stability bug or resource leak that will
bite in normal use; **M** = fairness, robustness or performance defect worth
fixing before claiming the module; **L** = polish, dead code, or a documented
trade-off.

## 1. What is in good shape

Credit first, because the foundation is solid and the report below should not
read as "the netcode is broken":

- The server-authoritative migration is real and consistent: the only gameplay
  input any client can send is a bounded `release` (velocity magnitude capped
  at 5,000, `Number.isFinite` checked, round/turn echoes validated) — see
  `bell-clash.engine.ts:127-139`, `kame-knock.engine.ts:131-145`,
  `shell-curl.engine.ts:143-146`. Score/settle/hit reports are rejected.
- One input rail for humans and CPU seats (`MatchmakingGateway.handleUserInput`
  is public and `BotPlayerService` goes through it), so bots cannot do anything
  a modified client could not.
- Match settlement is idempotent at the database level (the `WHERE status =
  'active'` guard, Rankings Bug Audit M4) and Elo snapshots pre-match ratings
  to stay order-independent (Bug Audit H1).
- The client projection timeline (`authoritative-projection.ts`) is a proper
  jitter-adaptive interpolation buffer (100–180 ms, Hermite interpolation,
  bounded 50 ms extrapolation) with no Phaser coupling — genuinely reusable.
- Disconnect → 45 s reconnect window → forfeit is implemented end-to-end,
  including the away flow, rejoin polling and spectator/rejoin snapshot+physics
  handshakes.

## 2. Findings — Major: Remote players

### R1 (H) — A second connection from the same user hijacks the match seat and can trigger a false forfeit

`handleConnection` unconditionally calls `rooms.reconnect(socket.id, user)` for
every new socket of a user with an active room
(`matchmaking.gateway.ts:216-228`), and `RoomService.reconnect` overwrites
`player.socketId` with the newest socket (`room.service.ts:117-127`). Presence
supports multiple sockets per user, but the room seat does not.

Failure sequence: a player is mid-match in tab A; they open the app in tab B
(or the mobile app, or a second window). Tab B silently steals the seat's
`socketId`. When tab B closes, `markDisconnected` matches the seat by that
socket id (`room.service.ts:152-178`), marks the actively-playing player as
disconnected, and starts the 45 s forfeit timer — while tab A is still playing
and its inputs are still accepted (input routing is by `userId`, not socket).
The player sees "You are disconnected. Forfeit in Ns" while playing, and loses
by forfeit if nothing re-triggers `reconnect` within 45 s.

Options, in rough order of preference:

1. **Only rebind the seat when it is actually vacant.** In `reconnect`, if
   `player.connected && player.socketId` still belongs to a live socket, leave
   the seat alone (optionally emit a "match in progress on another tab" notice
   to the new socket). Small, targeted, preserves the existing reconnect path.
   Needs a liveness check against `server.sockets` or presence.
2. **Track a set of seat sockets per player** and only mark disconnected when
   the last one drops. More invasive (touches `RoomPlayer`, `markDisconnected`,
   `markAway`), but makes multi-tab first-class.
3. **Explicit takeover handshake** ("Play here" prompt, the way console games
   transfer sessions). Best UX, most work; reasonable later, not as the fix.

Whichever option is taken, add a gateway spec reproducing the two-tab sequence.

### R2 (H) — Finished rooms are never evicted: unbounded memory growth

`RoomService.rooms` only ever gains entries (`room.service.ts:17`; no
`rooms.delete` exists anywhere in the module — verified by grep). `finish()`
clears the `userRoom` index and timers but deliberately keeps the room for the
rematch flow. Each retained room holds its full snapshot, physics state,
spectator map and — critically — the entire `replayFrames`/`replayEvents`
arrays (see R3). A day of casual play accumulates every match ever played in
process memory, and the linear scans in `markDisconnected` (every socket
disconnect iterates all rooms × players, `room.service.ts:157-159`) and
`removeSpectator` (`room.service.ts:254-259`) get slower as it grows.

Options:

1. **Evict on rematch resolution + TTL sweep (recommended).** Delete the room
   when a rematch starts (`rematchStartedMatchId` is set) or when every player
   has left the end screen, plus a periodic sweep that drops
   finished/abandoned rooms older than, say, 10 minutes (constant, named).
   The rematch UX is preserved; memory is bounded.
2. **Aggressive: delete in `finishIfEnded` after persistence** and rebuild the
   rematch flow on top of the durable `matches` row. Cleanest long-term, but
   the rematch feature currently reads the in-memory room, so this is a bigger
   refactor.
3. Independent of eviction, add a `socketId → matchId` index so
   `markDisconnected`/`removeSpectator` stop scanning all rooms. Cheap, and
   worth doing in the same pass.

### R3 (H) — Replay capture forces a full keyframe at 30 Hz, defeating the delta encoder

`emitPhysicsState` calls `this.replays.captureFrame(room, true)` on **every**
physics broadcast (`matchmaking.gateway.ts:1175`), and `force = true` makes
`captureFrame` take a keyframe: a full `JSON.parse(JSON.stringify(...))` deep
clone of the whole snapshot (`replay.service.ts:237-247`, `clone` at line 76).
While anything is moving that is ~30 full-state clones per second per room —
exactly the situation the 50 ms sampler with 1 s keyframes and delta encoding
(`arena-simulation.service.ts:69-80`, `REPLAY_KEYFRAME_MS`) was built to avoid.
Both paths run concurrently, so the same motion is captured twice on two
different time bases (the arena path stamps logical 50 ms steps, the gateway
path wall-clock `now`), which also risks non-monotonic `tMs` interleavings.

Consequences: CPU burn (deep clone + `JSON.stringify` diffing per frame per
room), `replayFrames` ballooning in memory (compounded by R2 — the frames stay
alive after the match), and very large `match_replays` rows persisted to
Postgres. Live capture has no frame cap; only imports are bounded
(`MAX_IMPORTED_REPLAY_FRAMES = 3600`, `replay.service.ts:29`).

Options:

1. **Drop `force` from the physics-broadcast call site (recommended).** The
   50 ms logical sampler already captures motion; keep forced keyframes only
   for lifecycle transitions (`emitState`, `recordEvent`,
   `persistReplayForRoom` already force where it matters). One-line change +
   replay regression run (the replay suite covers keyframe/delta
   reconstruction).
2. Keep a periodic forced keyframe but at the existing 1 s cadence, driven by
   the sampler, not the broadcaster — equivalent outcome, slightly more code.
3. Additionally impose a **live frame budget** (e.g. the same 3,600-frame cap
   as imports, oldest-round trimming) so a pathological match can never grow
   without bound. Worth doing regardless of 1/2.

Validate by recording a full Temple Curling online match before/after and
comparing frame counts and replay playback fidelity.

### R4 (M) — `game:input` and `game:physics-request` have no rate limiting

The chat socket path is rate-limited (30 msgs/10 s), but game input is not:
`onGameInput` goes straight to `handleUserInput`
(`matchmaking.gateway.ts:481-489`), and the `GameInputAck` even declares a
`"rate-limited"` reason that nothing ever produces (line 59) — an honest tell
that this was planned and not finished. A hostile or broken client can spam
releases (each accepted Bamboo/Bell release triggers an immediate broadcast to
the room) or hammer `game:physics-request` (each call serialises the full
public physics projection). Engines reject most spam cheaply, but the
per-message deserialisation, engine dispatch and ack traffic are still paid,
and accepted-action amplification (1 input → N-client broadcast) is real.

Options: reuse the existing `RateLimiterService.allowKey` per user with a
game-appropriate bucket (e.g. 10 inputs/s burst 20 — generous for humans,
fatal for spam loops) and actually return `"rate-limited"`; and give
`game:physics-request` its own small bucket (it is only needed at
join/rejoin). Both are a few lines each given the limiter already exists and
is already optional-injected into the gateway.

### R5 (M) — Matchmaking race: a disconnect between queue-splice and room creation seats a ghost player

`joinQueue` splices the matched entries synchronously but then awaits
`matchFactory.createMatch` (two DB round-trips) before the room exists
(`matchmaking.service.ts:87-108`). If a matched player's socket dies inside
that window, their disconnect handler runs before the room is registered:
`markDisconnected` finds nothing, so the room is later created with a seat that
is `connected: true` on a dead socket and no forfeit timer. The room then sits
in `pending` forever (the ghost never sends `room:ready`), the other players
see an eternal wait, and the ghost user is locked out of queueing
(`hasActiveRoom` is true) until they happen to reconnect (auto-rejoin heals it)
or an opponent abandons.

Options:

1. **Liveness check at room creation (recommended):** when the gateway
   receives `matched` and iterates `room.players`
   (`matchmaking.gateway.ts:325-343`), any player whose socket is no longer in
   `server.sockets` should immediately go through the
   `markDisconnected`-equivalent path so the 45 s timer arms. Small and covers
   every server-created room via the same helper.
2. **Pending-room TTL:** any room still `pending` after N minutes is aborted
   winnerless. Worth having as a backstop even with option 1 — it also covers
   the "matched but never readied" case generally.
3. Re-queue the surviving players automatically instead of aborting — nicest
   UX, more moving parts; sensible as a later refinement of 2.

### R6 (M) — Own-launch latency: no local presentation of the accepted shot

A player's own launch renders only once the server's projection arrives and
clears the interpolation delay: perceived response time ≈ RTT + 100–180 ms
(`authoritative-projection.ts:11-12`). The immediate `emitPhysicsState` on
release (`matchmaking.gateway.ts:530, 568, 637, 671`) keeps this acceptable on
LAN/dev, but on a 60–80 ms real-world link the launch feel is noticeably
spongy; the module's own follow-up notes ("Temple Curling retained additional
gameplay issues… under the original network conditions") point the same way.

Options, by increasing effort:

1. **Accept and document** — these are launch-based games, not twitch games; a
   200 ms launch acknowledgement is defensible. Cheapest, but it is the main
   perceived-quality lever left in this module.
2. **Cosmetic launch echo (recommended):** on the accepted ack, render the
   player's own projectile immediately from the client's launch parameters and
   blend to the authoritative track when the first projections arrive (the
   client already has a full local physics implementation for offline play to
   drive the first ~150 ms). No divergence risk beyond the blend window,
   because the server remains authoritative for everything that matters.
3. **Full client prediction + reconciliation** for the local projectile.
   Overkill here: collisions with other entities during flight would surface
   visible corrections, and option 2 captures ~90 % of the benefit.

### R7 (M) — The simulated `serverTime` clock can fall behind wall clock under load, degrading interpolation

`bump(physics, deltaMs)` advances `serverTime` only by simulated time, and the
fixed-step loop caps catch-up at 5 steps (`arena-simulation.service.ts:7,
107-125`): under event-loop pressure the simulation clock silently loses time
against `Date.now()`. The client's offset estimate is `min(receivedAt −
serverTime)` over a 10 s window (`authoritative-projection.ts:74-76`), so a
lagging server clock inflates offsets, repeatedly trips
`renderTime > latest.serverTime`, and ratchets the delay to its 180 ms cap
with only 50 ms of extrapolation available — visible rubber-banding exactly
when the server is busiest. Bamboo Bash additionally compares this simulated
clock against a wall-clock deadline (`roundEndsAt = Date.now() + roundTimeMs`
vs `physics.serverTime >= state.roundEndsAt`,
`bamboo-bash.engine.ts:121, 287-288`), so a loaded server stretches rounds.

Options: (1) re-anchor `serverTime` to wall clock whenever the accumulated
drift exceeds one tick (keeps the monotonic contract the client relies on if
clamped to never go backwards); (2) keep the simulated clock but express
Bamboo's round deadline in simulated time so at least the game rules are
consistent; (3) instrument first — a Prometheus histogram of tick duration and
dropped catch-up steps (the monitoring module is already in place) to size the
real risk before changing clock semantics. 3 is compatible with either and
cheap; 1+2 together is the correct end state.

### R8 (M) — Curling lifecycle snapshots ship trails and a duplicated entity array to every client

`syncShellCurlSnapshot` writes full per-ball trails into `snapshot.objects`
and then duplicates the entire array into `snapshot.entities`
(`shell-curl-physics.ts:94-127`). The 30 Hz physics channel rightly strips
trails (`publicPhysicsState`, `matchmaking.gateway.ts:1213-1239`), but every
`game:state` lifecycle emit — each throw, turn, join, presence change — still
carries up to 40 trail points × entities × 2 copies to every player and
spectator, and the same bloated snapshot is what gets deep-cloned by replay
capture (compounding R3). Options: strip `trail` from the lifecycle snapshot
and let clients keep rebuilding trails from interpolated positions (they
already do this for multiplayer cosmetics per the 2026-07-19 parity work —
the field is legacy); drop the `entities` duplicate for Curling or make it a
reference-projection of `objects` at serialisation time. Both are
contract-narrowing changes: check the replay reconstructor and
`renderSnapshotObjects` (`ShellCurlOnline.ts:476-501`) which reads `objects`,
not `entities`.

### R9 (L) — Broadcast decimation in `ArenaSimulationService` is dead logic

`ARENA_STATE_BROADCAST_MS` equals the tick interval
(`arena-simulation.service.ts:5-6`), so the elapsed-accumulator bookkeeping
(lines 81-95) always concludes "broadcast now": complexity with no effect.
Either delete it, or use it: broadcasting at 20 Hz while simulating at 30 Hz
would cut steady-state bandwidth by a third with no visible cost given the
client's 100–180 ms interpolation buffer — worth a quick A/B behind the
existing constant. If the decimation is kept, the "settled" fast-path reset
(line 93) is already correct for burst-settling.

### R10 (L) — Blanket `socket.off("event")` calls in `GamePage` can strip other listeners

`findOnlineMatch` and the panel cleanup call `socket.off("match:found")`,
`socket.off("game:state")` etc. without handler references
(`GamePage.tsx:431-434, 695-698`) on the shared singleton socket. Today the
ordering works out (scenes attach their handlers after the panel unmounts),
but it is one refactor away from silently detaching a live scene's state
listener — the class of bug that costs an evening in the debugger. Option:
always pass the handler reference to `off` (the online controllers already do
this correctly); a lighter-touch alternative is a scoped emitter wrapper per
consumer. Also note `finishAuthoritativeMatch`'s retry backoff uses inline
magic numbers (`matchmaking.gateway.ts:1198-1204`) — name them.

### R11 (L) — Reconnect window UX

The 45 s window (`RECONNECT_TIMEOUT_MS`, `matchmaking.gateway.ts:47`) is only
surfaced as a countdown on the matchmaking panel and via
`formatReconnectStatus` in-scene. Fine for the module; if the evaluation demo
includes a kill-the-tab test, consider a hub-level toast ("You have an active
match — rejoin within Ns") driven by the `match:status` payload that already
carries `reconnectExpiresAt`. Pure frontend, no protocol change.

## 3. Findings — Major: Multiplayer game with more than two players

The platform genuinely supports 3–5 players end-to-end: queue keys include
`playerCount` (`matchmaking.service.ts:66, 157-163`), PIN lobbies take 2–5,
all four engines declare `maxPlayers = 5`, snapshots are array-per-side
throughout, and Bell Clash/Bamboo spawn geometry distributes N seats around
the arena. The module's blocker is proof, plus a handful of N>2 fairness
holes that a demo would expose.

### P1 (H) — The module blocker is validation, not implementation

`docs/modules-progress.md` is explicit: "Lacking clear, demonstrable proof of
a functional 3+ match validated end-to-end", and the Temple Curling manual
matrix (3–5 players, eight powers, spectators, re-entry) is still open. Two
complementary options:

1. **Automated 3–5 player integration spec (recommended first).** The
   backend already has the pattern: the bot integration spec drives two bots
   through every game to a finished match via the real engines. Extend it to
   5 seats per game (mixed humans-as-fake-sockets + bots), asserting turn
   rotation, per-side scoring, disconnect/rejoin of a middle seat, and a
   settled winner. This becomes the *repeatable, demonstrable* proof and a CI
   regression net, independent of manual runs.
2. **Scripted multi-client Firefox headless matrix** for the visual/UX half
   (the project already validates this way per `CLAUDE.md`): five guest
   sessions through the PIN-lobby path in Temple Curling, checking turn
   banner order, HUD score columns, spectator entry mid-match and responsive
   relayout. Record it in the acceptance doc as the module's evidence.

Doing 1 before 2 is deliberate: the automated spec will flush out the P2–P5
issues below cheaply before burning manual validation time on them.

### P2 (M) — Temple Curling turn order gives the last seat the hammer in every end

`nextTurn` returns 0 whenever an end has just completed
(`shell-curl.engine.ts:209-213`), so every end runs 0→1→…→N−1: seat 0 always
throws first and seat N−1 always throws last. In curling terms the last seat
has the hammer in all three ends — a structural advantage that grows with
player count (with 5 players, seat 0's stones sit exposed through 12
subsequent throws). Options: rotate the lead each end
(`(state.currentEnd) % playerCount` as the end's starting side) — one line
plus HUD verification; classic rules (previous end's non-scorer throws last)
— more faithful, more state; or per-end seeded shuffle — fair in expectation
but harder to communicate. The rotation option is the best effort/fairness
ratio and is what the client's `throwsUsedBySide` formula
(`ShellCurlOnline.ts:509-514`) must be updated in lockstep with — it
currently hard-assumes the 0-first rotation, which is exactly the kind of
implicit contract the automated spec from P1 should pin.

### P3 (M) — Arena engines accept any power, ignoring the player's shell selection

`BaseArenaEngine.consumeArenaPower` validates the requested power only against
the global allowlist and once-per-round usage (`base-arena.engine.ts:71-83`).
Temple Curling additionally checks the player's validated `shellSelection`
(`shell-curl.engine.ts:215-236`), but Bell Clash, Kame Knock and Bamboo Bash
releases pass a client-chosen `payload.power` with no ownership check — a
modified client in a powerups match can invoke any of the eight powers
regardless of what it selected/owns (selection is validated at queue join via
`ShellsService.validateSelection`, then never enforced at use). Fairness hole,
directly relevant to this module's "fair gameplay" requirement. Options: add
the same `shellSelection` guard to `consumeArenaPower` (needs `RoomPlayer`
passed in — mirror the Curling signature; small, symmetric, testable), or
resolve the power server-side from selection order and stop trusting the
payload field entirely (stronger, changes the client contract). The first is
the pragmatic fix; note guests/empty selections must keep working (empty
selection currently means "anything goes" in Curling too — decide and
document whether that is intended).

### P4 (M) — Multiplayer Elo and ranked matchmaking are 2-player designs stretched to N

Two separate issues. First, `applyEloRatings` scores each player against the
*average* opponent rating (`game-session.service.ts:349-382`): defensible, but
not zero-sum for N>2, and a 3-way tie for first returns `winnerSide = null`
(`getWinnerSide`, `base.engine.ts:30-36`), which records a **draw for every
player including clear losers** — a last-placed player in a 5-seat ranked
match gains rating from a first-place tie. Second, ranked queues are pure
FIFO per `(gameId, mode, playerCount)` with no rating proximity, so 3–5-seat
ranked lobbies mix arbitrary skill.

Options, separable: (a) score multiplayer matches pairwise (each pair scored
by relative placement, deltas summed and divided by N−1 — standard
multiplayer-Elo construction; fixes both zero-sum drift and the tie-for-first
absurdity because placement, not `winnerSide`, drives scores) — moderate,
well-contained in `applyEloRatings` but needs per-side placement, which every
engine can already provide from its score array; (b) keep average-based Elo
but at minimum special-case ties: only tied-for-first players draw, others
lose; (c) restrict ranked to 2 players and leave 3–5 casual — smallest code
change, and honest if the evaluation does not require ranked N-player; (d)
rating-banded matchmaking is a nice-to-have and can be declared out of scope
— FIFO is defensible for the module. Recommendation: (b) now (small,
correctness), (a) if ranked 3+ is to be claimed seriously, (d) documented as
a known limitation.

### P5 (M) — Abandon resolution can hand the win to the wrong seat in N-player matches

`resolveAbandonWinner` picks the highest score among remaining **connected**
players (`base.engine.ts:38-56`). In a 4-player match where the leader is
momentarily disconnected (inside their 45 s window) and a different player
abandons, the leader is excluded from winner resolution — the match ends
immediately and a trailing connected player takes the win, plus the Elo
consequences. Options: drop the `connected` filter (score is score — a
temporarily disconnected player is still a participant; the abandoner is
already excluded by side) — one-line, recommended; or defer resolution until
all disconnect windows resolve — more correct in exotic cases, but adds a
waiting state to the finish path for marginal benefit. Related design gap
worth an explicit decision: when one of 4–5 players abandons, the whole match
ends. Continuing N−1-player matches is a real product option (the tournament
layer already proves seats can be handed to CPU stand-ins via
`convertSeatToBot`) but is a scope extension — flag for a user decision, do
not build unbidden.

### P6 (L) — Frontend N-player rough edges

`findOnlineMatch` and `rejoinActiveMatch` hard-code
`shellSelection: { player0: [], player1: [] }` (`GamePage.tsx:627, 722`)
while the lobby path builds N entries via `buildEmptyShellSelection` — today
the empty selections make it moot, but it will mask bugs the moment shell
selection matters online for 3+. Also, the `match:found` payload's
`opponents` list is built but not surfaced for N>2 lobbies, and Bell Clash
spawn-vs-zone geometry means seats face different bank angles to the scoring
arcs within a round (zones are random per round, so this averages out — worth
one line in the game rules doc rather than code).

### P7 (L) — 3+ spectator and re-entry paths lean on per-game manual claims

Kame Knock spectator entry during live play is explicitly unvalidated
(`modules-progress.md`), and spectator discovery is by PIN or matchId only.
The spectator code paths are shared and look sound (`spectator:join` replays
snapshot + physics; `onPhysicsRequest` authorises spectators). Fold spectator
assertions into the P1 automated spec (a sixth socket joining mid-match and
receiving a monotonic `physicsSeq` stream) so the claim stops depending on
manual passes.

## 4. Cross-cutting: capacity and observability

Everything runs in one Node process: a 30 Hz fixed-step loop over all active
rooms, per-substep O(entities²) collision resolution (fine — entity counts are
tiny), the 400 ms bot sweep, plus replay cloning (R3). Nothing here is
alarming at 42-evaluation scale, but there is currently no visibility: no
metric records tick duration, catch-up saturation (R7), broadcast payload
sizes, or room-count/replay-frame growth (R2/R3). The monitoring module
already ships prom-client and dashboards — adding a small `matchmaking`
metrics set (tick-duration histogram, active rooms gauge, replay frames
gauge, dropped catch-up counter) is half a day and converts several findings
above from speculation into graphs. Recommended regardless of which fix
options are chosen.

## 5. Suggested sequencing

If the goal is closing both majors with the least risk:

1. R3 (one-line replay force fix + frame budget) and R2 (room eviction) —
   they compound each other and are the stability floor for any long demo.
2. R1 (seat hijack) — the most likely "it forfeited me for no reason" demo
   incident.
3. P1 option 1 (automated 3–5 player spec) — the module's actual missing
   deliverable, and the net that P2/P3/P5 fixes land inside.
4. P3 (arena power ownership), P2 (curling turn rotation), P5 (abandon
   filter) — small fairness fixes, each with a spec.
5. R4 (input rate limiting), R5 (matchmaking race backstop) — robustness.
6. P4 decision (Elo scope for N>2) and R6 decision (launch echo) — user
   choices; then the manual Firefox matrices (P1 option 2) as final evidence,
   recorded in the acceptance docs.

Items deliberately left as documented trade-offs unless the user says
otherwise: N−1 match continuation after abandon (P5 note), rating-banded
matchmaking (P4d), full client prediction (R6 option 3).
