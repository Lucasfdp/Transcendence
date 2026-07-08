# Games Common Architecture Refactor Plan

Date: `2026-07-08`

## Purpose

This plan replaces the earlier shallow helper-extraction direction with a full architectural refactor. The goal is to move all reusable gameplay infrastructure out of individual game scenes, so each game keeps only its specific rules, content, assets, scoring model, and visual identity.

The current frontend game scenes are too large for the amount of gameplay variation they contain:

| Scene | Current size |
| --- | ---: |
| `frontend/src/games/bamboo-bash/BambooBashScene.ts` | ~2,758 lines |
| `frontend/src/games/kame-knock/KameKnockScene.ts` | ~2,396 lines |
| `frontend/src/games/bell-clash/BellClashScene.ts` | ~2,474 lines |
| `frontend/src/games/shell-curl/ShellCurlScene.ts` | ~2,576 lines |
| **Total** | **~10,204 lines** |

This is not acceptable as a long-term architecture. These games share the same product pattern: a player-controlled launchable entity moves through an arena, bounces against world objects, interacts with collectibles, scores, advances through turns or rounds, records replay data, and synchronises online state.

## Target Outcome

Each game scene should become a thin adapter around shared systems. A finished game scene should mostly contain:

- asset preloading keys and texture choices;
- the game descriptor;
- game-specific rule callbacks;
- game-specific entity renderers or visual effects;
- minimal scene bootstrap code.

The shared layer should own:

- launch lifecycle;
- local and online flow;
- input handling;
- physics stepping;
- collision orchestration;
- obstacle and collectible lifecycle;
- power lifecycle;
- replay recording;
- snapshot import and export;
- HUD and overlay flow;
- socket listener registration and cleanup;
- responsive relayout of common world entities.

The target size for each scene is **300-600 lines**, depending on how much custom rendering a game needs. Anything above that should be treated as a warning that common logic is still leaking back into the scene.

## Non-Goals

- Do not remove game identity. Bamboo growth, Kame target timing, Bell angular scoring, and Shell Curl house scoring remain game-specific.
- Do not force all physics into one implementation. Ball and stone physics may stay separate behind a shared launchable contract.
- Do not hide rules behind opaque inheritance. Prefer explicit descriptors and small rule hooks over a deep class hierarchy.
- Do not rewrite all four games in one unsafe commit. This must land in phases with tests and playable checkpoints.

## Architectural Direction

The desired shape is:

```text
GameScene
  -> GameDescriptor
  -> CommonSceneHost
      -> WorldRuntime
      -> LaunchRuntime
      -> RoundFlowRuntime
      -> OnlineRuntime
      -> ReplayRuntime
      -> HudOverlayRuntime
      -> RenderAdapter
```

Game-specific code should be data and hooks:

```text
BambooBashDescriptor
KameKnockDescriptor
BellClashDescriptor
ShellCurlDescriptor
```

The scene should no longer manually coordinate all subsystems. It should create the descriptor, pass it to the common host, and expose Phaser lifecycle methods.

## Proposed Directory Structure

The refactor must also consolidate the current shared folders. The repository
currently has both `frontend/src/shared/` and `frontend/src/games/shared/`,
which makes ownership ambiguous.

Target ownership:

```text
frontend/src/shared/
  App-wide shared frontend code only.
  Examples: theme, generic UI, route-level helpers, app assets, labels, layout helpers.

frontend/src/games/common/
  Shared gameplay code only.
  Examples: scene host, game runtimes, descriptors, replay, launchables, collisions,
  collectibles, game HUD adapters, game online runtime, Phaser game adapters.

frontend/src/games/shared/
  Temporary migration source only.
  This folder must be emptied and removed once its modules move to games/common.
```

`frontend/src/shared/mechanics/` also needs an ownership audit. Code that is
specific to gameplay, such as launch physics, powers, pickups, score HUDs,
game overlays, player trails, and in-game render helpers, should move to
`frontend/src/games/common/` unless it is genuinely useful outside games.
`frontend/src/shared/` should not become a second permanent home for game
runtime code.

