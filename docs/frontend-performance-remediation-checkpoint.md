# Frontend Performance Remediation Checkpoint

Last updated: 23 July 2026 — software-renderer game remediation validated
Overall status: Phase 1 complete; Phases 2–8 partially complete; Phase 9 in progress
Source plan: [`frontend-performance-profiler-report-and-plan-2026-07-23.md`](frontend-performance-profiler-report-and-plan-2026-07-23.md)

## 1. Purpose

This is the live hand-off record for the frontend performance remediation plan.
It must be updated in the same task as every implementation phase or partial
phase. It records what changed, what was validated, what remains, and the exact
next action for a future session.

The authoritative Phase 1 baseline has now been captured on the destination
machine. The report and checkpoint remain live because Phases 2–9 are still
open.

## 2. Phase Summary

| Phase | Scope | Status | Last validation | Remaining work |
| --- | --- | --- | --- | --- |
| 1 | Reproducible production baseline | Complete | Target-machine development and production matrices at 1440 x 900, Firefox profiles, React replay capture, lifecycle counters, build, tests, and health | None |
| 2 | Singular replay runtime | Partially complete | Destination development counters show one live replay runtime through inline, expanded, collapsed, and teardown states | Explain the remaining background `HomeMenu` commit and obtain a strictly comparable React capture if required |
| 3 | Replay render optimisation | Partially complete | Destination replay ownership and static Kame Knock parity pass | Strictly comparable allocation profile and Bamboo Bash, Temple Curling, and Bell Clash replay parity |
| 4 | Typed replay capture and delta encoding | Partially complete | Four complete 60-second active-game profiles show 78.4–89.7% fewer minor collections after the software-renderer fallback | Kame Knock, Temple Curling, and Bell Clash remain above the aspirational 5 collections/second target; validate replay reconstruction |
| 5 | Hub backdrop redesign and suspension | Partially complete | Isolated destination hub profile passes idle renderer and event-delay gates; responsive static check passes | Reduced-motion check and strict modal-versus-idle interpretation |
| 6 | Phaser lifecycle and start-up stalls | Partially complete | Production matrix shows one canvas per game and zero after each of five returns | Repeat comparable route profiling and explain any post-initialisation long tasks |
| 7 | Game and casino hot paths | Partially complete | Complete active profiles, production lifecycle matrix, and visual review pass for all four games after the Canvas fallback | Complete the remaining Chrome and replay acceptance matrix |
| 8 | React and data ownership | Partially complete | Focused replay resource check reports no duplicate session or inbox requests | Run one persistent-provider SPA round-trip network check and complete React acceptance evidence |
| 9 | Integrated validation and closure | In progress | Destination game profiles, production lifecycle matrix, full frontend suite, build, stack health, OpenAPI, stylesheet manifest, and diff checks pass | Complete Chrome, replay, SPA-network, reduced-motion, and TypeScript acceptance work |

## 3. Current Baseline Evidence

### Firefox

- Total recording: approximately 10 minutes 20 seconds.
- Retained application CPU samples: approximately 6 minutes 13 seconds.
- Application main-thread CPU: 57.44 seconds over 373 seconds.
- Browser Renderer CPU: 182.46 seconds over 371 seconds.
- Browser CanvasRenderer CPU: 94.54 seconds over 371 seconds.
- Later hub/casino Renderer interval: approximately 72.5 CPU seconds over
  100 seconds.
- Minor collections: 9,736, with 8,943 caused by nursery exhaustion.
- Nursery bytes processed: approximately 11.33 GiB.
- Tenured bytes: approximately 201.5 MiB.
- Long tasks: ten, totalling approximately 1.58 seconds, maximum 299 ms.
- Repeated `auth/me` requests: 24.

### React

- Capture window: approximately 56.4 seconds.
- Commits: 267.
- Total render duration: 1,017 ms.
- Maximum commit: 13 ms.
- Commits over 16 ms: zero.
- Replay-period `HomeMenu` commits: 219 over approximately 31.7 seconds.
- Replay-period render duration: approximately 930 ms.
- Adjacent replay commit intervals of 16 ms or less: 102.
- Two simultaneously mounted `ReplayViewer` instances confirmed.
- First and second replay mount passive effects: approximately 39 ms and
  19 ms respectively.

These values come from a development deployment and are diagnostic evidence,
not the final production baseline required by Phase 1.

### Phase 1 Environment Preflight

- Repository base commit: `7d0475a8f3ccad20322f105b08465eeb35bbed11`.
- Pinned container runtime: Node.js 24.18.0 and npm 11.16.0.
- Host runtime: Node.js 22.15.0 and npm 10.9.2; not used for acceptance.
- Initial workspace storage: 1.7 GB free of 4.7 GB.
- Initial Docker state: no images, containers, volumes, or build cache.
- A normal frontend builder failed with `ENOSPC` while extracting dependencies.
  Node.js 24 validation succeeded by placing dependencies and build artefacts on
  the separate `/tmp` filesystem, which had 302 GB free.
- Configured deployment: `https://10.19.234.21:42424`; the connection timed out
  and no served commit could be read from that deployment.
- Automated headless Firefox: version 152.0.6, WebRender (Software), WebGL 1 and
  WebGL 2 through Mesa llvmpipe (LLVM 20.1.2, 256 bits), X11, device pixel ratio
  1. This is automation-environment evidence only and is not a substitute for a
  non-headless capture on the profiled Radeon hardware.
- The rootless Docker data directory was relocated from the full `/goinfre`
  volume to `/var/tmp/marcnava-docker` on the root volume. The destination had
  302 GB free before the build and 298 GB free after the stack started.
- The complete development stack built under the pinned Node.js 24 images and
  all 13 services became healthy. The served commit was
  `a0626653cc71a402df55deb0e233a0380b52e398`.
- Non-headless Firefox 152.0.6 reported X11, device pixel ratio 1, WebRender
  (Software), and Mesa llvmpipe for both WebGL renderers. The host therefore
  still cannot provide a hardware-accelerated comparison with the profiled
  Radeon environment.
