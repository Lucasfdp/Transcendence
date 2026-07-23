# Frontend Performance Profiler Report And Remediation Plan

Date: 23 July 2026  
Status: Active working document  
Checkpoint: [`frontend-performance-remediation-checkpoint.md`](frontend-performance-remediation-checkpoint.md)

## 1. Purpose

This document records the analysis of the Firefox and React profiles captured
against the publicly exposed development deployment, correlates the observed
work with the current frontend code, and defines the ordered remediation plan.

The plan remains active until every phase is implemented and verified. Every
implementation task covered by this plan must update the linked checkpoint in
the same task. The checkpoint is the canonical hand-off location when work is
resumed in a later session.

No code was changed as part of the initial profiling analysis.

## 2. Profile Inputs And Constraints

The analysed files were:

- `Firefox 2026-07-23 00.36 profile.json.gz`
- `profiling-data.07-23-2026.00-48-12.json`

The Firefox recording lasted approximately 10 minutes 20 seconds. Its circular
buffer retained approximately 6 minutes 13 seconds of CPU samples for the
application content thread. It was recorded at a 1 ms interval with CPU,
memory, and screenshot features enabled.

The React profile covers approximately 56.4 seconds. React profiling was not
enabled for the complete navigation session. The captured sequence contains a
short Fortune Wheel interaction, replay navigation, replay playback, and an
expanded replay.

The deployment and browser environment introduce several measurement caveats:

- The application was served by Vite in development mode.
- React 18.3.1 development instrumentation was active.
- `React.StrictMode` was active.
- React Developer Tools was installed and profiling.
- Firefox memory profiling added its own overhead.
- The application was reached through its public IP rather than localhost.
- Firefox renderer threads are browser-wide and may include work from other
  tabs, although the phase changes correlate strongly with the active project.
- Some source line numbers embedded in the public deployment differ from the
  current repository. Function names and the relevant control flow still
  match, but the next comparison must use an identified commit.

These conditions mean the profiles are not production benchmarks. They are
nevertheless sufficient to identify structural defects that also exist in a
production build: duplicated replay instances, high-frequency state ownership,
full-scene redraws, JSON-based snapshot encoding, and excessive animated DOM.

### 2.1 Post-Pull Compatibility Review

The repository was updated from `d58d6755` to `7d0475a8` after the profiles
were analysed. The pull does not invalidate the findings or change the phase
order:

- no canonical React, Phaser, page, component, or frontend style-module source
  changed;
- the frontend dependency versions are unchanged, including React 18.3.1,
  Phaser 3.90, Vite 5, and Vitest 1.6;
- the two removed `.fuse_hidden*` stylesheets were stale duplicates and were
  not part of the live style manifest; and
- the profiler recordings remain valid diagnostic evidence of the same
  frontend implementation, although they predate the new repository commit and
  must not be used as the post-change comparison baseline.

The pull does change the execution and validation environment:

- the frontend and backend now require Node.js 24 and their Docker images use
  `node:24-alpine`;
- the current host has Node.js 22.15.0 and npm 10.9.2, so host-side results from
  that runtime are not valid acceptance evidence;
- the backend now builds through Nest CLI, targets ES2022, and uses Node.js 24
  types; and
- Scalar/OpenAPI dependencies and generated documentation support enlarge the
  backend dependency graph and may increase installation, image-build, and
  storage requirements. They do not enter the frontend bundle or explain the
  recorded frontend hot paths.

Phase 1 therefore includes a Node.js 24 and storage preflight before any new
baseline is captured. Normal performance scenarios must exclude `/api/docs`
unless documentation performance is being measured deliberately. Phase 9 also
accounts for the new OpenAPI validation when the backend is available or is
changed by a phase.

## 3. Executive Findings

The issues are ordered by expected user impact and recoverable performance:

1. **Critical — animated hub backdrop:** the hub creates 420 independently
   animated stars with blurred shadows and `will-change`, plus animated
   full-screen clouds and several gradients. The backdrop continues animating
   underneath opaque modals.
2. **Critical — duplicate replay runtime:** expanding a replay leaves the
   inline `ReplayViewer` mounted and creates a second viewer. Each owns a
   `Phaser.Game`, `ReplayController`, `ReplayScene`, `ResizeObserver`, and
   animation loop.
3. **High — replay render and allocation loop:** replay playback repeatedly
   resolves controller state, clears graphics, rebuilds transient maps and
   arrays, and redraws dynamic content every frame.
