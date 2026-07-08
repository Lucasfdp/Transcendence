# Common Code Extraction Checkpoint Between Minigames

## Context

This checkpoint summarises the work completed from
`docs/games-common-code-audit.md` through phase 7 of the
extraction process for the `arena + ball` family and its related shared
infrastructure.

Checkpoint date: `2026-07-08`

## Scope Applied

### Frontend

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
- `frontend/src/games/kame-knock/KameKnockScene.ts`
- `frontend/src/games/bell-clash/BellClashScene.ts`
- `frontend/src/games/shell-curl/ShellCurlScene.ts`
- `frontend/src/games/shared/localReplay.ts`
- `frontend/src/shared/mechanics/*`
- `frontend/src/games/bamboo-bash/bamboo.ts`
- `frontend/src/shared/mechanics/timed-targets.ts`
- `frontend/src/shared/mechanics/collectible-descriptor.ts`
- `frontend/src/shared/mechanics/power-pickups.ts`

### Backend

- `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`
- `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`
- `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`
- `backend/src/modules/matchmaking/engines/base-arena.engine.ts`

# Extraction Completed

## 1. Shared Player Visual Configuration

**Status:** `Completed`

Extracted into: - `frontend/src/shared/mechanics/player-config.ts`

This now centralises: - default skins - common `shellSkins` resolution
from the registry

### Impact

- Removes duplicated base skin arrays across the four audited scenes.
- Provides a single entry point for the minimum player visual
  configuration.

### Current limitation

A complete `PlayerEntityConfig` does not yet exist containing: -
`spriteKey` - `alpha` - `trailColor` - `renderMode` - `stateFlags`

## 2. Shared HUD Adapter for Round Flow

**Status:** `Completed`

Extracted into: - `frontend/src/shared/mechanics/round-flow-hud.ts`

This now centralises: - construction of `TurnState` from a generic round
state

### Impact

- Removes repeated mapping logic into `ScoreHud` across `bamboo-bash`,
  `kame-knock`, and `bell-clash`.

### Current limitation

- Round flow itself remains local to each scene.
- `GameRuleHooks` now describes the shared rule boundary, but round flow
  itself remains local to each scene.

## 3. Shared Local Replay Runtime

**Status:** `Completed`

Extracted into: - `frontend/src/games/shared/localReplay.ts`

New components: - `SceneReplayRecorder<TSnapshot>` -
`buildLocalReplayImportRequest()`

### Impact

Removes duplication of: - `initLocalReplayRecording()` - replay time
accumulators - periodic frame capture - frame compaction - replay import
payload construction

Each scene is now only responsible for building its own snapshot.

### Coverage

- `frontend/src/games/shared/localReplay.test.ts`

## 4. Shared Base Backend Engine for Arena Games

**Status:** `Completed`

Extracted into: -
`backend/src/modules/matchmaking/engines/base-arena.engine.ts`

This now centralises: - common arena room initialisation - `seq`
synchronisation - player refresh - player lookup by `userId` - winner
resolution by score - disconnect handling - common replay block for
initial entities and balls

### Impact

Reduces structural duplication across: - `bamboo-bash.engine.ts` -
`kame-knock.engine.ts` - `bell-clash.engine.ts`

### Current limitation

It does not yet absorb: - scoring hooks - release validation - settle
flow - advanced round progression

## 5. Shared Power Runtime for `arena + ball` Games

**Status:** `Completed` (first useful iteration)

Extracted into: - `frontend/src/shared/mechanics/arena-power-runtime.ts`

This now centralises: - applying ball powers on release - creation of
auxiliary balls for `SPLITTER` and `MIRROR` - shared updates for extra
balls, including friction and curl - common collision handling between
primary and auxiliary balls - shared rendering of the auxiliary ball
pool - cleanup of auxiliary textures

### Impact

- Significantly reduces functional duplication across `bamboo-bash`,
  `kame-knock`, and `bell-clash`.
- `KameKnockScene` now uses the same `powerBalls` structure as the
  other games: `{ ball, player }[]`

### Coverage

- `frontend/src/shared/mechanics/arena-power-runtime.test.ts`

### Current limitation

- Behaviour after balls come to rest remains game-specific.
- Pickup logic, scoring, and world effects are still implemented
  within each scene.