- The later Bamboo Bash continuation rebuilt the stack through `make dev`; all
  13 services were healthy and the served commit was
  `80dda77052a616edfe4f4aab7052b4de95287919`. The current display permitted the
  exact 1440 x 900 CSS-pixel viewport at device pixel ratio 1. Firefox ESR
  140.11.0 reported X11, WebRender, and AMD Radeon 610M hardware rendering for
  both WebGL versions.

## 4. Active Phase Record

Phase 1 is complete.

### Phase attempted

Phase 1 — establish a reproducible production baseline.

### Status

Complete.

### Changes made

- Added a development-only profiler at
  `window.__SHELL_SMASH_PERFORMANCE__`. Its `snapshot()` reports live, created,
  and peak counts for Phaser games, replay controllers, replay scenes, canvases,
  replay animation-frame loops, and resize observers. Its `reset()` starts a
  new measurement window without hiding resources that are already live.
- Instrumented both Phaser game creation paths and the complete replay lifecycle.
  Replay controllers now have explicit, idempotent disposal; replay scenes
  dispose controllers they create internally.
- Added a served-commit meta marker to every frontend document and propagated
  `VITE_APP_COMMIT` through the Makefile, Compose build, development service,
  and frontend Dockerfile.
- Added focused tests for counter increments, peaks, idempotent release, and
  reset behaviour.
- Defined the fixed development and production scenario procedure below.
- Added the parallel delivery topology for Phases 2–9 to the source plan. It
  defines four simultaneous computer workstreams, one remote integration
  branch, an immutable shared base commit, exclusive file ownership, five
  deliberately deferred cross-workstream connections, structured agent
  hand-offs, merge gates, and serial ownership of destination-machine
  performance resources.
- Added identical distributed-wave execution rules to `AGENTS.md` and
  `CLAUDE.md`. A command such as `do wave A` or `haz wave A` now authorises the
  assigned computer to create or continue its scoped branch, implement the
  complete workstream, validate it, commit it, push only that branch, and
  return the required hand-off without merging shared branches.
- Reviewed `docs/modules-progress.md`; this diagnostic infrastructure does not
  advance or complete a specification module, so no module status changed.

### Decisions

- Keep counters development-only so baseline tooling adds no production
  runtime surface. The production document retains only its commit marker.
- Preserve counters across Vite hot replacement so a capture is not silently
  reset by a module refresh.
- Count active RAF loops rather than every scheduled callback; the former
  exposes duplicate playback clocks directly without inflating totals each
  frame.
- Use live, created, and peak values together: live detects leaked ownership,
  created detects churn, and peak exposes transient duplication.
- Inject the commit through the Makefile rather than attempting to read `.git`
  from a Docker build context.
- Do not treat headless software rendering as the graphics baseline for the
  earlier Radeon profile.

### Automated validation

- Repository HEAD: `a2ee19a2a91e801a2c02042eebea75fab7941104`.
  Development and production served the same frontend commit marker,
  `a0626653cc71a402df55deb0e233a0380b52e398`; changes after that frontend
  commit are limited to documentation and the Vault development seed script.
- Pinned frontend container runtime: Node.js 24.18.0 and npm 11.16.0.
- `cd frontend && npm run test:run` in the pinned container — pass, 74 files
  and 416 tests in 9.53 seconds.
- `cd frontend && npm run build` in the pinned container — pass, 241 modules
  transformed and all production assets emitted in 11.10 seconds.
- Stylesheet manifest inspection — pass, all 18 feature stylesheets are
  reachable through `frontend/src/styles/modules/index.css`.
- `make health` — pass in both stack modes; all 13 services were healthy.
- `make validate-openapi` — pass, 97 paths and 108 operations.
- The production document exposed the same commit marker as development and
  did not expose `window.__SHELL_SMASH_PERFORMANCE__`.
- `git diff --check` — pass.

### Manual and profiler validation

- Firefox 152.0.6 ran non-headless over X11 at exactly 1440 x 900 CSS pixels
  and device pixel ratio 1. The destination environment exposed WebRender
  (Software) and Mesa llvmpipe for WebGL 1 and WebGL 2. This is the graphics
  configuration recorded for later comparisons.
- The complete fixed matrix passed in development and production: idle hub,
  opaque Shell Cards modal, Fortune Wheel, Shell Drop, all four Phaser games,
  inline replay, expanded replay, replay teardown, and five hub/game round
  trips.
- Every Phaser game retained exactly one game and one canvas while active.
  Every game return and all five route round trips returned live ownership and
  DOM canvas counts to zero.
- Development inline replay retained one Phaser game, controller, scene,
  canvas, RAF loop, and resize observer. Expanded replay retained two of each.
  Closing replay returned all six live counters to zero. Production reproduced
  the visible one-canvas and two-canvas ownership pattern and clean teardown.
- The isolated React replay window recorded 903 commits and 2,928 ms total
  render duration. Of these, 891 occurred while replay was mounted, all 891
  included `HomeMenu`, the maximum commit was 28 ms, two commits exceeded
  16 ms, and the maximum mounted `ReplayViewer` count was two.
- Production core retained 138.08 seconds of application samples: application
  main-thread CPU was 0.38% of one logical core, Renderer 11.02%, no
  `MainThreadLongTask` marker was recorded, and the maximum measured GC slice
  was 13.77 ms.
- The two production game shards retained 39.03 and 45.98 seconds. Application
  main-thread CPU was 17.96% and 12.94%, Renderer 20.71% and 25.01%, and
  CanvasRenderer 27.84% and 25.38%; neither shard recorded a long task.
- The production replay/route shard retained 55.81 seconds. Application
  main-thread CPU was 9.10%, Renderer 62.11%, and CanvasRenderer 9.35%. It
  recorded 11 long tasks totalling 1.59 seconds, from 51.90 to 246.62 ms.
  Because the shard also contains route loads, these tasks are a combined
  replay-and-navigation baseline rather than replay-only attribution.
- The earlier development game profile retained 39.02 seconds with application
  main-thread CPU at 13.81%, Renderer at 20.61%, CanvasRenderer at 24.67%, and
  no long tasks. Its maximum measured GC slice was 16.71 ms.
