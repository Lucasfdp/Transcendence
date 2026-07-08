# Common Code Audit Between Minigames

## Objective
Provide concrete evidence to answer a key question: what common code already exists between `shell-curl`, `bamboo-bash`, `kame-knock`, and `bell-clash`, which components remain duplicated or partially duplicated, and what can be safely extracted into a shared layer without introducing premature abstractions.

## Scope Reviewed

- Frontend gameplay:
  - `frontend/src/games/shell-curl/ShellCurlScene.ts`
  - `frontend/src/games/bamboo-bash/BambooBashScene.ts`
  - `frontend/src/games/kame-knock/KameKnockScene.ts`
  - `frontend/src/games/bell-clash/BellClashScene.ts`

- Shared frontend:
  - `frontend/src/shared/mechanics/*`
  - `frontend/src/shared/arenas/*`
  - `frontend/src/games/shared/*`

- Backend gameplay and replay:
  - `backend/src/modules/matchmaking/engines/*`
  - `backend/src/modules/matchmaking/replay-state.helpers.ts`
  - `backend/src/modules/matchmaking/matchmaking.types.ts`

## Executive Summary

There are two clearly defined game families:

| Family | Games | Status |
| --- | --- | --- |
| `arena + ball + slingshot` | `bamboo-bash`, `kame-knock`, `bell-clash` | These games share a substantial amount of real infrastructure, but each scene still reimplements much of the round lifecycle, local HUD, pickups, and world objects. |
| `rect-arena + curling-shell + turn-manager` | `shell-curl` | This game now shares the projectile module and HUD-facing rule hooks, but it still relies on curling-specific contracts and gameplay rules that should not be diluted into the oval-arena family. |

The best immediate opportunity is **not** to merge all four games into a single base scene. Instead, effort should be focused on consolidating three areas:

1. Player visual configuration
2. Contracts for obstacles, objectives, and collectibles
3. Shared projectile, power, replay, and snapshot lifecycle for `arena + ball` games

---

# Inventory of Audited Games

## `shell-curl`

- Core gameplay:
  - Rectangular sheet
  - `stone` physics
  - House scoring
  - Turns and ends
  - Sweeping
  - Bumpers

- Shared layers already in use:
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/score-hud.ts`
  - `shared/mechanics/player-renderer.ts`
  - `shared/mechanics/player-trails.ts`
  - `games/shared/localReplay.ts`

- Key structural difference:
  - Depends on the rectangular-sheet helpers in `rect-arena.ts` and
    `turn-manager.ts` rather than `arena.ts`; its curling-shell physics now
    lives in `ball.ts` alongside the oval arena projectile helpers.

---

## `bamboo-bash`

- Core gameplay:
  - Growing bamboo
  - Round timer
  - Continuous spawning
  - Stage-based scoring

- Shared layers already in use:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`

- Key structural difference:
  - Relies more heavily on continuous match state than on a strict turn-based flow.

---

## `kame-knock`

- Core gameplay:
  - Timed targets
  - Combo system
  - Perfect-hit mechanic
  - Player-specific target rounds

- Shared layers already in use:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/timed-targets.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`

- Key structural difference:
  - Combines player turns with target regeneration rules on a per-round basis.

---

## `bell-clash`

- Core gameplay:
  - Central bell
  - Angular scoring zones
  - Impact-based scoring
  - Three shots per round

- Shared layers already in use:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`

- Key structural difference:
  - Shares neither Bamboo Bash's objective model nor Kame Knock's target system; it only shares the projectile and round infrastructure.

---

# Existing Shared Code Map

## Shared Frontend Infrastructure

