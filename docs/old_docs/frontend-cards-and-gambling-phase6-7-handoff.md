# Handoff: Phases 5, 6 & 7 of the Cards/Gambling Modularisation

## Who this is for

Another agent picking up this migration cold, with no memory of the session that did Phases 1-4. Read this document plus the two linked below before touching anything:

- `docs/frontend-cards-and-gambling-modularisation-plan.md` — the original plan (scope, non-goals, full Automated Validation block).
- `docs/frontend-cards-and-gambling-migration-phases.md` — the 7-phase execution plan with gap-fixes. Phase 5 (§51-57), Phase 6 (§59-77), and Phase 7 (§79-90) are your scope. This handoff does not replace that document — it supplements it with the current, concrete state of the repo so you don't have to re-derive it.

Do not re-plan. Phases 1-4 already decided the target shape for Cards and Gambling logic/API extraction; your job is to rename the Gambling presentation directory (Phase 5), finish deleting the old ownership (Phase 6), and correct the documentation (Phase 7) against that already-decided shape.

**Do these three phases as three separate PRs, in order, each with its own gate.** Phase 6 in particular must not be combined with anything else (see its own section below).

## Current repo state (as of 2026-07-15, before Phase 5)

```
frontend/src/components/casino/
  FortuneWheelModal.tsx        (no dedicated test file — pre-existing gap, not yours to fix)
  KoiDiceModal.tsx + .test.tsx
  ShellDropModal.tsx + .test.tsx
  ShellFlipModal.tsx           (no dedicated test file — pre-existing gap)
  ShrineSlotsModal.tsx         (no dedicated test file — pre-existing gap)
  ThreeShellMonteModal.tsx + .test.tsx
  animation-coin-sync.test.tsx (cross-modal coin-sync regression suite)
  useReducedMotion.ts

frontend/src/features/gambling/   (done — Phase 4)
  contracts.ts, gamblingApi.ts (+.test.ts), index.ts,
  board-canvas.ts, dice.ts, drop-path.ts, fairness.ts, flip.ts, flip-rotation.ts,
  monte.ts (+.test.ts), plinko.ts, shuffle.ts, slots.ts, spin-rotation.ts, wheel.ts

frontend/src/features/cards/      (done — Phase 2/3)
  contracts.ts, cardsApi.ts (+.test.ts), index.ts, labels.ts,
  binderFilters.ts (+.test.ts), cardTilt.ts (+.test.ts), cardDropPopup.ts (+.test.ts)

frontend/src/components/cards/    (done — Phase 3)
  ShellCardsModal.tsx (+.test.tsx) — orchestration only
  CardSlot.tsx, CardLightbox.tsx, RevealOverlay.tsx, CardRarityBadge.tsx (+ each .test.tsx)

frontend/src/hooks/
  useDialogFocusTrap.ts, useSessionGate.ts   (useReducedMotion.ts is NOT here yet — that's Phase 5's job)
```

Confirmed by direct grep (2026-07-15) — the **only** files anywhere in `frontend/src` that reference `components/casino` are `pages/HomePage.tsx` (real imports of all six modals) and `features/gambling/index.ts` (a forward-looking code comment, not an import). No other page, route, test, or Phaser scene touches `components/casino`. This means Phase 5's consumer-update surface is small and fully enumerated below — you should not need to go hunting for hidden consumers.

## Phase 5 — Rename the Gambling presentation directory

Scope per the migration-phases doc (§51-57): rename `components/casino` → `components/gambling`; move `useReducedMotion.ts` to `hooks/`; update modal imports to the Gambling public API and the generic hook; update `HomePage.tsx` and all other consumers. **No logic changes, no behavior changes** — this is a pure rename/move phase.

### Steps