- Final matrix SHA-256 values are
  `dcdc35b08cff3d180c6205693bce7496b21555db86de913131a58ec6e655cc66`
  for development and
  `451af835e6635de17a2da952ff965dbfa9e51e80a89337535f387aaf2647b8c9`,
  `7b3f5188af228cc6126845b86e52cc5baecbf55c6b9ded1756d6323ba31627f3`,
  `7268f3edfb0faf8ff538bb90559d98753bf9058268f446e7e719abd7a5e14edf`,
  and
  `e0e28e92436588143a874d1f2d84c8787aec4878e720c29bfc82f4ba0a015638`
  for the four production shards.
- Firefox profile SHA-256 values are recorded as
  `abe8c2b7085c0c01926c8fe7694752a382470f44a5bc762808f597d5ab116bc1`,
  `dfdc536dfd6362dc62e1b9e4f1609807cbee43ad29c1728d31d14392c1e8acba`,
  `61a6240cb67c0f2b3b5d8bf50eac8c864c9ed03c2f097306ea0ec800ba08c60d`,
  `1aa96dcfbe0991be8bae2d2892e89e1cb735bc6f6baa0b5538271862960d9ee8`,
  `3f93fc18aa62b06118109694ce2b4e24359634f15addd06ee99a6759ecf515c8`,
  and
  `692705bc416f417f06b8a7998e4b8103471c230359ef5214d5cbdf383374d403`.
- The matrices remain under `/tmp/shell-smash-phase1/`, and the Firefox
  profiles remain under `/home/marcnava/snap/firefox/common/` on the
  destination machine. The SHA-256 values above identify the exact accepted
  artefacts.

### Known limitations

- Firefox's ring buffer discarded earlier parts of the longest recordings.
  CPU, GC, and long-task figures therefore describe each retained tail, while
  the separate matrix records prove that every required timed scenario ran.
- The production replay profile includes route transitions after replay. Long
  tasks from that shard cannot be attributed exclusively to replay without
  narrower segmentation.
- The current destination exposes software rendering rather than the Radeon
  renderer mentioned in the original diagnostic notes. Later comparisons must
  preserve the destination's recorded Firefox 152.0.6, llvmpipe, viewport, and
  interaction procedure.

### Work remaining in this phase

None. Every Phase 1 environment, scenario, profiler, lifecycle, and validation
requirement has been recorded.

### Exact next action

Commit the accepted Phase 1 closure, create
`perf/phases-2-9-integration` from that commit, publish the distributed
coordination package, and start the four independent replay, hub/casino,
Phaser/game, and React/data workstreams on separate computers.

## 5. Checkpoint 2026-07-23 — Post-Pull Plan Compatibility Review

This section is a historical checkpoint. Its status and next action record the
state at that point; the current Phase 1 status is the complete record in
Section 4.

### Phase and subtask attempted

Reviewed the pulled commits and adjusted the performance programme where the
new runtime, build, API documentation, and storage conditions affect execution
or validation.

### Status

Complete for the compatibility review. Phase 1 remains Not started.

### Changes made

- Extended Phase 1 with a Node.js 24, exact-version, storage, and build-artefact
  preflight.
- Extended integrated validation for the Nest CLI build and OpenAPI contract.
- Recorded that normal frontend profiles must exclude the Scalar documentation
  workload.

### Decisions and rejected alternatives

- Retained all nine phases in their existing order because the frontend
  implementation represented by the supplied profiles did not change.
- Did not regenerate baselines under Node.js 22 because that environment is no
  longer supported by the repository.
- Did not install dependencies or rebuild images without first resolving the
  stated storage constraint.

### Automated validation

- Static comparison of `d58d6755..7d0475a8` — compatible with the current
  findings and phase ordering.
- Host runtime check — Node.js 22.15.0 and npm 10.9.2; unsuitable for Phase 1
  acceptance.

### Manual and profiler validation

- No new runtime capture was required for the compatibility decision because
  the canonical frontend implementation and dependency versions are unchanged.

### Known limitations or regressions

- Node.js 24 build, tests, OpenAPI validation, and integrated stack validation
  remain pending until a compliant runtime and sufficient storage are
  available.

### Work remaining in this phase

- None for the pull compatibility review. The full Phase 1 baseline remains
  open.

### Exact next action

Measure free storage and Docker cache usage, then establish the Node.js 24
execution environment without creating mixed-version dependency artefacts.

## 6. Checkpoint 2026-07-23 — Phase 1 Development Hub Captures

This section is a historical checkpoint. Its partial results and remaining
work were superseded by the complete target-machine record in Section 4.

### Phase and subtask attempted

Removed the local Docker storage blocker, started the complete development
stack, and captured the idle-hub, opaque-modal, casino, and first Phaser-game
counter scenarios in clean authenticated Firefox sessions.

### Status

Partially complete. The development hub counter assertions pass in this local
environment; comparable hardware profiles and the rest of the matrix remain
open.

### Changes made

- Relocated the local rootless Docker data directory from the full `/goinfre`
  volume to `/var/tmp/marcnava-docker`, which is on the root volume. This is a
  user-environment change outside the repository; the previous directory was
  left intact.
- Bootstrapped Vault, built every development image, started the complete
  Compose stack, and created the dedicated local `perfbaseline` account.
- Set the local `perfbaseline` balance to 100,000 coins through a targeted SQL
  update so casino scenarios can use the same reproducible account.
- Recreated the dedicated `perfbaseline` account after the active preserved
  database volume no longer contained it, then restored its balance to 100,000
  coins after the Bamboo Bash capture.
- Updated this checkpoint with the environment, served commit, graphics
  configuration, viewport limitation, and the first two scenario results.
- Reviewed `docs/modules-progress.md`; baseline execution does not advance or
  complete a specification module, so its status remains unchanged.

### Decisions and rejected alternatives

- Used the repository Makefile and pinned container images for the stack rather
  than treating the unsupported host Node.js 22 runtime as acceptance evidence.
- Retained the non-headless software-rendered results as local lifecycle
  evidence but did not classify them as the target graphics baseline.