```text
frontend/src/games/common/
  scene/
    CommonGameSceneHost.ts
    CommonSceneLifecycle.ts
    SceneSocketChannel.ts
    SceneResponsiveLayout.ts
  runtime/
    WorldRuntime.ts
    LaunchRuntime.ts
    RoundFlowRuntime.ts
    OnlineGameRuntime.ts
    ReplayRuntime.ts
    HudOverlayRuntime.ts
  descriptors/
    GameDescriptor.ts
    ArenaDescriptor.ts
    LaunchableDescriptor.ts
    ObstacleDescriptor.ts
    CollectibleDescriptor.ts
    ScoringDescriptor.ts
    RendererDescriptor.ts
  entities/
    LaunchableEntity.ts
    WorldObjectEntity.ts
    CollectibleEntity.ts
    PlayerEntity.ts
  adapters/
    PhaserRenderAdapter.ts
    PhaserInputAdapter.ts
    PhaserAudioFxAdapter.ts
  tests/
```

Backend equivalents:

```text
backend/src/modules/matchmaking/common/
  game-rule-engine.ts
  arena-engine-runtime.ts
  launchable-snapshot.ts
  world-object-snapshot.ts
  collectible-state.ts
  deadline-scheduler.ts
```

The exact filenames can change during implementation, but the ownership boundaries should not.

## Shared Contracts To Introduce

### `GameDescriptor`

The top-level configuration for a game.

It should define:

- `gameId`;
- player count limits;
- local modes supported;
- arena type;
- launchable type;
- round or turn model;
- scoring model;
- available powers;
- collectible policy;
- replay entity mapping;
- online event mapping;
- render hooks.

### `LaunchableDescriptor`

Common contract for balls and stones.

It should define:

- spawn position;
- radius;
- velocity scale;
- collision body;
- friction model;
- trail policy;
- launch constraints;
- settle detection;
- power mutation hooks.

Ball and stone implementations can remain separate internally, but scenes should not know the difference beyond descriptor selection.

### `WorldRuntime`

Owns the active gameplay world.

It should manage:

- launchable entities;
- auxiliary power entities;
- obstacles;
- collectibles;
- collision order;
- movement stepping;
- settle detection;
- entity cleanup;
- normalised coordinate conversion.

The scene should not keep separate ad hoc arrays such as `targets`, `bamboos`, `zones`, `powerBalls`, `onlineBalls`, and `allStones` unless those are internal to the runtime or game-specific descriptor state.

### `ObstacleDescriptor`

Common representation for objects that collide, block, score, or react.

It should cover:

- bamboo;
- timed targets;
- bell zones and bell body;
- curling bumpers;
- future arena objects.

The descriptor should not force one scoring model. It should expose hooks such as:

- `getCollisionShape`;
- `onHit`;
- `onBounce`;
- `onFrame`;
- `isExpired`;
- `serialize`;
- `render`.

### `CollectibleDescriptor`

Common representation for pickups and future collectible objects.

It should cover:

- spawn rules;
- blocker rules;
- collection radius;
- collection effects;
- server ownership in online matches;
- serialisation;
- render data.

Kame Knock and Bell Clash must stop using local-only RNG for online pickups. Server-owned collectible state should be a shared engine feature, not Bamboo-specific code.

### `RoundFlowRuntime`

Owns round, turn, shot, settle, and end-of-game flow.

It should support:

- continuous timed rounds, as in Bamboo Bash;
- per-player turns, as in Kame Knock;
- per-round shot counts, as in Bell Clash;
- ends and throws, as in Shell Curl.

Scenes should not implement their own versions of:

- `startOnlineRound`;
- `setupShot`;
- `setupBallRound`;
- `finishThrow`;
- `finishBallRound`;
- `submitRoundScore`;
- `showNextRoundOverlay`;
- `currentTurnPhase`.

Those behaviours belong in shared flow code with game-specific hooks.

### `OnlineGameRuntime`

Owns socket lifecycle and online state application.

It should provide:

- symmetric listener registration and cleanup;
- snapshot sequence guards;
- throw event playback;
- settled event submission;
- round score submission;
- remote player state;
- spectator handling;
- rematch flow;
- away/return handling;
- server-owned collectible updates.

Scenes should not call `socket.on` and `socket.off` directly. They should register declarative event handlers through a common channel.

### `ReplayRuntime`

Owns local replay capture and import payload construction.

It should provide:

- frame timing;
- player visual mapping;
- entity serialisation;
- local persistence;
- waiting for pending replay persistence before scene restart;
- replay metadata.

Every game should use the same replay lifecycle. Scene-specific code should only provide the game snapshot and entity mapping hook.

### `HudOverlayRuntime`