1. **Move the hook first, on its own:**
   ```bash
   git mv frontend/src/components/casino/useReducedMotion.ts frontend/src/hooks/useReducedMotion.ts
   ```
   Then update the import in all six modals from `import { useReducedMotion } from "./useReducedMotion";` to `import { useReducedMotion } from "../../hooks/useReducedMotion";`. Confirmed consumers (grepped 2026-07-15): `FortuneWheelModal.tsx:17`, `KoiDiceModal.tsx:20`, `ShellFlipModal.tsx:22`, `ThreeShellMonteModal.tsx:14`, `ShrineSlotsModal.tsx:22`, `ShellDropModal.tsx:23`. No test file imports the hook directly — the tests stub `globalThis.matchMedia` instead (see `ShellDropModal.test.tsx`'s `beforeEach`), so test files need no import changes for this hook.

2. **Rename the directory:**
   ```bash
   git mv frontend/src/components/casino frontend/src/components/gambling
   ```
   This carries all 9 remaining files (6 modals + their 3 test files + `animation-coin-sync.test.tsx`) across in one move — their *internal* content and imports of `../../features/gambling` (added in Phase 4) don't need to change, only the directory name.

3. **Update `pages/HomePage.tsx`** (the only real consumer) — six import lines, `../components/casino/X` → `../components/gambling/X`:
   ```
   Line 16: FortuneWheelModal
   Line 17: KoiDiceModal
   Line 18: ShellDropModal
   Line 19: ShellFlipModal
   Line 20: ThreeShellMonteModal
   Line 21: ShrineSlotsModal
   ```
   (Line numbers as of 2026-07-15 — confirm before a blind sed, other work may have shifted them.)

4. **Update the forward-looking comment in `features/gambling/index.ts`** (currently reads "Consumers outside this feature (components/casino today, components/gambling ..." — presumably it already anticipates this rename; just drop the "today"/future-tense framing now that the rename is real).

5. **Do NOT rename** the `"casino"` string literal used as a React state value in `HomePage.tsx` (`activeModal === "casino"`, `GAMBIT_BUTTON_IMAGES.casino`) or any backend `casino.*` file/route. Those are unrelated to this directory rename — the state key and asset-map key are internal identifiers, not ownership paths, and backend `casino` naming is explicitly out of scope (see "Do not touch" under Phase 7 below). Renaming them would be scope creep beyond what the plan asks for.

### Gate

- All six modals still render and animate correctly under both normal and reduced-motion paths (manually verify at least one wagered round per modal, per `CLAUDE.md`'s guidance to document manual validation when frontend test coverage is incomplete).
- `animation-coin-sync.test.tsx` still passes and still verifies all six games publish the authoritative coin balance at the correct point (this test's assertions don't change, only its file location).
- `KoiDiceModal.test.tsx`, `ShellDropModal.test.tsx`, `ThreeShellMonteModal.test.tsx` still pass unmodified in content (only their directory moved).
- Full suite + build:
  ```bash
  cd frontend && npm run test:run
  cd frontend && npm run build
  test -d frontend/src/components/gambling
  test ! -d frontend/src/components/casino
  test -f frontend/src/hooks/useReducedMotion.ts
  test ! -f frontend/src/components/casino/useReducedMotion.ts
  rg 'components/casino' frontend/src   # expect empty
  ```

### Known pre-existing gap — not yours to fix in Phase 5

Three of the six gambling modals (`FortuneWheelModal.tsx`, `ShellFlipModal.tsx`, `ShrineSlotsModal.tsx`) have no dedicated test file. This predates this entire migration and is explicitly out of scope per the original plan's non-goals (no new functionality/coverage added beyond what Phase 3's `CardRarityBadge.test.tsx` already added as the one deliberate exception). Don't add tests for these three — that would be scope creep. Flag it as a follow-up if you want, but not inside this phase's diff.

## Phase 6 — Remove obsolete ownership

**This is the highest-risk phase in the whole migration: it deletes, it doesn't add.** Do not combine it with Phase 5 or Phase 7. One PR, full gate before merge, not spot checks. Requires Phase 5 merged first — everything below assumes `components/gambling` already exists and `components/casino` is already gone.

### What no longer needs deleting (already done in Phases 1-4)

- `features/hub/api.ts` no longer has Cards or Gambling contracts/methods on it — verified clean by grep in the Phase 4 gate (`CasinoGame`, gambling method names, and gambling types all absent). Confirm this is still true (someone could have reverted or re-added something):
  ```bash
  grep -n "CasinoGame\|getWheel\|dropPlinko\|startMonteRound" frontend/src/features/hub/api.ts
  ```
  Expect zero matches. If there are matches, something regressed since Phase 4 — stop and investigate before deleting anything.
- `components/cards/binderFilters.ts`, `components/cards/cardTilt.ts`, `shared/card-drop-popup.ts` — already deleted in Phase 2. Confirm:
  ```bash
  test ! -f frontend/src/components/cards/binderFilters.ts && test ! -f frontend/src/components/cards/cardTilt.ts && test ! -f frontend/src/shared/card-drop-popup.ts && echo "already gone"
  ```
- The pure-logic files (`board-canvas.ts`, `dice.ts`, `fairness.ts`, etc.) were **moved**, not copied, into `features/gambling` in Phase 4 — there's no duplicate copy left in `components/gambling` (formerly `components/casino`) to delete. Confirm:
  ```bash
  find frontend/src/components/gambling -type f ! -name '*.tsx' ! -name '*.ts' -print   # sanity, expect empty
  ls frontend/src/components/gambling/*.ts 2>/dev/null   # expect "No such file" — the hook moved to hooks/ in Phase 5
  ```

### What Phase 6 actually still needs to do

Full repo-wide search for stale imports and type names — this is the actual remaining work:
```bash
cd frontend && npm run test:run
cd frontend && npm run build
rg 'components/casino|shared/card-drop-popup|CasinoGame' frontend/src
rg 'features/hub/api' frontend/src/components/cards frontend/src/components/gambling frontend/src/features/cards frontend/src/features/gambling
git diff --check
```
The two `rg` checks are what matter most: they catch any lingering import of the old paths/names that Phases 1-5 might have missed in a file nobody touched (e.g., a Phaser scene, a shared util, a test fixture). No compatibility re-exports, no duplicate constants — if either check turns up a consumer still importing from the old location, fix the import at the call site, don't add a re-export shim to paper over it.

### Known pre-existing gaps — not yours to fix in Phase 6

Same three untested modals as Phase 5 — still not your problem to fix here either.

## Phase 7 — Update living documentation

Per `docs/frontend-cards-and-gambling-migration-phases.md` §79-90 and the original plan's non-goals: do not touch `docs/deprecated/`, `docs/old_docs/`, or backend `casino` terminology/`/casino/*` routes (those are intentionally unchanged — only the frontend directory naming moved).

### Already done — do not redo

The Phase 4 validation gate (2026-07-15) got ahead of Phase 7 on two documents. Read the current state of these files before changing anything; most of the Phase 4-caused staleness is already fixed:

- **`docs/casino-audit-report.md`** — already updated for:
  - The `apiFetch`/idempotent-retry reference (path now points at `services/api/apiClient.ts`, done in Phase 1).
  - `board-canvas.ts:170-173` and `fairness.ts:150-171` path references now point at `features/gambling/` (line numbers were verified unchanged during the move, so only the path prefix changed).
  - `verifyDice`'s underscored-params reference corrected from a stale `fairness.ts:201-209` to the verified-correct `fairness.ts:278-286`.
  - The Monte "`changeShells` clears state" claim corrected: no function or state named `changeShells`/`finalPositions` exists anywhere in the current `ThreeShellMonteModal.tsx`. The actual equivalent is `resetBoard` (`ThreeShellMonteModal.tsx:269-279`). This predates Phase 4 — Monte used to have a shell-count selector that was removed at some earlier, unrelated point; a code comment in `ShellDropModal.tsx:468-469` still says `changeShells` and should be updated to say `resetBoard` (**this one is still open — see below**).
  - Section 2.3 ("Shell Drop: switching row tier after a result desyncs the whole board") is now marked **already fixed** in the doc — verified against current code (`ShellDropModal.tsx:463-473`) and the passing regression test `ShellDropModal.test.tsx` ("should clear a landed result when the player switches row tiers afterward"). The original line-anchors (`:365-367`, `:393`, `:250-273`, `:408-420`) are preserved struck-through for history but flagged as stale by ~40-140 lines — that drift predates Phase 4 and was not chased down precisely (see "Still open" below).
  - `ThreeShellMonteModal.tsx` was removed from the list of modals said to use the `runBoardAnimation`/`finish()` pattern (§17-26 of the doc) — it never used that pattern; `onCoinsChange` is called inline in `startRound`/`resolveRound` (`ThreeShellMonteModal.tsx:233`, `:253`). This was a pre-existing doc error, unrelated to Phase 4.
- **`docs/monte-shuffle-hardening.md`** — checked, needs no change. Its `fairness.ts` reference is a bare filename with no path prefix or line numbers, so it survived the Phase 4 move without going stale.
- **`docs/handoff-shell-cards-bug-audit.md`** — the "Frontend:" file map was already corrected during Phase 2/3.

### Still open — this is your real Phase 7 work

1. **`docs/casino-audit-report.md`, five modal line-anchors.** `FortuneWheelModal.tsx`, `KoiDiceModal.tsx`, `ShellFlipModal.tsx`, `ShrineSlotsModal.tsx`, `ShellDropModal.tsx` each have `finish()`/cancel-effect line ranges cited in the doc (originally e.g. `FortuneWheelModal.tsx:200-221`) that no longer match — spot-checking `FortuneWheelModal.tsx` during the Phase 4 gate found `finish()` actually at line 230, a ~30-line gap far larger than anything Phase 4's import-only edits could cause. This drift predates Phase 4 and was deliberately **not** hand-patched (re-numbering five files under time pressure risks encoding new wrong numbers with false confidence). Your job: open each of the five files (now under `components/gambling/` after Phase 5), find the actual current line ranges for (a) the mount-effect's `cancelled = true` cleanup block and (b) the `finish()` function, and correct the doc for real — including updating the path prefix from `components/casino/` to `components/gambling/` while you're at it.
2. **`components/gambling/ShellDropModal.tsx` code comment** (was `:468-469` before Phase 5's rename shifts it — re-locate it) still says "see ThreeShellMonte's `changeShells`, which follows the same pattern" — update it to reference `resetBoard` instead, since `changeShells` doesn't exist in the codebase. This is a one-line code comment fix, not a docs-folder fix, but it's the same underlying staleness `docs/casino-audit-report.md` now flags, so fix both together.
3. **`docs/handoff-shell-cards-bug-audit.md` M1/M3/M4 entries** — per the migration-phases doc (§84), these still cite pre-Phase-3-split `ShellCardsModal.tsx` line ranges for bugs that are already fixed in the current code. M1's fix now lives in `ShellCardsModal.tsx`'s `handleOpenPack` (same file, shifted lines — check current line numbers). M3's reveal-focus-trap fix moved entirely into `RevealOverlay.tsx` (different file now, not just shifted lines — update the file reference, not just the line numbers). M4 spans two old ranges; re-locate both.
4. **`docs/vector-rendering-report-2026-07-11.md` line 27** — currently reads `components/casino/FortuneWheelModal.tsx` (correct as of 2026-07-15, before Phase 5). Update to `components/gambling/FortuneWheelModal.tsx` once Phase 5 has landed. (Its `board-canvas.ts` reference on line 30 was already corrected in the Phase 4 gate to `features/gambling/board-canvas.ts` — don't touch that one again.)
5. **Directory-rename fallout from Phase 5** — once `components/casino` → `components/gambling` is merged, grep the whole `docs/` tree for remaining `components/casino` references (excluding `docs/deprecated/`, `docs/old_docs/`, the modularisation plan, and the migration-phases doc, all of which legitimately discuss the old path historically):
   ```bash
   rg 'components/casino|shared/card-drop-popup' docs --glob '!docs/deprecated/**' --glob '!docs/old_docs/**' --glob '!docs/frontend-cards-and-gambling-modularisation-plan.md' --glob '!docs/frontend-cards-and-gambling-migration-phases.md' --glob '!docs/frontend-cards-and-gambling-phase6-7-handoff.md'
   ```
   This is the Phase 7 gate from the migration-phases doc (§90) — it should return nothing once you're done.
6. **`docs/modules-progress.md`** — checked during the Phase 4 gate; this migration doesn't complete a functional module milestone (it's a structural refactor), so per CLAUDE.md and the migration-phases doc's own instruction (§81), no update is warranted unless you discover otherwise while doing Phases 5-7. Don't add an entry just because a doc-touching phase feels like it should log something.

### Do not touch

- `docs/deprecated/proposals/casino-new-games-handoff.md` — archived, leave it.
- Backend `casino.service.ts`, `casino.controller.ts`, `casino.fair.ts`, `/casino/*` routes, and any doc describing them — naming there is intentionally unchanged; only the frontend directory naming moved.
- The `"casino"` string literal used as `HomePage.tsx`'s `activeModal` state value and `GAMBIT_BUTTON_IMAGES.casino` asset-map key — these are internal identifiers, not ownership paths, and renaming them is not part of this migration's scope (see Phase 5, step 5).

## Validation gate to run before calling Phases 5-7 done

Run this once all three phases have landed (it supersedes the per-phase gates above as the final check):

```bash
cd frontend && npm run test:run
cd frontend && npm run build
test -d frontend/src/components/gambling
test ! -d frontend/src/components/casino
test -f frontend/src/hooks/useReducedMotion.ts
test ! -f frontend/src/shared/card-drop-popup.ts
test ! -f frontend/src/components/cards/binderFilters.ts
test ! -f frontend/src/components/cards/cardTilt.ts
find frontend/src/components/cards frontend/src/components/gambling -type f ! -name '*.tsx' -print
rg 'components/casino|shared/card-drop-popup|CasinoGame' frontend/src
rg 'features/hub/api' frontend/src/components/cards frontend/src/components/gambling frontend/src/features/cards frontend/src/features/gambling
git diff --check
rg 'components/casino|shared/card-drop-popup' docs --glob '!docs/deprecated/**' --glob '!docs/old_docs/**' --glob '!docs/frontend-cards-and-gambling-modularisation-plan.md' --glob '!docs/frontend-cards-and-gambling-migration-phases.md' --glob '!docs/frontend-cards-and-gambling-phase6-7-handoff.md'
```

All of the above should come back clean/empty before merging. If the sandbox you're running in produces a spurious `dist/.DS_Store` `EPERM` error on `npm run build`, that's an environment artifact, not a regression — confirm by building to a scratch `--outDir` instead (e.g. `npx vite build --outDir /tmp/dist-check`) before concluding the build is broken.
