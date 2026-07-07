# Games Common Code — Fix Report and Bug Audit

Report date: `2026-07-07`

## Context

This report follows up on `docs/games-common-code-audit.md` and `docs/common-code-extraction-checkpoint.md`. It re-audits the codebase against the problems described there (residual duplication, partially extracted abstractions) and catalogues concrete bugs, broken edge cases, and user-facing failure modes discovered during the review, with fixes for each.

The checkpoint noted that runtime validation could not be completed because `npm` was unavailable. That validation has now been run, and it found real failures (see "Verification Performed" below).

## Scope Reviewed

- Extracted shared modules: `frontend/src/shared/mechanics/player-config.ts`, `round-flow-hud.ts`, `arena-power-runtime.ts`, `frontend/src/games/shared/localReplay.ts`, `backend/src/modules/matchmaking/engines/base-arena.engine.ts`
- Game scenes: `BambooBashScene.ts`, `KameKnockScene.ts`, `BellClashScene.ts`, `ShellCurlScene.ts`
- Backend: `bamboo-bash.engine.ts`, `kame-knock.engine.ts`, `bell-clash.engine.ts`, `shell-curl.engine.ts`, `base.engine.ts`, `replay-state.helpers.ts`, `matchmaking.gateway.ts`, `game-session.service.ts`
- Shared mechanics feeding the runtime: `ball.ts`, `ball-powers.ts`, `ball-spawn-powers.ts`, `power-pickups.ts`, `slingshot.ts`

## Verification Performed

- `frontend: npx vitest run src/games/shared/localReplay.test.ts src/shared/mechanics/arena-power-runtime.test.ts` → **both test files fail** (details in A1 and A2).
- `backend: npx jest src/modules/matchmaking` → 5 suites, 55 tests, all pass. However, **no spec file covers any game engine** (`base-arena.engine.ts` and the four game engines have zero direct tests).
- Every finding below was verified against the current source, with file and line references.

---

# A. Regressions Inside the Extracted Shared Code

These are defects in the code the checkpoint marked `Completed`. They should be fixed before phases 4–6 build on top of them.

## A1. `SceneReplayRecorder` game-time `deltaMs` is silently discarded — shipped test fails

**Severity: High (data quality of every saved local replay). Status: confirmed by failing test.**

`SceneReplayRecorder.captureSnapshot()` computes `deltaMs` from accumulated game time (`this.elapsedMs`, fed by `addElapsed(delta)`). But `normalizeReplayImportFrames()` (`localReplay.ts:315-323`) recomputes `deltaMs` for every frame after the first from wall-clock `recordedAt` timestamps, throwing the recorder's value away.

Consequences:

- Frames captured within the same wall-clock millisecond get `deltaMs: 0`. The shipped test `"records local replay frames through the shared recorder runtime"` expects `deltaMs: 120` and receives `0` — it fails on every run.
- Replays recorded while the tab throttles or the game pauses inherit inflated wall-clock gaps instead of game-time gaps, so playback timing is wrong precisely in the cases the recorder's game clock was designed to handle.

**Fix:** in `normalizeReplayImportFrames`, prefer the recorder-provided value: `deltaMs: frame.deltaMs ?? <wall-clock fallback>`. Apply the same rule in the compaction branch (`localReplay.ts:337-354`). Keep the wall-clock computation only for imported frames that carry no `deltaMs`. Then re-run the test — it encodes the correct contract already.

## A2. `arena-power-runtime.test.ts` cannot execute — the module is untestable as extracted

