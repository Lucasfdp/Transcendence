# Frontend Cards and Gambling Migration — 7 Phases

## Purpose

This document turns the Migration Sequence in `docs/frontend-cards-and-gambling-modularisation-plan.md` into 7 independently mergeable phases. Each phase is one PR, one revert point, and one validation gate. It also folds in the fixes for the three gaps and one risk identified when that plan was reviewed against the current codebase.

Nothing here changes scope, ownership rules, or non-goals from the original plan. This is execution sequencing only.

## Cross-cutting rules for every phase

- One phase = one PR. Do not merge phase N+1 until phase N's PR is merged and its validation gate passes.
- Run the full gate from the original plan's "Automated Validation" section (`npm run test:run`, `npm run build`, the `test -d`/`find`/`rg` checks scoped to `frontend/src`, `git diff --check`) at the end of every phase, not only at the end of the migration. Catching a stale import in phase 2 is cheap; catching it in phase 6 after three more phases sit on top of it is not.
- Phase 1 is the designated rollback checkpoint: it touches only `services/api/apiClient.ts` and how `features/hub/api.ts` consumes it, with no Cards/Gambling ownership changes yet. If anything downstream goes wrong, phases 2–7 can be reverted independently without touching the transport extraction.

## Phase 1 — Extract the common API client

Scope: create `services/api/apiClient.ts`; move transport, CSRF, retry, upload, response parsing, `AuthError`/`NetworkError` out of `features/hub/api.ts`; make the Hub client consume it without changing its public behaviour; move tests to `services/api/apiClient.test.ts`.

Gate: `apiClient.test.ts` covers the same cases as the current `features/hub/api.test.ts` transport tests (safe GET retries, explicit idempotent mutation retries, non-idempotent gating, exhausted retries, non-transient failures, normal/empty upload responses); confirm no feature client calls `fetch` directly.

Risk fix applied: this phase is deliberately the smallest and safest — it is the checkpoint everything else can be rolled back to.

## Phase 2 — Establish the Cards feature

Scope: move Cards contracts out of `features/hub/api.ts`; create `cardsApi` on the new transport; move `binderFilters.ts`, `cardTilt.ts`, `shared/card-drop-popup.ts` and their tests into `features/cards`; consolidate shared Cards labels/constants without changing copy, glyphs, colours, or ordering; update `ProgressionResult.cardDrop` to a type-only `PackPull` import from Cards.

Gate: `getCards()`/`openCardPack()` still hit `GET /cards` and `POST /cards/packs/open` with identical payloads; Phaser card-drop consumers still resolve `showCardDropPopup` correctly.

Gap fix applied: `docs/handoff-shell-cards-bug-audit.md:28` references `components/cards/binderFilters.ts` and `cardTilt.ts` by their current path. Flag this line for correction in Phase 7 rather than letting it silently go stale — add it to the Phase 7 checklist now so it isn't missed.

## Phase 3 — Split Cards presentation

Scope: extract `CardSlot`, `CardLightbox`, `RevealOverlay`, `CardRarityBadge` from `ShellCardsModal.tsx`; update existing component tests to import each component from its own file; leave only `.tsx`/`.test.tsx` files in `components/cards`.

Gap fix applied — split this phase into two commits reviewed separately, not bundled:
- Commit 3a (mechanical): pure extraction — move JSX/props out of `ShellCardsModal.tsx` into the four new files, repoint existing tests, no new behaviour or new test cases. This is a like-for-like diff and should review as one.
- Commit 3b (net-new): add focused coverage for `CardRarityBadge`, since it currently has no dedicated test file. This is the only place in the whole migration where new test code is written, so it deserves its own reviewer attention rather than hiding inside a "just moving files" commit.

Gate: focus trap, keyboard activation, lightbox, pack reveal, retry, and balance behaviour in `ShellCardsModal` are unchanged after 3a; `CardRarityBadge.test.tsx` passes after 3b.

## Phase 4 — Establish the Gambling feature

Scope: move all gambling contracts out of `features/hub/api.ts`; rename `CasinoGame` → `GamblingGame` throughout the frontend; create `gamblingApi` on the shared transport; move `board-canvas.ts`, `dice.ts`, `drop-path.ts`, `fairness.ts`, `flip.ts`, `flip-rotation.ts`, `monte.ts`, `plinko.ts`, `shuffle.ts`, `slots.ts`, `spin-rotation.ts`, `wheel.ts` and their tests (including `monte.test.ts`) from `components/casino` into `features/gambling`.

Gate: fairness messages, HMAC derivation, thresholds, outcome identifiers, multiplier calculations, and neutral-return checks are byte-identical to pre-move behaviour.