- Did not stretch or scale the 1440 x 893 browser viewport to claim a 1440 x
  900 result. The seven-pixel limitation is recorded and the final comparable
  capture remains open.
- Rejected an initial Bamboo Bash diagnostic pass because the pre-existing
  development stack served the literal `%VITE_APP_COMMIT%` placeholder. The
  stack was stopped and rebuilt through `make dev`, which injected the current
  commit before the accepted capture.
- Used the now-available 1920 x 1080 display to establish an exact 1440 x 900
  CSS-pixel viewport rather than carrying the earlier work-area limitation into
  the Bamboo Bash evidence.

### Automated validation

- `make dev` — pass; all development images built and Compose started.
- `make health` — pass; all 13 services reported healthy.
- HTTPS document inspection — pass; the served-commit marker was
  `a0626653cc71a402df55deb0e233a0380b52e398`.
- Docker storage inspection — pass; the active data root was
  `/var/tmp/marcnava-docker` with 298 GB free after the build.
- Targeted database setup — pass; exactly one `perfbaseline` row was updated and
  the resulting balance was 100,000 coins.
- Continuation `make dev` — pass; all images built and the Makefile injected
  commit `80dda77052a616edfe4f4aab7052b4de95287919`.
- Continuation `make health` — pass; all 13 services reported healthy.
- Continuation HTTPS document inspection — pass; the meta marker matched the
  current repository commit exactly.
- Continuation frontend suite in the Node.js 24 development container — pass;
  74 files and 416 tests.

### Manual and profiler validation

- Firefox 152.0.6 ran non-headless over X11 at device pixel ratio 1. Its
  1440 x 893 content viewport reported WebRender (Software) and Mesa llvmpipe
  for WebGL 1 and WebGL 2.
- Idle hub — 66.8 seconds visible; every Phaser and replay lifecycle counter
  remained at zero, with no canvas in the DOM.
- Opaque Shell Cards modal — 71.6 seconds visible; every lifecycle counter
  remained at zero, with no canvas in the DOM.
- Fortune Wheel — the wager animation settled after 4.319 seconds and remained
  idle for another ten seconds. The visible result was `½× · -5`, the balance
  changed from 100,000 to 99,995 coins, every lifecycle counter remained zero,
  and the DOM contained no canvas.
- Shell Drop — the wager animation settled after 5.035 seconds and remained
  idle for another ten seconds. The visible result was
  `Bucket 4 · 0.54× · -5`, the balance changed from 99,995 to 99,990 coins,
  every lifecycle counter remained zero, and the expected canvas 2D board
  remained mounted.
- Kame Knock — after start-up, 30 seconds idle and approximately 60 seconds of
  pointer input retained exactly one Phaser game and one canvas, with no replay
  resources. Returning through browser history released both live resources
  and removed the canvas from the DOM; the measurement window retained
  `created=1` and `peak=1` for both resource types.
- Bamboo Bash — the accepted development capture ran in non-headless Firefox
  ESR 140.11.0 at 1440 x 900 CSS pixels and device pixel ratio 1. `about:support`
  reported X11, WebRender, and AMD Radeon 610M through `radeonsi` for WebGL 1
  and WebGL 2. After start-up, 30.000 seconds idle and 60.324 seconds active
  retained exactly one Phaser game and one 1440 x 900 canvas. The active window
  issued 85 pointer movements and seven drag attempts. Every replay controller,
  replay scene, replay RAF loop, and resize-observer counter remained zero. The
  SPA return to the hub removed the canvas and reduced both Phaser-game and
  canvas live counts to zero while retaining `created=1` and `peak=1`. The page
  error listeners recorded no application errors, and visual inspection showed
  the complete arena, both side panels, score HUD, and return control without
  clipping or corruption.
- Firefox Profiler CPU and memory recordings were not captured, so these runs
  validate lifecycle ownership only.

### Known limitations or regressions

- The accepted Bamboo Bash capture used hardware acceleration, but its Radeon
  610M is not the Radeon 780M target from the original profile.
- The earlier hub, modal, casino, and Kame Knock captures remain at 1440 x 893;
  the Bamboo Bash continuation established that the current display can run the
  required 1440 x 900 viewport.
- The fixed account has no replay history yet, so replay scenarios remain
  unmeasured.
- Six `auth/me` entries accumulated during the clean page load and idle run;
  their ownership remains scheduled for Phase 8.

### Work remaining in this phase

- Capture Temple Curling, Bell Clash, inline replay, expanded replay, and five
  route round trips in development.
- Repeat the complete matrix in production mode.
- Repeat comparable profiles at the exact viewport on the target graphics
  environment and record Firefox and React metrics.

### Exact next action

Capture Temple Curling for 30 seconds idle plus 60 seconds active with the
`perfbaseline` account in development mode, then return to the hub and record
the lifecycle snapshots before and after navigation.

## 7. Fixed Phase 1 Capture Procedure

Use the same account, replay, viewport, display scale, Firefox profile, graphics
configuration, and interaction timing for the development and production pair.
Do not open `/api/docs` or any unrelated tab during a capture.

### Controls

- Base commit marker: read
  `document.querySelector('meta[name="shell-smash-commit"]')?.content` and stop
  if it is `unknown` or differs between modes.
- Viewport: 1440 × 900 CSS pixels at device pixel ratio 1.
- Firefox: a clean non-headless profile, no extensions, one application tab,
  and the `about:support` Compositing, WebRender, WebGL 1, WebGL 2, window
  protocol, and device-pixel-ratio values copied into this checkpoint.
- Firefox Profiler: 1 ms interval with CPU, memory, screenshots, JavaScript,
  allocations, and responsiveness enabled.
- React Profiler: record the same interaction window in development mode and
  enable component change descriptions.
- Preparation: wait for network activity and initial animation/layout work to
  settle before resetting counters and starting each recording.

### Development Counter Capture

Run `make dev`. Immediately before a scenario, call:

```js
window.__SHELL_SMASH_PERFORMANCE__.reset();
```

Immediately after the scenario, record:

```js
window.__SHELL_SMASH_PERFORMANCE__.snapshot();
```