## 6. Shared Obstacle Descriptor

**Status:** `Completed` (first useful iteration)

Extracted into: - `frontend/src/shared/mechanics/obstacle-descriptor.ts`

This now centralises: - obstacle identity and type - normalised or
absolute position metadata - circular geometry and source/pixel/normalised
radius units - score value - collision semantics for blocking, bouncing,
breaking, and point awards - rendering metadata - optional hooks for hit,
expiry, and scoring

### Impact

- `bamboo-bash` bamboo, `kame-knock` timed targets, `bell-clash`'s
  central bell, and `shell-curl` bumpers now expose a common
  `ObstacleDescriptor` while retaining their game-specific growth,
  rendering, scoring, bounce, cooldown, and round rules.
- Shared helpers now resolve obstacle positions and radii against the
  active arena or absolute pixel geometry, test circular collisions, and
  build pickup blockers from circular obstacles.
- Existing `bambooPos`, `bambooRadius`, `hitsBamboo`,
  `timedTargetPosition`, `timedTargetRadius`, and `hitsTimedTarget`
  functions now route through the common descriptor helpers, preserving
  the public game APIs while removing duplicated geometry logic.
- Bell Clash's central bell collision and Shell Curl's bumper collision
  now use descriptor-derived position/radius data without moving their
  local gameplay-specific response logic into the shared layer.

### Coverage

- `frontend/src/shared/mechanics/obstacle-descriptor.test.ts`

### Current limitation

- Score zones in Bell Clash are still local because they are scoring
  regions rather than physical obstacles.
- Snapshot serialisation for world objects remains separate.

## 7. Shared Collectible Descriptor

**Status:** `Completed` (first useful iteration)

Extracted into: - `frontend/src/shared/mechanics/collectible-descriptor.ts`

This now centralises: - collectible identity and type - effect payload -
normalised or absolute position metadata - circular geometry and
source/pixel/normalised radius units - collect radius - common serialise
metadata - rendering metadata - optional collect and expiry hooks

### Impact

- `PowerPickupManager` now routes power pickups through a
  `CollectibleDescriptor` while keeping the existing `PowerPickup` API for
  scenes.
- Shared helpers now resolve collectible positions and radii, test
  circular collection, build blockers, and remap descriptor lists without
  mutating source values.
- Bamboo Bash's online pickup snapshot mapping now uses a shared
  normalised snapshot helper instead of local coordinate conversion.
- Power pickup rendering metadata, collection effect, and serialisation
  metadata now share one descriptor boundary.

### Coverage

- `frontend/src/shared/mechanics/collectible-descriptor.test.ts`
- `frontend/src/shared/mechanics/power-pickups.test.ts`

### Current limitation

- Backend authoritative Bamboo Bash pickup spawning still keeps its local
  normalised coordinate generator.
- Game-specific collection effects remain local to each scene or power
  runtime by design.

## 8. Shared Game Rule Hooks

**Status:** `Completed` (first useful iteration)

Extracted into: - `frontend/src/shared/mechanics/game-rule-hooks.ts`

This now centralises:

- the shared rule boundary for player count, active player, round index,
  remaining turns, score, phase, optional hammer state, winner
  computation, and lifecycle hooks for release, projectile settlement,
  obstacle hits, and round completion
- HUD state construction from generic game rule hooks

### Impact

- `bamboo-bash`, `kame-knock`, `bell-clash`, and `shell-curl` now expose
  their local rule state through `GameRuleHooks` when updating `ScoreHud`.
- The scenes keep their game-specific scoring, online/local state handling,
  round advancement, and projectile settlement logic local.
- `shell-curl` keeps `TurnManager` as the authority for ends, hammer,
  stones left, score, and phase; `GameRuleHooks` is only the shared
  boundary into HUD state.
- The shared layer now has a stable contract for future rule-flow
  extraction without introducing a base scene.

### Coverage

- `frontend/src/shared/mechanics/game-rule-hooks.test.ts`

### Current limitation

- The hooks are currently adopted for HUD state construction only across
  the audited games.
- Release, settlement, obstacle-hit, round-complete, and winner hooks are
  contract-level extension points for the next extraction pass.

# Current Status by Area