Gap fix applied: before merging, diff the moved fairness/rule logic against the two audit documents that pin down current behaviour with line-anchored references — `docs/casino-audit-report.md` (e.g. `fairness.ts:201-209`, `fairness.ts:150-171`, `board-canvas.ts:170-173`, `ThreeShellMonteModal.tsx:537`) and `docs/monte-shuffle-hardening.md` (references `fairness.ts`). These line numbers will be invalidated by the move regardless of whether behaviour changes, so:
1. Confirm behaviourally nothing drifted (the actual regression check).
2. Record the old→new file/line mapping for the specific findings those two docs cite, so Phase 7 can update references precisely instead of doing a blind find-and-replace.

## Phase 5 — Rename the Gambling presentation directory

Scope: rename `components/casino` → `components/gambling`; keep the six modals and their React interface tests; move `useReducedMotion.ts` to `hooks/`; update modal imports to the Gambling public API and generic hook; update `HomePage.tsx` and all other consumers.

Gate: all six modals render and animate as before under both normal and reduced-motion paths; `animation-coin-sync.test.tsx` still verifies all six games publish the authoritative coin balance at the correct point.

Gap fix applied: only 3 of the 6 modals currently have test files (`KoiDiceModal.test.tsx`, `ShellDropModal.test.tsx`, `ThreeShellMonteModal.test.tsx` exist; `FortuneWheelModal.tsx`, `ShellFlipModal.tsx`, `ShrineSlotsModal.tsx` do not). This is a pre-existing coverage gap, not something this rename phase introduces or is obligated to fix — per the original plan's Non-Goals, this migration adds no new functionality. Calling it out explicitly here so it isn't mistaken for scope creep mid-review, and so it can be raised separately as its own follow-up if wanted.

## Phase 6 — Remove obsolete ownership

Scope: remove Cards/Gambling contracts and methods from the Hub API surface; delete old `components/casino`, `components/cards/binderFilters.ts`, `components/cards/cardTilt.ts`, `shared/card-drop-popup.ts`; no compatibility re-exports or duplicate constants; full repo search for stale imports and type names.

Gate: this is the highest-risk phase because it deletes rather than adds. Run the complete Automated Validation block from the original plan in full (not spot checks) before merge:
```bash
cd frontend && npm run test:run
cd frontend && npm run build
test ! -d frontend/src/components/casino
test ! -f frontend/src/shared/card-drop-popup.ts
test ! -f frontend/src/components/cards/binderFilters.ts
test ! -f frontend/src/components/cards/cardTilt.ts
find frontend/src/components/cards frontend/src/components/gambling -type f ! -name '*.tsx' -print
rg 'components/casino|shared/card-drop-popup|CasinoGame' frontend/src
rg 'features/hub/api' frontend/src/components/cards frontend/src/components/gambling frontend/src/features/cards frontend/src/features/gambling
git diff --check
```

Risk fix applied: because deletion is irreversible in a way file moves aren't, this phase should not be combined with any other phase's changes, and should be the one phase where the gate above blocks merge rather than being run only at the very end of the whole migration.

## Phase 7 — Update living documentation

Scope: update docs that describe `features/hub/api.ts`, `components/casino`, or `shared/card-drop-popup` as current ownership; keep backend `casino` terminology and `/casino/*` routes untouched; do not edit `docs/deprecated/` or `docs/old_docs/`; review `docs/modules-progress.md` and update it only if a separate functional module requirement was completed, not for this structural move.

Gap fix applied — concrete list of docs confirmed (via search) to reference paths that moved, to update precisely rather than guessing:
- `docs/handoff-shell-cards-bug-audit.md` — the "Frontend:" file map (was line 25-29) was corrected during Phase 2/3 to point at `features/cards/` and the split `components/cards/` files. Its M1 (was L489-505), M3 (was L235-331), and M4 (was L470-487 + L507-508) bug entries still cite `ShellCardsModal.tsx` line ranges from before the Phase 3 split — those bugs are already fixed (the current code implements the documented fix), so the line numbers are historical evidence rather than a live pointer; still worth an accuracy pass in Phase 7 since M1's fix now lives in `ShellCardsModal.tsx`'s `handleOpenPack` (unchanged file, shifted lines) while M3's reveal-focus-trap code moved entirely into `RevealOverlay.tsx`.
- `docs/casino-audit-report.md` — update the specific line-anchored references to `board-canvas.ts`, `fairness.ts`, `ThreeShellMonteModal.tsx` using the old→new mapping recorded in Phase 4; do not leave stale line numbers.
- `docs/monte-shuffle-hardening.md` — update its `fairness.ts` reference the same way.
- `docs/vector-rendering-report-2026-07-11.md` — check its `components/casino` reference and update if it describes current ownership rather than a historical snapshot. Its `shared/card-drop-popup.ts` reference was already corrected during Phase 2 (moved to `features/cards/cardDropPopup.ts`).
- `docs/deprecated/proposals/casino-new-games-handoff.md` — leave untouched; it is archived material per the original plan's non-goals.

Gate: `rg 'components/casino|shared/card-drop-popup' docs` (excluding `docs/deprecated/`, `docs/old_docs/`, and this phases document and the original modularisation plan, both of which legitimately discuss the old paths historically) returns nothing describing current ownership.