Owns HUD, side panels, round overlays, end modals, rematch modals, countdowns, and relayout-safe overlay rebuilding.

It should provide:

- score HUD mapping;
- status text;
- turn and round labels;
- power panel state;
- score log panels;
- end screen actions;
- rematch modal actions;
- relayout rebuilding.

Scenes should not manually decide whether an overlay is an end modal or a round transition.

## Backend Refactor Direction

The backend should mirror the frontend architecture enough to keep online matches authoritative and replay data trustworthy.

### Shared Engine Runtime

Create a shared engine runtime for common match flow:

- start room;
- reset round;
- validate release;
- consume power;
- apply collectible collection;
- apply world hit;
- settle launchable;
- advance turn or round;
- finish match;
- abandon match;
- enforce deadlines;
- cleanup per-room state.

Existing `BaseEngine` and `BaseArenaEngine` are a start, but they are not enough. They still leave too much game flow in each engine.

### Snapshot Contracts

Introduce shared backend contracts:

- `LaunchableSnapshot`;
- `WorldObjectSnapshot`;
- `CollectibleSnapshot`;
- `RoundFlowSnapshot`;
- `PlayerRuntimeSnapshot`.

The current snapshots contain compatible ideas, but each game still defines its own equivalent fields. The shared runtime should own the common fields, with per-game extensions for rule-specific state.

### Server Authority

The following must become server-owned for online matches:

- collectible list;
- power consumption;
- round and turn deadlines;
- score acceptance;
- object identity;
- allowed world object updates;
- winner calculation;
- replay snapshot integrity.

Client-side simulation can still be used for responsive visuals, but server snapshots must be the source of truth.

## Refactor Phases

## Phase 0 - Freeze Behaviour With Tests

Before moving code, add regression tests around current intended behaviour.

Frontend tests:

- replay frame timing;
- power ball pruning and settle-once behaviour;
- pickup preservation on relayout;
- overlay rebuilding on relayout;
- common launch flow in local mode;
- online listener cleanup.

Backend tests:

- release validation;
- power validation;
- collectible collection;
- target or obstacle hit handling;
- duplicate settled messages;
- abandon winner resolution;
- round and turn deadlines once introduced.

Acceptance criteria:

- Existing targeted tests pass.
- A small scripted smoke path exists for each game mode being refactored.
- No phase begins by rewriting a scene without coverage for the behaviour being moved.

## Phase 1 - Create The Common Scene Host

Create `CommonGameSceneHost` without migrating all logic immediately.

Responsibilities:

- Phaser lifecycle bridge;
- dependency container for runtime modules;
- common update loop;
- common shutdown cleanup;
- common relayout dispatch;
- descriptor registration.

First migration target:

- Bamboo Bash, because it already has the healthiest server-owned model for objectives and pickups.

Acceptance criteria:

- Bamboo Bash runs through the host.
- The host owns update, shutdown, and relayout dispatch.
- Bamboo scene size starts decreasing without changing gameplay.

## Phase 2 - Extract Launch And Movement Runtime

Move shared launchable behaviour out of scenes.

Extract:

- slingshot creation and recreation;
- launch preparation;
- velocity normalisation;
- ball or stone reset;
- active local player selection;
- local versus launch routing;
- moving and settled detection;
- trail recording.

Keep game-specific:

- launch speed constants;
- spawn positions;
- turn eligibility rules;
- launchable renderer.

Acceptance criteria:

- Bamboo, Kame, and Bell no longer implement separate launch handlers for the common path.
- Shell Curl uses the same launch lifecycle with a stone descriptor.
- Scenes do not directly own the common slingshot lifecycle.

## Phase 3 - Extract World Runtime

Move entity arrays and collision orchestration out of scenes.

Extract:

- active launchables;
- remote launchables;
- power launchables;
- world objects;
- collectibles;
- collision ordering;
- blocker lists;
- normalised coordinate conversion;
- resize and relayout of runtime entities.

Keep game-specific:

- bamboo growth rules;
- timed target generation;
- bell zone geometry;
- curling house and bumper definitions.

Acceptance criteria:

- Scenes no longer own arrays such as `powerBalls`, `onlineBalls`, `targets`, `bamboos`, `zones`, `allStones`, or equivalent common runtime state.
- Runtime exposes serialisable world state for replay and online sync.
- The same relayout path preserves entities for all games.

## Phase 4 - Introduce Descriptors For Obstacles And Scoring