4. **High — replay recording allocations:** all local games capture every
   100 ms, while the encoder clones and compares snapshots through repeated
   `JSON.stringify` and `JSON.parse` operations.
5. **High — Phaser/WebGL start-up stalls:** new game contexts produce clusters
   of 200–300 ms main-thread stalls while Firefox waits on WebGL work.
6. **Medium — broad React invalidation:** replay playback state lives in the
   5,500-line `HomePage.tsx` component, so replay progress invalidates the
   complete hub subtree.
7. **Medium — game-specific hot paths:** Shell Curl trails and physics, Bell
   Clash snapshot construction, side-panel reconstruction, Shell Drop board
   drawing, and Fortune Wheel React animation all add avoidable work.
8. **Low — duplicate data hydration:** session, notification, unread-chat, and
   achievement calls repeat across route remounts. Development `StrictMode`
   amplifies the count, but ownership is duplicated independently of it.

Public-IP latency affects request completion times, but it does not explain the
renderer CPU, garbage collection rate, React update topology, or WebGL stalls.

## 4. Firefox Profile Evidence

### 4.1 CPU Distribution

| Thread | CPU time | Retained window | Approximate occupancy |
| --- | ---: | ---: | ---: |
| Application content main thread | 57.44 s | 373 s | 15.4% of one core |
| Firefox Renderer | 182.46 s | 371 s | 49.1% of one core |
| Firefox CanvasRenderer | 94.54 s | 371 s | 25.5% of one core |
| Firefox Compositor | 5.50 s | 371 s | 1.5% of one core |

Graphics work is materially larger than React and application JavaScript work.
The shared Firefox renderer thread prevents perfect per-tab attribution, but
the phase distribution is significant:

- During the Phaser-heavy first 260 seconds, `CanvasRenderer` consumes almost
  all of its 94.54 seconds of CPU.
- After the Phaser canvas work stops and the session returns to hub and casino
  screens, `CanvasRenderer` falls to almost zero.
- During a later 100-second hub/casino interval, `Renderer` consumes about
  72.5 seconds of CPU, or roughly 72% of one core.

The dominant renderer symbols are software WebRender texture sampling, linear
and radial gradient rendering, Gaussian blur, pixel blending, and box-shadow
work. This matches the animated hub backdrop. Firefox reported an AMD Ryzen 7
PRO 8700GE with Radeon 780M Graphics, but its sampled symbols include the SWGL
software path. A clean validation run must record the `about:support`
Compositing, WebRender, and WebGL renderer fields.

### 4.2 Animated Hub Backdrop

`HomePage.tsx` defines `CYCLE_STAR_COUNT` as 420. `CycleBackdrop` creates all
420 stars and renders one DOM element per star. Each star receives individual
position, size, colour, opacity, blur, duration, and delay properties.

`hub.css` applies an infinite transform and opacity animation, a blurred
`box-shadow`, and `will-change: opacity, transform` to every star. The same
backdrop also contains full-screen gradient layers and clouds whose
`background-position` animates continuously.

`CycleBackdrop` is mounted directly below the hub shell. Opening a casino,
social, replay, or profile modal does not pause it, so its renderer cost
continues beneath the modal.

This is the strongest explanation for the sustained renderer load observed
after the Phaser canvas phase ends. Because the renderer thread is shared, this
attribution must still be verified with an isolated hub-only production
profile, but confidence is high.

### 4.3 Garbage Collection And Allocation Pressure

The retained content-thread samples contain:

- 9,736 minor collections, averaging 26.1 per second;
- 8,943 `OUT_OF_NURSERY` collections;
- approximately 11.33 GiB processed through the nursery;
- approximately 201.5 MiB promoted to tenured memory;
- 33 major collection cycles;
- 1.44 seconds accumulated in minor collections;
- approximately 534 ms in major-GC slices;
- a maximum major-GC slice of 15.8 ms; and
- a maximum minor collection of 7.65 ms.

Some active-game intervals reach approximately 50 minor collections per
second. After returning to hub-only screens, this drops to roughly four to six
minor collections per 20 seconds. The pattern indicates continuous transient
allocation in gameplay and replay capture rather than a simple retained-memory
leak.

### 4.4 Long Tasks And Phaser Initialisation

Ten main-thread long tasks were recorded:

