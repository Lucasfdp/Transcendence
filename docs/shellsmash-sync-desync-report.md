# ShellSmash Multiplayer Synchronisation — Desync Deep Dive

Date: 2026-07-11
Scope: synchronisation layer of the ShellSmash arena games (Bell Clash, Bamboo Bash, Kame Knock, Shell Curl). Bell Clash is used as the worked example because that is where the desync was observed, but every finding in section 2 applies to all four games — they share `BaseArenaEngine`, `replay-state.helpers.ts`, `stepArenaBall` and the `XxxOnline.ts` controller pattern.

Analysis only — no code was changed.

---

## Implementation status (2026-07-14)

Bell Clash now has a complete server-authoritative online simulation path:

- The backend advances Bell Clash in canonical arena source coordinates through
  a fixed-step 30 Hz accumulator and publishes `game:physics-state` for every
  moving simulation step, including the initial launch projection.
- Physics projection is strictly separate from lifecycle `game:state` messages.
  A physics update cannot restart rounds, reset controls, or rebuild the HUD.
- Arena boundaries, the bell, projectile collisions, active powers, server
  pickups, hit detection, zone multipliers, scoring, shot settlement, and round
  completion are decided by the backend.
- Clients send launch input only. Client-authored `bell:hit` and `round:score`
  actions are rejected, and launch speed is bounded by the server.
- Remote entities use timestamped, velocity-aware snapshot interpolation. The
  client does not locally simulate an incomplete pre-authoritative flight.
- Splitter and mirror projectiles receive stable server identities. Reconnects
  and spectators request the current physics projection explicitly rather than
  trying to reconstruct a flight from lifecycle state.
- Authoritative physics is included in replay frames, including pickups and
  score events.

Bamboo Bash now has an equivalent server-authoritative path for its continuous
round model. The backend keeps a stopped primary entity for every player between
launches, then simulates source-space movement, wall and shell collisions, bamboo
growth and hits, pickups, scoring, and timed round transitions. The client renders
the buffered projection only; client transform, hit, pickup, and round-score
reports are rejected. Initial two-client checks, including powers, currently show
matching positions and outcomes. Kame Knock and Shell Curl retain their previous
client-simulation models and must not be described as server-authoritative.

Headless Firefox validation used two registered players and a guest spectator.
It covered private matchmaking, simultaneous launches, identical transforms and
score events, second-shot rearming, transition into round two, reconnect,
spectator entry, and responsive relayout. The backend suite remains green at
57 suites and 808 tests; focused authoritative tests cover fixed-step pacing,
physics sequence, server scoring, derived identities, round completion, and
initial/immediate/final projection delivery.

---

## 1. Original executive summary

The following sections describe the pre-authoritative baseline found on
2026-07-11. Bell Clash no longer uses that architecture; the findings remain
current for the other games where explicitly applicable.

The desync is not a bug in any single function. The current netcode is a **"fire-and-forget initial-conditions" replication model**: when a player launches a shell, only the initial velocity is broadcast, and every client then simulates the entire flight **independently, forever, with no correction mechanism of any kind**. The server never simulates physics and never learns where any ball actually is. For this model to work, every client's simulation would need to be bit-for-bit deterministic — and it is nothing close to deterministic (variable timestep, per-client RNG, per-client collisions, per-client power effects).

Divergence is therefore **guaranteed by design**, and it **compounds every shot** because the next launch starts from wherever the ball ended up on each screen. Three shells into a round, the two clients are effectively rendering two different matches that only agree on the scoreboard totals — exactly what your screenshots show.

The good news: roughly half of the machinery needed to fix this already exists in the codebase but is dead or under-used (`stepArenaBall` on the server, `syncArenaReplayBallFromPayload`, `settleArenaReplayBall`, the snapshot `entities` array, per-room `seq` numbers). The fix options in section 4 are ordered by how much code they touch, and all of them are designed as **game-agnostic modules** (a shared sync runtime on the frontend, shared engine behaviour on `BaseArenaEngine`), so the same code slots into all four games with only per-game configuration.

---

## 2. How the current sync works (and where it breaks)

### 2.1 The data flow today