## Successfully extracted

- Basic player visual configuration
- HUD adapter
- Scene replay recorder
- Replay import payload builder
- Replay persistence runtime for local replay import and pending persistence
  waits
- Base arena engine
- Ball power lifecycle for the `arena + ball` family
- Shared obstacle descriptor for bamboo, timed targets, the bell, and
  bumpers
- Shared collectible descriptor for power pickups
- Shared game rule hooks for round HUD state plus lifecycle dispatch for
  release, projectile settlement, round completion, and winner resolution
- Unified projectile module: `ball.ts` now owns both oval arena ball helpers
  and rectangular-sheet curling-shell helpers

## Partially extracted

- `PlayerEntityConfig`
- `LaunchableActor`
- `BaseArenaEngine`
- `ArenaPowerRuntime`
- `ObstacleDescriptor`
- `CollectibleDescriptor`
- `GameRuleHooks`
- `LocalReplayPersistenceRuntime`

## Not yet extracted

- Shared frontend/backend contracts for `LaunchSnapshotEntity` and
  `WorldObjectSnapshot`

# Significant Duplication Still Remaining

- Gameplay rules and round flow
- World object implementations
- Pickup integration
- Snapshot contracts

# Risks and Considerations

- No shared base scene by design.
- `shell-curl` still keeps its rectangular arena, sweeping, house scoring,
  and turn-manager rules even though its projectile helpers now live in
  `ball.ts`.
- Bell Clash score zones are intentionally left local because they are not
  physical obstacles.

# Latest Applied Phases

## Phase 7

**Status:** `Completed` (first useful iteration)

Applied in:

- `frontend/src/shared/mechanics/game-rule-hooks.ts`
- `frontend/src/shared/mechanics/game-rule-hooks.test.ts`
- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
- `frontend/src/games/kame-knock/KameKnockScene.ts`
- `frontend/src/games/bell-clash/BellClashScene.ts`
- `frontend/src/games/shell-curl/ShellCurlScene.ts`

This now centralises:

- optional release notification through `GameRuleHooks`
- optional projectile-settled notification through `GameRuleHooks`
- optional round-complete notification through `GameRuleHooks`
- optional winner computation through `GameRuleHooks`

### Impact

- `KameKnockScene`, `BellClashScene`, and `ShellCurlScene` now route
  projectile settlement through shared hook dispatch while keeping their
  local scoring, turn advancement, and online state rules unchanged.
- `KameKnockScene`, `BellClashScene`, and `ShellCurlScene` now route launch
  side effects through shared release dispatch where that removes repeated
  post-release plumbing.
- `BambooBashScene` now routes timer-driven round completion through shared
  round-complete dispatch.
- Local replay winner serialisation now uses the shared winner-resolution
  hook in the migrated scenes where it was safe to do so.

### Coverage

- `frontend/src/shared/mechanics/game-rule-hooks.test.ts`

### Validation

- `cd frontend && npm run test:run -- src/shared/mechanics/game-rule-hooks.test.ts`
- `cd frontend && npm run build`

Results:

- Targeted frontend tests passed.
- Frontend production build passed.
- Vite still reports the existing large chunk warning.

### Current limitation

- Gameplay rule ownership remains local to each scene by design.
- Shared hooks now provide lifecycle dispatch points, but they do not yet
  model full round-flow state transitions or online authoritative
  settlement.

## Phase 8

**Status:** `Completed`

Applied in:

- `frontend/src/games/common/runtime/LocalReplayPersistenceRuntime.ts`
- `frontend/src/games/common/runtime/LocalReplayCaptureRuntime.ts`
- `frontend/src/games/common/runtime/LocalReplayRuntime.ts`
- `frontend/src/games/common/replay/LocalReplaySnapshots.ts`
- `frontend/src/games/common/runtime/LocalReplayPlayers.ts`
- `frontend/src/games/common/runtime/ReplayEntities.ts`
- `frontend/src/games/common/tests/LocalReplayPersistenceRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplayCaptureRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplayRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplaySnapshots.test.ts`
- `frontend/src/games/common/tests/LocalReplayPlayers.test.ts`
- `frontend/src/games/common/tests/ReplayEntities.test.ts`
- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
- `frontend/src/games/kame-knock/KameKnockScene.ts`
- `frontend/src/games/bell-clash/BellClashScene.ts`
- `frontend/src/games/shell-curl/ShellCurlScene.ts`