| Domain | Shared Code | Evidence |
| --- | --- | --- |
| Projectile physics | Oval arena ball physics plus rectangular-sheet curling-shell physics, collision, and rendering | `frontend/src/shared/mechanics/ball.ts`; used by `frontend/src/games/bamboo-bash/BambooBashScene.ts`, `frontend/src/games/kame-knock/KameKnockScene.ts`, `frontend/src/games/bell-clash/BellClashScene.ts`, and `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Launch system | Shared drag-to-launch implementation | `frontend/src/shared/mechanics/slingshot.ts`; imported by all four games |
| Elliptical arenas | Arena geometry and responsive layout | `frontend/src/shared/arenas/arena.ts`; used by `bamboo-bash`, `kame-knock`, and `bell-clash` |
| Rectangular arena | Sheet geometry and house scoring | `frontend/src/shared/mechanics/rect-arena.ts`; used by `shell-curl` |
| Powers | Shared catalogue, assets, and power semantics | `frontend/src/shared/mechanics/power-system.ts`; `frontend/src/shared/mechanics/game-powers.ts` |
| Pickups | Pickup spawning, collection, and rendering | `frontend/src/shared/mechanics/power-pickups.ts`; used by all four games |
| Ball powers | Shared projectile flags and mutations | `frontend/src/shared/mechanics/ball-powers.ts`; used by `bamboo-bash`, `kame-knock`, and `bell-clash` |
| Ball power spawning | Split and mirror mechanics | `frontend/src/shared/mechanics/ball-spawn-powers.ts`; used by `bamboo-bash`, `kame-knock`, and `bell-clash` |
| HUD and overlays | `ScoreHud`, round overlay, game-end modal, and online rematch UI | `frontend/src/shared/mechanics/score-hud.ts`, `round-overlay.ts`, `game-end-modal.ts`, `online-rematch.ts` |
| Player visuals | In-game textures and trails | `frontend/src/shared/mechanics/player-renderer.ts`; `frontend/src/shared/mechanics/player-trails.ts` |
| Local replay and replay visuals | Frame normalisation, replay controller, replay scene, and replay rendering | `frontend/src/games/shared/localReplay.ts`; `ReplayController.ts`; `ReplayScene.ts`; `replayVisuals.ts` |

## Shared Backend Infrastructure

| Domain | Shared Code | Evidence |
| --- | --- | --- |
| Engine contract | Common interface for game engines | `backend/src/modules/matchmaking/engines/game-engine.ts` |
| Engine registry | Engine resolution by `gameId` | `backend/src/modules/matchmaking/engines/game-engine.registry.ts` |
| Snapshot player synchronisation | Synchronisation of `room.players` into `snapshot.players` | `backend/src/modules/matchmaking/engines/base.engine.ts` |
| Snapshot and replay entity contracts | `GameSnapshot`, `SnapshotPlayer`, `ReplayFrameSnapshotEntity`, `BallSnapshotData` | `backend/src/modules/matchmaking/matchmaking.types.ts` |
| Replay mirroring for arena games | Projectile initialisation, synchronisation, and settle handling | `backend/src/modules/matchmaking/replay-state.helpers.ts`; used by `bamboo-bash.engine.ts`, `kame-knock.engine.ts`, and `bell-clash.engine.ts` |
| Replay mirroring for curling | Stone initialisation and synchronisation | `backend/src/modules/matchmaking/replay-state.helpers.ts`; used by `shell-curl.engine.ts` |

---

# Extraction Matrix by Domain

| Component | Current Implementation | Degree of Reuse | Proposed Extraction | Risk | Priority | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Launchable projectile layer | `ball.ts` now owns both oval ball and rectangular curling-shell helpers with a shared `Slingshot` | Similar but still mode-specific | Introduce a `LaunchableActor` contract for launching, visual flags, and movement hooks while retaining separate `stepBall()` and `stepStone()` behaviours inside `ball.ts` | Medium | High | `frontend/src/shared/mechanics/ball.ts`; `frontend/src/shared/mechanics/slingshot.ts` |
| Player visual configuration | Each scene duplicates skin/colour arrays and calls to `drawIngamePlayerTexture` or `drawIngameShellTexture` | Duplicated | Create a `PlayerEntityConfig` covering skin, colour, scale, alpha, sprite key, trail, and rendering rules | Low | High | `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts`; `frontend/src/shared/mechanics/player-renderer.ts`; `frontend/src/shared/mechanics/player-trails.ts` |
| Obstacles and objectives | `bamboo.ts`, `timed-targets.ts`, bell/zones inside `BellClashScene`, bumpers inside `ShellCurlScene` | Similar but tightly coupled | Introduce an `ObstacleDescriptor` containing geometry, collision, scoring, health, and rendering metadata while allowing each game to retain its own hooks | Medium | High | `frontend/src/games/bamboo-bash/bamboo.ts`; `frontend/src/shared/mechanics/timed-targets.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Collectibles / pickups | Shared manager, but local pickup contracts and separate backend payloads | Shared visually, duplicated at integration level | Introduce a `CollectibleDescriptor` covering pickup behaviour, effects, and common serialisation | Low | Medium | `frontend/src/shared/mechanics/power-pickups.ts`; `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Power lifecycle in non-curling games | The three ball games duplicate `applyBallPower`, split, mirror, pickup consumption, flags, and replay metadata | Duplicated | Create a shared `ArenaPowerRuntime` or `BallPowerCycle` covering release, pickups, split, mirror, and visual synchronisation | Medium | High | `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/shared/mechanics/ball-powers.ts`; `frontend/src/shared/mechanics/ball-spawn-powers.ts` |
| Terrain / arena / collisions | Elliptical arena already shared; rectangular arena separate; spawn locations and coordinate normalisation repeated across world objects | Partially shared | Keep `arena.ts` and `rect-arena.ts` separate; extract only normalised positioning helpers and spawn-clearance utilities | Low | Medium | `frontend/src/shared/arenas/arena.ts`; `frontend/src/shared/mechanics/rect-arena.ts`; `frontend/src/shared/mechanics/timed-targets.ts`; `frontend/src/games/bamboo-bash/bamboo.ts` |
| Scoring / turns / rounds | `TurnManager` remains the curling authority, while the other three games build round/turn state manually; all audited games now expose HUD-facing rule state through `GameRuleHooks` | Partially shared | Extend `GameRuleHooks` beyond HUD state only where it removes duplicated release, settlement, winner, or round-complete plumbing without enforcing a single scoring model | Medium | High | `frontend/src/shared/mechanics/turn-manager.ts`; `frontend/src/shared/mechanics/game-rule-hooks.ts`; `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| HUD / overlays / game end | UI components are shared, but each scene manually maps `TurnState` or builds equivalent structures | Shared UI, duplicated adapters | Create a shared `buildHudStateFromRoundFlow()` adapter to eliminate repeated mapping logic | Low | Medium | `frontend/src/shared/mechanics/score-hud.ts`; `frontend/src/shared/mechanics/round-overlay.ts`; `frontend/src/shared/mechanics/game-end-modal.ts`; `frontend/src/shared/mechanics/online-rematch.ts` |
| Local replay / frontend snapshots | Replay layer is already well extracted, but each scene still constructs entities and players using similar code | Mostly shared with residual duplication | Extract a `SceneReplayRecorder` with helpers for players, frames, and local persistence | Low | Medium | `frontend/src/games/shared/localReplay.ts`; `frontend/src/games/shared/ReplayController.ts`; `frontend/src/games/shared/ReplayScene.ts`; all four game scenes |
| Backend snapshot / replay for arena games | Three engines share the same projectile replay helper and very similar structures | Duplicated lifecycle, shared replay entities | Introduce a `BaseArenaEngine` covering winner resolution, round reset, basic release validation, and scoring/objective hooks | Medium | High | `backend/src/modules/matchmaking/replay-state.helpers.ts`; `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`; `kame-knock.engine.ts`; `bell-clash.engine.ts` |
| Shared frontend/backend snapshot contracts | Contracts are compatible, but several payloads and state structures remain game-specific | Similar but tightly coupled | Review a common `LaunchSnapshotEntity` and `WorldObjectSnapshot` contract to reduce duplicate serialisation | Medium | Medium | `backend/src/modules/matchmaking/matchmaking.types.ts`; `frontend/src/games/shared/localReplay.ts`; `frontend/src/games/shared/ReplayScene.ts` |