- 1.58 seconds total;
- 299 ms maximum; and
- three notable transition clusters containing approximately
  `91 + 237 + 133 ms`, `66 + 241 + 299 ms`, and `63 + 259 + 138 ms`.

They coincide with game-route launch and Phaser scene construction. Most leaf
samples inside the long tasks are synchronous waits (`futex`), IPC, and WebGL
context work rather than React computation. Creating and destroying Phaser
games repeatedly therefore has a visible transition cost even when the
application JavaScript initiating the work is short.

### 4.5 Game Hot Paths

Inclusive application-source sampling, excluding ambiguous `HomeMenu` stack
attribution, identifies the following approximate totals:

| Area | Inclusive sampled CPU |
| --- | ---: |
| Shell Curl | 2.9 s |
| Bell Clash | 1.9 s |
| Phaser side panels | 1.4 s |
| Shared ball mechanics | 511 ms |
| Shell Drop | 434 ms |
| Kame Knock | 382 ms |

Notable functions include:

- `updateShellCurl`: approximately 1.29 seconds;
- Bell Clash local snapshot ball mapping: approximately 762 ms;
- `recordMovingBallTrails`: approximately 573 ms;
- `stepCurlingBall`: approximately 503 ms;
- side-panel render and row reconstruction; and
- `ShellDropModal.drawBoard`: approximately 241 ms.

These totals are not normalised by time spent in each game. They identify hot
paths, not a fair per-game ranking.

### 4.6 Input Processing

The profile contains 8,892 `pointermove` and 8,892 compatibility `mousemove`
events. Approximately 54% target canvases. Pointer-move latency has a p95 near
17.4 ms and a maximum near 157 ms.

Browsers normally generate compatibility mouse events after pointer events, so
the equal counts do not prove duplicate project listeners. Validation should
instead confirm that inactive scenes, hidden canvases, and destroyed replay
viewers remove all input subscriptions.

### 4.7 Network Requests

The recording contains 238 completed requests. Repeated calls include:

- 24 `GET /api/auth/me` requests;
- eight notification requests;
- eight unread-chat requests;
- eight achievement requests; and
- three replay import requests.

Representative timings were:

- `auth/me`: p95 near 60 ms;
- notifications and unread chat: maxima near 106 ms;
- replay import: approximately 164–207 ms; and
- game-result submission: up to approximately 115 ms.

These values can affect loading feedback but do not account for the recorded
rendering stalls. `StrictMode` doubles development effect execution, while
`ProtectedRoute` and `HomeMenu` also independently request the current user.

## 5. React Profile Evidence

### 5.1 Aggregate Results

| Metric | Result |
| --- | ---: |
| Capture window | 56.4 s |
| Commits | 267 |
| Total React render duration | 1,017 ms |
| Mean commit duration | 3.8 ms |
| Median commit duration | 4 ms |
| p95 commit duration | 6 ms |
| Maximum commit duration | 13 ms |
| Commits over 16 ms | 0 |

React creates excessive repeated work, but no individual captured React commit
exceeds the nominal 16 ms frame budget. The main issue is update frequency and
the fact that React competes with Phaser, GC, and browser rendering.

### 5.2 Fortune Wheel

The Fortune Wheel phase contains 27 commits and approximately 50 ms of React
render time. `FortuneWheelModal` and `WheelFace` appear throughout the phase.

The animation calls `setRotation(angle)` from its `requestAnimationFrame`
callback. This reconciles the SVG and modal while the wheel moves. Pointer
pulses already use an imperative DOM ref, demonstrating the lower-overhead
pattern that should also be used for rotation.

### 5.3 Replay Playback

The replay interval contains:

- 219 `HomeMenu` commits over approximately 31.7 seconds;
- approximately 930 ms of React rendering;
- 102 adjacent commit intervals of 16 ms or less;
- 113 intervals between 151 and 300 ms; and
- effectively no intervals between those groups.

The alternating pattern of paired commits followed by a roughly 200 ms gap is
consistent with two replay controllers writing related state into the same
parent.

The normal replay modal retains its `ReplayViewer` when expansion opens a
second modal. The expanded branch creates another `ReplayViewer` instead of
moving or resizing the existing one. The React operation stream confirms both
instances remain mounted and participate in approximately 219 commits.

The first replay viewer incurred about 39 ms of passive-effect work when it
mounted. The expanded viewer incurred another approximately 19 ms. Each mount
creates a new `ReplayController`, `Phaser.Game`, `ReplayScene`, resize observer,
subscription, and animation loop.