The assertions for the current Phase 1 implementation are:

| Scenario | Expected live ownership while active |
| --- | --- |
| Idle hub or opaque non-replay modal | All counters `0` |
| Any Phaser game | One Phaser game and one canvas; replay counters `0` |
| Paused inline replay | One game, controller, scene, canvas, and observer; RAF loop `0` |
| Playing inline replay | The paused-inline values plus one RAF loop |
| Playing expanded replay | Two games, controllers, scenes, canvases, observers, and RAF loops; this records the known defect for Phase 2 |
| Return to hub after game or replay | Every live counter returns to `0` |

### Scenario Order

Run the plan's validation matrix in this order for each mode: idle cycle hub,
opaque-modal hub, Fortune Wheel, Shell Drop, the four Phaser games, inline
replay, expanded replay, then five hub/game round trips. Use the durations in
the source plan. Capture development first with `make dev`, stop it with
`make down`, then repeat with `make prod`. Save files with the mode, scenario,
commit, Firefox version, and date in their names.

## 8. Checkpoint 2026-07-23 — Phases 2–9 Integration

### Phase and subtask attempted

Merged all four distributed performance workstreams, completed their deferred
page and route connections, and ran the reproducible portion of Phase 9 on the
current computer.

### Status

Partially complete. The implementation and automated integration gates pass.
The destination-machine visual, lifecycle, Firefox, React, allocation, and
network comparisons remain required.

### Changes made

- Merged replay workstream head `5948affe3301a8e0fd50f2439def339cc3b332e0`.
- Merged hub and casino workstream head
  `1cdc505136fd47af641bc7dd44e28a74317f1405`.
- Merged Phaser and games workstream head
  `0195b059d930dffcbf96b22e488325d4b22568d0`.
- Merged React and data workstream head
  `aed3a642db61b18276f1d95c691b7cc49a9e225b`.
- Replaced the page-owned replay frame, progress, and playback state with the
  workstream's singular `ReplaySession`. Expansion now changes the existing
  viewer's presentation class instead of mounting a second viewer.
- Mounted the extracted `CycleBackdrop` from the hub and connected modal
  coverage to its suspension input. Removed the superseded 420-star DOM
  implementation, repainting cloud rule, and star animation styles.
- Confirmed that the final game scenes use the typed `ReplayCaptureRuntime`,
  the route tree owns persistent session and inbox providers, and the final
  Phaser factory changes require no additional cross-workstream adapter.
- Added a focused integration test proving that replay expansion and collapse
  preserve exactly one `ReplayViewer`.
- Reviewed `docs/modules-progress.md`; this performance integration changes no
  specification module claim, so no module status changed.

### Decisions and rejected alternatives

- Kept one replay component in one React tree position and changed only its
  layout class. Moving it between separate modal trees or portals could
  recreate presentation state and would weaken the singular-runtime guarantee.
- Treated the current computer's healthy stack as service-level evidence only.
  It is not a replacement for the destination machine's graphics, viewport,
  interaction, and profiler evidence.
- Kept the performance plan and checkpoint live. The closure rule requires the
  destination production matrix and profiles before archival.

### Automated validation

- Runtime — Node.js 24.13.0 and npm 11.18.0.
- `cd frontend && npm run test:run -- src/pages/HomePage.replay-integration.test.tsx`
  — pass, one file and one test.
- `cd frontend && npm run test:run` — pass, 87 files and 483 tests.
- `cd frontend && npm run build` — pass, 250 modules transformed and all
  production assets emitted.
- Stylesheet manifest inspection — pass, all 19 feature stylesheets are
  reachable through `frontend/src/styles/modules/index.css`.
- Static integration checks — pass; `HomePage.tsx` contains one
  `ReplayViewer`, mounts the extracted backdrop, and no legacy star or cloud
  selector remains in its former owners.
- `make health` — pass, all 13 services healthy.
- `make validate-openapi` — pass, 97 paths and 108 operations.
- `git diff --check` — pass.
- `cd frontend && npx tsc --noEmit` — blocked by the existing dependency and
  configuration mismatch: the lock installs TypeScript 5.9.3 while
  `ignoreDeprecations` is set to `6.0`. A diagnostic run with the compatible
  value reached existing repository-wide type errors in unrelated code and
  tests. The tracked configuration was left unchanged.

### Manual and profiler validation

- Workstream B supplied headless Firefox evidence for the extracted backdrop,
  Fortune Wheel, and Shell Drop before integration.
- No comparable manual or profiler validation was claimed for this integrated
  commit. The user confirmed that the current computer is not the destination
  environment, so its graphics and interaction results would not satisfy the
  Phase 1 comparison controls.

### Known limitations or regressions

- Destination lifecycle counters, React commits, browser renderer occupancy,
  event delay, long tasks, minor collections, network request ownership, and
  four-game replay parity remain unmeasured.
- Responsive, reduced-motion, casino, game, and replay presentation checks
  remain pending on the destination display and graphics renderer.
- Repository-wide TypeScript validation remains blocked as recorded above.
- No automated regression failed, and no known functional regression was
  observed in the reproducible checks.

### Work remaining in this phase

- Run the complete fixed development and production scenario matrix on the
  destination machine.
- Capture comparable Firefox and React profiles and record every Phase 2–8
  acceptance metric against the Phase 1 baseline.
- Resolve or deliberately rebaseline the TypeScript configuration and existing
  errors, then rerun `npx tsc --noEmit`.
- Update the phase table with measured results. Archive this checkpoint and the
  source plan only if every closure gate passes.

### Exact next action

On the destination machine, check out the final merged commit, run `make dev`,
and capture inline replay followed by expanded replay for 60 seconds each.
Record the development counters before, during, and after expansion; exactly
one game, controller, scene, canvas, observer, and playback clock must remain
live throughout.

## 9. Checkpoint 2026-07-23 — Destination Acceptance Pause

### Phase and subtask attempted

Ran the destination-machine development and production functional matrices,
focused replay validation, isolated hub profiling, and part of the per-game
active profiling against commit `349cd846`. Work was paused at the user's
request during the Bell Clash active profile.

