# Frontend Performance Remediation Checkpoint

Last updated: 23 July 2026 — local Phase 1 capture complete; target capture pending
Overall status: Phase 1 partially complete
Source plan: [`frontend-performance-profiler-report-and-plan-2026-07-23.md`](frontend-performance-profiler-report-and-plan-2026-07-23.md)

## 1. Purpose

This is the live hand-off record for the frontend performance remediation plan.
It must be updated in the same task as every implementation phase or partial
phase. It records what changed, what was validated, what remains, and the exact
next action for a future session.

The diagnostic report and local Phase 1 capture are complete. The authoritative
performance baseline on the machine where the problem was observed remains
pending. This file and the source plan remain in `docs/` until all
implementation and validation phases are complete.

## 2. Phase Summary

| Phase | Scope | Status | Last validation | Remaining work |
| --- | --- | --- | --- | --- |
| 1 | Reproducible production baseline | Partially complete | Local exact-viewport development and production matrices, Firefox profiles, React replay capture, lifecycle counters, graphics record, build, tests, health, and OpenAPI validation | Repeat the comparable Firefox and React baseline on the original problem machine and record its exact environment |
| 2 | Singular replay runtime | Not started | Existing React profile exposes two viewers | Full phase |
| 3 | Replay render optimisation | Not started | Static code and existing profiles reviewed | Full phase |
| 4 | Typed replay capture and delta encoding | Not started | Existing GC and encoder reviewed | Full phase |
| 5 | Hub backdrop redesign and suspension | Not started | Existing renderer profile and CSS reviewed | Full phase |
| 6 | Phaser lifecycle and start-up stalls | Not started | Existing long tasks classified | Full phase |
| 7 | Game and casino hot paths | Not started | Existing source hot paths ranked | Full phase |
| 8 | React and data ownership | Not started | Existing React and network patterns reviewed | Full phase |
| 9 | Integrated validation and closure | Not started | None | Full phase |

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

Phase 1 remains active. Its local implementation and capture are complete, but
the target-machine performance capture is still required.

### Phase attempted

Phase 1 — establish a reproducible production baseline.

### Status

Partially complete.

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

- Exact repository and served commit:
  `bb0cf0fc7616858ae63f88acd31c55fe9dbdee4c`.
- Host runtime: Node.js 24.13.0 and npm 11.18.0. Pinned frontend container
  runtime: Node.js 24.18.0 and npm 11.16.0.
- `cd frontend && npm run build` — pass, with 241 modules transformed and all
  production assets emitted.
- `cd frontend && npm run test:run` — pass, 74 files and 416 tests.
- `make health` — pass, all 13 services healthy in development mode.
- `make validate-openapi` — pass, 97 paths and 108 operations.
- The production document exposed the exact commit and did not expose
  `window.__SHELL_SMASH_PERFORMANCE__`.
- `git diff --check` — pass.

### Manual and profiler validation

- Firefox ESR 140.11.0 ran non-headless under X11 at exactly 1440 x 900 CSS
  pixels and device pixel ratio 1. `about:support` reported WebRender and an
  AMD Radeon 610M through `radeonsi` for WebGL 1 and WebGL 2.
- The complete fixed matrix passed in both development and production: idle
  hub, opaque Shell Cards modal, Fortune Wheel, Shell Drop, Kame Knock, Bamboo
  Bash, Temple Curling, Bell Clash, five route round trips, inline replay,
  expanded replay, and replay teardown. Each matrix contains 16 records.
- Both matrices reported zero browser errors, zero unhandled rejections, and
  zero failed resources.
- Every Phaser game retained one game and one canvas while active, and no game
  canvas remained after returning to the hub. All five route round trips
  returned to zero live resources.
- Inline replay retained one of each tracked replay resource. Expanded replay
  retained two games, controllers, scenes, canvases, RAF loops, and resize
  observers. Closing replay returned every live count to zero. This is the
  reproducible defect baseline for Phase 2.
- The local comparison Firefox captures used a 1 ms interval with JS, CPU,
  memory, stack walking, responsiveness, and screenshots enabled. Production
  recorded 134.29 seconds; development recorded 136.57 seconds.
- Production CPU totals were 7.31 seconds on Renderer, 4.44 seconds on
  CanvasRenderer, 2.07 seconds on Compositor, and 21.53 seconds across content
  Gecko main threads. Development recorded 5.99, 4.10, 1.71, and 21.55 seconds
  respectively.
- Production recorded 1,095 minor collections and 42 major collections.
  Development recorded 1,340 minor collections and 54 major collections.
- The React replay window covered inline and expanded playback for 22.83
  seconds: 354 `HomeMenu` commits, 1,506 ms total render duration, 4.25 ms
  mean, 8 ms p95, 24 ms maximum, one commit over 16 ms, and 151 adjacent commit
  intervals of 16 ms or less.
- Raw development and production matrices, screenshots, Firefox profiles,
  React commit data, and `about:support` data are retained under
  `/tmp/phase1-results/`. The matrix SHA-256 values are
  `8603764fc753b824da0789e46497fe2b67b52c5b367db4c9ad9e5113ffe591a1`
  and
  `376519f3b0d46727bea9581fc50ce62f2ef9c9e2caed73395f37ee4220e1c20a`;
  the Firefox profile values are
  `8d94f5d2e9c92eb20c637af343fa5438b5513e1501d1d77b68bec8f76243c742`
  and
  `db9110c83203d5608b1983db42897a10ebe0ea589a19032fec5b56bfffa4f250`.

### Known limitations

- The configured public deployment remains unreachable, so its historical
  commit is unknown. Future builds expose the commit in the
  `shell-smash-commit` meta element.
- The current Radeon 610M machine is not the machine where the performance
  problem was observed. Its captures validate the scenario automation,
  lifecycle ownership, and local behaviour only; they are not the
  authoritative graphics or CPU baseline.
- The original diagnostic capture reported a Radeon 780M and software-renderer
  activity. A clean baseline must be repeated on that original problem machine
  with its exact Firefox `about:support` configuration. The post-remediation
  comparison must then use that same machine, browser configuration, viewport,
  and scripted sequence.
- Startup and browser-shutdown activity remains in both comparable Firefox
  captures. Later phase comparisons must use the same scripted sequence and
  capture procedure.

### Work remaining in this phase

Run the fixed development and production comparison capture on the original
problem machine. Record its exact commit, Node.js and npm versions, Firefox
version, operating system, CPU, `about:support` Compositing, WebRender, WebGL 1
and WebGL 2 fields, viewport, device pixel ratio, Firefox profile metrics, and
React replay metrics. Preserve the raw profiles and checksums, then designate
that capture as the authoritative Phase 1 performance baseline.

### Exact next action

On the original problem machine, check out exact commit
`bb0cf0fc7616858ae63f88acd31c55fe9dbdee4c`, start the stack through the
Makefile, capture Firefox `about:support`, and run the same development and
production profiling sequence at 1440 x 900 and device pixel ratio 1. Do not
start Phase 2 until that target-machine baseline has been recorded.

## 5. Checkpoint 2026-07-23 — Post-Pull Plan Compatibility Review

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

## 8. Per-Phase Update Template

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

## 9. Closure Rule

The programme is complete only when all nine phases are marked complete, the
integrated production-mode validation matrix passes, and no required manual or
profiler check remains open. At that point, review `docs/modules-progress.md`
for any status impact and move both this checkpoint and the source report to
`docs/old_docs/` in the same task.
