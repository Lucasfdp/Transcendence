# Replay System Unification Plan

## Goal

Replace the legacy replay pipeline with replay contract v2 and one shared capture, encoding, persistence, playback, and rendering system for all four games. Replays are available only when power-ups are disabled.

## Availability invariant

- [x] Decide replay availability before the match starts and keep it immutable.
- [x] Expose `replayEnabled` and `replayDisabledReason` in local match, queue, room, and private-lobby contexts.
- [x] Show `Replays are unavailable while power-ups are enabled.` beside every power-up control when enabled.
- [x] Keep the equivalent explanatory notice in the replay modal.
- [x] Do not start or retain a frontend recorder for a match with power-ups.
- [x] Do not create a backend `MatchReplay` for a room with power-ups.
- [x] Reject imports unless metadata explicitly declares `powerupsEnabled: false`.
- [x] Exclude matches without a replay from replay lists and replay actions.

## Replay contract v2

- [x] Define equivalent frontend and backend `ReplayMetadataV2`, `ReplayFrameV2`, `ReplayEventV2`, and `ReplayEntityV2` contracts.
- [x] Use monotonic `tMs` as the only replay timeline.
- [ ] Validate one to five participants, matching score arrays, stable entity IDs and generations, and normalised positions and velocities.
- [x] Encode full keyframes and delta frames with explicit removals.
- [x] Reconstruct trails from position history instead of serialising complete trails per frame.
- [x] Persist `contractVersion`, `metadata`, and `durationMs` on `match_replays`.
- [ ] Add shared fixtures that exercise the frontend and backend contract validators.

## Capture and timeline

- [x] Sample dynamic state at 20 Hz while retaining accumulator remainder.
- [ ] Produce a full keyframe every 1,000 ms and at round, action, reconnect, authority-change, and finish boundaries.
- [ ] Record round, action, launch, discontinuity, and authority events on the same `tMs` timeline.
- [x] Add `REPLAY_ROUND_PREROLL_MS=3000` to `.env.example`.
- [x] Trim only excess waiting before the first action of a match or round, retaining at most three seconds.
- [x] Preserve all later pauses and total duration when reducing samples.
- [ ] Always preserve keyframes, event boundaries, round boundaries, and the final frame.

## Runtime and online telemetry

- [ ] Consolidate recorder, sampler, encoder, persistence, controller, and renderers under `frontend/src/games/common/replay/`.
- [ ] Register one `ReplayCaptureRuntime` through the common scene host.
- [ ] Keep one pure state adapter per game; scenes expose state and lifecycle events only.
- [ ] Add replay-only WebSocket telemetry for online matches without power-ups.
- [ ] Select the active player, or the lowest connected side for simultaneous rounds, as authority.
- [ ] Validate authority, ordering, frequency, entity IDs, and ranges without changing live game state.
- [ ] Start a new keyframe and motion segment whenever authority changes.

## Playback and rendering

- [x] Drive playback and seek by `tMs` with one `requestAnimationFrame` loop.
- [x] Reconstruct from the preceding keyframe and retain a bounded seek cache.
- [x] Deliver React playback state at no more than 10 Hz.
- [ ] Never interpolate across generations, motion segments, rounds, or discontinuities.
- [ ] Use a renderer registry for all four games and reuse Phaser display objects.
- [ ] Apply participant shell, background, trail, and colour metadata consistently.
- [x] Extract `ReplayViewer` from `HomePage` and display time-based progress.
- [x] Display participants and scores correctly for one to five players.

## Tests and acceptance

- [x] Test monotonic time, accumulator remainder, keyframes, deltas, reconstruction, and stable duration after compaction.
- [x] Confirm the first action occurs within 3,000 ms and later pauses retain their duration.
- [x] Test seek, pause, resume, single-delivery events, and a stable final state.
- [x] Render classic trails through the shared runtime polyline renderer and test
  segment count, width, colour, alpha, empty histories, and independent trails.
- [ ] Compare scores, turns, entities, and winner with the original state.
- [ ] Test spawn, removal, bounce, teleport, round changes, reconnect, and authority handover.
- [ ] Confirm enabling power-ups displays the warning immediately.
- [x] Confirm power-up matches allocate no recorder frames and create no backend replay.
- [x] Confirm imports with power-ups are rejected and those matches are absent from replay lists.
- [ ] Run power-up-free fixtures for every game with one to five participants.
- [ ] Manually validate every game in single-player, local versus, and online modes with two to five players.
- [ ] Include reconnect and authority handover in a five-player online match.
- [ ] Confirm the viewer never waits more than three seconds before a round.
- [ ] Confirm five-player rendering remains within 16.7 ms per frame.
- [ ] Manually confirm continuous trail parity in all four games during play,
  pause, seek, and resize, with no line crossing a round or launch boundary.
- [x] Run frontend and backend tests and builds, followed by `make re` and `make health`.

## Documentation and completion

- [x] Replace obsolete game-specific replay guidance with the common replay-system documentation.
- [x] Document the power-up incompatibility and Replay Mode justification in `README.md`.
- [ ] Record the executed acceptance matrix in `docs/modules-progress.md`.
- [ ] Mark Replay Mode as `Done` only after every acceptance check passes.
- [ ] Mark Multiplayer 3+ as `Done` only after online matches with three, four, and five players pass.
