# Common Code Extraction Checkpoint Between Minigames

## Context

This checkpoint summarises the work completed from
`docs/games-common-code-audit.md` during phases 1, 2 and 3 of the
extraction process for the `arena + ball` family and its related shared
infrastructure.

Checkpoint date: `2026-07-06`

## Scope Applied

### Frontend

-   `frontend/src/games/bamboo-bash/BambooBashScene.ts`
-   `frontend/src/games/kame-knock/KameKnockScene.ts`
-   `frontend/src/games/bell-clash/BellClashScene.ts`
-   `frontend/src/games/shell-curl/ShellCurlScene.ts`
-   `frontend/src/games/shared/localReplay.ts`
-   `frontend/src/shared/mechanics/*`

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

# Current Status by Area

## Successfully extracted

-   Basic player visual configuration
-   HUD adapter
-   Scene replay recorder
-   Replay import payload builder
-   Base arena engine
-   Ball power lifecycle for the `arena + ball` family

## Partially extracted

-   `PlayerEntityConfig`
-   `BaseArenaEngine`
-   `ArenaPowerRuntime`

## Not yet extracted

-   `ObstacleDescriptor`
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
-   Runtime validation could not be completed because `npm` was
    unavailable.

# Recommended Next Sequence

## Phase 4

Extract `ObstacleDescriptor`.

## Phase 5

Extract `CollectibleDescriptor`.

## Phase 6

Extract `GameRuleHooks`.

# Executive Summary

The project now includes genuine shared infrastructure for player
visuals, HUD adaptation, replay support, backend arena lifecycle
management, and the shared power runtime for the `arena + ball` family.
Remaining duplication is now primarily centred around gameplay rules and
world contracts rather than shared plumbing.

# Module Status

`docs/modules-progress.md` was reviewed. No update is required because
these changes reduce technical debt without changing the functional
completion status of any project modules.