This now centralises:

- local replay persistence eligibility checks
- guest exclusion for replay import
- finished replay import payload construction
- replay player user-id mapping
- replay player metadata construction from registry user and shell skins
- replay participant context construction for player metadata, player names,
  and local replay user lookup
- replay projectile and stone entity list mapping
- `api.importReplay` success and failure logging through a shared callback
  boundary
- pending replay persistence ownership and wait/reset handling
- local replay start, interval capture, and forced frame capture
- local replay recorder ownership, elapsed-time accounting, capture
  accumulator resets, replay identifiers, replay sequence allocation, and
  capture/persistence runtime composition behind a single
  `LocalReplayRuntime`
- normalised arena projectile replay snapshot construction
- normalised curling stone replay snapshot construction
- per-game local replay snapshot assembly for Bamboo Bash, Kame Knock, Bell
  Clash, and Shell Curl through common-owned builders
- descriptor-driven replay world-object serialisation for Bamboo Bash
  bamboos, Kame Knock timed targets, and Shell Curl bumpers
- score-region descriptor serialisation for Bell Clash score zones, kept
  separate from `ObstacleDescriptor` because score zones are not physical
  obstacles

### Impact

- The four audited games no longer own duplicated `pendingReplayPersist`
  state.
- The four audited games no longer implement repeated
  `buildReplayImportFrames()` wrappers.
- The four audited games no longer implement repeated
  `buildLocalReplayPlayers()` metadata helpers.
- The four audited games now route replay entity list construction through
  common projectile or stone entity helpers instead of mapping directly in
  scene snapshots.
- Local replay persistence now goes through
  `LocalReplayPersistenceRuntime`, while scenes still provide their
  game-specific mode, player count, winner, and entity snapshots.
- Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl now wait through the
  shared runtime before restart or return actions that leave the local end
  overlay.
- Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl no longer instantiate
  `SceneReplayRecorder`, `LocalReplayCaptureRuntime`, or
  `LocalReplayPersistenceRuntime` directly.
- Scene-local wrappers named `initLocalReplayRecording()`,
  `captureReplayTick()`, `captureLocalReplayFrame()`,
  `persistLocalReplay()`, and `waitForPendingReplayPersist()` were removed
  from the four audited scenes.
- The old `buildLocalReplaySnapshot()` method name was removed from the four
  scenes, but this did not complete the intended extraction because the
  scene-specific snapshot bodies still live in each scene as
  `createLocalReplaySnapshot()`.
- `createLocalReplaySnapshot()` now delegates to common-owned per-game builders
  and keeps only local state gathering in the four audited scenes.
- Bamboo Bash, Kame Knock, and Shell Curl now pass obstacle descriptors into
  the replay snapshot builders for their replay world objects instead of
  constructing those snapshot objects directly in scene code.
- Bell Clash now passes score-region descriptors into the replay snapshot
  builder for score zones instead of treating them as obstacles.

### Line Reduction Audit

Measured against commit `57c84e7d` and commit `29a6ca76`:

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`: `95` insertions,
  `95` deletions, net `0`.
- `frontend/src/games/kame-knock/KameKnockScene.ts`: `61` insertions,
  `71` deletions, net `-10`.
- `frontend/src/games/bell-clash/BellClashScene.ts`: `71` insertions,
  `69` deletions, net `+2`.
- `frontend/src/games/shell-curl/ShellCurlScene.ts`: `62` insertions,
  `63` deletions, net `-1`.
- Combined scene net reduction: `-9` lines.

This is not sufficient for the intended Phase 8 outcome. The expected
direction for this phase is a substantial scene reduction by moving replay
snapshot construction out of the scenes, not only moving common replay
plumbing.

Corrective pass measured on 2026-07-08, before and after the
`LocalReplayRuntime` extraction in the working tree:

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`: `2896` to `2847`,
  net `-49`.
- `frontend/src/games/kame-knock/KameKnockScene.ts`: `2486` to `2450`,
  net `-36`.
- `frontend/src/games/bell-clash/BellClashScene.ts`: `2605` to `2565`,
  net `-40`.