Replace scene-embedded obstacle logic with descriptors and rule hooks.

Extract:

- collision shape lookup;
- hit detection;
- bounce response;
- scoring event generation;
- object expiry;
- object rendering metadata;
- object serialisation.

Game descriptors should define:

- Bamboo Bash: bamboo growth, stage points, spawn limit.
- Kame Knock: target kinds, lifetime, combo and perfect-hit rules.
- Bell Clash: bell body, angular zones, hit cooldown and score values.
- Shell Curl: bumpers, house scoring, stone scoring order.

Acceptance criteria:

- Scenes no longer contain large methods like `checkTargetHits`, `checkBambooHits`, `checkBellHit`, `scoreEnd`, or bumper collision loops.
- Backend engines and frontend descriptors use compatible scoring concepts.
- At least Bamboo and Kame share the same object-hit runtime path before Bell and Shell are migrated.

## Phase 5 - Extract Collectible Runtime

Make collectibles fully common and server-owned online.

Extract:

- spawn interval;
- spawn attempts;
- blocker clearance;
- collect detection;
- collection effects;
- used power tracking;
- online pickup input;
- gateway relay;
- snapshot serialisation.

Acceptance criteria:

- Bamboo, Kame, Bell, and Shell use one collectible runtime.
- Online Kame and Bell no longer spawn pickups with local RNG.
- Pickup collection is represented by a shared input action and shared backend handling.
- No scene has bespoke `spawnPowerPickup`, `collectPowerPickup`, or pickup relayout code.

## Phase 6 - Extract Round Flow And Deadlines

Move match progression into common flow code.

Extract:

- round start;
- turn start;
- shot start;
- settle handling;
- round score submission;
- next turn;
- next round;
- end match;
- deadlines;
- idle-player fallback.

Acceptance criteria:

- No scene owns online round transition logic.
- Backend has one deadline sweep for all games.
- Bamboo, Bell, and Kame cannot stall forever if a connected client stops submitting.
- Shell Curl duplicate or late settle handling remains guarded.

## Phase 7 - Extract Online Runtime

Move online scene behaviour into one channel/runtime.

Extract:

- socket listener registration;
- socket listener cleanup;
- snapshot guards;
- throw event playback;
- power pickup events;
- rematch events;
- spectator handling;
- away status;
- online status labels.

Acceptance criteria:

- Scenes do not call `socket.on` or `socket.off` directly.
- Full snapshots and event streams have separate sequence tracking.
- Every registered listener is automatically cleaned up on scene shutdown.
- Online runtime tests cover listener symmetry.

## Phase 8 - Extract Replay Runtime

Move replay capture and persistence out of scenes.

Extract:

- local replay recorder ownership;
- frame capture cadence;
- player metadata;
- entity mapping;
- replay import payload;
- pending persistence handling before restart or return.

Acceptance criteria:

- Scenes no longer implement `buildLocalReplaySnapshot`, `buildReplayImportFrames`, `persistLocalReplay`, or repeated player metadata helpers.
- Replay entity mapping is descriptor-driven.
- All games wait consistently for pending replay persistence before leaving the scene.

## Phase 9 - Extract HUD And Overlay Runtime

Move repeated HUD and overlay logic out of scenes.

Extract:

- score HUD state mapping;
- side panel creation;
- power panel visibility;
- score log panels;
- round transition overlays;
- online end screens;
- local end screens;
- rematch modals;
- relayout-safe overlay rebuilding.

Acceptance criteria:

- Scenes no longer manually build end modals or round transition overlays.
- Overlay state survives relayout for all games.
- HUD state is derived from `RoundFlowRuntime`.

## Phase 10 - Slim Scenes And Remove Debris

After all shared layers are in place, reduce each scene to a descriptor-backed adapter.

Target scene contents:

- class declaration;
- asset preload calls;
- descriptor construction;
- scene host creation;
- optional custom visual hooks;
- no duplicated gameplay infrastructure.

Acceptance criteria:

- Each scene is below 600 lines unless there is a documented reason.
- Shared runtime code has direct unit tests.
- Game descriptors have focused tests for game-specific scoring and progression.
- `frontend/src/games/shared/` has been emptied, migrated to `frontend/src/games/common/`, and removed.
- `frontend/src/shared/mechanics/` has been audited, with gameplay-specific modules moved to `frontend/src/games/common/`.
- `graphify-out` build artefacts are removed from source trees and ignored.
- `docs/games-common-code-audit.md` is superseded by this plan or rewritten to match the new architecture.

