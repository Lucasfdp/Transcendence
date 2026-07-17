# Common Replay System

## Purpose

The replay subsystem records and presents matches from Shell Curl, Bamboo Bash,
Kame Knock, and Bell Clash through one replay v2 contract. Local games capture
state in the browser and import the completed recording. Online games are
captured and persisted by the authoritative backend simulation.

Replay Mode is intentionally unavailable when power-ups are enabled. Power-ups
introduce transient effects that are not part of the deterministic replay v2
state contract. This decision is fixed before a match starts: a disabled match
does not start a recorder, retain frames, import a recording, create a
`MatchReplay`, or appear in the replay list.

## Contract and timeline

Replay v2 uses monotonic `tMs` values for both frames and events. Dynamic state
is sampled at 20 Hz, with a full keyframe at least once per second and at forced
lifecycle boundaries. Delta frames contain changes and explicit removals.
Seeking reconstructs state from the preceding keyframe and uses a bounded cache.

The contract is defined in equivalent frontend and backend types:

- `frontend/src/games/common/replay/contracts.ts`
- `backend/src/modules/matchmaking/entities/match-replay.entity.ts`

Persisted rows declare `contractVersion`, `metadata`, and `durationMs`, alongside
v2-only `frames`, `events`, and `frameCount`. Metadata always declares
`powerupsEnabled: false`.

At most three seconds of waiting before the first action of a match or round is
retained. Later pauses are not compressed, and sample reduction does not alter
the duration of the recording.

## Local recording flow

Each local scene uses `ReplayCaptureRuntime`, which owns the shared recorder,
sampler, encoder, and persistence flow. The scene supplies a pure snapshot
builder and lifecycle events. On completion, an authenticated non-guest client
imports the replay through `POST /api/matches/replays/import`. The backend
validates replay v2 before creating the synthetic match, participants, and
temporary replay.

The local entry points are:

- `frontend/src/games/common/replay/ReplayCaptureRuntime.ts`
- `frontend/src/games/common/replay/ReplayEncoder.ts`
- `frontend/src/games/common/localReplay.ts`

## Online recording flow

The authoritative backend simulation samples a room every 50 ms. Forced events
and their keyframes share the current logical replay time; wall-clock dates are
not used to advance the recording. `ReplayService` remains the facade for
capture, normalisation, validation, persistence, access, retention, and import.

The online entry points are:

- `backend/src/modules/matchmaking/arena-simulation.service.ts`
- `backend/src/modules/matchmaking/replay.service.ts`
- `backend/src/modules/matchmaking/game-session.service.ts`
- `backend/src/modules/matchmaking/matchmaking.gateway.ts`

## Playback flow

`ReplayViewer` owns the React controls and time-based progress display.
`ReplayController` advances and seeks by `tMs`, emits UI state at no more than
10 Hz, and reconstructs snapshots from keyframes. `ReplayScene` renders the
resolved state in Phaser and does not interpolate across a round, state, or
explicit removal boundary.

The playback entry points are:

- `frontend/src/games/common/replay/ReplayViewer.tsx`
- `frontend/src/games/common/ReplayController.ts`
- `frontend/src/games/common/ReplayScene.ts`

## API and storage

The replay API supports listing, loading, importing, saving, and unsaving:

- `GET /api/matches/replays/me`
- `GET /api/matches/:id/replay`
- `POST /api/matches/replays/import`
- `POST /api/matches/:id/replay/save`
- `DELETE /api/matches/:id/replay/save`

Unsaved imported replays expire after the configured retention period. Access
is limited to match participants. Contract v1 recordings are deliberately not
migrated; the replay v2 migration removes them before enforcing the new schema.

## Validation

Use the executable checklist in
[`replay-system-unification-plan.md`](./replay-system-unification-plan.md). Replay
Mode must remain `In progress` in `modules-progress.md` until its automated and
manual acceptance checks pass. In particular, the manual matrix covers all four
games, local and online modes, one to five participants, reconnection, authority
handover, round pre-roll, and the five-player rendering budget.

For integrated verification, use the repository entry points:

- `make refresh-app` after application changes
- `make re` when the database must be recreated and migrations reapplied
- `make health` to confirm the final stack state
