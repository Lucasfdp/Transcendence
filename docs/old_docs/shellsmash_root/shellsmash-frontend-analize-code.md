# Shell Smash Frontend — Audit Report

## Date

- 2026-06-17

## Scope reviewed

- Route/page/module: whole frontend application under `shellsmash/srcs/requirements/frontend/src/src`, with auth-flow verification against the supporting backend controller.
- Files reviewed:
    - `shellsmash/srcs/requirements/frontend/src/src/main.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/hub/api.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/hub/ShellPickerScene.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/hub/ProfilePanel.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/shared/responsive-scene.ts`
    - `shellsmash/srcs/requirements/frontend/src/src/shared/theme.ts`
    - `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts`
- Runtime assumptions:
    - Vite app served behind the repo’s `/api` backend.
    - Phaser scenes are the primary UI runtime.
    - Backend enforcement was only spot-checked where frontend trust boundaries depended on it.

## Stack classification

- React: no
- Web Components: no
- Actual stack reviewed: TypeScript + Phaser + Vite + DOM overlays

## Inputs and methodology

- Skills used:
    - `analize-code`
    - `web-design-guidelines`
    - `frontend-design`
    - `react-best-practices`
    - `composition-patterns`
- Code areas inspected:
    - bootstrap and scene registration
    - login / guest / OAuth entry points
    - hub scene lifecycle, resize and modal behavior
    - shell selection flow and registry handoff
    - profile panel and leaderboard rendering
    - frontend API client and auth boundary assumptions
- Runtime/build verification performed:
    - static code review
    - attempted `npm run build` in `shellsmash/srcs/requirements/frontend/src`
- Limitations:
    - Build verification could not run because `npm` is unavailable in the environment.
    - This is not a React codebase, so React-specific findings were intentionally not forced.
    - Some security conclusions remain limited by incomplete backend review outside the auth controller.

## Executive summary

The frontend shows careful handling of Phaser lifecycle edge cases, especially around resize and stale async continuations, but it is carrying too much complexity in a small number of scene files. The largest risks are in authentication boundaries, not in rendering: the dev-login flow is state-changing over `GET`, and the 42 OAuth path is still partially stubbed with TODO guards removed, which makes the login surface fragile and potentially unsafe if enabled casually.

From a product-quality perspective, the landing/auth experience is functional but accessibility is weak because the only semantic HTML area in the app is missing basic form labels, keyboard-friendly controls, and live error semantics. Maintainability is the other major concern: `HubScene`, `LandingScene`, `ShellPickerScene`, and `ProfilePanel` together hold 3,600 lines, with lifecycle defensive code spread through the scenes instead of being isolated behind smaller modules.

## Findings by severity

### Critical

- No critical issues confirmed in the reviewed scope.

### High

- Title: State-changing dev login is exposed through `GET`
    - Why it matters: authentication state should not be mutated through `GET`. This makes the flow vulnerable to accidental triggering by crawlers, prefetchers, or cross-site requests in non-production environments, and it bypasses the CSRF discipline used everywhere else.
    - Evidence:
        - frontend client calls `apiFetch('/auth/dev-login?...')` without specifying a method, so it defaults to `GET`: `shellsmash/srcs/requirements/frontend/src/src/hub/api.ts:201`
        - the entry is wired directly from the login UI when `VITE_DEV_LOGIN_ENABLED` is set: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:367`
        - backend handler is explicitly `@Get('dev-login')` and issues an auth cookie: `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts:221`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/api.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts`
        - `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts`
    - Recommended fix: change dev login to `POST`, require the same CSRF validation path used by `login/register/guest`, and keep the endpoint unreachable unless both server-side gates are enabled.