### Status

Partially complete and safely paused. No browser, profiler, or WebDriver process
is running. The production stack remains available for the next session. The
working tree contains only this checkpoint update.

### Environment and controls

- Firefox 152 ran on X11 with software WebRender and device pixel ratio 1.
- The current desktop chrome limited the measured viewport to 1440 x 893 rather
  than the baseline's 1440 x 900. The captures are diagnostic and visual
  evidence, but do not satisfy strict profile comparability.
- The Phase 9 profiler feature and thread lists also differ slightly from the
  Phase 1 baseline. The next comparable capture must restore the baseline
  configuration.
- Docker had reverted to a nearly full `/goinfre` data root. The external
  user-level Docker daemon configuration was corrected to use
  `/var/tmp/marcnava-docker`, after which the existing images, containers, and
  persistent database became available again. This was an environment repair,
  not a repository change.
- The dedicated technical performance account was reset locally so that the
  destination browser flows could be exercised. No project user data was
  changed.

### Completed destination evidence

- Development focused replay:
  `/tmp/shell-smash-phase9/development-replay-results.json`.
  One game, controller, scene, canvas, observer, and playback clock remained
  live through inline playback, expansion, collapse, and continued playback;
  teardown returned every live counter and DOM canvas count to zero. The
  longest measured React commit was 6 ms and no commit exceeded 16 ms.
  `ReplayViewer` peaked at one. Each 60-second interval recorded one
  `HomeMenu` commit, which is not playback-frequency activity but still means
  the literal zero-update criterion has not been demonstrated.
- Production focused replay:
  `/tmp/shell-smash-phase9/production-replay-results.json` and
  `/tmp/shell-smash-phase9/production-replay-firefox-profile.json`.
  Singular ownership, playback-position continuity, clean teardown, and the
  focused resource check passed. The retained 68.14-second profile reported
  application CPU 4.876%, Renderer 92.716%, CanvasRenderer 2.180%, application
  event-delay p99 24.878 ms, and two long tasks with a maximum of approximately
  89 ms. It therefore does not pass the global p99 or unexplained
  post-initialisation long-task gates. Production React duration fields are
  unavailable and their recorded zeroes are not acceptance evidence.
- Development functional matrix:
  `/tmp/shell-smash-phase9/development-matrix-results.json`.
  The hub and opaque modal had no replay resources; both casinos rendered; all
  four games maintained one game canvas while active and zero after return;
  and five repeated game-to-hub returns completed without a retained canvas.
- Production functional matrix:
  `/tmp/shell-smash-phase9/production-matrix-results.json` and
  `/tmp/shell-smash-phase9/production-matrix-firefox-profile.json`.
  The same functional canvas and route checks passed. Its profiler ring buffer
  retained only the final approximately 20 seconds of a 619-second run, so its
  scenario CPU, event-delay, long-task, and GC figures are not acceptance
  measurements and must not be attributed to the complete matrix.
- Isolated production idle hub:
  `/tmp/shell-smash-phase9/production-idle-hub-firefox-profile.json`.
  Application CPU was 0.203%, Renderer 0.131%, CanvasRenderer 0%, application
  event-delay p99 14.769 ms, and no long task was recorded. This passes the
  idle renderer, event-delay, and long-task gates.
- Isolated opaque modal:
  `/tmp/shell-smash-phase9/production-opaque-modal-firefox-profile.json`.
  Application CPU was 0.160%, Renderer 0.290%, CanvasRenderer 0%, application
  event-delay p99 12.824 ms, and no long task was recorded. Its absolute cost
  is negligible, but Renderer is higher than the isolated idle result, so the
  literal “no more expensive than idle” criterion is not yet met.
- Static visual review found development/production parity for the hub, modal,
  casinos, all four live games, Kame Knock inline and expanded replay, and the
  972 x 627 responsive hub. It found no blank canvas, duplication, horizontal
  overflow, or material composition regression. The evidence does not cover
  reduced motion, interactive motion, complete vertical scrolling, or replay
  parity for the other three games.

### Interrupted and diagnostic-only game profiles

The Kame Knock, Bamboo Bash, and Temple Curling active runs reached their
nominal 60-second interaction loops and recorded 20 input attempts each.
However, the ring buffer retained only approximately 34.49, 37.24, and
41.37 seconds respectively. Their files and summaries are preserved under
`/tmp/shell-smash-phase9/production-<game>-active-*` for diagnosis only.
Kame Knock recorded 1,560 minor collections, Bamboo Bash 842, and Temple
Curling 2,388 in their retained windows; those rates remain high relative to
the Phase 4 target. Bamboo Bash recorded one 72 ms long task, while Temple
Curling recorded two long tasks with a maximum of approximately 309 ms.

Bell Clash was interrupted during its active loop and produced no profile
file. The three short-window profiles and the interrupted Bell Clash attempt
must all be repeated; none is accepted as the final four-game comparison.

### New functional and security finding

The replay list exposed summaries belonging to another account, while opening
the same replay correctly returned 403. Static diagnosis identified ungrouped
`OR` predicates in `ReplayService.listForUser()` in
`backend/src/modules/matchmaking/replay.service.ts`. PostgreSQL precedence
allows any unexpired replay to enter the list, leaking replay metadata although
the detailed frames remain protected. This medium-severity horizontal
authorisation issue is outside the performance validation change and remains
unfixed. Its remediation requires grouped predicates and PostgreSQL-backed
list/detail authorisation regression tests.

### Work remaining after resumption

1. Repeat all four production game profiles from the start, serially, with the
   Phase 1 profiler configuration and enough buffer capacity to retain the
   complete 60-second active interval. Treat the existing three profiles as
   diagnostic only.
2. Run one persistent-provider SPA route loop without full document reloads,
   then inspect session, notification, unread-count, failed-resource, console,
   and lifecycle evidence.
3. Validate reduced motion and vertical scrolling, and capture replay parity
   for Bamboo Bash, Temple Curling, and Bell Clash.