- `frontend/src/games/shell-curl/ShellCurlScene.ts`: `2676` to `2632`,
  net `-44`.
- Combined scene net reduction after this corrective pass: `-169` lines.
- New shared runtime added:
  `frontend/src/games/common/runtime/LocalReplayRuntime.ts` (`88` lines).

Snapshot builder pass measured after the `LocalReplayRuntime` extraction:

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`: `2847` to `2773`,
  net `-74`.
- `frontend/src/games/kame-knock/KameKnockScene.ts`: `2450` to `2409`, net
  `-41`.
- `frontend/src/games/bell-clash/BellClashScene.ts`: `2565` to `2510`, net
  `-55`.
- `frontend/src/games/shell-curl/ShellCurlScene.ts`: `2632` to `2583`, net
  `-49`.
- Combined scene net reduction after this snapshot builder pass: `-219`
  lines.
- New shared snapshot builder module added:
  `frontend/src/games/common/replay/LocalReplaySnapshots.ts` (`420` lines).

Descriptor-driven world-object pass measured after the snapshot builder pass:

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`: `2773` to `2767`,
  net `-6`.
- `frontend/src/games/kame-knock/KameKnockScene.ts`: `2409` to `2412`, net
  `+3`.
- `frontend/src/games/bell-clash/BellClashScene.ts`: unchanged at `2510`.
- `frontend/src/games/shell-curl/ShellCurlScene.ts`: `2583` to `2585`, net
  `+2`.
- Combined scene net change after this descriptor pass: `-1` line.
- `frontend/src/games/common/replay/LocalReplaySnapshots.ts`: `420` to `492`
  lines.
- `frontend/src/games/common/tests/LocalReplaySnapshots.test.ts`: `152` to
  `211` lines.

Bell Clash score-zone descriptor pass measured after the descriptor-driven
world-object pass:

- `frontend/src/games/bell-clash/BellClashScene.ts`: `2510` to `2513`, net
  `+3`.
- `frontend/src/games/common/replay/LocalReplaySnapshots.ts`: `492` to `537`
  lines.
- `frontend/src/games/common/tests/LocalReplaySnapshots.test.ts`: `211` to
  `230` lines.

Replay participant context pass measured after the score-zone descriptor pass:

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`: `2767` to `2766`,
  net `-1`.
- `frontend/src/games/kame-knock/KameKnockScene.ts`: `2412` to `2411`, net
  `-1`.
- `frontend/src/games/bell-clash/BellClashScene.ts`: `2513` to `2512`, net
  `-1`.
- `frontend/src/games/shell-curl/ShellCurlScene.ts`: `2585` to `2584`, net
  `-1`.
- `frontend/src/games/common/runtime/LocalReplayPlayers.ts`: `23` to `40`
  lines.
- `frontend/src/games/common/tests/LocalReplayPlayers.test.ts`: `31` to `70`
  lines.

### Coverage

- `frontend/src/games/common/tests/LocalReplayPersistenceRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplayCaptureRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplayRuntime.test.ts`
- `frontend/src/games/common/tests/LocalReplaySnapshots.test.ts`
- `frontend/src/games/common/tests/LocalReplayPlayers.test.ts`
- `frontend/src/games/common/tests/ReplayEntities.test.ts`

### Validation

- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplayCaptureRuntime.test.ts src/games/common/tests/ReplayEntities.test.ts src/games/common/tests/LocalReplayPlayers.test.ts src/games/common/tests/LocalReplayPersistenceRuntime.test.ts src/games/shared/localReplay.test.ts src/shared/mechanics/game-rule-hooks.test.ts`
- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplayRuntime.test.ts src/games/common/tests/LocalReplayCaptureRuntime.test.ts src/games/common/tests/LocalReplayPersistenceRuntime.test.ts src/games/common/tests/ReplayEntities.test.ts src/games/common/tests/LocalReplayPlayers.test.ts src/games/shared/localReplay.test.ts`
- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplaySnapshots.test.ts src/games/common/tests/LocalReplayRuntime.test.ts src/games/common/tests/LocalReplayCaptureRuntime.test.ts src/games/common/tests/LocalReplayPersistenceRuntime.test.ts src/games/common/tests/ReplayEntities.test.ts src/games/common/tests/LocalReplayPlayers.test.ts src/games/shared/localReplay.test.ts`
- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplaySnapshots.test.ts src/games/common/tests/LocalReplayRuntime.test.ts src/games/common/tests/ReplayEntities.test.ts`
- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplaySnapshots.test.ts src/games/common/tests/LocalReplayRuntime.test.ts src/games/common/tests/LocalReplayCaptureRuntime.test.ts src/games/common/tests/LocalReplayPersistenceRuntime.test.ts src/games/common/tests/ReplayEntities.test.ts src/games/common/tests/LocalReplayPlayers.test.ts src/games/shared/localReplay.test.ts`
- `cd frontend && npm run test:run -- src/games/common/tests/LocalReplayPlayers.test.ts src/games/common/tests/LocalReplaySnapshots.test.ts src/games/common/tests/LocalReplayRuntime.test.ts`
- `cd frontend && npm run build`