Both viewers publish `frameIndex`, `progress`, and `playing` into the same
`HomeMenu` states. Each viewer then mirrors the received props back into its
controller through `setPlayback`, producing a bidirectional feedback path.

### 5.4 Broad HomeMenu Invalidation

`HomeMenu` owns replay frame, progress, playing, expansion, modal, social,
profile, casino, ranking, and many other states. During playback it was the
most expensive React component:

- 228 commits in the complete capture;
- 972 ms accumulated actual duration; and
- 408 ms accumulated self duration.

Static or unrelated descendants such as `ShellPortrait`,
`ExperienceProgress`, `ViewProfileLink`, links, nine-slice buttons, replay list
content, and modal scaffolding render repeatedly with playback progress.

The Firefox React User Timing markers provide an important correction to raw
stack sampling: 94 `HomeMenu` render spans totalled only about 188.5 ms in the
Firefox recording. Raw inclusive stacks that attribute much larger totals to
`HomeMenu` also contain callbacks declared inside the component and JIT/inlined
frames; they must not be interpreted as pure React render time.

### 5.5 ViewportGuard

`ViewportGuard` produced 13 updates rounded to 0 ms. Its resize handler creates
a new state object without checking whether the two boolean values changed.
This is unnecessary but low priority.

## 6. Code-Level Causes

### 6.1 Duplicate Replay Ownership

`HomePage.tsx` renders the inline viewer whenever a replay is selected. The
expanded branch renders a second viewer while the first remains present.

`ReplayViewer` creates all runtime resources in a mount effect and relays every
controller emission into parent state. A second effect mirrors parent playback
props into the controller. A third effect owns an external animation frame
loop. Expansion therefore duplicates both the rendering runtime and the state
feedback mechanism.

### 6.2 Replay Full Redraw

`ReplayScene.update()` marks the scene dirty on every playing frame. Rendering
clears several graphics objects and visibility sets, resolves playback state,
allocates maps and arrays, interpolates trails and entities, searches participant
metadata, and redraws dynamic objects. Some branches call `getState()` more
than once in the same frame.

### 6.3 JSON-Based Replay Encoding

All four local games use a 100 ms replay capture step. `ReplayEncoder`:

1. clones the input snapshot through JSON;
2. removes repeated trails from the clone;
3. serialises previous and current top-level values for comparison;
4. clones changed values; and
5. clones the complete snapshot again for `previous`.

This architecture is allocation-heavy even when few fields change and is the
most plausible project-level explanation for the nursery pressure.

### 6.4 Side-Panel Reconstruction

The reusable Phaser side panel creates a JSON render key. When the key changes,
it clears and recreates text objects, zones, frame graphics, and row content.
Incremental text and visibility updates would avoid much of this work.

### 6.5 Casino Animation Patterns

- Fortune Wheel stores every animated angle in React state.
- Shell Drop redraws static board geometry and gradients during the falling
  token animation.
- Other casino games should be audited for the same full-board-per-frame
  pattern before they are assumed to be inexpensive.

### 6.6 Repeated Session Hydration

`useSessionGate` and `HomeMenu` both request `auth/me`. Notifications and unread
chat are intentionally rehydrated on each hub remount because the socket is a
module-level singleton. The behaviour is correct for freshness but indicates
that session and inbox ownership should persist above individual routes.

## 7. Remediation Phases

### Phase 1 — Establish A Reproducible Production Baseline

Before changing behaviour:

- record the exact commit under test, starting from post-pull repository commit
  `7d0475a8`, and identify the exact commit served by any public deployment;
- use Node.js 24 consistently, either through the project containers or a
  compliant host installation, and record the exact Node.js and npm versions;
- check available storage and the Docker build cache before installing or
  rebuilding, accounting for the enlarged backend dependency graph;
- do not mix dependencies or build artefacts created under Node.js 22 and
  Node.js 24;
- create production and development comparison captures;
- record `about:support` graphics information;
- add development-only counters for live `Phaser.Game`, replay controller,
  canvas, RAF, resize observer, and scene instances;
- define isolated scenarios for idle hub, modal-open hub, each game, inline
  replay, and expanded replay; and
- record baseline values in the checkpoint.

This phase must not be skipped. The current evidence is strong enough to order
work, but browser-wide renderer numbers require an isolated baseline for fair
before/after comparisons.

