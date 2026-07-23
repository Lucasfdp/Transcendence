# Repository Guidelines

## Core Rules

- All repository documentation and instructional files must be written strictly
  in British English.
- Always reply in the user's language. Use English only when the user's language
  is genuinely unclear.
- `AGENTS.md` and `CLAUDE.md` are mirrored operational guides. Any change to
  working rules, workflows, or conventions must update both files in the same
  task and keep their operational content identical.
- Every project change must review `docs/modules-progress.md`. Update it in the
  same task when the change advances or completes a module.
- Store every new project document under `docs/`.
- Prioritise current documents before drafting or investigating. The principal
  brief is `docs/en.subject.md`, with its PDF version in `docs/en.subject.pdf`.
- Treat `docs/deprecated/` and `docs/old_docs/` as historical archives. Do not
  use them as primary sources for current decisions unless the user explicitly
  requests it.
- When a working document is fully completed and verified, move it to
  `docs/old_docs/` in the same task. Keep it in `docs/` while any phase,
  finding, or validation remains open.
- The functional scope is defined by `docs/modules-progress.md`. Do not add
  modules or functionality outside that scope unless the user explicitly asks.

## Pending Plans

- Pending: `docs/frontend-performance-profiler-report-and-plan-2026-07-23.md`.
  Resume it from `docs/frontend-performance-remediation-checkpoint.md`.
- When the user asks to continue or follow "the plan" without naming one, review
  this section and the listed live plan and checkpoint documents before acting.
  If exactly one plan is pending, continue that plan. If several are pending and
  the request is ambiguous, identify them and ask the user which one to resume.
- When a pending plan is fully implemented and verified, archive its completed
  working documents as required by the Core Rules and update this section in
  both `AGENTS.md` and `CLAUDE.md` in the same task. When this performance plan
  is complete and no other plans are listed here, replace its entry with
  `- None.` so the guides explicitly state that no plans are pending.

## Distributed Performance Workstreams

The commands `do wave A`, `do wave B`, `do wave C`, `do wave D`, their Spanish
equivalents, and references to a workstream letter are complete execution
requests for one distributed performance workstream. In this context, "wave"
and "workstream" are aliases. The assignments are:

- Wave A — Replay: `perf/workstream-replay`.
- Wave B — Hub and casino rendering: `perf/workstream-hub-casino`.
- Wave C — Phaser lifecycle and games: `perf/workstream-phaser-games`.
- Wave D — React and data ownership: `perf/workstream-react-data`.

The live performance plan defines the complete scope, owned files, forbidden
files, acceptance criteria, deferred integration points, and hand-off format
for each wave. An agent receiving a wave command must complete the whole
assigned workstream on its current computer, not merely analyse it or prepare a
plan.

Follow this workflow:

1. Read this guide, `CLAUDE.md`, the live performance plan, its checkpoint, and
   `docs/modules-progress.md` before changing code.
2. Inspect the current branch, worktree status, remotes, and recent history.
   Preserve unrelated user changes and never absorb them into the wave.
3. Use the immutable base commit supplied by the coordinator. If no separate
   SHA is supplied and the computer is on a clean `main` or `master`, first
   fast-forward it from its configured remote, then create the assigned branch
   from that exact HEAD. If it is already on the assigned branch, verify its
   base and continue. If the worktree is dirty with unrelated changes, the
   published base is unavailable, or a different branch contains ambiguous
   work, stop and report the exact conflict instead of guessing.
4. Create the assigned branch when currently on `main` or `master`. Never
   implement a wave directly on `main`, `master`, or the integration branch.
5. Modify only files owned by the assigned wave. Treat forbidden files,
   another wave's files, `AGENTS.md`, `CLAUDE.md`, the canonical checkpoint,
   and `docs/modules-progress.md` as read-only. Record required cross-workstream
   or canonical-document changes in the hand-off for the integrator.