Results:

- Targeted frontend tests passed.
- Frontend production build passed.
- Vite still reports the existing large chunk warning.

### Completed By The Corrective Pass

- Local replay recorder ownership has moved out of the four audited scenes
  into `LocalReplayRuntime`.
- Scene-local replay persistence wrapper methods named `persistLocalReplay()`
  have been removed from the four audited scenes.
- Scene-local capture wrapper methods such as `initLocalReplayRecording()`,
  `captureReplayTick()`, and `captureLocalReplayFrame()` have been removed
  from the four audited scenes.
- Per-game local replay snapshot assembly has moved into common-owned builders
  under `frontend/src/games/common/replay/`.
- Bamboo Bash bamboos, Kame Knock timed targets, and Shell Curl bumpers now
  serialise through obstacle descriptors at the replay builder boundary.
- Bell Clash score zones now serialise through score-region descriptors at the
  replay builder boundary.
- Replay player metadata, replay player names, and local replay user lookup now
  go through a shared participant context helper.
- The corrective pass reported line counts before and after for all four
  scene files.

### Closure Decision

Phase 8 is closed with `createLocalReplaySnapshot()` intentionally retained in
each scene as the minimal capture-runtime callback boundary.

This is deliberate rather than remaining extraction debt:

- The callback is now limited to state gathering and delegation into common
  replay builders.
- Removing the method would move equivalent scene-state access into inline
  lambdas or per-scene provider objects without removing meaningful
  complexity.
- Scene-specific replay player counts remain local by design because each game
  derives the active local player count differently; the user/player/player
  name mapping itself is shared.
- Replay entity list mapping now goes through common helpers, and replay world
  object mapping is descriptor-driven for the obstacle families that already
  expose descriptors.
- Projectile and stone replay entities remain state-driven because they are
  launch actors, not obstacle descriptors.

The final Phase 8 outcome is primarily architectural: replay ownership,
capture, persistence, player metadata, entity mapping, snapshot assembly, and
world-object serialisation are now centralised and covered by common tests.
The scene line reduction is meaningful but not massive because gameplay rules,
online synchronisation, scoring, rendering, and scene state ownership remain
local by design.

# Recommended Next Sequence

## Phase 9

Proceed to Phase 9. Further line reduction should target higher-level shared
gameplay/runtime flow, especially the `arena + ball` family, rather than
continuing to optimise the now-thin local replay callback boundary.

# Executive Summary

The project now includes genuine shared infrastructure for player
visuals, HUD adaptation, replay support, backend arena lifecycle
management, the shared power runtime for the `arena + ball` family, and a
common obstacle contract adopted by the audited physical obstacles.
Power pickups now also expose a common collectible contract, and the
audited arena games expose HUD-facing round state and lifecycle dispatch
through shared `GameRuleHooks`, including Shell Curl's `TurnManager` state.
Local replay persistence, pending persistence waits, local replay snapshot
assembly, replay participant metadata, and replay world-object serialisation
now go through shared runtime and replay modules. Remaining duplication is now
primarily centred around gameplay rule execution, online/local flow, rendering,
and higher-level runtime structure rather than replay plumbing.

# Module Status

`docs/modules-progress.md` was reviewed. No update is required because
these changes reduce technical debt without changing the functional
completion status of any project modules.