Implementation checkpoint, 23 July 2026: the Node.js 24 execution path,
served-commit marker, development-only lifecycle counters, and fixed scenario
protocol are implemented. The Docker data root has since been relocated to a
volume with sufficient space, the complete development stack builds and becomes
healthy, and the non-headless idle-hub and opaque-modal lifecycle captures pass.
Complete Fortune Wheel and Shell Drop animations plus idle captures also pass
their lifecycle assertions. Kame Knock also retains one game and canvas during
idle and active input, then releases both on return to the hub. The remaining
development matrix, every production capture, and comparable profiles on the
target graphics environment remain pending. See the live checkpoint for the
recorded evidence and exact continuation action.

### Phase 2 — Make Replay Runtime Singular

- Introduce a replay session that owns one controller.
- Render exactly one replay canvas and Phaser game.
- Expand by changing the existing viewer layout or host, not by mounting a
  second viewer.
- Remove frame, progress, and playing state from `HomeMenu`.
- Keep only selected replay, open/closed state, and presentation mode in the
  parent.
- Remove the prop-to-controller feedback effect.
- Send toolbar commands directly to the replay session.
- Preserve playback position across expand and collapse.

Acceptance criteria:

- one controller, game, scene, canvas, resize observer, and playback clock;
- zero `HomeMenu` commits caused by playback;
- no paired replay commits separated by a few milliseconds; and
- no replay restart or asset reload when presentation mode changes.

### Phase 3 — Optimise Replay Rendering

- Resolve controller state once per render frame.
- Pass the resolved state through renderer functions.
- Cache participant lookups by side.
- Reuse arrays, maps, sets, and entity render records.
- Retain Phaser objects and update transforms, alpha, texture, and visibility.
- Separate static and dynamic graphics.
- Redraw targets, zones, backgrounds, and arena elements only when their source
  frame data changes.
- Consider an adaptive 30 FPS replay render mode only after allocation and
  redraw defects are removed.

Acceptance criteria:

- at most one `getState()` call per frame;
- no avoidable `new Map`, `filter`, `map`, or participant search in the hot
  path;
- materially lower replay allocation rate; and
- visual parity across all four replay game types.

### Phase 4 — Replace JSON Replay Capture And Diffing

- Define a typed, data-oriented snapshot delta encoder.
- Compare entity fields by ID and primitive values.
- Track dirty/version state at the source where practical.
- Avoid constructing a complete snapshot when nothing relevant changed.
- Preserve periodic keyframes and deterministic reconstruction.
- Separate trail sampling from general snapshot cloning.
- Keep the 100 ms cadence initially; alter it only after measuring the new
  encoder.

Acceptance criteria:

- no JSON serialisation or parsing in the capture loop;
- replay contract and reconstruction tests remain green;
- all game replays remain visually and logically correct; and
- active-game minor GC moves towards fewer than five collections per second.

### Phase 5 — Redesign And Suspend The Hub Backdrop

- Replace 420 animated DOM stars with a single canvas/texture layer or a much
  smaller bounded set.
- Remove per-star `will-change` and expensive blurred shadows.
- Move clouds through a transformed layer instead of animated
  `background-position`.
- pause or simplify the backdrop when the document is hidden, an opaque modal
  covers it, or reduced motion is requested;
- scale visual complexity by viewport and renderer capability; and
- preserve the intended day/night appearance at supported breakpoints.

Acceptance criteria:

- isolated idle-hub renderer occupancy below 10–15% of one core on the profiled
  machine;
- no large compositor-layer explosion;
- modal-open hub is not more expensive than idle hub; and
- no visible responsive or theme regression.

### Phase 6 — Reduce Phaser Start-Up And Lifecycle Stalls

- prove cleanup of every game, scene, canvas, input listener, timer, and
  observer;
- prevent duplicate context creation during route transitions;
- assess a persistent Phaser game shell with scene transitions;
- preload required modules and assets without constructing hidden games;
- tune device pixel ratio and resolution when hardware acceleration is
  unavailable; and
- ensure replay expansion never creates another context.

Acceptance criteria:

- instance counters return to their expected baseline after navigation;
- no duplicate context construction;
- no post-initialisation long task above 100 ms where practical; and
- a transition fallback clearly communicates unavoidable first-start work.

### Phase 7 — Optimise Game And Casino Hot Paths

- Shell Curl: reduce transient physics/trail structures and gate panel updates.
- Bell Clash: remove snapshot mapping and cloning overhead before altering the
  already useful idle redraw gate.