- Title: 42 OAuth flow is incomplete and lacks request integrity protection
    - Why it matters: the frontend advertises OAuth login via `api.loginUrl()`, but the backend route still has TODO guards removed and does not attach a `state` parameter. That leaves the login flow either broken or insufficiently protected against request forgery / callback confusion if turned on.
    - Evidence:
        - frontend redirects users directly into `/auth/42`: `shellsmash/srcs/requirements/frontend/src/src/hub/api.ts:180`, `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts:1901`
        - backend route comment says the guard is still TODO: `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts:178`
        - OAuth request parameters include `client_id`, `redirect_uri`, `response_type`, `scope`, but no `state`: `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts:187`
        - callback guard is also TODO, and the method only succeeds if `req.user` was populated elsewhere: `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts:200`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/api.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts`
        - `shellsmash/srcs/requirements/backend/src/src/auth/auth.controller.ts`
    - Recommended fix: do not expose the OAuth CTA until the guard is enabled end-to-end, add an OAuth `state` token tied to the user session, and verify callback integrity before issuing auth cookies.

### Medium

- Title: Landing auth UI is not accessible enough despite using real DOM inputs
    - Why it matters: this is the one part of the app where semantic HTML can help, but the current implementation still leaves screen-reader and keyboard users with weak affordances. That increases login friction and makes error recovery harder on assistive technology.
    - Evidence:
        - inputs rely on placeholders instead of labels: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:324`
        - error text is a plain `<p>` with no live-region semantics: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:337`
        - mode toggle is a clickable `<p>` rather than a button or link, so it is not keyboard-focusable by default: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:351`
        - dev login affordance is also rendered as a clickable `<p>`: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:368`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts`
    - Recommended fix: use a real `<form>`, add `<label>` elements, give errors `role="alert"` or `aria-live`, and convert text-action paragraphs into buttons or links with visible focus states.

- Title: Core UI flows are concentrated in oversized scene classes
    - Why it matters: the app is already compensating for lifecycle complexity with many stale-run and resize guards. Keeping most behavior inside a few giant files raises regression risk, makes onboarding expensive, and discourages isolated tests.
    - Evidence:
        - `HubScene.ts` is 1,960 lines and mixes auth refresh, hub rendering, overlays, leaderboard, shop, achievements and scene navigation: `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts:1`
        - `LandingScene.ts`, `ShellPickerScene.ts`, and `ProfilePanel.ts` add another 1,640 lines around the same flow surface
        - comments explicitly document repeated lifecycle hazards and duplicate-zone bugs: `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts:186`, `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts:242`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/ShellPickerScene.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/ProfilePanel.ts`
    - Recommended fix: split scenes into focused collaborators, for example `hub-auth-state`, `hub-hotspots`, `hub-modals`, `hub-leaderboard`, and `profile-panel-model`; keep scenes as orchestration shells.

- Title: Type safety drops at exactly the hub/profile boundary where state is most shared
    - Why it matters: scene-to-scene data and profile rendering depend on dynamic objects. Falling back to `any` in those zones reduces confidence in refactors and makes backend contract drift harder to catch.
    - Evidence:
        - `ProfilePanel` constructor and build path accept `user: any`: `shellsmash/srcs/requirements/frontend/src/src/hub/ProfilePanel.ts:117`, `shellsmash/srcs/requirements/frontend/src/src/hub/ProfilePanel.ts:177`
        - leaderboard fetch also degrades to `users: any[]`: `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts:1917`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/ProfilePanel.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/HubScene.ts`
    - Recommended fix: reuse the exported `User` type from `hub/api.ts`, define explicit leaderboard row shapes, and avoid untyped registry payloads where possible.

### Low