**Severity: High (the checkpoint's claimed coverage is zero tests).**

The suite fails at import time: `arena-power-runtime.ts` imports `player-renderer.ts` and `ball.ts`, which import Phaser, which crashes under jsdom without a canvas implementation (`TypeError: Cannot set properties of null (setting 'fillStyle')`). Result: `Tests: no tests` — the coverage claimed in the checkpoint for this module has never actually run.

**Fix (pick one, first is preferred):**

1. Split the module: pure logic (`applyArenaBallPowerCycle`, `updateArenaPowerBalls`, `resolveArenaPowerBallCollisions`) into a Phaser-free file, and rendering (`drawArenaPowerBalls`, `clearArenaPowerBallTextures`) into a `arena-power-runtime.render.ts` that imports Phaser. This also matches the audit's guidance to keep contracts separate from rendering.
2. Or add the `canvas` package as a dev dependency / configure a Phaser mock in the vitest setup so the suite can load.

## A3. `updateArenaPowerBalls` return-value contract is misused by 2 of 3 callers

**Severity: High (unbounded array growth, repeated "settled" events, ghost collisions).**

The runtime returns the still-moving entries and expects the caller to adopt that as the new list. No scene does:

- `BambooBashScene.updatePowerBalls` (`BambooBashScene.ts:2548-2566`) discards the return value entirely.
- `BellClashScene.updatePowerBalls` (`BellClashScene.ts:538-548`) discards it too.
- `KameKnockScene.updatePowerBalls` (`KameKnockScene.ts:1483-1492`) uses the return only to check target hits and never prunes `this.powerBalls`.

Consequences: settled auxiliary balls stay in `powerBalls` forever, so (a) `onSettled` re-fires for them **every frame** (the handlers only survive because the power flags happen to be idempotent), (b) they keep participating in `resolveArenaPowerBallCollisions` and can knock live balls around, (c) the array and its textures grow for the whole match.

**Fix:** make the runtime own its list. Convert the free functions into a small `ArenaPowerRuntime` class holding the entries internally, pruning settled ones after `onSettled` fires exactly once, and exposing `push(entries)`, `update(delta, handlers)`, `draw(...)`, `clear()`. This removes the misuse-prone return-value contract and deletes ~40 duplicated lines per scene.

## A4. Auxiliary power balls are never cleared at online round/turn boundaries

**Severity: High (user-visible: leftover split/mirror balls from a previous round sit on the field and still collide).**

`clearPowerBalls()` is called only in `create()` (all three scenes) plus `setupBallRound()` (kame local) and `setupShot()` (bell local). It is **not** called in:

- `BambooBashScene.startOnlineRound()` (`BambooBashScene.ts:1064-1111`)
- `BellClashScene.startOnlineRound()` (`BellClashScene.ts:1124-1154`)
- Kame-knock's online turn transition (server `resetArenaReplayBalls` resets its own state, but the scene keeps local `powerBalls` forever).

**Fix:** call the runtime's `clear()` from every round/turn reset path. Once A3's `ArenaPowerRuntime` exists, expose a single `resetForRound()` and call it from the (future) `GameRuleHooks.onRoundStart` so this class of bug cannot recur.

## A5. SPLITTER discards the centre child but leaves the parent at full size/speed

**Severity: Medium (gameplay/visual inconsistency; confirm intent).**

`applyArenaBallPowerCycle` (`arena-power-runtime.ts:36-42`) takes `createSplitBalls(ball)` — which returns three balls at `SPLITTER_RADIUS` (0.75×) and 0.85× speed — keeps `children[0]` and `children[2]`, and throws away `children[1]`. The parent ball is not modified, so a "split" produces one full-size, full-speed ball plus two smaller, slower ones, rather than three matched fragments.

**Fix:** if three equal fragments are intended, copy `children[1]`'s `r`, `vx`, `vy` onto the parent inside the SPLITTER branch. If the current behaviour is intended, document it in the function docstring and in `ball-spawn-powers.ts` so the next extraction pass doesn't "fix" it blindly.

## A6. `buildHudStateFromRoundFlow` hardcodes `hasHammer: false`

**Severity: Low.** Fine for the three arena games, but the adapter is the designated shared HUD path; when shell-curl migrates onto it the hammer indicator will silently vanish. **Fix:** accept an optional `hasHammer` in `RoundFlowState` defaulting to `false`.

---

# B. Backend Engine and Gateway Bugs

## B1. Server-side replay simulation is dead code — and buggy if ever wired up

**Severity: High (explains several downstream symptoms).**

`advanceReplaySimulation` / `markReplaySimulation` (`replay-state.helpers.ts:646-669`) are exported but **never called anywhere in the backend**, and the server never emits `game:state-delta` (zero occurrences in `backend/src`). Meanwhile `BambooBashScene` registers `socket.on("game:state-delta", this.applyOnlineDelta)` (`BambooBashScene.ts:959`) for an event that can never arrive, and comments in the scene describe server-echoed ball state that does not exist.

On top of that, the dormant implementation has a real bug: `advanceSnapshot` (`replay-state.helpers.ts:607-625`) uses `Array.prototype.some(...)` to step entities. `.some()` short-circuits on the first entity that returns `true`, so with two or more moving balls/stones **only the first one would ever be simulated per tick** — the rest would freeze mid-air. Same problem in the curling branch.

Consequences today: between `release` and the next client sync, server-side snapshots (and therefore recorded online replays and spectator state) show balls frozen at their launch position with a nonzero velocity.

**Fix (decide explicitly):**

1. Either wire the simulation up — a per-room interval (e.g. 100 ms while `hasSnapshotMotion`) that calls `advanceReplaySimulation` and emits `game:state-delta` — after replacing `.some(...)` with `.map(...).includes(true)` (or a `for` loop accumulating `changed`), or
2. Delete `advanceReplaySimulation`, `markReplaySimulation`, `replayLastSimulationAt`, and the frontend's `applyOnlineDelta` listener, and document that opponent motion comes from local re-simulation plus the periodic sync inputs.

Leaving it half-wired invites someone to enable it and ship the `.some()` freeze bug.

## B2. Match can stall forever: no server-side round deadline

**Severity: High (user-facing online: one idle player soft-locks the match).**

- Bamboo Bash and Bell Clash only advance when **every** player submits `round:score`; Kame Knock only advances when the current player submits `settled`.
- `roundEndsAt` is set by the bamboo engine (`bamboo-bash.engine.ts:273-276`) but **no backend code ever reads it**. Kame and bell have no deadline at all.
- Disconnections are covered (away timeout → `finishAbandonedMatch`), but a player who stays connected and simply never submits (crashed scene, background tab that stops its game loop, or deliberate griefing) freezes the match for everyone. The opponent sees "Waiting for opponents..." forever, with no server escape hatch.

**Fix:** add a deadline sweep to the (future) `BaseArenaEngine` lifecycle: when `roundEndsAt + grace` passes, auto-submit `liveRoundScores[side]` for every side that has not reported (`roundScores[side] = liveRoundScores[side] ?? 0`) and advance the round. For kame-knock, add a per-turn deadline (max plausible ball-flight time, e.g. 20 s after the `release`) that force-settles the turn. This belongs in the `GameRuleHooks` extraction (phase 6) as a shared `enforceDeadlines(now)` hook driven by a single gateway interval.

## B3. Client-authoritative scoring is trivially exploitable

**Severity: High (competitive integrity; ranked mode applies Elo from these scores).**

- **Bell Clash** (`bell-clash.engine.ts:112-137`): any connected player with `shotCounts > 0` can emit unlimited `bell:hit` inputs; each accepts up to 10 000 points. There is no per-shot hit budget and no plausibility check — a script can post millions of points per round.
- **Kame Knock** (`kame-knock.engine.ts:123-165`): `combo` (≤99) and `perfect` are taken from the client. One legitimate target hit can be reported as `points × 99 + 500`.
- **Shell Curl** (`shell-curl.engine.ts:126-174` + `replay-state.helpers.ts:431-495`): `applySettled` replaces the entire server object list with whatever the client sends — positions decide end scoring, so a client can teleport its stones onto the button. There is also **no cap on `payload.objects` length**, so a hostile client can send tens of thousands of objects and inflate server memory/CPU (each is mirrored into `entities`).
- **Bamboo Bash** is the healthiest (server owns bamboo state and points), which is the model to generalise.

**Fixes:**

1. Bell: track hits per release server-side — accept at most `floor(flightTime / HIT_COOLDOWN_MS)` hits per shot, or simply a hard cap (e.g. 12) per release, and validate points against `BASE_HIT_SCORE × max multiplier`.
2. Kame: keep the combo counter in the snapshot (reset on `release`, incremented per accepted `target:hit`), ignore the client value; recompute `perfect` bonus server-side or cap its frequency.
3. Shell-curl: cap `objects.length` to `turnNumber + 1`, reject ids the server never issued, and clamp per-turn displacement.
4. Long term, this is the strongest argument for finishing `LaunchSnapshotEntity` / `WorldObjectSnapshot` (audit backlog #5): a shared, validated serialisation layer is where these checks belong.

## B4. Power validation exists only in Bamboo Bash

**Severity: Medium.**

`BambooBashEngine.consumePower` enforces `ALLOWED_POWERS`, `powerupsEnabled`, and one-use-per-round. Kame (`kame-knock.engine.ts:111-118`) and bell (`bell-clash.engine.ts:100-107`) accept `String(payload.power)` unvalidated and ignore `powerupsEnabled`; the gateway then relays the raw string to all clients (`matchmaking.gateway.ts:534,582`) and stores it on the replay entity. Receiving scenes coerce unknown strings to `NONE`, so the practical impact is polluted replay data plus powers usable in "powerups disabled" matches by modified clients.

**Fix:** move `consumePower` into `BaseArenaEngine` with a per-game allowlist and call it from all three `applyRelease` implementations.

## B5. Kame-knock `roundTargetSets` map leaks on abandoned matches

**Severity: Medium (slow server memory leak).**

`KameKnockEngine.roundTargetSets` is keyed by `matchId` and deleted only on the natural finish path (`kame-knock.engine.ts:194`). Matches that end via `abandon()` — or any error path — leave their target sets in the map forever.

**Fix:** delete the entry in `abandon()`; better, add an `onRoomClosed(matchId)` hook to `GameEngine` that the session service calls for every terminal state, so per-match engine caches cannot leak by construction.

## B6. Shell-curl `abandon()` is wrong for more than two players

**Severity: Medium (wrong winner shown, wrong Elo applied).**

`shell-curl.engine.ts:97-99` returns `abandonedPlayer.side === 0 ? 1 : 0`. The engine allows up to `MAX_PLAYERS = 5`; in a 3+ player match, whoever abandons hands the win to a hardcoded side regardless of scores or who is still connected.

**Fix:** shell-curl extends `BaseEngine`, not `BaseArenaEngine`, so it cannot reach `resolveAbandonWinner`. Move `resolveAbandonWinner` and `getWinnerSide` (currently duplicated verbatim in `shell-curl.engine.ts:233-239`) up into `BaseEngine` and use them here.

## B7. Shell-curl `applySettled` has no turn idempotency guard

**Severity: Medium (edge case corrupts match state).**

`applyRelease` guards against duplicates (`objects.some(o => o.id === turnNumber)`), but `applySettled` (`shell-curl.engine.ts:126-174`) validates only `player.side === state.currentTurn`. Edge case: when an end completes, `nextTurn()` returns `0` (`throwsInEnd === 0`), so if player 0 threw the last stone of the end, they are immediately the current turn again — a duplicated or late `settled` packet from them is accepted a second time, advancing `turnNumber`/`throwsInEnd` and re-syncing (possibly empty) objects. Kame-knock already solves this by echoing and checking `turnNumber`; shell-curl should do the same.

**Fix:** include `turnNumber` in the settled payload and reject mismatches (client already knows it).

## B8. `persistFinishedRoom` indexes players by array position, not side

**Severity: Medium (wrong `winnerUserId` persisted if ordering ever diverges).**

`game-session.service.ts:109-110`: `room.players[winnerSide].user.id`. Everywhere else the codebase deliberately looks players up by `player.side` because array order is not guaranteed to equal side. **Fix:** `room.players.find(p => p.side === winnerSide)?.user.id ?? null`.

## B9. Engines have zero direct test coverage

The matchmaking suites pass (55 tests) but none instantiate an engine. Every bug in B1–B7 would have been reachable by a plain unit test (`createInitialState` → `start` → scripted `handleInput` calls). **Fix:** add `*.engine.spec.ts` per engine plus one for `BaseArenaEngine`, covering: happy-path round flow, duplicate/late/foreign-turn inputs, abandon with 2 and with 3+ players, score-cap validation, and the round-deadline behaviour once B2 lands. These tests are also the safety net phases 4–6 need.

---

# C. Frontend Scene Bugs (User-Facing)

## C1. Online power pickups are desynchronised in Kame Knock and Bell Clash

**Severity: High (two players in the same match see different worlds).**

Only Bamboo Bash mirrors server pickups (`snapshot.powerPickups` → `setPickups`, `BambooBashScene.ts:2481-2494`) and reports collections (`bamboo:power-pickup` action, handled by the engine and relayed by the gateway). In Kame Knock and Bell Clash:

- `spawnPowerPickup()` spawns pickups with **local RNG even in online matches** (`KameKnockScene.ts:1450-1465`, `BellClashScene.ts:1370-1385`) — each client rolls different pickups at different positions.
- `collectPowerPickup()` applies the power locally and **never notifies the server or the opponent** (no `kame:power-pickup` / `bell:power-pickup` input action exists in the engines).
- The gateway's `game:kame-power-pickup` / `game:bell-power-pickup` events (`matchmaking.gateway.ts:544-553, 592-601`) fire only when a release carries `power !== "none"` — which the UI can never produce, because in both scenes the power panel is constructed read-only with a no-op `onSelect` and `activePower` is only ever assigned `PowerType.NONE`. The scenes' `handleOnlinePowerPickup` listeners therefore wait for events that never fire.

Net effect online: your ball turns giant / splits on your screen; your opponent's client, simulating your ball without that knowledge, shows a different trajectory and size until the next hard sync snaps it around. Pickups you can see may not exist on the opponent's screen at all.

**Fix:** generalise the Bamboo Bash model into `BaseArenaEngine` — server-owned pickup list in the snapshot, a shared `power-pickup` input action, and a shared relay event. This is precisely the audit's `CollectibleDescriptor` (phase 5); given the user impact, it should be promoted ahead of `ObstacleDescriptor` (phase 4).

## C2. Giant/Tiny balls render at 4×/0.25× online (double scaling)

**Severity: High (clearly visible visual bug; render size ≠ collision size).**

On a throw event, scenes call `applyArenaBallPowerCycle`, and `applyBallPower` multiplies the ball's physical radius (`r *= GIANT_RADIUS_FACTOR` = 2). The server independently sets `entity.scale = 2` via `applyReplayPowerVisuals` (`replay-state.helpers.ts:153-164`), the scenes copy it onto the ball (`syncOnlineBalls`), and `drawBalls` multiplies again: `renderRadius = ball.r * (ball.scale ?? 1)` (`BambooBashScene.ts:1525`, `KameKnockScene.ts:1958`, `BellClashScene.ts:2134`). Result: giant renders at 4× (collides at 2×), tiny renders at 0.25× (collides at 0.5×). After the ball stops and `r` is reset to base, the stale server `scale` keeps it drawn at 2× while colliding at 1×.

**Fix:** pick one radius source. Recommended: treat the server `scale` as authoritative for rendering **only when the local power cycle has not already resized `r`** — simplest is to stop multiplying by `ball.scale` for balls that went through `applyArenaBallPowerCycle`, i.e. drop the `renderRadius` multiplication and rely on physical `r` (which also fixes the collision/render mismatch). Reset the cached `scale` when the ball settles.

## C3. Resizing the window during a round-transition overlay shows a false "game end" modal

**Severity: High (mid-game soft lock).**

Both `KameKnockScene.relayout()` (`KameKnockScene.ts:2332-2344`) and `BellClashScene.relayout()` (`BellClashScene.ts:2378-2391`) handle any live `this.overlay` by destroying it and then, if the online snapshot is not finished/abandoned, calling `showEndScreen()`. But `this.overlay` is also used for the **round-transition** overlay ("ROUND 2 — NEXT ROUND"). Resizing during that window (kame local play pauses on a button-gated overlay, so the window is large) destroys the transition overlay — losing its `onButton` callback that resumes the game — and replaces it with the end-of-game modal showing incomplete scores. The only ways out are PLAY AGAIN or RETURN: the match in progress is lost.

**Fix:** track what the overlay is (`"round-transition" | "end-modal"`) and rebuild the same kind on relayout, re-wiring the original callback. This adapter is a natural part of the shared HUD/overlay layer (`round-overlay.ts` could return a rebuildable descriptor instead of a bare container).

## C4. Socket listener leaks: pickup handlers are never unregistered

**Severity: Medium (duplicate event handling after rematch/scene reuse).**

- `KameKnockScene.cleanupSceneResources()` (`KameKnockScene.ts:516-521`) removes `game:state`, `game:end`, `game:kame-throw` but **not** `game:kame-power-pickup` (registered at `KameKnockScene.ts:913`).
- `BellClashScene.cleanupSceneResources()` (`BellClashScene.ts:450-455`) similarly omits `game:bell-power-pickup` (registered at `BellClashScene.ts:1044`).

Because the socket is a singleton, every rematch/restart stacks another handler; stale handlers from a destroyed scene then run against dead scene objects. Bamboo Bash removes all five of its listeners — the inconsistency is exactly the kind of drift the audit's shared online lifecycle was meant to remove.

**Fix (immediate):** add the missing `socket.off(...)` calls. **Fix (structural):** extract a shared `OnlineSceneChannel` helper that takes a table of `{event: handler}` pairs and guarantees symmetric on/off — all four scenes repeat this block today.

## C5. Snapshot `seq` guards are inconsistent and mix event streams

**Severity: Medium (risk of dropping the final "finished" snapshot).**

- Bamboo uses `snapshot.seq <= lastOnlineSeq` (drops equal), kame/bell use `<` (accept equal) — same logic, three spellings.
- Bamboo additionally writes `delta.seq` from `applyOnlineDelta` into the same `lastOnlineSeq` counter. Deltas are dead today (B1), but the moment they are wired up, a delta arriving with seq N would cause the full snapshot with seq N — potentially the `phase: "finished"` one — to be discarded, and the end screen would never show.

**Fix:** one shared `applySnapshotGuard(snapshot)` in the online-scene helper; keep full-state and delta sequence tracking separate (or make deltas carry their base snapshot seq).

## C6. FREEZE power silently does nothing in online Bamboo Bash

**Severity: Medium (player buys/uses a power with zero effect).**

Locally, FREEZE sets `spawnFreezeMs` and pauses spawn/growth. Online, bamboo state is server-owned and the engine has no freeze concept — `updateSharedBamboos` keeps spawning/growing regardless. The client still sets its local flag, which affects nothing the server won't overwrite on the next snapshot.

**Fix:** either implement a `freezeUntil` timestamp in the bamboo snapshot (set when a freeze ball settles, respected by `updateSharedBamboos`), or filter FREEZE out of the online power pools until it exists server-side.

## C7. Bell Clash relayout rerolls power pickups on every window resize

**Severity: Low-Medium (also a mild exploit: resize until a pickup lands next to your ball).**

`BellClashScene.relayout()` calls `recreatePowerPickups()` + `spawnPowerPickup()` (`BellClashScene.ts:2366-2367`), which clears and randomly respawns pickups mid-shot. Other scenes rescale positions instead. **Fix:** rescale existing pickup coordinates by the arena ratio (same as balls) instead of respawning.

## C8. Duplicated/dead initialisation and code debris

**Severity: Low individually; collectively they blur the extraction boundaries.**

- `BambooBashScene.create()` runs `recreatePowerPickups()` twice (`:404`, `:477`) and `spawnPowerPickup()` twice (`:473`, `:478`).
- `BambooBashScene.buildLocalReplaySnapshot` has the no-op conditional `mode: this.isLocalVersus() ? "casual" : "casual"` (`:1995`) and sets `nextBambooId: this.bamboos.length` (should be max id + 1).
- Dead code kept "for reference": `KameKnockScene.drawShellIcon` (`:2348-2369`), `BellClashScene.drawZoneIcon` (`:2400-2432`), `BellClashScene.checkBellHit()` wrapper (`:726-728`).
- Kame/bell track `powerUsed` and send `payload.power` on release, but `activePower` can never leave `NONE` in those scenes (read-only panel, no-op `onSelect`) — either wire pre-shot power selection or delete the tracking.
- `pendingReplayPersist` is awaited before restart only in kame-knock (`waitForPendingReplayPersist`); bamboo, bell and shell-curl fire-and-forget. Standardise (persist can live on `SceneReplayRecorder`).
- `graphify-out/` build artifacts are committed inside source trees at `frontend/src/games/graphify-out/` and `backend/src/modules/matchmaking/engines/graphify-out/` (graph.json, manifest.json, cache). Delete and gitignore.

## C9. `power-pickups.ts` uses Phaser at runtime through a type-only import

**Severity: Low today, breakage risk under any bundler/test change.**

`import type Phaser from "phaser"` (`power-pickups.ts:1`) is erased at compile time, yet the module calls `Phaser.Math.RND.pick` and `Phaser.Math.FloatBetween` at runtime (`:90`, `:173-174`, `:195`). It only works because Phaser's UMD bundle happens to set the global `Phaser` when another module imports it first. Under a stricter ESM build, tree-shaking, or in tests, this throws `ReferenceError: Phaser is not defined`. **Fix:** use a real import (or `Math.random`-based helpers to keep the module Phaser-free, which also helps A2-style testability).

---

# D. Recommended Fix Order

## Phase 0 — Stabilise what is already extracted (before phases 4–6)

1. A1 (replay deltaMs) + re-enable its test.
2. A2 (split arena-power-runtime into pure + render; make the suite run).
3. A3 + A4 (ArenaPowerRuntime owns its list; clear at all round boundaries).
4. C4 (missing `socket.off`) and C3 (relayout overlay kind) — small, user-facing.
5. B1 decision (wire or delete the dead server simulation; fix `.some()` if kept).

## Phase 1 — Online integrity (highest user impact)

6. C1 via `CollectibleDescriptor` in `BaseArenaEngine` (promote audit phase 5 ahead of phase 4): server-owned pickups + shared pickup action for all three arena games.
7. C2 (single radius source for power visuals).
8. B2 (server round/turn deadlines) — belongs to the `GameRuleHooks` extraction.
9. B3 + B4 (score plausibility checks, shared `consumePower`).

## Phase 2 — Backend hardening and hygiene

10. B5 (engine cache lifecycle hook), B6 (`resolveAbandonWinner` to `BaseEngine`), B7 (settled turn guard), B8 (winner lookup by side).
11. B9 (engine spec files — write them alongside each fix above so every fix lands with a regression test).
12. C5–C9 cleanups, folded into the touched files as they come up.

## Then resume the audit's phases 4–6

With the above fixed, `ObstacleDescriptor` (phase 4) and `GameRuleHooks` (phase 6) can be extracted onto a foundation that is actually tested and consistent, instead of copying today's leaks and desyncs into shared code.

---

# Module Status

`docs/modules-progress.md` was reviewed. This report documents defects and fixes without changing the functional completion status of any module, so no update to that file is required.