4. Repeat any acceptance profiles needed at a strictly comparable
   1440 x 900 viewport. Explain or remediate the replay event-delay and long-task
   failures and the high active-game allocation rates.
5. Rerun the frontend full suite, production build, stylesheet manifest,
   `make health`, `make validate-openapi`, `git diff --check`, and the tracked
   TypeScript command. Resolve or deliberately rebaseline the known TypeScript
   configuration and repository-wide errors.
6. Address the replay-list authorisation finding in a separately scoped change
   before treating the replay matrix as complete.

### Exact next action

Confirm that the production stack is healthy, then rerun the complete
Kame Knock, Bamboo Bash, Temple Curling, and Bell Clash active-profile sequence
with an enlarged buffer and the exact Phase 1 profiler feature and thread
configuration. Do not reuse the three short retained-window profiles as final
evidence.

## 10. Checkpoint 2026-07-23 — Software-Renderer Game Remediation

### Phase and subtask attempted

Investigated the active-game minor-collection rate, implemented a shared
software-renderer fallback for all four Phaser games, removed three smaller
per-frame allocation sources, and repeated the complete 60-second production
profiles at 1440 x 900 and device pixel ratio 1.

### Status

Partially complete. The change substantially reduces minor collections and
total tracked rendering occupancy without changing the four games' visible
output, lifecycle, input, or event-delay acceptance. Three games remain above
the Phase 4 aspirational target of five minor collections per second, so this
does not close the performance programme.

### Changes made

- `frontend/src/lib/createShellSmashGame.ts` now selects Phaser Canvas when the
  existing renderer probe reports llvmpipe, SWGL, SwiftShader, softpipe, or
  another software renderer. Hardware-capable browsers retain Phaser `AUTO`
  and therefore retain WebGL.
- The allocation profile showed that Phaser's WebGL `Graphics` renderer
  accounted for approximately 99% of sampled JavaScript allocation bytes in
  active Temple Curling. It rebuilt path and triangulation objects every
  rendered frame while the browser's profiled nursery was fixed at 1 MiB.
- `LocalReplayCaptureRuntime` now retains one recorder callback instead of
  allocating an adapter closure every render tick.
- `CommonGameSceneHost` avoids creating an empty `Map.values()` iterator on
  every frame when no common runtime is registered.
- Classic trails now draw the bounded tail by index instead of allocating a
  sliced array on every draw.
- `docs/modules-progress.md` was reviewed and updated with this rendering-budget
  evidence. Replay Mode remains `In progress`, and the additional-browser
  module remains `Not done`.

### Firefox profiler comparison

All comparison profiles retain a complete approximately 60.3-second active
window. They use Firefox 152.0.6, the Phase 1 profiler feature/thread set,
1440 x 900, device pixel ratio 1, and the destination's software-rendered X11
environment through the documented nested display.

| Game | Minor GC/s before | Minor GC/s after | Reduction | Tracked occupancy before | Tracked occupancy after | Event-delay p99 after | Long tasks after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Kame Knock | 37.73 | 8.14 | 78.4% | 66.29% | 59.57% | 7.64 ms | 0 |
| Bamboo Bash | 19.45 | 2.67 | 86.3% | 83.87% | 67.30% | 8.46 ms | 0 |
| Temple Curling | 60.84 | 6.29 | 89.7% | 92.70% | 54.88% | 7.08 ms | 0 |
| Bell Clash | 39.50 | 6.60 | 83.3% | 72.07% | 66.15% | 8.07 ms | 0 |

“Tracked occupancy” is the sum of the application Gecko main thread, parent
Renderer, and parent CanvasRenderer occupancy. Canvas moves rendering work onto
the application thread, so application-thread occupancy alone increases in
three games; the combined measured occupancy falls by 8.2–40.8% in every game.
This summed percentage is a diagnostic aggregate across separate threads, not
a single-core utilisation percentage.

The source profiles and summaries are stored under
`/tmp/shell-smash-phase9/production-<game>-active-*`. Their pre-change
counterparts use `production-<game>-before-canvas-*`.

### Functional and visual validation

- The production matrix ran at 1440 x 900 and device pixel ratio 1 against the
  rebuilt image. Each game had exactly one canvas while idle and active, accepted
  pointer input, and returned to zero canvases on leaving.
- Five additional game-to-hub returns each repeated the one-to-zero canvas
  transition without a retained canvas.
- The responsive hub reported no horizontal overflow.
- No failed resource was recorded by the matrix.
- Manual inspection of the four post-change screenshots found no blank canvas,
  missing texture, alpha error, geometric distortion, layout regression, or
  visible difference attributable to Canvas.
- The matrix's error listener did not survive its deliberate full-document
  navigations, so its final `errors: null` is not accepted as persistent-console
  evidence. The dedicated SPA and Chrome console checks remain required.

### Automated validation

- Targeted Vitest suites — pass, 4 files and 32 tests.
- `cd frontend && npm run test:run` under Node 24 — pass, 87 files and
  484 tests.
- `cd frontend && npm run build` under Node 24 — pass, 250 modules transformed
  and production assets emitted.
- Stylesheet manifest — pass, all 19 feature stylesheets are imported by
  `frontend/src/styles/modules/index.css`.
- `make health` — pass, all 13 services healthy.
- `make validate-openapi` — pass, 97 paths and 108 operations.
- `git diff --check` — pass.
- `cd frontend && npx tsc --noEmit` — still blocked before checking sources:
  TypeScript 5.9.3 rejects the tracked `ignoreDeprecations: "6.0"` value.

### Known limitations and remaining work

- Only Bamboo Bash reaches the aspirational target below five minor collections
  per second. The user explicitly accepted the current improvement and deferred
  further GC optimisation.
- The Firefox profiles use a nested X11 display to recover the exact 1440 x 900
  viewport that the current desktop window manager no longer exposes. This must
  remain explicit when comparing them with the original destination baseline.
- Chrome 150 was downloaded as an isolated latest-stable binary because the
  system installation is Chrome 149 and global upgrades require unavailable
  `sudo` privileges. Its matrix was paused before producing acceptance evidence
  and deliberately deferred at the user's request until a later session. Any
  partial Chrome matrix artefact is diagnostic only; the valid Chrome evidence
  is limited to the recorded preflight.