- Side panels: retain objects and update content incrementally.
- Shell Drop: prerender static board geometry and draw only dynamic elements.
- Fortune Wheel: animate rotation imperatively and commit only start/end state
  to React.
- Audit Kame Knock, Bamboo Bash, and the remaining casino games against the
  same dirty-render and static-layer rules.

Acceptance criteria must be recorded per affected feature, including automated
tests and visual checks.

### Phase 8 — Narrow React State And Data Ownership

- Split `HomeMenu` by feature ownership without treating file splitting itself
  as a runtime optimisation.
- Keep rapidly changing state inside the feature that consumes it.
- Memoise stable presentation only after correcting state boundaries.
- Introduce persistent session ownership above protected routes.
- Deduplicate in-flight and recently resolved `auth/me` requests.
- Persist notification and unread state across hub/game route transitions,
  while retaining REST reconciliation and socket updates.
- Avoid no-op `ViewportGuard` state changes.

Acceptance criteria:

- no unrelated hub subtree renders during feature animation;
- one logical session request per required refresh;
- freshness and authentication invalidation semantics remain correct; and
- no React commit exceeds the 16 ms budget in the defined scenarios.

### Phase 9 — Integrated Validation And Closure

- Run the required frontend build and test suite.
- Run targeted replay, game, and component tests added by each phase.
- Run all relevant commands under Node.js 24 and record the exact runtime in
  the checkpoint.
- Run the backend build and tests when a phase changes backend code or shared
  contracts.
- Run `make validate-openapi` when backend controllers, DTOs, build
  configuration, or API contracts are affected, and once during final
  integrated closure.
- Validate the running stack through the Makefile when the environment has
  sufficient space.
- Inspect Firefox console, network, rendered state, and profiles.
- Repeat the isolated scenario matrix in production mode.
- Compare every acceptance metric against the Phase 1 baseline.
- Review `docs/modules-progress.md` and update it only if completed work changes
  the supported module claims.
- Move this report and its checkpoint to `docs/old_docs/` only when all phases,
  visual checks, and profiling validation are complete.

## 8. Validation Matrix

Each comparable profile should use the same viewport, graphics configuration,
interaction script, replay, recording duration, Node.js 24 build environment,
and identified repository commit. Normal scenarios should not keep the Scalar
API documentation open in another tab.

| Scenario | Minimum capture |
| --- | --- |
| Idle cycle hub | 60 seconds, no pointer movement |
| Hub with opaque modal | 60 seconds |
| Fortune Wheel spin | Complete spin plus 10 seconds idle |
| Shell Drop | Complete drop plus 10 seconds idle |
| Each Phaser game | 30 seconds idle plus 60 seconds active |
| Inline replay | 60 seconds playback |
| Expanded replay | 60 seconds playback |
| Route transitions | At least five hub/game round trips |

Global target metrics:

- one replay viewer, canvas, controller, and game;
- no `HomeMenu` playback updates;
- React maximum commit below 16 ms;
- event-delay p99 below 16 ms;
- no unexplained long task over 50 ms after initialisation;
- active-game minor GC substantially below the current 26–50 per second;
- idle-hub renderer occupancy below 10–15% of one core;
- no duplicate session hydration; and
- no visual, replay-contract, game-logic, accessibility, or responsive
  regression.

## 9. Checkpoint Protocol

`docs/frontend-performance-remediation-checkpoint.md` must be updated in the
same task as every implementation phase or partial phase. A checkpoint update
must contain:

1. the phase and subtask attempted;
2. status: `Not started`, `In progress`, `Partially complete`, `Complete`, or
   `Blocked`;
3. files and behaviours changed;
4. design decisions and rejected alternatives;
5. automated validation executed and its result;
6. manual or profiler validation executed and its result;
7. known failures, regressions, or unvalidated areas;
8. work still required to complete the phase; and
9. one exact next action to perform when the user asks to continue.

When a phase is only partially implemented, the checkpoint must not mark it as
complete merely because the current task ended. The next action must identify
the first unresolved technical step, not simply say "continue Phase N".

The checkpoint summary table must also be updated so a future session can
resume without re-auditing completed work.

## 10. Initial Recommended Next Action

Start Phase 1 by recording the deployed commit, graphics renderer information,
and live Phaser/replay instance counts. Then capture isolated production-like
idle-hub and replay-expand baselines before implementing Phase 2.