## Multi-Agent Migration Strategy

Default migration mode:

- Work on Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl in the same phase.
- Before starting each phase, make an explicit multi-agent suitability decision.
- Use multi-agent parallel work only when it creates real value: independent per-game edits, substantial game-specific reasoning, broad review coverage, or a high risk of missing one game's variant.
- Do not use multi-agent workers when the phase is mainly a small shared-contract change, a narrow central runtime edit, or a serial integration where parallel workers would add coordination cost without reducing risk.
- Record the decision in the phase notes or checkpoint: `Multi-agent decision: used` or `Multi-agent decision: not used`, with a short reason.
- Assign one bounded worker per game when edits are large enough to conflict or require game-specific reasoning.
- Keep the main agent responsible for shared contracts, integration, final review, validation, and checkpoint updates.
- Do not migrate only one game as the default path.

Exception:

- If the user explicitly names one game, scope the task to that game and document the deliberate single-game scope in `docs/commom-code-extraction-checkpoint.md`.

Recommended per-phase split:

1. Main agent: define or adjust the shared contract, tests, exports, and integration rules.
2. Bamboo Bash worker: apply the contract to bamboo growth, scoring, pickups, replay, or flow.
3. Kame Knock worker: apply the contract to timed targets, combo scoring, pickups, replay, or turn flow.
4. Bell Clash worker: apply the contract to zones, bell hits, pickups, replay, or shot flow.
5. Shell Curl worker: apply the contract to stones, bumpers, house scoring, pickups, replay, or end flow.

Integration rule:

- Workers must have disjoint write scopes wherever possible.
- If a shared API changes, the main agent owns the shared files and workers adapt their game files to that API.
- The final result for a phase must compile and validate all four games unless a single-game scope was explicitly requested.
- If multi-agent work is not used, the main agent must still verify the phase against all four audited games and document why parallel workers were unnecessary.

## Implementation Rules

- Every phase must leave the game playable.
- Every code change related to this refactor must update `docs/commom-code-extraction-checkpoint.md` in the same task.
- Unless the user explicitly requests a specific game, each phase must address Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl together. Multi-agent parallel work is optional and must follow the per-phase suitability decision above.
- Do not keep two long-term implementations of the same lifecycle.
- Move code first, then simplify. Avoid changing gameplay semantics during extraction unless a bug is explicitly being fixed.
- Shared runtime files must be Phaser-free unless they are explicitly render adapters.
- Backend authority must be strengthened whenever online common logic is extracted.
- New shared contracts must have tests before multiple games depend on them.
- Scene files should only shrink or temporarily grow with a documented reason in the phase notes.

## Success Metrics

The refactor is successful when:

- total scene code drops from ~10,204 lines to below ~2,400 lines;
- each scene is below ~600 lines;
- no scene owns socket listener bookkeeping directly;
- no scene owns replay persistence directly;
- no scene owns generic launch lifecycle directly;
- no scene owns generic collectible lifecycle directly;
- common runtime tests cover launch, world update, collisions, collectibles, replay, online listener cleanup, and round flow;
- backend engine tests cover each shared lifecycle branch.

## Documentation Updates Required During The Refactor

Update these documents as phases land:

- `docs/modules-progress.md` only if a module status or evidence changes.
- `docs/games-common-code-audit.md` should be replaced, deprecated, or rewritten once this plan becomes the source of truth.
- `docs/commom-code-extraction-checkpoint.md` must track every code change related to this refactor, including phase status, validation, risks, and the next recommended step.
- Any new design or implementation note must live in `docs/` and be written in British English.

## Immediate Next Step

Continue with Phase 6:

1. Decide whether Phase 6 benefits from multi-agent workers before editing code.
2. If multi-agent work is useful, split Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl flow analysis into bounded per-game workers while the main agent owns the shared `GameRuleHooks` and `RoundFlowRuntime` contracts.
3. If multi-agent work is not useful, document why and have the main agent verify all four games directly.
4. Keep game-specific rule identity in descriptors and hooks rather than scene-local orchestration.
5. Add focused round-flow and rule-hook tests for the shared contract and the affected games.
6. Update `docs/commom-code-extraction-checkpoint.md` with the multi-agent decision, per-game status, validation, risks, and the next step.