- Replay performance, four-game replay parity, persistent-provider SPA network
  ownership, reduced motion, and TypeScript resolution remain open.
- The replay-list metadata authorisation finding remains unfixed and must not be
  conflated with this renderer remediation.

### Exact next action

When the user resumes browser acceptance, run the isolated Chrome 150
production matrix with an exact emulated 1440 x 900 viewport, then run the
development replay/React capture. Keep its CDP metrics separate from the
Firefox Profiler baseline.

## 11. Checkpoint 2026-07-23 — Local Gameplay Integration

### Phase and subtask attempted

Integrated the preserved pre-Wave-D gameplay branch with the completed
performance workstreams without replacing their replay, Phaser lifecycle, or
session-ownership architecture.

### Status

Partially complete. The gameplay integration and reproducible automated gates
pass. Destination performance profiles and complete replay parity remain part
of the open Phase 9 acceptance work.

### Changes made

- Added the textured Temple Curling sheet to live play and replay while keeping
  the vector sheet as a load-failure fallback.
- Restored complete turtle rendering, retained roll angle and clockwise initial
  orientation for Temple Curling.
- Passed interpolated recorded velocity into Temple Curling replay actors and
  reset accumulated rotation after replay timeline jumps.
- Preserved Bell Clash's retained replay zone layer instead of clearing it
  before its cached redraw guard.
- Integrated the unboxed responsive pre-game layout and removed its residual
  1440 x 900 desktop scroll.
- Changed `GamePage` to consume the persistent `SessionContext` user rather
  than issuing another `auth/me` request.
- Reconciled the pending merge without replacing the software-renderer
  fallback or retained runtime changes. The reconciliation also reuses Temple
  Curling render options and replay velocity storage so the new renderer does
  not add per-ball or per-player temporary objects to steady-state frames.
- Reviewed `docs/modules-progress.md`; the integration strengthens existing
  evidence but does not change a module status.

### Decisions and rejected alternatives

- Kept `origin/main`'s singular replay session, retained render layers, pooled
  collections and Phaser lifecycle. Replacing `ReplayScene` with the older
  branch version was rejected because it would reinstate the performance
  defects already removed by Phases 2–7.
- Kept one shared route-level session owner. Page-local user hydration was
  rejected because it duplicates requests and can retain stale cosmetics.
- Kept the authored physics dimensions as the source of truth for the textured
  sheet and retained a vector fallback rather than making successful asset
  loading a gameplay requirement.

### Automated validation

- Node.js 24 frontend targeted tests — pass, 6 files and 14 tests.
- `npm run test:run` in the Node.js 24 frontend container — pass, 90 files and
  490 tests.
- `npm run build -- --outDir /tmp/local-gameplay-integration-dist
  --emptyOutDir` — pass, 256 modules transformed; the Temple Curling texture
  was present in the emitted public assets.
- Stylesheet manifest inspection — pass, all 19 feature stylesheets remain
  reachable through `frontend/src/styles/modules/index.css`.
- `git lfs fsck` — pass for the new arena texture.
- `make health` — pass, all 13 services healthy.
- `make validate-openapi` — pass, 97 paths and 108 operations.
- `git diff --check` — pass.
- `npx tsc --noEmit` — still blocked by the tracked `ignoreDeprecations` value.
  Retrying with the compatible value reached only the previously recorded
  repository-wide baseline errors; no integrated file reported an error.

### Manual and profiler validation

- Headless Firefox 152 at 1440 x 900 launched Temple Curling, rendered the
  aligned textured sheet and complete turtle, completed a throw and settlement,
  and reported no console, window or unhandled-rejection error.
- The same flow remained aligned after resizing to 1000 x 700.
- The pre-game matrix covered 1871 x 758, 1440 x 900, 1123 x 839, 1000 x 700
  and 900 x 900. Standard 1440 x 900 desktop now has equal client and scroll
  heights; compact and mobile layouts retain deliberate vertical scrolling.
- No new profiler capture was claimed for this integration.
- The final merge reconciliation used static hot-path inspection, targeted
  tests and repository integrity checks only; the user deliberately deferred
  the long browser and profiling checks.

### Known limitations or regressions

- Temple Curling replay motion and Bell Clash retained zones have automated or
  static regression coverage but still require the open destination replay
  parity pass.
- Active Temple Curling and replay allocation profiles must be repeated because
  this integration changes their renderer and asset composition.
- The broader TypeScript baseline and replay-list authorisation finding remain
  unchanged.

### Work remaining in this phase

- Complete the destination replay parity and active-game profiles already
  listed in the Phase 9 pause checkpoint.
- Run the persistent-provider SPA network loop and remaining reduced-motion
  checks.

### Exact next action

On the destination machine, capture a complete retained Temple Curling active
profile and Temple Curling replay profile, then verify moving turtles retract,
timeline seeking resets orientation, and one replay session remains live.

## 12. Per-Phase Update Template

Copy this section under a new dated heading whenever work advances:

```markdown
## Checkpoint YYYY-MM-DD — Phase N: <name>

### Phase and subtask attempted

<Exact scope attempted.>

### Status

<Not started | In progress | Partially complete | Complete | Blocked>

### Changes made

- <File or behaviour and why it changed.>

### Decisions and rejected alternatives

- <Decision, evidence, trade-off, and rejected option.>

### Automated validation

- `<command>` — <pass/fail and relevant result>.

### Manual and profiler validation

- <Scenario, environment, result, and before/after metric.>

### Known limitations or regressions

- <Unvalidated area, baseline failure, or observed regression.>

### Work remaining in this phase

- <Specific unresolved work. Write "None" only when acceptance criteria pass.>

### Exact next action

<One concrete technical action that starts the next continuation.>
```

## 13. Closure Rule

The programme is complete only when all nine phases are marked complete, the
integrated production-mode validation matrix passes, and no required manual or
profiler check remains open. At that point, review `docs/modules-progress.md`
for any status impact and move both this checkpoint and the source report to
`docs/old_docs/` in the same task.
