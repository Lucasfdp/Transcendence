# Frontend Performance Remediation Checkpoint

Last updated: 23 July 2026 — Phase 1 development hub captures
Overall status: In progress  
Source plan: [`frontend-performance-profiler-report-and-plan-2026-07-23.md`](frontend-performance-profiler-report-and-plan-2026-07-23.md)

## 1. Purpose

This is the live hand-off record for the frontend performance remediation plan.
It must be updated in the same task as every implementation phase or partial
phase. It records what changed, what was validated, what remains, and the exact
next action for a future session.

The diagnostic report is complete and Phase 1 implementation is in progress.
This file and the source plan remain in `docs/` until all implementation and
validation phases are complete.

## 2. Phase Summary

| Phase | Scope | Status | Last validation | Remaining work |
| --- | --- | --- | --- | --- |
| 1 | Reproducible production baseline | Partially complete | Full development stack plus non-headless hub, modal, casino, and Kame Knock counter captures | Capture the remaining development scenarios, every production scenario, and comparable profiles on the target graphics environment |
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

## 4. Active Phase Record

Phase 1 is active.

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

- Pinned runtime check — Node.js 24.18.0 and npm 11.16.0.
- `cd frontend && npm run test:run` in the pinned Node.js 24 container — pass,
  74 files and 416 tests.
- `cd frontend && npm run build` in the pinned Node.js 24 container — pass,
  241 modules transformed and the production assets emitted successfully.
- Production bundle inspection — pass; the document contains commit
  `7d0475a8f3ccad20322f105b08465eeb35bbed11` and no profiler global.
- Development Compose configuration validation — pass with the injected commit
  present in the resolved configuration.
- Repository-wide TypeScript check — the configured command stops at the
  pre-existing TypeScript 5.9 rejection of `ignoreDeprecations: "6.0"`. With a
  compatible command-line override it reports the existing unrelated baseline
  errors and no error in a Phase 1 file.
- `git diff --check` — pass at the implementation checkpoint.

### Manual and profiler validation

- A Node.js 24 Vite development server was loaded in Firefox 152.0.6 headless.
  The document and profiler both reported the expected base commit, and all six
  resource counters started at zero on the unauthenticated route.
- Firefox `about:support` was captured through WebDriver. The graphics fields
  are recorded in the environment preflight above.
- The complete development stack was built and started through `make dev`; all
  13 services became healthy and the HTTPS document exposed the expected
  served-commit marker.
- An authenticated, non-headless Firefox idle-hub capture remained visible for
  66.8 seconds. Every live, created, and peak lifecycle counter remained zero,
  and the DOM contained no canvas.
- The same session held the opaque Shell Cards modal open for 71.6 seconds.
  Every lifecycle counter again remained zero, and the DOM contained no canvas.
- A complete Fortune Wheel wager animated for 4.319 seconds and was followed by
  ten seconds idle. The result and balance settled correctly, every lifecycle
  counter remained zero, and the DOM contained no canvas.
- A complete Shell Drop wager animated for 5.035 seconds and was followed by
  ten seconds idle. The result and balance settled correctly, every lifecycle
  counter remained zero, and the expected canvas 2D board remained mounted.
- Kame Knock ran for 30 seconds idle and approximately 60 seconds under pointer
  input with exactly one Phaser game and one canvas. Returning to the hub
  released both live resources and removed the canvas from the DOM.
- The clean page load accumulated six `auth/me` resource entries before the
  idle capture ended. This is baseline evidence for Phase 8, not an isolated
  request count for the 60-second window.

### Known limitations

- The configured public deployment remains unreachable, so its historical
  commit is unknown. Future builds expose the commit in the
  `shell-smash-commit` meta element.
- Both headless and non-headless graphics data are software-rendered.
  Comparable profiles on the target machine remain open.
- The desktop work area limited the browser content viewport to 1440 x 893
  rather than the specified 1440 x 900. The development captures must be
  repeated at the exact height for the final comparison.
- Development captures after Kame Knock and every production capture
  remain open.
- Authenticated counter values for inline and expanded replay have not yet been
  observed; the expected values below are assertions for the capture, not
  results.

### Work remaining in this phase

Record the remaining development and production scenario matrix with the exact
viewport and target non-headless Firefox graphics configuration. Record the
development counter snapshots and the production, React, and Firefox profile
metrics in this checkpoint. Repeat the two hub scenarios on the target machine
because this environment uses software rendering and a 1440 x 893 viewport.

### Exact next action

Using the current `make dev` stack and `perfbaseline` account, capture Bamboo
Bash for 30 seconds idle plus 60 seconds active, then return to the hub and
record its lifecycle counters before and after navigation.

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

### Automated validation

- `make dev` — pass; all development images built and Compose started.
- `make health` — pass; all 13 services reported healthy.
- HTTPS document inspection — pass; the served-commit marker was
  `a0626653cc71a402df55deb0e233a0380b52e398`.
- Docker storage inspection — pass; the active data root was
  `/var/tmp/marcnava-docker` with 298 GB free after the build.
- Targeted database setup — pass; exactly one `perfbaseline` row was updated and
  the resulting balance was 100,000 coins.

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
- Firefox Profiler CPU and memory recordings were not captured, so these runs
  validate lifecycle ownership only.

### Known limitations or regressions

- Hardware acceleration on the profiled Radeon machine is unavailable here.
- The exact 1440 x 900 content viewport could not fit inside the current X11
  work area.
- The fixed account has no replay history yet, so replay scenarios remain
  unmeasured.
- Six `auth/me` entries accumulated during the clean page load and idle run;
  their ownership remains scheduled for Phase 8.

### Work remaining in this phase

- Capture Bamboo Bash, Temple Curling, Bell Clash, inline replay, expanded
  replay, and five route round trips in development.
- Repeat the complete matrix in production mode.
- Repeat comparable profiles at the exact viewport on the target graphics
  environment and record Firefox and React metrics.

### Exact next action

Capture Bamboo Bash for 30 seconds idle plus 60 seconds active with the
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