```
Player A drags slingshot → release
  A: emitRelease()                    frontend/src/games/bell-clash/BellClashOnline.ts:240
     - zeroes local ball velocity, waits for echo
     - emits game:input {action:"release", vx, vy, power, roundNumber}
  Server: BellClashEngine.applyRelease()   backend/.../engines/bell-clash.engine.ts:83
     - validates round/shot count, stores ball with initial vx/vy in snapshot
  Server: gateway broadcasts game:bell-throw {side, vx, vy, power, shotNumber}
                                        backend/.../matchmaking.gateway.ts:599-645
  A and B: playThrow()                 BellClashOnline.ts:426
     - each client sets vx/vy on ITS OWN local copy of that ball
     - from here on: nothing else is ever exchanged about this ball's motion
  A and B: stepArenaBall() every frame BellClashOnline.ts:292 (update loop)
     - independent variable-dt Euler integration on each machine
  A only (ball owner): checkBellHitForBall(ball, canScore=true)
     - on hit: computes points locally, emits game:input {action:"bell:hit", points}
  Server: applyBellHit()               bell-clash.engine.ts:117
     - adds client-reported points to liveRoundScores, broadcasts snapshot
  B: applySnapshot()                   BellClashOnline.ts:317
     - updates scores/zones/HUD — but NOT ball positions
```

### 2.2 Root causes, ranked by impact

**R1 — No position data ever crosses the network after launch.**
`reportBellHit()` (BellClashOnline.ts:271) sends only `{roundNumber, points, zoneKind}`. On the server, `applyBellHit` dutifully calls `syncArenaReplayBallFromPayload(state, side, payload)` (bell-clash.engine.ts:137) — a helper that reads `x/y/vx/vy` from the payload and updates the snapshot — but since the client never includes those fields, it silently no-ops (`replay-state.helpers.ts:267-300` returns `false` when all fields are null). The server's `entities` array keeps the spawn position and launch velocity forever. The snapshot the opponent receives contains no usable position, so `syncBalls()` (BellClashOnline.ts:505) deliberately only copies `scale/alpha/power/trail/stateFlags` from it. **There is no reconciliation channel at all.** The helper infrastructure for one exists and is tested — it's just never fed data.

**R2 — Non-deterministic independent simulation.**
`stepArenaBall` → `stepBall` (frontend/src/shared/mechanics/ball-core.ts) uses variable-timestep Euler integration with frame-rate-compensated friction (`Math.pow(0.985, deltaMs/16.67)`). Friction compensation makes the *decay* frame-rate independent, but the *positional integration* is not: a 60 Hz client and a 144 Hz client (or one client that hitches during a bounce) produce different trajectories, and every wall/bell bounce amplifies the difference. Small drift becomes metres of drift after one rebound.

**R3 — Divergence compounds across shots.**
`playThrow()` sets `vx/vy` on the remote ball but **never sets `x/y`** (BellClashOnline.ts:438-442). The event's `x/y` fields wouldn't help anyway — the gateway fills them from the server's stale spawn-position ball (matchmaking.gateway.ts:609-620). So shot 2 launches from wherever shot 1 happened to end on *that* screen. By round 3 the starting positions themselves disagree wildly — visible in your screenshots where the same turtles are on opposite sides of the arena.

**R4 — Client-local collisions change both trajectories *and* scores.**
`resolveOnlineBallCollisions()` (BellClashScene.ts:903) resolves ball-vs-ball collisions among locally simulated copies. Because positions already differ per client, a collision can occur on one screen and not the other. Worse, a collision on the owner's screen can knock their ball into the bell — scoring real points for an event the opponent never sees, or vice versa suppressing a hit the opponent *does* see. This is why score-log entries appear "from nowhere" on the other screen.

**R5 — Per-client RNG for power pickups; mid-flight effects are not replicated.**
Pickups spawn with `Math.random()` positions on each client independently (power-pickups.ts:333-347 via `spawnPowerPickup()`, BellClashScene.ts:957). A mid-flight pickup (splitter, mirror…) applies **only on the collecting client's screen** — there is no bell-clash network message for mid-flight pickup application (the `game:bell-power-pickup` event fires only at release time, gateway line 633). Splitter's extra balls exist on one screen only, and those balls can score (`updatePowerBalls` → `checkBellHitForBall(ball, true)`, BellClashScene.ts:541-546). Bamboo Bash already has a `bamboo:power-pickup` input for this — Bell Clash simply never got the equivalent.

