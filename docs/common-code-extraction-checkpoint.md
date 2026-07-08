# Common Code Extraction Checkpoint Between Minigames

## Context

This checkpoint summarises the work completed from
`docs/games-common-code-audit.md` during phases 1, 2, 3 and 4 of the
extraction process for the `arena + ball` family and its related shared
infrastructure.

Checkpoint date: `2026-07-08`

## Scope Applied

### Frontend

-   `frontend/src/games/bamboo-bash/BambooBashScene.ts`
-   `frontend/src/games/kame-knock/KameKnockScene.ts`
-   `frontend/src/games/bell-clash/BellClashScene.ts`
-   `frontend/src/games/shell-curl/ShellCurlScene.ts`
-   `frontend/src/games/shared/localReplay.ts`
-   `frontend/src/shared/mechanics/*`
-   `frontend/src/games/bamboo-bash/bamboo.ts`
-   `frontend/src/shared/mechanics/timed-targets.ts`

### Backend

-   `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`
-   `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`
-   `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`
-   `backend/src/modules/matchmaking/engines/base-arena.engine.ts`

# Extraction Completed

## 1. Shared Player Visual Configuration

**Status:** `Completed`

Extracted into: - `frontend/src/shared/mechanics/player-config.ts`

This now centralises: - default skins - common `shellSkins` resolution
from the registry

### Impact

-   Removes duplicated base skin arrays across the four audited scenes.
-   Provides a single entry point for the minimum player visual
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

-   Removes repeated mapping logic into `ScoreHud` across `bamboo-bash`,
    `kame-knock`, and `bell-clash`.

### Current limitation

-   Round flow itself remains local to each scene.
-   `GameRuleHooks` has not yet been introduced.

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

-   `frontend/src/games/shared/localReplay.test.ts`

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

-   Significantly reduces functional duplication across `bamboo-bash`,
    `kame-knock`, and `bell-clash`.
-   `KameKnockScene` now uses the same `powerBalls` structure as the
    other games: `{ ball, player }[]`

### Coverage

-   `frontend/src/shared/mechanics/arena-power-runtime.test.ts`

### Current limitation

-   Behaviour after balls come to rest remains game-specific.
-   Pickup logic, scoring, and world effects are still implemented
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

-   `bamboo-bash` bamboo, `kame-knock` timed targets, `bell-clash`'s
    central bell, and `shell-curl` bumpers now expose a common
    `ObstacleDescriptor` while retaining their game-specific growth,
    rendering, scoring, bounce, cooldown, and round rules.
-   Shared helpers now resolve obstacle positions and radii against the
    active arena or absolute pixel geometry, test circular collisions, and
    build pickup blockers from circular obstacles.
-   Existing `bambooPos`, `bambooRadius`, `hitsBamboo`,
    `timedTargetPosition`, `timedTargetRadius`, and `hitsTimedTarget`
    functions now route through the common descriptor helpers, preserving
    the public game APIs while removing duplicated geometry logic.
-   Bell Clash's central bell collision and Shell Curl's bumper collision
    now use descriptor-derived position/radius data without moving their
    local gameplay-specific response logic into the shared layer.

### Coverage

-   `frontend/src/shared/mechanics/obstacle-descriptor.test.ts`

### Current limitation

-   Score zones in Bell Clash are still local because they are scoring
    regions rather than physical obstacles.
-   Snapshot serialisation for world objects remains separate.

# Current Status by Area

## Successfully extracted

-   Basic player visual configuration
-   HUD adapter
-   Scene replay recorder
-   Replay import payload builder
-   Base arena engine
-   Ball power lifecycle for the `arena + ball` family
-   Shared obstacle descriptor for bamboo, timed targets, the bell, and
    bumpers

## Partially extracted

-   `PlayerEntityConfig`
-   `BaseArenaEngine`
-   `ArenaPowerRuntime`
-   `ObstacleDescriptor`

## Not yet extracted

-   `CollectibleDescriptor`
-   `GameRuleHooks`
-   `LaunchableActor`
-   Shared frontend/backend contracts for `LaunchSnapshotEntity` and
    `WorldObjectSnapshot`

# Significant Duplication Still Remaining

-   Gameplay rules and round flow
-   World object implementations
-   Pickup integration
-   Snapshot contracts

# Risks and Considerations

-   No shared base scene by design.
-   `shell-curl` remains mechanically independent.
-   Bell Clash score zones are intentionally left local because they are not
    physical obstacles.

# Recommended Next Sequence

## Phase 5

Extract `CollectibleDescriptor`.

## Phase 6

Extract `GameRuleHooks`.

# Executive Summary

The project now includes genuine shared infrastructure for player
visuals, HUD adaptation, replay support, backend arena lifecycle
management, the shared power runtime for the `arena + ball` family, and a
common obstacle contract adopted by the audited physical obstacles.
Remaining duplication is now primarily centred around collectible
integration, gameplay rules, and broader world snapshot contracts rather
than shared plumbing.

# Module Status

`docs/modules-progress.md` was reviewed. No update is required because
these changes reduce technical debt without changing the functional
completion status of any project modules.