- Title: Deprecated auth scene remains in the tree and can confuse future auth work
    - Why it matters: the file is not registered, but it still documents a prior localStorage token flow. That increases the chance of someone reusing outdated auth assumptions during later maintenance.
    - Evidence:
        - file is marked deprecated and explicitly says it should be deleted later: `shellsmash/srcs/requirements/frontend/src/src/hub/AuthCallbackScene.ts:1`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/hub/AuthCallbackScene.ts`
    - Recommended fix: remove the file once the team no longer needs migration context, and keep the cookie-auth rationale in current auth docs instead.

- Title: The visual system is intentionally themed but still defaults to generic monospace typography
    - Why it matters: the app has a distinct aesthetic direction, but the shared theme falls back to a generic `monospace` stack, which weakens hierarchy and perceived polish across scenes and overlays.
    - Evidence:
        - global theme font is `monospace`: `shellsmash/srcs/requirements/frontend/src/src/shared/theme.ts:18`
        - landing overlay hardcodes `Courier New` instead of consuming a shared typographic token: `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts:39`
    - Affected files:
        - `shellsmash/srcs/requirements/frontend/src/src/shared/theme.ts`
        - `shellsmash/srcs/requirements/frontend/src/src/hub/LandingScene.ts`
    - Recommended fix: define a deliberate font stack in one place and reuse it across Phaser text and DOM overlays.

## UI / UX / Accessibility review

- Visual hierarchy is decent. The landing screen and hub have a clear mood and readable foreground/background separation.
- Responsiveness is handled more carefully than typical Phaser apps. `ResponsiveScene` and the hub’s resize logic are explicit strengths.
- Keyboard and screen-reader support are weak where HTML is used:
    - no semantic form wrapper
    - no labels
    - no live-region errors
    - click-only paragraph controls
- Touch targets inside Phaser appear reasonably large in the sampled flows, but this could not be runtime-verified.
- Error handling copy is serviceable and mostly specific.
- Empty and fallback states are present in several places, which is positive:
    - background gracefully degrades
    - inventory fetch falls back
    - hub returns to landing when the session is gone

## Stack-specific best-practices review

### React

- Not applicable. This is not a React frontend.

### Web Components

- Not applicable. This is not a Web Components frontend.

### Phaser / custom SPA observations

- Strength:
    - `ResponsiveScene` is a good abstraction for resize cleanup and avoids a class of listener leaks.
    - stale async guards in `HubScene` and `ShellPickerScene` show awareness of Phaser scene reuse semantics.
- Weakness:
    - lifecycle and navigation correctness now depend on manual guard patterns repeated across scenes.
    - scene orchestration is doing too much direct state, rendering and networking work in one layer.

## Architecture / Maintainability review

- The main structural problem is concentration of responsibilities in scene files rather than in smaller services or render helpers.
- `HubScene` is effectively acting as router, authenticated shell, modal manager, leaderboard renderer, shop host, achievements host and transition coordinator.
- `ProfilePanel` is render-heavy and data-heavy at the same time; it would benefit from a typed view-model layer.
- Shared primitives exist and are useful:
    - `ResponsiveScene`
    - `drawBackground`
    - `theme`
    - shared mechanics modules
- The codebase is showing symptoms of scaling pressure, not of low engineering effort. The next refactor should reduce coordination burden rather than restyle everything.

## Security review

- Confirmed issue:
    - state-changing dev login over `GET`
- Probable risk:
    - unfinished 42 OAuth flow should not be user-exposed until the guard and `state` validation are complete
- Healthy patterns observed:
    - cookie-based auth instead of localStorage token storage
    - CSRF token attached for state-changing standard auth calls
    - explicit logout path using `DELETE`
- Frontend-only limits:
    - authorization enforcement on game data, progression and customization was not fully audited server-side
    - cookie flags and reverse-proxy behavior were only inferred from the auth controller, not verified at runtime

## Cross-cutting improvements

- Introduce a thin application service layer around auth, hub data, and profile data so scenes stop mixing fetch logic with rendering and navigation.
- Replace ad hoc scene payload objects and `any` usage with typed DTOs shared from `hub/api.ts`.
- Standardize interaction components for both DOM and Phaser controls:
    - button semantics
    - focus behavior
    - disabled/loading states
    - analytics / logging hooks if needed
- Gate incomplete auth features behind server-confirmed capability flags rather than frontend env toggles alone.

## Prioritized action plan

1. Immediate fixes
    - Convert dev login to `POST` + CSRF.
    - Remove or hard-disable the 42 OAuth CTA until the backend flow is complete and protected with `state`.
2. Short-term cleanup
    - Fix landing form semantics and keyboard accessibility.
    - Replace `any` with shared DTO types in profile and leaderboard code.
3. Structural improvements
    - Split `HubScene` into smaller collaborators and move fetch/state coordination out of the scene class.
    - Introduce typed scene payload helpers for registry and `scene.start()` data.
4. Optional polish
    - unify typography tokens across DOM and Phaser text
    - remove deprecated auth files once migration context is no longer needed

## Open questions / assumptions

- The requested skill targeted React, but this repository frontend is Phaser/Vite rather than React. The audit was adapted to the actual stack.
- I did not verify whether the reverse proxy currently hides `/auth/42` and `/auth/dev-login` in every non-dev deployment path.
- I did not run the frontend build because `npm` is unavailable in this environment.
