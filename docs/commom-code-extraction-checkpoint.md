# Common Code Extraction Checkpoint

Date: `2026-07-08`

## Purpose

This checkpoint tracks the live progress of `docs/games-common-architecture-refactor-plan.md`. It must be updated with every future change that moves, creates, or rewires shared gameplay code under the common architecture.

## Current Status

Phases `0` to `3` have been implemented as the first architectural pass across the four active games. The extraction is functional and tested, but it is not the final slim-scene target from Phase `10`.

## Completed Work

### Phase 0 - Behaviour Freeze With Tests

Status: `Done for the current extraction baseline`

Completed:

- Added and validated focused common runtime tests.
- Reused existing frontend regression coverage for local replay timing, power-ball settling, pickup remapping, and HUD state mapping.
- Reused existing backend matchmaking engine coverage for Kame Knock, Bell Clash, Shell Curl, and session flow.

Validated with:

- `frontend`: common runtime and related mechanics tests.
- `backend`: targeted matchmaking engine and session tests.

### Phase 1 - Common Scene Host

Status: `Done across Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl`

Completed:

- Created `CommonGameSceneHost`.
- Added lifecycle dispatch for update, shutdown, and relayout.
- Added descriptor registration through `GameDescriptor`.
- Migrated Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl to dispatch their common lifecycle through the host.
- Added `SceneSocketChannel` for symmetric socket listener registration and cleanup.

### Phase 2 - Launch And Movement Runtime

Status: `Implemented as an initial shared runtime across the four games`

Completed:

- Created shared launchable runtime helpers.
- Created `SlingshotLaunchRuntime`.
- Moved the main slingshot lifecycle for Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl into `SlingshotLaunchRuntime`.
- Added shared relayout helpers for launchable arena remapping.
- Shell Curl uses the same launch lifecycle with a stone launchable and `grabRadiusFactor`.

Still pending:

- Move more per-game launch callbacks, reset rules, trail recording, and settle transitions into descriptor-backed hooks.
- Remove the remaining local-versus participant-specific slingshot paths where they still exist.

### Phase 3 - World Runtime

Status: `Implemented as an initial shared ownership layer across the four games`

Completed:

- Created `WorldRuntime` for ordered world entity collections.
- Created `WorldMapRuntime` for keyed remote or per-player entity maps.
- Moved Bamboo Bash bamboo ownership behind `WorldRuntime`.
- Moved Kame Knock target ownership behind `WorldRuntime`.
- Moved Bell Clash zone ownership behind `WorldRuntime`.
- Moved Shell Curl stone ownership behind `WorldRuntime`.
- Moved keyed online/local ball maps for Kame Knock and Bell Clash behind `WorldMapRuntime`.

Still pending:

- Move collision orchestration, object hit handling, collectible blockers, and serialisation hooks fully into runtime APIs.
- Move remaining power launchable ownership and world collision ordering out of scenes.
- Reduce scene-owned rule methods once Phase `4` descriptors are introduced.

## Current Validation

Latest validation performed:

- `cd frontend && npm run test:run -- src/games/common/tests src/games/shared/localReplay.test.ts src/shared/mechanics/arena-power-runtime.test.ts src/shared/mechanics/power-pickups.test.ts src/shared/mechanics/round-flow-hud.test.ts`
- `cd frontend && npm run build`
- `cd backend && npm test -- --runTestsByPath src/modules/matchmaking/engines/bell-clash.engine.spec.ts src/modules/matchmaking/engines/kame-knock.engine.spec.ts src/modules/matchmaking/engines/shell-curl.engine.spec.ts src/modules/matchmaking/game-session.service.spec.ts`

Results:

- Frontend targeted tests passed.
- Frontend production build passed.
- Backend targeted tests passed.

Known non-blocking warning:

- Vite reports existing large chunk warnings during frontend build.

## Next Step

Proceed with Phase `4`: introduce descriptors for obstacles and scoring.

Recommended first slice:

1. Define common obstacle and scoring descriptor contracts in `frontend/src/games/common/descriptors/`.
2. Use multi-agent workers to migrate Bamboo Bash, Kame Knock, Bell Clash, and Shell Curl in parallel unless the user explicitly scopes the task to one game.
3. Add focused object-hit and scoring tests for all four games in the same phase.
4. Keep each game's scoring identity in descriptor hooks: bamboo growth, timed target combo, bell angular zones, and curling house scoring.
5. Let the main agent own shared descriptor files and final integration.

## Update Rule

Every future code change related to this refactor must update this checkpoint in the same task. At minimum, update:

- phase status;
- files or systems migrated;
- validation commands and results;
- remaining risks;
- the next recommended step.

Default execution rule:

- Future phase work must use multi-agent parallel migration across all four games unless the user explicitly asks for one named game.
- If a single-game scope is requested, record that exception here with the reason and affected phase.