6. Implement the complete workstream, including its targeted tests, regression
   tests, production build, static checks, and local visual validation. Use the
   Makefile for any local integrated stack. Performance results from a worker
   computer are diagnostic; final acceptance profiles run on the destination
   computer.
7. Review the final diff for scope and forbidden-file violations. Commit the
   wave as one or more clear commits and push only its assigned branch to the
   configured remote. A wave command authorises creating, committing, and
   pushing that workstream branch; it does not authorise merging, force-pushing,
   rebasing shared branches, opening a pull request, or modifying another
   branch.
8. Return the structured hand-off required by the live plan: base and head
   commits, changed files, decisions, validation results, visual evidence,
   environment differences, known failures, deferred connections, and
   destination-machine checks still required.

The integrator alone merges workstream branches, performs deferred
cross-workstream connections, updates canonical performance documentation, and
runs Phase 9. A worker must not mark a phase complete when its integration or
destination-machine acceptance remains outstanding.

## Operational Index

- Product context: `docs/project-overview.md`
- Brief and scope: `docs/en.subject.md`
- Docker and deployment: `docker-compose.yml`, `docker-compose.override.yml`,
  `docs/deployment.md`, `docs/docker-notes.md`
- Service architecture: `docs/project-overview.md`, `docs/service-map.md`
- Frontend: `frontend/src/`, `public/`
- Backend: `backend/src/`
- Working commands: `Makefile`
- Security and OAuth: `docs/security.md`, `docs/oauth-setup.md`
- Module scope and status: `docs/modules-progress.md`
- Historical archive: `docs/deprecated/`, `docs/old_docs/`

## Project Structure

`frontend/` contains the Vite, React, and Phaser SPA. `backend/` contains the
NestJS API, TypeORM entities, and migrations under `backend/src/migrations/`.
`infra/` contains Nginx, PostgreSQL, Redis, Vault, monitoring, and supporting
configuration. `scripts/` contains local utilities. `public/` contains shared
assets. `docs/` contains the live project documentation.

## Docker

The main stack is defined in `docker-compose.yml`.
`docker-compose.override.yml` enables development hot reload.

- `reverse_proxy`: the single HTTPS entry point; terminates TLS and routes the
  frontend, API, and monitoring services.
- `frontend`: the Vite, React, and Phaser client served inside the stack.
- `backend`: authentication, API, game logic, and data access.
- `database`: persistent PostgreSQL storage for users, profiles, and game data.
- `redis`: caching, session support, and the basis for real-time work or queues.
- `monitoring`: the monitoring dashboard exposed through Nginx.
- `vault`: the central source of local secrets.
- `backend_vault_agent`: renders secrets consumed by the backend.
- `database_vault_agent`: renders PostgreSQL passwords and secrets.
- `redis_vault_agent`: renders Redis passwords and secrets.
- `monitoring_vault_agent`: renders monitoring-service secrets.

## Frontend and Backend

Preserve the existing format. The project uses tabs with a width of `4`, as
defined in `.prettierrc.json`. Do not introduce a competing style.

In the frontend, respect the existing `pages/`, `routes/`, `hooks/`, `features/`,
`components/`, and `shared/` boundaries. Use `PascalCase` for components and
`camelCase` for hooks and utilities. In the backend, follow the existing
TypeScript, NestJS, and ESLint conventions.

## Frontend Styling

Tailwind CSS is the default styling system. The canonical configuration is
`frontend/tailwind.config.cjs`, and the required import order in
`frontend/src/main.tsx` is:

1. `styles/tailwind-base.css`
2. `styles/modules/index.css`
3. `styles/tailwind-utilities.css`

Follow these rules for every frontend style change:

- Use Tailwind utilities directly in React for local, static component styling.
- Keep every Tailwind class as a complete, statically discoverable string.
  Do not construct class names from partial strings. Use explicit maps for
  variants, or add a deliberate safelist entry when generation is unavoidable.