---

# Executive Refactoring Classification

## Ready to Extract

- `PlayerEntityConfig` to consolidate skin, sprite, size, scale, alpha, and trail configuration.
- `SceneReplayRecorder` for local replay support across game scenes.
- A shared adapter for `ScoreHud`, `showRoundTransitionOverlay`, `showGameEndModal`, and `showOnlineRematchEndModal`.
- Normalised positioning and spawn-clearance helpers for elliptical world objects.

---

## Suitable After Interface Normalisation

- `LaunchableActor` as a shared launch contract and visual flag interface, without enforcing a single physics implementation.
- `ObstacleDescriptor` for objectives, bumpers, bamboo, bells, and targets.
- `CollectibleDescriptor` for pickups and other collectible world objects.
- `BaseArenaEngine` for `bamboo-bash`, `kame-knock`, and `bell-clash`.
- `GameRuleHooks` to separate the shared round/turn lifecycle from game-specific scoring logic.

---

## Best Left Local

- Curling-sheet physics versus oval-arena physics inside `ball.ts`.
- Curling house scoring.
- The angular scoring geometry in `bell-clash`.
- Stage-based bamboo growth.
- The combo and perfect-hit mechanics in `kame-knock`.

---

# Proposed Target Abstractions

## Proposed `PlayerEntityConfig`

Should centralise:

- `spriteKey`
- `shellSkin`
- `radius`
- `scale`
- `alpha`
- `trailColor` or `side`
- `renderMode`: `fullPlayer | shellOnly`
- `stateFlags`

**Objective:** remove visual decision-making from individual scenes, `player-renderer.ts`, `player-trails.ts`, and replay construction.

---

## Proposed `LaunchableActor`

Should unify:

- Minimum launch state
- Shared visual metadata
- Power flags
- Integration with `Slingshot`

It should **not** enforce a single physics model. `ball.ts` should continue
to expose separate `stepBall()` and `stepStone()` behaviours for the two
arena families.

---

## Proposed `ObstacleDescriptor`

Should describe:

- ID and type
- Normalised or absolute position
- Radius or bounds
- Score value
- Whether it blocks, bounces, breaks, or awards points
- Rendering metadata
- Optional hooks:
  - `onHit`
  - `onExpire`
  - `onScore`

This would cover:

- Bamboo
- `kame-knock` targets
- `shell-curl` bumpers
- The bell and scoring zones in `bell-clash`

---

## Proposed `CollectibleDescriptor`

Should describe:

- ID
- Type
- Position
- Radius
- Effect
- Consumption rules
- Snapshot serialisation

This would close the remaining gap between the shared `PowerPickupManager` and the still-duplicated integration code found in individual scenes and backend engines.
```

## Proposed `GameRuleHooks`

Should leave only game-specific behaviour implemented locally:

- `onRelease`
- `onProjectileSettled`
- `onObstacleHit`
- `onRoundComplete`
- `computeWinner`
- `buildHudState`

**Objective:** extract the shared gameplay flow without hiding or abstracting away each game's individual rules.

---

# Concrete Duplication Findings

## 1. The `bamboo-bash` / `kame-knock` / `bell-clash` Trio

This represents the strongest opportunity for further extraction.

These games already share:

- `arena.ts`
- `ball.ts`
- `Slingshot`
- `PowerPickupManager`
- `applyBallPower`
- Split and mirror mechanics
- `ScoreHud`
- Player trails
- Player renderer
- Local replay
- Backend projectile replay

They also share a considerable amount of scene structure, including:

- Slingshot recreation and synchronisation
- HUD reconstruction
- Replay recording
- Pickup application
- Round completion handling and the end-game modal

**Conclusion:** these games justify a dedicated shared layer for the `arena + ball` family, rather than a universal abstraction covering all four games.

---

## 2. `shell-curl` Is Less Duplicated Than It First Appears

Although it shares less gameplay physics, it already reuses many of the appropriate shared systems:

- HUD
- Overlays
- Slingshot
- Pickups
- Player renderer
- Player trails
- Local replay

**Conclusion:** the goal with `shell-curl` should not be to migrate it onto
the oval-arena rule architecture. It now shares the unified projectile module
and the HUD-facing `GameRuleHooks` boundary, while its rectangular arena,
sweeping, house scoring, and `TurnManager` flow remain local.

---

## 3. Arena Backend Exhibits Significant Structural Duplication

`bamboo-bash.engine.ts`, `kame-knock.engine.ts`, and `bell-clash.engine.ts` all repeat:

- `createInitialState()` using parallel arrays per player
- `start()` together with `resetArenaReplayBalls()` and `refreshSnapshotPlayers()`
- Player, room, and phase validation
- Winner calculation based on the highest score
- Integration with `initializeArenaReplayBall()` and `syncArenaReplayBallFromPayload()`

**Conclusion:** there is sufficient structural similarity to justify introducing a `BaseArenaEngine` with game-specific hooks.

---

# Prioritised Extraction Backlog

1. Consolidate shared player configuration and visual rendering.
2. Unify obstacle and objective contracts.
3. Extract the shared power lifecycle used by the non-curling games.
4. Reduce duplication across HUD, round flow, replay, and snapshot handling.
5. Review a shared frontend/backend contract for launchable entities and world objects.

---

# Recommended Approach

The safest implementation order is:

1. Extract small data abstractions and lightweight adapters.
2. Move the shared `arena + ball` gameplay flow into common infrastructure.
3. Leave any attempt to unify `stone` and `ball` until the very end.

Reversing this order would force an overly abstract inheritance hierarchy and significantly increase the risk of gameplay regressions.

---

# Module Status

`docs/modules-progress.md` was reviewed as part of this audit.

There is no evidence that these changes alter the completion status of any project module. Consequently, no update to the module progress document is required.