**R6 — No server tick, no correction cadence.**
`game:state` is emitted **only in response to inputs** (`emitState` in `onGameInput`, gateway:1066). During the seconds a shell is rolling, zero packets flow. The server-side physics stepper `stepArenaBall` (replay-state.helpers.ts:501) is fully implemented — friction, rim bounce, settle threshold, matching client constants — and is **never called by anything**. Dead code that is one wiring step away from giving the server a real simulation.

**R7 — Client-authoritative scoring.**
Points are computed on the scoring client and trusted by the server (clamped to 10,000 per hit but unbounded in hit count within a round). Beyond the cheating surface, this means "truth" about player A's round lives only on A's machine, so B's screen can never be made consistent with it retroactively.

### 2.3 Secondary defects worth fixing in any option

- **Soft-lock on rejected release.** `emitRelease()` zeroes the local velocity and destroys the slingshot *before* server confirmation. If `applyRelease` rejects (stale `roundNumber`, shot-count race), no `game:bell-throw` echo arrives and the player is stuck on "Launching…". There is no ack/nack on `game:input`.
- **Silent throw drops.** `playThrow()` discards events where `event.roundNumber !== this.roundNumber` (BellClashOnline.ts:427-432). Combined with snapshot-driven round advancement this is normally safe, but around reconnects or reordered listener registration it drops throws with no recovery.
- **`stopped` is never reported in Bell Clash.** `settleArenaReplayBall` exists for exactly this (and Bamboo Bash's owner-reports-stopped pattern is documented in replay-state.helpers.ts:277-282) but Bell Clash never sends a settle message, so the server believes balls roll forever — replays and spectator views inherit garbage.
- **Perceived desync in the HUD.** The header shows only the *local* player's `Shell x/3`. Since both players shoot simultaneously and independently, "Shell 3/3" vs "Shell 1/3" can be legitimate — but it reads as desync. Showing both players' shot progress would remove false alarms while the real fixes land.
- **Spectators and reconnects have no source of truth.** A reconnecting client or spectator receives a snapshot whose entity positions are launch-time stale, so they can never reconstruct the visual state.

---

## 3. Why it looks the way it does in the screenshots

- Different turtle positions per screen: R1 + R2 + R3 (independent, uncorrected, compounding simulation).
- Score log showing only "P1 …" on one screen and "P2 …" on the other: each client logs only hits it *detects locally*; remote hits arrive only as silent score deltas in snapshots (`scoreBellHit` logs, `applySnapshot` doesn't).
- Round score 300 vs 0, Shell 3/3 vs 1/3: parallel-play design plus per-client hit detection — partially legitimate, wholly confusing.
- A moving shell on one screen while the other shows it parked: R4/R5 — a collision or power effect that only one simulation experienced.

---

## 4. Fix options (smallest → largest)

All options are specified as **shared, game-agnostic modules**. Nothing below is Bell Clash-specific; per-game code shrinks in every option.

### Option A — Owner-authoritative position echo (band-aid, ~days)

Keep the current architecture; add the missing correction channel. Each client becomes the authority for **its own** ball's position and streams it; remote balls stop being simulated and become puppets.

- New shared frontend module `games/common/runtime/EntitySyncRuntime.ts`: on a timer (10–15 Hz, named constant) while the local ball is moving, emit a generic `game:input {action:"entity:sync", payload:{x,y,vx,vy,stopped}}`; on receiving remote states, lerp the remote ball toward the reported position instead of stepping it with local physics.
- Backend: one generic handler in `BaseArenaEngine` for `entity:sync` that calls the **already-existing** `syncArenaReplayBallFromPayload` / `settleArenaReplayBall` and bumps `seq`. All four engines inherit it; zero per-game engine code.
- Include `x/y/vx/vy` in the `bell:hit` payload (server already parses them — R1 closes with a payload change).
- Apply `event.x/y` in `playThrow` and have the gateway send the *reported* position, fixing R3 for the first frame of each shot.
- Rate-limit `entity:sync` server-side (the pattern exists in `RateLimiterService`).

Fixes: R1, R3, R6 (partially), settle reporting, spectator/reconnect positions.
Does not fix: R4 (collisions still locally resolved — but with remote balls pinned to owner-truth, collision outcomes converge much better), R5, R7 (still cheatable), R2 becomes irrelevant for remote balls.
Risk: low. Bandwidth: ~4 small messages/sec/player while a ball rolls.

### Option B — Proper visual sync layer: interpolation buffer + server relay tick (~1–2 weeks)

Option A formalised into a real replication layer, still without server physics.

- Shared `RemoteEntityInterpolator` (games/common): remote entities render from a 100–150 ms interpolation buffer of timestamped states (standard snapshot interpolation), eliminating the rubber-banding a naive lerp gives under jitter. Local entities stay predicted/simulated locally.
- Server gains a lightweight per-room tick (10–20 Hz, only while a room has moving entities): rebroadcasts latest known entity states and — for owners who go silent — advances them with the **existing, currently-dead** server `stepArenaBall` as a fallback extrapolator. This gives spectators, reconnects, and replays a live source of truth.
- Replicate mid-flight power effects (closes R5): pickup layouts become server-generated and delivered in the snapshot (Bamboo Bash's `powerPickups` snapshot field is the template — reuse it in `BaseArenaEngine`), and a generic `entity:event` input/broadcast pair carries "pickup collected / split / mirror" so both screens show the same effects.
- Input ack/nack on `game:input` (closes the soft-lock): server replies `{accepted:false, reason}` so the client can restore the slingshot.
- Shared HUD contract: both players' shot progress in the header (kills perceived desync).

Fixes: R1, R2 (for remote entities), R3, R5, R6, secondary defects. R4 largely converges because both screens agree on positions to within one buffer window. R7 remains.
Risk: moderate — touches the online controllers of all four games, but the controllers shrink because per-game `syncBalls`/`playThrow` logic moves into the shared runtime.

### Option C — Server-authoritative simulation (the real fix, ~3–5 weeks)

Move physics to the server; clients send inputs and render snapshots.

- Extract a **shared deterministic physics package** consumed by both frontend and backend. The two codebases already contain near-identical constants and stepping logic (client `ball-core.ts` vs server `replay-state.helpers.ts:497-542` — friction 0.985, bounce damp 0.8, min speed 6): unify them into one module with a fixed-timestep accumulator and seeded RNG, so the current copy-drift between the two implementations (itself a latent desync source) disappears.
- `BaseArenaEngine` gains a fixed-tick room loop (e.g. 30 Hz simulate, 10–15 Hz broadcast): steps all balls, resolves collisions, detects bell/target hits, applies zone multipliers and pickups. Per-game engines reduce to a rules object (spawn layout, scoring table, round structure) — matching the modular goal exactly.
- Clients: local-ball prediction with server reconciliation (rewind/replay on correction) for responsive aiming; everything else rendered from the interpolation buffer of Option B (Option B's client work is a strict subset of C, so B → C is an incremental path, not a rewrite).
- Scoring moves server-side (closes R7 — clients report nothing; the server *sees* the bell hit). The `bell:hit`/`round:score` inputs are deleted; the cheating surface and the trust problem go with them.
- Replays become exact for free: the replay service records authoritative frames instead of client claims.

Fixes: everything (R1–R7).
Risk/cost: highest — server CPU per room (trivial for these entity counts), a shared-package build step, and prediction/reconciliation tuning. This is the industry-standard architecture for this genre of game.

### Option D — Deterministic lockstep (alternative to C, similar effort, different trade-offs)

Keep simulation on clients but make it bit-identical: fixed timestep with an accumulator, seeded shared RNG (server distributes the seed per round), deterministic entity iteration order, no `Math.random` in gameplay, and replicate **only inputs**. Near-zero bandwidth and no server CPU, but: JS floating-point determinism across browsers is achievable yet fragile, one missed nondeterminism source silently reintroduces desync (with no correction channel to hide it), and it does nothing for R7 (still client-trusted outcomes) without adding hash-verification. Given that Option C reuses more of what already exists (the server stepper, snapshot plumbing) and also solves cheating, **C is recommended over D** if a large option is chosen.

---

## 5. Recommendation

Ship **Option A immediately** — it is small, it reuses helpers that already exist and are tested, and it turns "two different matches" into "one match with slightly laggy remote balls". Then build **Option B's interpolation buffer and generic entity-event channel** as the shared module all four games adopt, and treat **Option C** as the target architecture, reached incrementally: B's client work carries over unchanged, and the server tick added in B becomes C's simulation loop by swapping "rebroadcast last-known" for "step the shared physics".

Independent of the option chosen, four cheap fixes are worth doing in the very first pass: apply throw positions in `playThrow`, add position to `bell:hit`, send a settle message via `settleArenaReplayBall`, and add the input ack/nack to remove the "Launching…" soft-lock.

---

## 6. Server-authoritative implementation record

### Current safe state

The failed 2026-07-12 experiment was removed before the Bell Clash implementation
described above. The replacement keeps `game:state` as lifecycle-only and uses a
dedicated projection contract, avoiding the scene initialisation regression.

The remaining rollout rule is unchanged: do not connect Bamboo Bash, Kame Knock,
or Shell Curl to the Bell loop until each game has equivalent backend rules and
its own validation gates.

### Completed Bell Clash order

1. Established a manually-tested baseline before changing netcode. Started the
   normal development stack and verify launch input, HUD panels, round flow,
   reconnect, spectator entry, and replay capture in Bell Clash, Bamboo Bash,
   and Kame Knock.
2. Added a distinct `game:physics-state` event and a typed payload containing
   only match id, monotonically increasing physics sequence, server timestamp,
   and entity transforms. It must not carry round or UI fields.
3. Implemented the backend fixed-step loop for Bell Clash. It simulates and
   publishes `game:physics-state` at 30 Hz while entities move, plus immediate
   launch and final settled projections.
4. Added a dedicated Bell Clash physics-state listener that only updates
   interpolation targets and authoritative projection. It must not call
   `applySnapshot`, `startRound`, reset logic, or HUD/countdown methods.
5. Added automated tests for fixed-step advancement, monotonic sequence numbers,
   final settled-state emission, replay-frame capture, and that physics events
   do not invoke scene lifecycle methods. Then manually test two browsers at
   different frame rates, delayed network conditions, reconnect, and spectator
   join before enabling the flag by default.
6. Moved Bell Clash wall/bell collision, projectile collision, active powers,
   pickups, hit detection, zone multiplier, score, settlement, and round
   completion into the backend tick. Client scoring actions are rejected.
7. Applied the projection event to Bamboo Bash with game-specific server rules.
   Idle player shells are authoritative physics entities, so the first launch can
   collide with the opponent and round resets do not remove either turtle.

### Next-session work order

1. Finish the Bamboo Bash validation matrix: two players, powers and pickups,
   scoring, full three-round match, reconnect, spectator entry, and responsive
   relayout. Preserve the current branch as the rollback point until this passes.
2. Make the online score presentation consistent without changing physics:
   Bell Clash should display the server-authoritative hit value rather than the
   literal `SERVER`; Bamboo Bash should append authoritative `scoreEvents` to its
   score log. Confirm the HUD, side panel, and log agree on live-round and total
   values.
3. Capture a stable Bamboo Bash checkpoint after the score presentation pass.
4. Only then begin Kame Knock. Reuse the separated projection transport, but write
   Kame-specific backend target, turn, and power rules before changing its client.
   Keep Shell Curl as a separate future design because its persistent turn-based
   stones have different authority and settlement requirements.

### Non-negotiable constraints

- Keep the existing full `game:state` event for lifecycle changes only.
- Roll out one game at a time under a feature flag; retain the prior path until
  manual validation passes.
- Do not make a ranked claim until server-side collision, pickup, scoring, and
  settlement rules are complete for that game.
- Test UI interaction and scene transitions as part of every netcode change;
  compilation and engine unit tests did not detect the prior regression.