- Use a feature style module under `frontend/src/styles/modules/` when a style
  needs pseudo-elements, relational or attribute selectors, complex keyframes,
  vendor-specific controls, shared semantic selectors, or values driven through
  CSS custom properties.
- Register every new feature style module in
  `frontend/src/styles/modules/index.css`. Preserve the manifest's cascade order;
  do not import feature styles ad hoc from unrelated components.
- Do not create another `global.css`, monolithic stylesheet, or second style
  entry point.
- Reuse an existing domain module before creating a new one. Split a module when
  it reaches 1,000 lines where practical. A stylesheet must be split before it
  reaches 1,600 lines.
- Use clear domain names such as `cards.css`, `social-replays.css`, or
  `gambling-wheel.css`. For retained global selectors, follow the existing BEM
  convention and keep selectors scoped to their feature.
- Within feature modules, use `@apply` for repeated Tailwind-compatible layout
  and typography primitives. Keep raw CSS only where it expresses behaviour or
  visual detail more clearly or where no exactly equivalent utility exists.
- Never replace a CSS shorthand with a narrower Tailwind utility when that
  changes reset semantics. For example, `background: transparent` is not
  equivalent to `bg-transparent`, and `list-style: none` is not always
  equivalent to `list-none`.
- Use inline React styles only for genuinely runtime-derived values. Prefer
  setting a CSS custom property and consuming it in the relevant feature module.
- Keep fonts, palette tokens, and shared custom properties in the foundation
  layer. Do not duplicate design tokens across feature files.
- After moving a stylesheet, correct and verify all relative asset and font
  paths. A successful development render alone is not sufficient; the
  production build must emit the assets.
- Write all new CSS comments in British English. Update live documentation that
  references a renamed or moved stylesheet.

For any style change, validation must include:

- `cd frontend && npm run build`
- `cd frontend && npm run test:run`
- a check that every stylesheet is reachable through `styles/modules/index.css`
- `git diff --check`
- visual validation at affected desktop and responsive breakpoints

For integrated or visually significant changes, use the `Makefile` to validate
the running stack and inspect Firefox console, network, and rendered state. If
repository-wide type-checking has unrelated baseline failures, type-check the
touched files where possible and report the baseline failures explicitly.

## Makefile

Always use the `Makefile` as the main entry point for the local environment.

- Start and stop: `make up`, `make dev`, `make prod`, `make down`,
  `make restart`, `make re`
- Individual services: `make restart-front`, `make restart-back`,
  `make rebuild-front`, `make rebuild-back`, `make refresh-app`
- Build and status: `make build`, `make logs SERVICE=backend`, `make ps`,
  `make status`, `make health`, `make validate-openapi`
- Diagnostics and cleaning: `make diagnosis`, `make clean`, `make fclean`
- Inspection: `make shell SERVICE=backend`, `make inspect SERVICE=backend`,
  `make volumes`, `make networks`, `make db`, `make open`
- Vault and certificates: `make vault-bootstrap`, `make vault-init`,
  `make vault-unseal`, `make vault-seed-dev`, `make vault-status`, `make certs`,
  `make prepare-local-secrets`
- Environment and help: `make check-env`, `make help`
- Automated Git flow: `make push M="message"`

## Testing and Validation

The backend uses Jest with `*.spec.ts`; run `cd backend && npm run test` or
`npm run test:cov`. For integrated platform changes, validate with `make dev` or
`make up`, depending on the required mode. If a frontend area lacks automated
tests, document the manual validation in the delivery.

When a runtime error, frozen scene, or logical failure remains unexplained after
static analysis, launch Firefox in headless or developer mode and autonomously
reproduce the required user flows. Inspect the browser console, network
activity, visual state, and available traces before applying a fix. This step
complements rather than replaces automated tests and final manual validation.

## Commits

Use short, direct commit messages, for example
`Fixed auth and removed CORS restrictions`. Keep one clear idea per commit and
avoid vague titles.
